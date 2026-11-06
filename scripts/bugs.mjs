#!/usr/bin/env node
// Manage the bug board from a terminal (or from Claude Code).
//
//   node scripts/bugs.mjs list            show every report (no key needed)
//   node scripts/bugs.mjs rm <id> [id…]   delete reports (needs BUGS_ADMIN_KEY)
//   node scripts/bugs.mjs link            print the secret admin link
//   node scripts/bugs.mjs keygen          print a fresh random key
//
// BUGS_ADMIN_KEY and BUGS_URL come from the environment, or from .env.local at
// the repo root (gitignored). BUGS_URL defaults to https://play.langerock.xyz.

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadEnvFile(join(root, '.env.local'));

const base = (process.env.BUGS_URL || 'https://play.langerock.xyz').replace(/\/+$/, '');
const key = (process.env.BUGS_ADMIN_KEY || '').trim();

function die(message) {
  console.error(message);
  process.exit(1);
}

async function api(path, init = {}) {
  let res;
  try {
    res = await fetch(base + path, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    die(`Cannot reach ${base}: ${error.cause?.code ?? error.message}`);
  }
  if (res.status === 204) return null;
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
    die(`${base}${path} did not answer with JSON (HTTP ${res.status}). Is the bug board API deployed?`);
  }
  const body = await res.json();
  if (!res.ok) die(`HTTP ${res.status}: ${body.error ?? 'error'}`);
  return body;
}

// Strip terminal escape sequences: report text is untrusted.
const safe = (text) => String(text ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '');

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'list':
  case 'ls': {
    const { reports } = await api('/api/bugs');
    if (args.includes('--json')) {
      console.log(JSON.stringify(reports, null, 2));
      break;
    }
    if (reports.length === 0) console.log('No reports.');
    for (const r of reports) {
      const who = r.name ? ` · ${safe(r.name)}` : '';
      console.log(`#${r.id}  [${r.type === 'bug' ? 'BUG ' : 'IDEA'}]  ${r.createdAt.slice(0, 10)}${who}`);
      console.log(`      ${safe(r.message).replace(/\n/g, '\n      ')}\n`);
    }
    break;
  }
  case 'rm':
  case 'delete': {
    if (!key) die('BUGS_ADMIN_KEY is not set (env or .env.local).');
    if (args.length === 0) die('Usage: bugs.mjs rm <id> [id…]');
    for (const arg of args) {
      const id = arg.replace(/^#/, '');
      if (!/^\d{1,9}$/.test(id)) die(`Not an id: ${arg}`);
      await api(`/api/bugs/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${key}` } });
      console.log(`deleted #${id}`);
    }
    break;
  }
  case 'link':
    if (!key) die('BUGS_ADMIN_KEY is not set (env or .env.local).');
    // The fragment (#) never leaves the browser, so the key stays out of server logs.
    console.log(`${base}/bugs/admin#key=${encodeURIComponent(key)}`);
    break;
  case 'keygen':
    console.log(randomBytes(32).toString('base64url'));
    break;
  default:
    console.log('Usage: node scripts/bugs.mjs list [--json] | rm <id> [id…] | link | keygen');
    process.exit(command ? 1 : 0);
}
