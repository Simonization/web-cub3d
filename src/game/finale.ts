/**
 * The fake ending, as a pure timeline. Walking through the level-3 door fades the
 * world to black and rolls a short "THE END"; then a white flash hides the swap into
 * the secret boss arena — same stone walls, so you are still inside them — and a red
 * "SURPRISE, FINAL BOSS" slams in before control comes back.
 *
 * main.ts samples finaleAt() once a frame and fires finaleCues() as they are crossed,
 * so a slow or backgrounded frame skips ahead without missing the level swap.
 */

/** Milliseconds from the moment the player reaches the door. */
export const FINALE = {
  /** World fades to black. */
  fadeOut: 700,
  /** White snaps on; the boss level is swapped in underneath it. */
  flash: 3400,
  /** White held at full before it starts to fade. */
  flashHold: 150,
  /** White fully gone. */
  flashGone: 1250,
  /** "SURPRISE, FINAL BOSS" slams in, the screen shakes, the sting plays. */
  reveal: 4300,
  /** Shake has died down. */
  shakeEnd: 4950,
  /** Control returns; the fight starts. */
  end: 6400,
} as const;

export type FinaleText = 'none' | 'end' | 'boss';
export type FinaleCue = 'flash' | 'reveal';

export interface FinaleFrame {
  /** Opacity of the black veil, 0..1. */
  black: number;
  /** Opacity of the white flash, 0..1. */
  white: number;
  /** Which caption is up. */
  text: FinaleText;
  /** True once the boss level should be in place. */
  swapped: boolean;
  /** Screen-shake strength, 0..1. */
  shake: number;
  done: boolean;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function finaleAt(t: number): FinaleFrame {
  const f = FINALE;
  const black = t < f.fadeOut ? clamp01(t / f.fadeOut) : t < f.flash ? 1 : 0;

  let white = 0;
  if (t >= f.flash) {
    const since = t - f.flash;
    if (since < f.flashHold) white = 1;
    else {
      const k = clamp01((since - f.flashHold) / (f.flashGone - f.flashHold));
      white = (1 - k) * (1 - k); // ease-out: drops fast, lingers as a glow
    }
  }

  const text: FinaleText =
    t >= f.reveal && t < f.end ? 'boss' : t >= f.fadeOut && t < f.flash ? 'end' : 'none';
  const shake = t >= f.reveal && t < f.shakeEnd ? 1 - (t - f.reveal) / (f.shakeEnd - f.reveal) : 0;

  return { black, white, text, swapped: t >= f.flash, shake, done: t >= f.end };
}

/** The cues whose time falls in (from, to], in order. */
export function finaleCues(from: number, to: number): FinaleCue[] {
  const cues: FinaleCue[] = [];
  if (from < FINALE.flash && to >= FINALE.flash) cues.push('flash');
  if (from < FINALE.reveal && to >= FINALE.reveal) cues.push('reveal');
  return cues;
}
