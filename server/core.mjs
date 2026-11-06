// The bug board: validation, rate limiting, storage and the HTTP handler.
// Node built-ins only, no build step — this file runs as-is on the VPS and is
// imported as-is by the vitest tests next to it.

import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

export const LIMITS = Object.freeze({
  messageMin: 3,
  messageMax: 500,
  nameMax: 40,
  bodyBytes: 4096,
  maxReports: 500,
});

export const TYPES = Object.freeze(['bug', 'suggestion']);

// C0/C1 controls except \n and \t, plus the bidi overrides and zero-width
// characters that let text pretend to be something it is not.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g;

/** Length in code points, so an emoji counts as one character, as people expect. */
const length = (text) => [...text].length;

function clean(text, { multiline }) {
  let out = text.normalize('NFC').replace(/\r\n?/g, '\n').replace(CONTROL, '').replace(/\t/g, ' ');
  if (!multiline) out = out.replace(/\n+/g, ' ');
  // Keep paragraph breaks, drop walls of blank lines.
  out = out.replace(/[ ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

/**
 * Checks an untrusted POST body.
 * @returns {{ ok: true, value: { type: string, message: string, name: string | null }, spam: boolean }
 *         | { ok: false, error: string }}
 */
export function validateReport(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'Expected a JSON object.' };
  }
  const { type, message, name, website } = input;

  if (typeof type !== 'string' || !TYPES.includes(type)) {
    return { ok: false, error: 'Pick "bug" or "suggestion".' };
  }
  if (typeof message !== 'string') return { ok: false, error: 'Write a message.' };
  // Refuse absurd input before normalising it, not after.
  if (message.length > LIMITS.messageMax * 4) return { ok: false, error: 'That message is too long.' };
  const cleanMessage = clean(message, { multiline: true });
  if (length(cleanMessage) < LIMITS.messageMin) return { ok: false, error: 'Write a bit more than that.' };
  if (length(cleanMessage) > LIMITS.messageMax) {
    return { ok: false, error: `Keep it under ${LIMITS.messageMax} characters.` };
  }

  let cleanName = null;
  if (name !== undefined && name !== null) {
    if (typeof name !== 'string' || name.length > LIMITS.nameMax * 4) {
      return { ok: false, error: 'That name is not valid.' };
    }
    cleanName = clean(name, { multiline: false }) || null;
    if (cleanName && length(cleanName) > LIMITS.nameMax) {
      return { ok: false, error: `Names are ${LIMITS.nameMax} characters at most.` };
    }
  }

  // Honeypot: a field people never see. Bots that fill every input get a
  // cheerful 201 and are never stored.
  const spam = typeof website === 'string' && website.length > 0;
  return { ok: true, value: { type, message: cleanMessage, name: cleanName }, spam };
}

/** Fixed number of hits per sliding window, per key. Memory is bounded. */
export class RateLimiter {
  constructor({ limit, windowMs, maxKeys = 10_000, now = () => Date.now() }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.now = now;
    /** @type {Map<string, number[]>} */
    this.hits = new Map();
  }

  /** Records a hit if allowed. @returns {{ ok: boolean, retryAfterMs: number }} */
  take(key) {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return { ok: false, retryAfterMs: this.windowMs - (now - recent[0]) };
    }
    recent.push(now);
    this.hits.delete(key); // re-insert so Map order is least-recently-used first
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) this.prune(now);
    return { ok: true, retryAfterMs: 0 };
  }

  prune(now = this.now()) {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
    // Still too many live keys (a flood from many addresses): drop the oldest.
    for (const key of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys) break;
      this.hits.delete(key);
    }
  }
}

/** Compares secrets in constant time, whatever their lengths. */
export function sameSecret(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || expected.length === 0) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** The reports, held in memory and mirrored to one JSON file with atomic writes. */
export class Store {
  constructor(file) {
    this.file = file;
    this.data = { nextId: 1, reports: [] };
    this.queue = Promise.resolve();
  }

