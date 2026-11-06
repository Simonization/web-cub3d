import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHandler, LIMITS, RateLimiter, sameSecret, Store, validateReport } from './core.mjs';

describe('validateReport', () => {
  it('accepts a minimal bug and trims it', () => {
    const r = validateReport({ type: 'bug', message: '  walls flicker  ' });
    expect(r).toEqual({ ok: true, value: { type: 'bug', message: 'walls flicker', name: null }, spam: false });
  });

  it('only knows bug and suggestion', () => {
    expect(validateReport({ type: 'suggestion', message: 'more levels' }).ok).toBe(true);
    expect(validateReport({ type: 'BUG', message: 'more levels' }).ok).toBe(false);
    expect(validateReport({ type: ['bug'], message: 'more levels' }).ok).toBe(false);
    expect(validateReport({ message: 'more levels' }).ok).toBe(false);
  });

  it('rejects non-objects', () => {
    for (const input of [null, 'bug', 42, ['bug', 'x']]) expect(validateReport(input).ok).toBe(false);
  });

  it('enforces message length in characters, not bytes', () => {
    expect(validateReport({ type: 'bug', message: 'ab' }).ok).toBe(false);
    expect(validateReport({ type: 'bug', message: '   ab    ' }).ok).toBe(false);
    expect(validateReport({ type: 'bug', message: 'x'.repeat(LIMITS.messageMax) }).ok).toBe(true);
    expect(validateReport({ type: 'bug', message: 'x'.repeat(LIMITS.messageMax + 1) }).ok).toBe(false);
    // 500 emoji are 500 characters even though each is two UTF-16 units.
    expect(validateReport({ type: 'bug', message: '🧱'.repeat(LIMITS.messageMax) }).ok).toBe(true);
    expect(validateReport({ type: 'bug', message: 42 }).ok).toBe(false);
  });

  it('strips control and bidi characters but keeps line breaks', () => {
    const r = validateReport({ type: 'bug', message: 'a\u0000b‮c\r\nd\n\n\n\n\ne​' });
    expect(r.ok && r.value.message).toBe('abc\nd\n\ne');
  });

  it('a message of only invisible characters is empty', () => {
    expect(validateReport({ type: 'bug', message: '​​​\u0007\u0007' }).ok).toBe(false);
  });

  it('keeps HTML as plain text (escaping is the renderer’s job)', () => {
    const r = validateReport({ type: 'bug', message: '<img src=x onerror=alert(1)>' });
    expect(r.ok && r.value.message).toBe('<img src=x onerror=alert(1)>');
  });

  it('name is optional, single-line and capped', () => {
    expect(validateReport({ type: 'bug', message: 'hello', name: '' }).value?.name).toBeNull();
    expect(validateReport({ type: 'bug', message: 'hello', name: null }).value?.name).toBeNull();
    expect(validateReport({ type: 'bug', message: 'hello', name: ' sim\non ' }).value?.name).toBe('sim on');
    expect(validateReport({ type: 'bug', message: 'hello', name: 'n'.repeat(LIMITS.nameMax) }).ok).toBe(true);
    expect(validateReport({ type: 'bug', message: 'hello', name: 'n'.repeat(LIMITS.nameMax + 1) }).ok).toBe(false);
    expect(validateReport({ type: 'bug', message: 'hello', name: { a: 1 } }).ok).toBe(false);
  });

  it('flags the honeypot', () => {
    expect(validateReport({ type: 'bug', message: 'hello', website: 'http://spam' }).spam).toBe(true);
    expect(validateReport({ type: 'bug', message: 'hello', website: '' }).spam).toBe(false);
  });
});

describe('RateLimiter', () => {
  it('allows `limit` hits per window, per key', () => {
    let now = 0;
    const rl = new RateLimiter({ limit: 3, windowMs: 1000, now: () => now });
    expect([1, 2, 3].map(() => rl.take('a').ok)).toEqual([true, true, true]);
    expect(rl.take('a')).toEqual({ ok: false, retryAfterMs: 1000 });
    expect(rl.take('b').ok).toBe(true);
    now = 400;
    expect(rl.take('a').retryAfterMs).toBe(600);
  });

  it('slides: old hits fall out of the window', () => {
    let now = 0;
    const rl = new RateLimiter({ limit: 2, windowMs: 1000, now: () => now });
    rl.take('a');
    now = 500;
    rl.take('a');
    now = 999;
    expect(rl.take('a').ok).toBe(false);
    now = 1000;
    expect(rl.take('a').ok).toBe(true); // the hit at 0 expired
    expect(rl.take('a').ok).toBe(false); // the hit at 500 has not
  });

  it('refused hits do not extend the ban', () => {
    let now = 0;
    const rl = new RateLimiter({ limit: 1, windowMs: 1000, now: () => now });
    rl.take('a');
    for (now = 100; now < 1000; now += 100) expect(rl.take('a').ok).toBe(false);
    now = 1000;
    expect(rl.take('a').ok).toBe(true);
  });

  it('keeps memory bounded under a flood of addresses', () => {
    let now = 0;
    const rl = new RateLimiter({ limit: 1, windowMs: 1000, maxKeys: 100, now: () => now });
    for (let i = 0; i < 1000; i++) rl.take(`ip${i}`);
    expect(rl.hits.size).toBeLessThanOrEqual(100);
    now = 5000;
    rl.prune();
    expect(rl.hits.size).toBe(0);
  });
});

