import { describe, expect, it } from 'vitest';

import { advance, parseSize, retreat } from './typing';

describe('advance', () => {
  it('moves right, wraps to the next row, and stops at the end', () => {
    expect(advance({ x: 1, y: 0 }, 4, 2)).toEqual({ x: 2, y: 0 });
    expect(advance({ x: 3, y: 0 }, 4, 2)).toEqual({ x: 0, y: 1 });
    expect(advance({ x: 3, y: 1 }, 4, 2)).toEqual({ x: 3, y: 1 });
  });
});

describe('retreat', () => {
  it('moves left, wraps to the previous row end, and stops at the start', () => {
    expect(retreat({ x: 2, y: 1 }, 4)).toEqual({ x: 1, y: 1 });
    expect(retreat({ x: 0, y: 1 }, 4)).toEqual({ x: 3, y: 0 });
    expect(retreat({ x: 0, y: 0 }, 4)).toEqual({ x: 0, y: 0 });
  });
});

describe('parseSize', () => {
  it('clamps and survives garbage', () => {
    expect(parseSize('abc', 20, 3, 100)).toBe(20);
    expect(parseSize(undefined, 12, 3, 100)).toBe(12);
    expect(parseSize('1', 20, 3, 100)).toBe(3);
    expect(parseSize('9999', 20, 3, 100)).toBe(100);
    expect(parseSize('30', 20, 3, 100)).toBe(30);
  });
});
