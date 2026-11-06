#!/usr/bin/env node
// Starts the bug board API. Configuration comes from the environment only:
//
//   BUGS_ADMIN_KEY   secret for DELETE /api/bugs/:id (unset = deleting disabled)
//   BUGS_DATA        JSON file holding the reports    (default ./server/data/bugs.json)
//   BUGS_HOST        address to bind                  (default 127.0.0.1 — Caddy is in front)
//   BUGS_PORT        port                             (default 8787)
//   BUGS_TRUST_PROXY "0" to ignore X-Forwarded-For    (default trusted: only Caddy can reach us)

import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createHandler, Store } from './core.mjs';

const env = process.env;
const host = env.BUGS_HOST || '127.0.0.1';
const port = Number(env.BUGS_PORT || 8787);
const file = resolve(env.BUGS_DATA || 'server/data/bugs.json');
const adminKey = (env.BUGS_ADMIN_KEY || '').trim();
const trustProxy = env.BUGS_TRUST_PROXY !== '0';

const log = (message) => console.log(`[bugs] ${message}`);

if (!adminKey) log('BUGS_ADMIN_KEY is not set: reports can be added but not deleted.');
else if (adminKey.length < 24) {
  console.error('[bugs] BUGS_ADMIN_KEY is too short (need 24+ characters). Refusing to start.');
  process.exit(1);
}

const store = await new Store(file).load();
const server = createServer(createHandler({ store, adminKey, trustProxy, log }));
// Slow-loris guard: a client gets 10 s to send its whole request.
server.requestTimeout = 10_000;
server.headersTimeout = 5_000;
server.listen(port, host, () => log(`${store.size} reports from ${file}, listening on http://${host}:${port}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    // Let a write in flight finish before exiting.
    store.queue.finally(() => process.exit(0));
  });
}
