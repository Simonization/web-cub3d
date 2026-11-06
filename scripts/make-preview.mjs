/**
 * Builds public/preview.png (1200x630), the image link previews show: the map editor
 * with ":w" typed, next to the 3D view that map turns into. Not needed at runtime.
 *
 *     npm run dev            # in another terminal
 *     node scripts/make-preview.mjs [http://localhost:5173] [public/preview.png]
 */
import { writeFileSync } from 'node:fs';

import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'public/preview.png';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? undefined, channel: process.env.CHROMIUM ? undefined : 'chromium' });

// --- 1. the editor, mid-sentence: a hand-drawn maze and ":w" waiting in the box ---
const page = await browser.newPage({ viewport: { width: 700, height: 630 } });
await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__cub3d !== undefined);
await page.click('#start-map');
await page.addStyleTag({
  content: `.map-grid { --cell: 2.35em !important; font-size: 15px; }
            .map-grid-wrap { max-height: none !important; }
            .explainers, .brushes, .terminal-commands > p, .lint { display: none !important; }`,
});
await page.fill('#map-editor .terminal-prompt input', ':new 15 9');
await page.press('#map-editor .terminal-prompt input', 'Enter');
await wait(200);
// Paint some walls with clicks (the wall brush is the default).
const walls = [
  [3, 2], [4, 2], [5, 2], [9, 2], [10, 2], [11, 2],
  [3, 3], [11, 3], [3, 6], [11, 6], [3, 7], [4, 7], [10, 7], [11, 7],
  [7, 1], [7, 2],
];
for (const [x, y] of walls) await page.click(`.map-grid .cell[data-x="${x}"][data-y="${y}"]`);
await page.fill('#map-editor .terminal-prompt input', ':w');
await page.locator('#map-editor .terminal-prompt input').evaluate((el) => el.classList.add('typed'));
await wait(200);
const editorPng = await page.screenshot();

// --- 2. what that map looks like from inside ---
await page.locator('#map-editor .terminal-prompt input').evaluate((el) => el.classList.remove('typed'));
await page.press('#map-editor .terminal-prompt input', 'Enter');
await wait(300);
await page.evaluate(() => {
  const g = globalThis.__cub3d;
  g.setMode('PLAYING');
  g.player.y += 1.2;
});
await wait(1500);
const view = await page.evaluate(() => document.querySelector('#screen').toDataURL('image/png'));

// --- 3. compose ---
const shot = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await shot.setContent(`
  <style>
    body { margin: 0; width: 1200px; height: 630px; background: #05070a; color: #4ade80;
           font-family: ui-monospace, Menlo, Consolas, monospace; position: relative; overflow: hidden; }
    img { position: absolute; top: 0; image-rendering: pixelated; }
    #ed { left: 0; width: 700px; height: 630px; }
    #view { left: 700px; width: 500px; top: 0; height: 630px; object-fit: cover; }
    .arrow { position: absolute; left: 672px; top: 285px; width: 56px; height: 56px; border-radius: 50%;
             background: #05070a; border: 2px solid #4ade80; font-size: 30px; text-align: center; line-height: 52px; }
    .title { position: absolute; right: 0; top: 0; width: 500px; padding: 28px 28px 44px;
             background: linear-gradient(#05070aee 45%, transparent); box-sizing: border-box; }
    .title b { display: block; font-size: 44px; letter-spacing: 0.18em; text-shadow: 0 0 22px #4ade8055; }
    .title span { color: #cbd5e1; font-size: 19px; }
  </style>
  <img id="ed" src="data:image/png;base64,${editorPng.toString('base64')}">
  <img id="view" src="${view}">
  <div class="arrow">&rarr;</div>
  <div class="title"><b>cub3D</b><span>Draw a maze, walk inside it.</span></div>`);
await wait(300);
writeFileSync(out, await shot.screenshot());
await browser.close();
console.log(`wrote ${out}`);