  async load() {
    let text;
    try {
      text = await readFile(this.file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return this;
      throw error;
    }
    const data = JSON.parse(text); // a corrupt file stops the service rather than being overwritten
    if (!Array.isArray(data.reports) || !Number.isInteger(data.nextId)) {
      throw new Error(`${this.file} does not look like a bug board`);
    }
    this.data = data;
    return this;
  }

  list() {
    return [...this.data.reports].reverse();
  }

  get size() {
    return this.data.reports.length;
  }

  hasDuplicate(message) {
    const key = message.toLowerCase();
    return this.data.reports.some((r) => r.message.toLowerCase() === key);
  }

  async add({ type, message, name }, now = new Date()) {
    const report = { id: this.data.nextId++, type, message, name, createdAt: now.toISOString() };
    this.data.reports.push(report);
    await this.save();
    return report;
  }

  async remove(id) {
    const index = this.data.reports.findIndex((r) => r.id === id);
    if (index === -1) return false;
    this.data.reports.splice(index, 1);
    await this.save();
    return true;
  }

  /** Writes a temp file, fsyncs it, renames it over the real one. Writes are serialised. */
  save() {
    const snapshot = JSON.stringify(this.data, null, 2) + '\n';
    const run = async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      const handle = await open(tmp, 'w', 0o600);
      try {
        await handle.writeFile(snapshot);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await rename(tmp, this.file);
      } catch (error) {
        await unlink(tmp).catch(() => {});
        throw error;
      }
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }
}

/**
 * The client address. Behind Caddy the socket is always 127.0.0.1, so the
 * address comes from X-Forwarded-For — the right-most entry, which is the one
 * Caddy itself appended and the client cannot forge.
 */
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      const parts = forwarded.split(',');
      return parts[parts.length - 1].trim();
    }
  }
  return req.socket.remoteAddress ?? 'unknown';
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > maxBytes) {
      reject(new HttpError(413, 'That is too much text.'));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    const onData = (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        // Stop keeping it, but let it drain so the 413 still reaches the client.
        req.off('data', onData);
        req.resume();
        reject(new HttpError(413, 'That is too much text.'));
        return;
      }
      chunks.push(chunk);
    };
    req.on('data', onData);
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, body, extraHeaders = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(payload);
}

/**
 * @param {{ store: Store, adminKey?: string, trustProxy?: boolean,
 *           postLimiter?: RateLimiter, authLimiter?: RateLimiter, log?: (msg: string) => void }} options
 */
export function createHandler({
  store,
  adminKey = '',
  trustProxy = true,
  postLimiter = new RateLimiter({ limit: 5, windowMs: 10 * 60_000 }),
  authLimiter = new RateLimiter({ limit: 10, windowMs: 15 * 60_000 }),
  log = () => {},
}) {
  async function route(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '');
    const ip = clientIp(req, trustProxy);

    if (path === '/api/health' && req.method === 'GET') {
      return send(res, 200, { ok: true, reports: store.size });
    }

    if (path === '/api/bugs') {
      if (req.method === 'GET' || req.method === 'HEAD') {
        return send(res, 200, { reports: store.list(), limits: LIMITS });
      }
      if (req.method === 'POST') {
        const type = String(req.headers['content-type'] ?? '');
        if (!type.toLowerCase().startsWith('application/json')) {
          throw new HttpError(415, 'Send JSON.');
        }
        const raw = await readBody(req, LIMITS.bodyBytes);
        let input;
        try {
          input = JSON.parse(raw);
        } catch {
          throw new HttpError(400, 'That was not valid JSON.');
        }
        const checked = validateReport(input);
        if (!checked.ok) throw new HttpError(400, checked.error);

        const allowed = postLimiter.take(ip);
        if (!allowed.ok) {
          const seconds = Math.ceil(allowed.retryAfterMs / 1000);
          return send(
            res,
            429,
            { error: `Slow down a little: try again in ${Math.ceil(seconds / 60)} min.` },
            { 'Retry-After': String(seconds) },
          );
        }
        if (checked.spam) return send(res, 201, { report: null });
        if (store.hasDuplicate(checked.value.message)) {
          throw new HttpError(409, 'Someone already reported exactly that. Thanks anyway!');
        }
        if (store.size >= LIMITS.maxReports) {
          throw new HttpError(503, 'The board is full right now. Try again after Simon tidies up.');
        }
        const report = await store.add(checked.value);
        log(`added #${report.id} (${report.type}) from ${ip}`);
        return send(res, 201, { report });
      }
      throw new HttpError(405, 'Method not allowed.');
    }

    const match = /^\/api\/bugs\/(\d{1,9})$/.exec(path);
    if (match) {
      if (req.method !== 'DELETE') throw new HttpError(405, 'Method not allowed.');
      if (!adminKey) throw new HttpError(503, 'Deleting is disabled: the server has no admin key.');
      const header = String(req.headers.authorization ?? '');
      const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      if (!sameSecret(given, adminKey)) {
        if (!authLimiter.take(ip).ok) throw new HttpError(429, 'Too many wrong keys. Wait a while.');
        log(`rejected delete from ${ip}`);
        throw new HttpError(401, 'Wrong or missing admin key.');
      }
      const id = Number(match[1]);
      if (!(await store.remove(id))) throw new HttpError(404, `No report #${id}.`);
      log(`removed #${id}`);
      return send(res, 204);
    }

    throw new HttpError(404, 'Not found.');
  }

  return (req, res) => {
    route(req, res).catch((error) => {
      if (res.headersSent) return res.end();
      if (error instanceof HttpError) return send(res, error.status, { error: error.message });
      log(`error: ${error?.stack ?? error}`);
      send(res, 500, { error: 'Something broke on the server.' });
    });
  };
}
