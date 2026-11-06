import { describe, expect, it } from 'vitest';

import { formatTime, RunStats } from './stats';

describe('RunStats', () => {
  it('starts empty, with no accuracy to report yet', () => {
    expect(new RunStats().summary()).toEqual({
      shots: 0, hits: 0, misses: 0, accuracy: null, timesHit: 0, damageTaken: 0, deaths: 0, ms: 0,
    });
  });

  it('splits shots into on target and off target', () => {
    const s = new RunStats();
    for (const hit of [true, false, true, true, false, false, false, true]) s.recordShot(hit);
    expect(s.summary()).toMatchObject({ shots: 8, hits: 4, misses: 4, accuracy: 50 });
  });

  it('rounds accuracy to a whole percent', () => {
    const s = new RunStats();
    s.recordShot(true);
    s.recordShot(false);
    s.recordShot(false);
    expect(s.summary().accuracy).toBe(33);
  });

  it('counts hits taken and the HP they cost, ignoring zero-damage ones', () => {
    const s = new RunStats();
    s.recordHurt(10);
    s.recordHurt(25);
    s.recordHurt(0);
    expect(s.summary()).toMatchObject({ timesHit: 2, damageTaken: 35 });
  });

  it('counts deaths', () => {
    const s = new RunStats();
    s.recordDeath();
    s.recordDeath();
    expect(s.summary().deaths).toBe(2);
  });

  it('adds up playing time and ignores nonsense deltas', () => {
    const s = new RunStats();
    s.addTime(0.5);
    s.addTime(1.25);
    s.addTime(-3);
    s.addTime(NaN);
    expect(s.summary().ms).toBe(1750);
  });

  it('resets everything, including the finished flag', () => {
    const s = new RunStats();
    s.recordShot(true);
    s.recordHurt(5);
    s.recordDeath();
    s.addTime(10);
    s.finish();
    expect(s.finished).toBe(true);
    s.reset();
    expect(s.finished).toBe(false);
    expect(s.summary()).toEqual(new RunStats().summary());
  });
});

describe('formatTime', () => {
  it('pads minutes and seconds', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(5_000)).toBe('00:05');
    expect(formatTime(65_999)).toBe('01:05');
    expect(formatTime(3_600_000)).toBe('60:00');
  });

  it('never goes negative', () => {
    expect(formatTime(-500)).toBe('00:00');
  });
});
