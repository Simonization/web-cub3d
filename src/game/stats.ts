/**
 * What the end-of-game screen shows: one run, from the first real level to the final
 * door. Pure counters, no DOM and no clock of its own — main.ts feeds it the frame
 * delta while the player is actually playing, so menus, the editors, the sandbox and a
 * backgrounded tab never add to the time.
 */

export interface RunSummary {
  shots: number;
  hits: number;
  misses: number;
  /** Whole percent of shots that landed, or null before the first shot. */
  accuracy: number | null;
  timesHit: number;
  damageTaken: number;
  deaths: number;
  /** Time spent playing, in milliseconds. */
  ms: number;
}

export class RunStats {
  shots = 0;
  hits = 0;
  timesHit = 0;
  damageTaken = 0;
  deaths = 0;
  ms = 0;
  /** True once the final door was reached; the next level load starts a fresh run. */
  finished = false;

  reset(): void {
    this.shots = 0;
    this.hits = 0;
    this.timesHit = 0;
    this.damageTaken = 0;
    this.deaths = 0;
    this.ms = 0;
    this.finished = false;
  }

  /** One trigger pull that fired a bullet. */
  recordShot(hit: boolean): void {
    this.shots++;
    if (hit) this.hits++;
  }

  /** An enemy landed a hit; `hpLost` is what actually came off the health bar. */
  recordHurt(hpLost: number): void {
    if (hpLost <= 0) return;
    this.timesHit++;
    this.damageTaken += hpLost;
  }

  recordDeath(): void {
    this.deaths++;
  }

  /** Playing time; negative or non-finite deltas are ignored. */
  addTime(seconds: number): void {
    if (Number.isFinite(seconds) && seconds > 0) this.ms += seconds * 1000;
  }

  finish(): void {
    this.finished = true;
  }

  summary(): RunSummary {
    return {
      shots: this.shots,
      hits: this.hits,
      misses: this.shots - this.hits,
      accuracy: this.shots === 0 ? null : Math.round((this.hits / this.shots) * 100),
      timesHit: this.timesHit,
      damageTaken: this.damageTaken,
      deaths: this.deaths,
      ms: Math.round(this.ms),
    };
  }
}

/** mm:ss, minutes unbounded (an hour is "60:00"). */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
