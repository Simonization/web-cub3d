/** Cursor maths for typing into the map, like typing into a text file in vim. */

export interface Cursor {
  x: number;
  y: number;
}

/** One step right; at the end of a row, the start of the next. Stays put on the last cell. */
export function advance(c: Cursor, width: number, height: number): Cursor {
  if (c.x + 1 < width) return { x: c.x + 1, y: c.y };
  if (c.y + 1 < height) return { x: 0, y: c.y + 1 };
  return { x: c.x, y: c.y };
}

/** One step left; at the start of a row, the end of the previous. Stays put on the first cell. */
export function retreat(c: Cursor, width: number): Cursor {
  if (c.x > 0) return { x: c.x - 1, y: c.y };
  if (c.y > 0) return { x: Math.max(width - 1, 0), y: c.y - 1 };
  return { x: c.x, y: c.y };
}

/** Reads a size typed after `:new`. Anything that is not a whole number falls back. */
export function parseSize(arg: string | undefined, fallback: number, min: number, max: number): number {
  const n = arg === undefined ? fallback : Number.parseInt(arg, 10);
  return Math.min(Math.max(Number.isFinite(n) ? n : fallback, min), max);
}
