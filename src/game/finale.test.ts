import { describe, expect, it } from 'vitest';

import { FINALE, finaleAt, finaleCues } from './finale';

describe('finale timeline', () => {
  it('starts on the live world and fades it to black', () => {
    expect(finaleAt(0)).toMatchObject({ black: 0, white: 0, text: 'none', swapped: false, done: false });
    expect(finaleAt(FINALE.fadeOut / 2).black).toBeCloseTo(0.5);
    expect(finaleAt(FINALE.fadeOut).black).toBe(1);
  });

  it('rolls THE END on black, still on the old level', () => {
    const f = finaleAt(FINALE.fadeOut + 500);
    expect(f).toMatchObject({ black: 1, white: 0, text: 'end', swapped: false });
  });

  it('flashes white the instant the level swaps, so the swap is never seen', () => {
    expect(finaleAt(FINALE.flash - 1).swapped).toBe(false);
    const f = finaleAt(FINALE.flash);
    expect(f).toMatchObject({ white: 1, black: 0, text: 'none', swapped: true });
  });

  it('fades the white out to reveal the arena before the boss text lands', () => {
    expect(finaleAt(FINALE.flash + FINALE.flashGone).white).toBe(0);
    expect(finaleAt(FINALE.reveal - 1).white).toBeLessThan(0.15);
  });

  it('slams the boss text in with a decaying shake, then hands back control', () => {
    const hit = finaleAt(FINALE.reveal);
    expect(hit.text).toBe('boss');
    expect(hit.shake).toBe(1);
    expect(finaleAt((FINALE.reveal + FINALE.shakeEnd) / 2).shake).toBeCloseTo(0.5);
    expect(finaleAt(FINALE.shakeEnd).shake).toBe(0);
    expect(finaleAt(FINALE.end - 1)).toMatchObject({ text: 'boss', done: false });
    expect(finaleAt(FINALE.end)).toMatchObject({ text: 'none', done: true, black: 0, white: 0 });
  });

  it('gives the boss text about two seconds', () => {
    expect(FINALE.end - FINALE.reveal).toBeGreaterThanOrEqual(1800);
    expect(FINALE.end - FINALE.reveal).toBeLessThanOrEqual(2500);
  });
});

describe('finaleCues', () => {
  it('fires each cue exactly once across consecutive frames', () => {
    const seen: string[] = [];
    for (let t = 0; t < FINALE.end + 100; t += 16) seen.push(...finaleCues(t, t + 16));
    expect(seen).toEqual(['flash', 'reveal']);
  });

  it('fires every missed cue, in order, after one huge frame', () => {
    expect(finaleCues(0, FINALE.end * 10)).toEqual(['flash', 'reveal']);
  });

  it('does not re-fire a cue on a zero-length frame at its boundary', () => {
    expect(finaleCues(FINALE.flash, FINALE.flash)).toEqual([]);
  });
});
