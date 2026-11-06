/**
 * Two tiny synthesized sounds for the fake ending — no audio files. The context is
 * made lazily, the first time a sound plays: by then the player has clicked Enter,
 * so the browser lets it start. Every call is best-effort and never throws.
 */

type AudioCtor = typeof AudioContext;

let ctx: AudioContext | null | undefined;

function audio(): AudioContext | null {
  if (ctx === undefined) {
    try {
      const Ctor: AudioCtor | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
      ctx = Ctor ? new Ctor() : null;
    } catch {
      ctx = null;
    }
  }
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
  return ctx ?? null;
}

function play(build: (ac: AudioContext, out: GainNode, t: number) => void): void {
  try {
    const ac = audio();
    if (!ac) return;
    const out = ac.createGain();
    out.gain.value = 0.5;
    out.connect(ac.destination);
    build(ac, out, ac.currentTime);
  } catch {
    // No sound is fine; a thrown error mid-cinematic is not.
  }
}

/** A bright hiss for the white flash. */
export function playFlash(): void {
  play((ac, out, t) => {
    const length = Math.floor(ac.sampleRate * 0.9);
    const buffer = ac.createBuffer(1, length, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ac.createBufferSource();
    noise.buffer = buffer;
    const filter = ac.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1800, t);
    filter.frequency.exponentialRampToValueAtTime(300, t + 0.9);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    noise.connect(filter).connect(gain).connect(out);
    noise.start(t);
    noise.stop(t + 0.9);
  });
}

/** A low, detuned stab that sinks — the "uh-oh" under SURPRISE, FINAL BOSS. */
export function playBossSting(): void {
  play((ac, out, t) => {
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(160, t + 1.8);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.9);
    filter.connect(gain).connect(out);
    for (const [freq, type] of [
      [98, 'sawtooth'],
      [103.5, 'sawtooth'],
      [49, 'square'],
    ] as const) {
      const osc = ac.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 1.8);
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + 1.95);
    }
    // The thump you feel more than hear.
    const sub = ac.createOscillator();
    const subGain = ac.createGain();
    sub.frequency.setValueAtTime(70, t);
    sub.frequency.exponentialRampToValueAtTime(28, t + 0.45);
    subGain.gain.setValueAtTime(0.6, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    sub.connect(subGain).connect(out);
    sub.start(t);
    sub.stop(t + 0.55);
  });
}
