/**
 * Drives the real page in Chromium: enters the game, walks and turns, opens both
 * editor screens, paints a wall onto the player's own tile and applies it.
 *
 *     node scripts/smoke.mjs http://localhost:5180 ./shots
 *
 * Two notes on the odd shape of this script, both about the harness rather than the
 * game.
 *
 * `channel: 'chromium'` is required. Playwright's default `chrome-headless-shell`
 * cannot composite a continuously repainting canvas: every CDP round-trip takes
 * twice as long as the one before it — 0.6s, 1.2s, 2.1s, 3.5s, 6s, 11s — until rAF
 * itself stalls. Hiding the canvas drops that back to 2ms with the same loop
 * running, so it is the compositor, not the engine. The full browser stays at 2-4ms.
 *
 * Full-page screenshots are still only taken while an editor overlay is up and the
 * render loop has gone quiet; over a live canvas they take ~18s even here.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5180';
const outDir = process.argv[3] ?? 'shots';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(20000);

const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

const shot = (name) => page.screenshot({ path: join(outDir, `${name}.png`) });
const savePng = (name, dataUrl) =>
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));

// Injected so key handling runs exactly as it does for a real key: the listeners
// are on window, so a dispatched KeyboardEvent takes the same path.
const HELPERS = `
  const g = globalThis.__cub3d;
  const key = (type, k) => window.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true }));
  const frames = (n) => new Promise((res) => {
    let i = 0;
    const tick = () => (++i >= n ? res() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });
  const canvas = () => document.querySelector('#screen').toDataURL('image/png');
`;

const inPage = (body) => page.evaluate(`(async () => { ${HELPERS} ${body} })()`);

// --- curtain -------------------------------------------------------------
await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__cub3d !== undefined, null, { timeout: 15000 });
await shot('01-curtain');

// --- play: one round-trip covering entry, movement and capture -----------
await page.click('#levels button >> nth=0'); // the sandbox
const play = await inPage(`
  await frames(3);
  const start = { x: g.player.x, y: g.player.y, angle: g.player.angle };
  const first = canvas();
  key('keydown', 'w'); await frames(14); key('keyup', 'w');
  key('keydown', 'ArrowRight'); await frames(14); key('keyup', 'ArrowRight');
  const end = { x: g.player.x, y: g.player.y, angle: g.player.angle };
  return { mode: g.mode, start, end, first, moved: canvas(),
           surface: g.display.surface.width + 'x' + g.display.surface.height };
`);
savePng('02-playing', play.first);
savePng('03-moved', play.moved);

// --- map editor ----------------------------------------------------------
const opened = await inPage(`key('keydown', 'm'); await frames(2); return g.mode;`);
await shot('04-map-editor');

const mapState = await page.evaluate(() => ({
  cells: document.querySelectorAll('#map-editor .cell').length,
  lint: document.querySelector('#map-editor .lint')?.textContent?.trim(),
  status: document.querySelector('#map-editor .terminal-status')?.textContent?.trim(),
}));

// Paint a wall onto the tile the player occupies: the eject path is the thing most
// likely to trap someone, and the C engine has no equivalent to copy from.
const buried = await page.evaluate(() => {
  const g = globalThis.__cub3d;
  const x = Math.floor(g.player.x);
  const y = Math.floor(g.player.y);
  const at = () => document.querySelector(`#map-editor .cell[data-x="${x}"][data-y="${y}"]`);
  at().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
  return {
    x,
    y,
    painted: at().textContent,
    lint: document.querySelector('#map-editor .lint').textContent.trim(),
  };
});
await shot('05-wall-on-player');

await page.fill('#map-editor input', ':w');
await page.press('#map-editor input', 'Enter');
const afterApply = await inPage(`
  await frames(3);
  return { mode: g.mode, x: g.player.x, y: g.player.y,
           tile: g.level.grid[Math.floor(g.player.y)]?.[Math.floor(g.player.x)],
           shot: canvas() };
`);
savePng('06-after-eject', afterApply.shot);

// --- colour editor -------------------------------------------------------
await inPage(`key('keydown', 'c'); await frames(2);`);
await shot('07-colour-editor');

const colour = await page.evaluate(() => {
  const floor = document.querySelectorAll('#color-editor .swatch')[1];
  const red = floor.querySelector('input[data-channel="r"]');
  red.value = '250';
  red.dispatchEvent(new Event('input', { bubbles: true }));
  return {
    line: floor.querySelector('.cub-line').textContent,
    packed: floor.querySelector('.packed').textContent,
    faces: [...document.querySelectorAll('#color-editor .face .cub-line')].map((n) => n.textContent),
  };
});
await shot('08-colour-dragged');

await page.fill('#color-editor input[type="text"]', ':w');
await page.press('#color-editor input[type="text"]', 'Enter');
const final = await inPage(`await frames(3); return { mode: g.mode, floor: g.level.floor, shot: canvas() };`);
savePng('09-new-floor', final.shot);

await browser.close();

console.log(
  JSON.stringify(
    {
      play: { ...play, first: undefined, moved: undefined },
      opened,
      mapState,
      buried,
      afterApply: { ...afterApply, shot: undefined },
      colour,
      final: { mode: final.mode, floorHex: '0x' + final.floor.toString(16) },
      problems,
    },
    null,
    2,
  ),
);
if (problems.length > 0) process.exitCode = 1;