describe('sameSecret', () => {
  it('matches only the exact key', () => {
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('abd', 'abc')).toBe(false);
    expect(sameSecret('abcd', 'abc')).toBe(false);
    expect(sameSecret('', '')).toBe(false);
    expect(sameSecret(undefined, 'abc')).toBe(false);
  });
});

describe('Store', () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bugs-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('starts empty, persists, numbers reports and survives a reload', async () => {
    const file = join(dir, 'nested', 'bugs.json');
    const store = await new Store(file).load();
    expect(store.size).toBe(0);
    await store.add({ type: 'bug', message: 'one', name: null });
    await store.add({ type: 'suggestion', message: 'two', name: 'kid' });
    expect(await store.remove(1)).toBe(true);
    expect(await store.remove(1)).toBe(false);
    await store.add({ type: 'bug', message: 'three', name: null });

    const again = await new Store(file).load();
    expect(again.list().map((r) => [r.id, r.message])).toEqual([[3, 'three'], [2, 'two']]);
    // No temp files left behind.
    expect(await readdir(join(dir, 'nested'))).toEqual(['bugs.json']);
  });

  it('serialises concurrent writes', async () => {
    const file = join(dir, 'bugs.json');
    const store = await new Store(file).load();
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.add({ type: 'bug', message: `m${i}`, name: null })));
    const saved = JSON.parse(await readFile(file, 'utf8'));
    expect(saved.reports).toHaveLength(20);
    expect(saved.nextId).toBe(21);
  });

  it('refuses to start over a corrupt file instead of overwriting it', async () => {
    const file = join(dir, 'bugs.json');
    await writeFile(file, '{ nope');
    await expect(new Store(file).load()).rejects.toThrow();
  });
});

describe('HTTP handler', () => {
  const KEY = 'k'.repeat(32);
  let dir, server, base, store;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bugs-http-'));
    store = await new Store(join(dir, 'bugs.json')).load();
    server = createServer(
      createHandler({
        store,
        adminKey: KEY,
        postLimiter: new RateLimiter({ limit: 3, windowMs: 60_000 }),
        authLimiter: new RateLimiter({ limit: 2, windowMs: 60_000 }),
      }),
    );
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });

  const post = (body, headers = {}) =>
    fetch(`${base}/api/bugs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  const del = (id, key) =>
    fetch(`${base}/api/bugs/${id}`, { method: 'DELETE', headers: key ? { Authorization: `Bearer ${key}` } : {} });

  it('adds, lists newest first, and never leaks the IP', async () => {
    expect((await post({ type: 'bug', message: 'first' })).status).toBe(201);
    const res = await post({ type: 'suggestion', message: 'second', name: 'Simon' });
    expect(res.status).toBe(201);
    const list = await (await fetch(`${base}/api/bugs`)).json();
    expect(list.reports.map((r) => r.message)).toEqual(['second', 'first']);
    expect(Object.keys(list.reports[0]).sort()).toEqual(['createdAt', 'id', 'message', 'name', 'type']);
  });

  it('rejects bad input with a readable error', async () => {
    const res = await post({ type: 'bug', message: '' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/more/);
    expect((await post('{oops')).status).toBe(400);
    expect((await post({ type: 'bug', message: 'hello' }, { 'Content-Type': 'text/plain' })).status).toBe(415);
  });

  it('caps the body size', async () => {
    const res = await post({ type: 'bug', message: 'x'.repeat(LIMITS.bodyBytes) });
    expect(res.status).toBe(413);
  });

  it('rate-limits per client address (from X-Forwarded-For, right-most entry)', async () => {
    const as = (ip, i) => post({ type: 'bug', message: `msg ${ip} ${i}` }, { 'X-Forwarded-For': ip });
    for (let i = 0; i < 3; i++) expect((await as('1.1.1.1', i)).status).toBe(201);
    const limited = await as('1.1.1.1', 9);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    // A spoofed left-hand entry does not buy a fresh quota.
    expect((await as('9.9.9.9, 1.1.1.1', 10)).status).toBe(429);
    expect((await as('2.2.2.2', 0)).status).toBe(201);
  });

  it('refuses exact duplicates', async () => {
    await post({ type: 'bug', message: 'Door is stuck' });
    expect((await post({ type: 'bug', message: 'door is STUCK' })).status).toBe(409);
  });

  it('pretends to accept honeypot spam but stores nothing', async () => {
    expect((await post({ type: 'bug', message: 'buy pills', website: 'x' })).status).toBe(201);
    expect(store.size).toBe(0);
  });

  it('deletes only with the admin key', async () => {
    await post({ type: 'bug', message: 'fixed already' });
    expect((await del(1)).status).toBe(401);
    expect((await del(1, 'wrong')).status).toBe(401);
    expect((await del(1, KEY)).status).toBe(204);
    expect((await del(1, KEY)).status).toBe(404);
    expect(store.size).toBe(0);
  });

  it('locks out repeated wrong keys', async () => {
    await post({ type: 'bug', message: 'keep me' });
    await del(1, 'a');
    await del(1, 'b');
    expect((await del(1, 'c')).status).toBe(429);
    expect(store.size).toBe(1);
  });

  it('answers 404 / 405 elsewhere', async () => {
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
    expect((await fetch(`${base}/api/bugs`, { method: 'PUT' })).status).toBe(405);
    expect((await fetch(`${base}/api/bugs/1`)).status).toBe(405);
    expect((await fetch(`${base}/api/bugs/abc`, { method: 'DELETE' })).status).toBe(404);
  });
});
