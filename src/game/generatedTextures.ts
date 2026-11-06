/** Textures drawn at load time rather than shipped as files: the door and the pickups. */

import type { Texture } from '../engine/textures';

function paint(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  const image = ctx.getImageData(0, 0, width, height);
  return { width, height, data: new Uint32Array(image.data.buffer) };
}

/**
 * Both doors sit in an east wall, which the raycaster samples right-to-left, so the
 * lettering is drawn pre-mirrored to read the right way round.
 */
function mirrored(ctx: CanvasRenderingContext2D): void {
  ctx.translate(128, 0);
  ctx.scale(-1, 1);
}

export function doorTexture(): Texture {
  return paint(128, 128, (ctx) => {
    mirrored(ctx);
    ctx.fillStyle = '#1b1410';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#2e2119';
    ctx.fillRect(6, 6, 116, 116);

    ctx.strokeStyle = '#6b4a2f';
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, 108, 108);
    for (let y = 22; y < 118; y += 24) {
      ctx.beginPath();
      ctx.moveTo(12, y);
      ctx.lineTo(116, y);
      ctx.stroke();
    }

    ctx.fillStyle = '#0c0a08';
    ctx.fillRect(16, 40, 96, 34);
    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 21px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('THE', 64, 50);
    ctx.fillText('END', 64, 66);

    ctx.fillStyle = '#c0872f';
    ctx.fillRect(100, 84, 8, 8);
  });
}

/**
 * The real way out, in the boss arena. 'sealed' is the iron slab while the boss lives;
 * 'open' and 'open-bright' are two beats of a glowing green EXIT that main.ts alternates.
 */
export type FinalDoorState = 'sealed' | 'open' | 'open-bright';

export function finalDoorTexture(state: FinalDoorState): Texture {
  return paint(128, 128, (ctx) => {
    mirrored(ctx);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (state === 'sealed') {
      ctx.fillStyle = '#16141a';
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = '#26232c';
      ctx.fillRect(6, 6, 116, 116);
      ctx.strokeStyle = '#4a4552';
      ctx.lineWidth = 3;
      ctx.strokeRect(10, 10, 108, 108);
      // Hazard bars, so it reads as shut at a glance.
      ctx.fillStyle = '#6b1d1d';
      for (let i = -128; i < 128; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i + 14, 118);
        ctx.lineTo(i + 30, 118);
        ctx.lineTo(i + 30 + 100, 18);
        ctx.lineTo(i + 14 + 100, 18);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = '#0c0a0c';
      ctx.fillRect(14, 46, 100, 36);
      ctx.fillStyle = '#f87171';
      ctx.font = 'bold 20px monospace';
      ctx.fillText('SEALED', 64, 64);
      return;
    }
    const bright = state === 'open-bright';
    ctx.fillStyle = bright ? '#bbf7d0' : '#4ade80';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = bright ? '#4ade80' : '#166534';
    ctx.fillRect(8, 8, 112, 112);
    ctx.fillStyle = bright ? '#dcfce7' : '#86efac';
    ctx.fillRect(22, 22, 84, 84);
    ctx.fillStyle = '#04120a';
    ctx.font = 'bold 30px monospace';
    ctx.fillText('EXIT', 64, 56);
    ctx.fillRect(34, 76, 60, 6);
    ctx.beginPath();
    ctx.moveTo(64, 98);
    ctx.lineTo(48, 84);
    ctx.lineTo(80, 84);
    ctx.closePath();
    ctx.fill();
  });
}

export function pickupTexture(kind: 'health' | 'ammo'): Texture {
  return paint(32, 32, (ctx) => {
    ctx.clearRect(0, 0, 32, 32);
    if (kind === 'health') {
      ctx.fillStyle = '#e8e8ea';
      ctx.fillRect(4, 8, 24, 18);
      ctx.fillStyle = '#d63b3b';
      ctx.fillRect(14, 12, 4, 10);
      ctx.fillRect(10, 16, 12, 4);
      ctx.strokeStyle = '#8d9096';
      ctx.lineWidth = 2;
      ctx.strokeRect(4, 8, 24, 18);
    } else {
      ctx.fillStyle = '#5a4a24';
      ctx.fillRect(5, 12, 22, 14);
      ctx.fillStyle = '#d8b03a';
      for (let i = 0; i < 4; i++) ctx.fillRect(7 + i * 5, 6, 3, 8);
      ctx.strokeStyle = '#2e2612';
      ctx.lineWidth = 2;
      ctx.strokeRect(5, 12, 22, 14);
    }
  });
}
