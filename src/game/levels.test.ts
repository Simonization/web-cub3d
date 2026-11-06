import { describe, expect, it } from 'vitest';

import { parseCub } from '../format/cub';
import { doorTile, LEVELS, levelToCub, SANDBOX_CUB, SANDBOX_GRID } from './levels';

/** Every open tile reachable on foot from the spawn. */
function reachable(grid: string[], startX: number, startY: number): Set<string> {
  const seen = new Set<string>();
  const queue: Array<readonly [number, number]> = [[startX, startY]];
  while (queue.length > 0) {
    const [x, y] = queue.pop()!;
    const key = `${x},${y}`;
    if (seen.has(key)) continue;
    const cell = grid[y]?.[x];
    if (cell === undefined || cell === '1' || cell === 'D' || cell === ' ') continue;
    seen.add(key);
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return seen;
}

describe.each(LEVELS.map((level, index) => [index, level] as const))(
  'level %i',
  (index, level) => {
    const cub = levelToCub(level);
    const parsed = parseCub(cub);

    it('has rows of equal length', () => {
      const widths = new Set(level.grid.map((row) => row.length));
      expect([...widths]).toHaveLength(1);
    });

    it('parses as a valid .cub', () => {
      expect(parsed.ok ? null : parsed.errors).toBeNull();
    });

    it('exports a .cub the C parser would accept — no D left in the grid', () => {
      const mapPart = cub.split('\n').filter((line) => /^[01NSEW ]+$/.test(line) && line.length > 2);
      expect(mapPart.some((line) => line.includes('D'))).toBe(false);
    });

    it('puts every enemy on a walkable tile the player can reach', () => {
      if (!parsed.ok) return;
      const open = reachable(level.grid, parsed.level.spawn.x, parsed.level.spawn.y);
      for (const enemy of level.enemies) {
        const key = `${Math.floor(enemy.x)},${Math.floor(enemy.y)}`;
        expect({ level: index, enemy: key, reachable: open.has(key) }).toEqual({
          level: index,
          enemy: key,
          reachable: true,
        });
      }
    });

    it('puts every pickup on a walkable tile the player can reach', () => {
      if (!parsed.ok) return;
      const open = reachable(level.grid, parsed.level.spawn.x, parsed.level.spawn.y);
      for (const pickup of level.pickups ?? []) {
        const key = `${Math.floor(pickup.x)},${Math.floor(pickup.y)}`;
        expect({ pickup: key, reachable: open.has(key) }).toEqual({ pickup: key, reachable: true });
      }
    });

    it('walls off nothing the player needs', () => {
      if (!parsed.ok) return;
      const open = reachable(level.grid, parsed.level.spawn.x, parsed.level.spawn.y);
      const walkable = level.grid.join('').split('').filter((c) => c !== '1' && c !== 'D').length;
      expect(open.size).toBe(walkable);
    });
  },
);

describe('the door', () => {
  it('exists on level 3 (the fake end) and the boss arena (the real one), nowhere else', () => {
    const withDoors = LEVELS.map((l, i) => (doorTile(l) ? i : -1)).filter((i) => i >= 0);
    expect(withDoors).toEqual([3, 4]);
    expect(LEVELS[4]!.secret).toBe(true);
  });

  it('is a plain wall in the .cub export, on every level', () => {
    for (const level of LEVELS) expect(levelToCub(level)).not.toContain('D');
  });

  it.each([3, 4])('on level %i sits against a wall the player can walk up to', (index) => {
    const level = LEVELS[index]!;
    const door = doorTile(level)!;
    const parsed = parseCub(levelToCub(level));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const open = reachable(level.grid, parsed.level.spawn.x, parsed.level.spawn.y);
    const neighbours = [
      `${door.x - 1},${door.y}`,
      `${door.x + 1},${door.y}`,
      `${door.x},${door.y - 1}`,
      `${door.x},${door.y + 1}`,
    ];
    expect(neighbours.some((n) => open.has(n))).toBe(true);
  });
});

describe('sandbox level', () => {
  it('is mirror-symmetric, so the view at spawn is too', () => {
    for (const row of SANDBOX_GRID) {
      expect([...row].reverse().join('')).toBe(row);
    }
    expect([...SANDBOX_GRID].reverse()).toEqual(SANDBOX_GRID);
  });

  it('spawns the player on the centre tile', () => {
    const result = parseCub(SANDBOX_CUB);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { spawn, grid } = result.level;
    expect(spawn.x).toBe((grid[0]!.length - 1) / 2);
    expect(spawn.y).toBe((grid.length - 1) / 2);
  });
});
