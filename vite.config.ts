import { defineConfig } from 'vite';

// In dev and preview, /api/* goes to the bug board server (`npm run bugs:dev`).
// If it is not running the proxy errors and the panel just shows "offline".
const api = { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } };

export default defineConfig({
  server: { proxy: api },
  preview: { proxy: api },
});
