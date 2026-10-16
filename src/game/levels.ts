import { BOSS, GRUNT, type EnemyKind } from './enemy';

export interface EnemySpawn {
  x: number;
  y: number;
  kind: EnemyKind;
}

export interface LevelDef {
  name: string;
  subtitle: string;
  grid: string[];
  floor: [number, number, number];
  ceiling: [number, number, number];
  textures: { NO: string; SO: string; WE: string; EA: string };
  enemies: EnemySpawn[];
  /** Tile of the door marked THE END. It is a '1' in the grid, so the C sees a wall. */
  door?: { x: number; y: number };
  /** Ammo and health pickups, on walkable tiles. */
  pickups?: Array<{ x: number; y: number; kind: 'health' | 'ammo' }>;
  /** Left out of the level picker: the only way in is through the door. */
  secret?: boolean;
}

const STONE = {
  NO: './textures/greystone.png',
  SO: './textures/mossy.png',
  WE: './textures/greystone.png',
  EA: './textures/mossy.png',
};

/**
 * Level 0: the sandbox. Open, harmless, and the room the editors exist to change.
 *
 * Built rather than typed out: the width is odd and the spawn sits on the centre
 * column so the room is exactly symmetric, which is fiddly to get right by hand and
 * obvious when it is wrong. `levels.test.ts` holds it to that.
 */
const SANDBOX_WIDTH = 21;
const SANDBOX_HEIGHT = 13;
export const SANDBOX_PILLARS = [5, 6, 7, 13, 14, 15];
const SANDBOX_PILLAR_ROWS = new Set([3, 4, 5, 7, 8, 9]);

function sandboxGrid(): string[] {
  const spawnX = (SANDBOX_WIDTH - 1) / 2;
  const spawnY = (SANDBOX_HEIGHT - 1) / 2;
  return Array.from({ length: SANDBOX_HEIGHT }, (_, y) =>
    Array.from({ length: SANDBOX_WIDTH }, (_, x) => {
      if (x === spawnX && y === spawnY) return 'N';
      if (y === 0 || y === SANDBOX_HEIGHT - 1 || x === 0 || x === SANDBOX_WIDTH - 1) return '1';
      return SANDBOX_PILLAR_ROWS.has(y) && SANDBOX_PILLARS.includes(x) ? '1' : '0';
    }).join(''),
  );
}

export const SANDBOX_GRID = sandboxGrid();

export const LEVELS: LevelDef[] = [
  {
    name: 'Level 0',
    subtitle: 'The sandbox — nothing here wants to hurt you',
    grid: SANDBOX_GRID,
    floor: [64, 68, 78],
    ceiling: [22, 25, 34],
    textures: STONE,
    enemies: [],
  },
  {
    name: 'Level 1',
    subtitle: 'Contact',
    grid: [
      '11111111111111111',
      '10000000000000001',
      '10000000000000001',
      '10001100000110001',
      '10001000000010001',
      '100000000N0000001',
      '10001000000010001',
      '10001100000110001',
      '10000000000000001',
      '10000000000000001',
      '11111111111111111',
    ],
    floor: [84, 74, 64],
    ceiling: [38, 34, 42],
    textures: STONE,
    enemies: [{ x: 13.5, y: 5.5, kind: GRUNT }],
  },
  {
    name: 'Level 2',
    subtitle: 'Three of them',
    grid: [
      '111111111111111111111',
      '100000000000000000001',
      '100111000000000111001',
      '100000000000000000001',
      '100000011100111000001',
      '100000010000010000001',
      '100000000N00000000001',
      '100000010000010000001',
      '100000011100111000001',
      '100000000000000000001',
      '100111000000000111001',
      '100000000000000000001',
      '111111111111111111111',
    ],
    floor: [88, 68, 58],
    ceiling: [34, 28, 40],
    textures: STONE,
    enemies: [
      { x: 3.5, y: 3.5, kind: GRUNT },
      { x: 17.5, y: 3.5, kind: GRUNT },
      { x: 10.5, y: 11.5, kind: GRUNT },
    ],
    pickups: [{ x: 10.5, y: 1.5, kind: 'health' }],
  },
  {
    name: 'Level 3',
    subtitle: 'The End',
    grid: [
      '1111111111111111111111111',
      '1000000000000000000000001',
      '1011100011100011100011101',
      '1000000000000000000000001',
      '1000000000000000000000001',
      '1011100000000000000011101',
      '1000000000000000000000001',
      '100000000000N0000000000D1',
      '1000000000000000000000001',
      '1011100000000000000011101',
      '1000000000000000000000001',
      '1000000000000000000000001',
      '1011100011100011100011101',
      '1000000000000000000000001',
      '1111111111111111111111111',
    ],
    floor: [76, 60, 74],
    ceiling: [30, 24, 42],
    textures: STONE,
    enemies: [
      { x: 3.5, y: 1.5, kind: GRUNT },
      { x: 21.5, y: 1.5, kind: GRUNT },
      { x: 3.5, y: 13.5, kind: GRUNT },
      { x: 21.5, y: 13.5, kind: GRUNT },
      { x: 12.5, y: 3.5, kind: GRUNT },
    ],
    pickups: [
      { x: 12.5, y: 11.5, kind: 'health' },
      { x: 6.5, y: 7.5, kind: 'ammo' },
    ],
  },
  {
    name: '?',
    subtitle: 'That was not the end',
    secret: true,
    grid: [
      '111111111111111111111',
      '100000000000000000001',
      '100000000000000000001',
      '100011000000000110001',
      '100011000000000110001',
      '100000000000000000001',
      '100000000000000000001',
      '100000000000000000001',
      '100000000N00000000001',
      '100000000000000000001',
      '100000000000000000001',
      '100011000000000110001',
      '100011000000000110001',
      '100000000000000000001',
      '100000000000000000001',
      '111111111111111111111',
    ],
    floor: [104, 38, 40],
    ceiling: [44, 14, 18],
    textures: STONE,
    enemies: [{ x: 10.5, y: 2.5, kind: BOSS }],
    pickups: [
      { x: 2.5, y: 8.5, kind: 'health' },
      { x: 18.5, y: 8.5, kind: 'health' },
      { x: 10.5, y: 14.5, kind: 'ammo' },
    ],
  },
];

/** Wall textures that ship with the build, offered as presets in the colour editor. */
export const BUILTIN_TEXTURES: ReadonlyArray<{ path: string; label: string }> = [
  { path: './textures/greystone.png', label: 'greystone' },
  { path: './textures/mossy.png', label: 'mossy' },
  { path: './textures/o.png', label: 'panel' },
];

export function levelToCub(level: LevelDef): string {
  const [fr, fg, fb] = level.floor;
  const [cr, cg, cb] = level.ceiling;
  return [
    `NO ${level.textures.NO}`,
    `SO ${level.textures.SO}`,
    `WE ${level.textures.WE}`,
    `EA ${level.textures.EA}`,
    '',
    `F ${fr},${fg},${fb}`,
    `C ${cr},${cg},${cb}`,
    '',
    // The door is a plain wall as far as the .cub format is concerned, so a level
    // exported from here still loads in the original C binary.
    ...level.grid.map((row) => row.replace(/D/g, '1')),
    '',
  ].join('\n');
}

export function doorTile(level: LevelDef): { x: number; y: number } | undefined {
  if (level.door) return level.door;
  for (let y = 0; y < level.grid.length; y++) {
    const x = level.grid[y]!.indexOf('D');
    if (x >= 0) return { x, y };
  }
  return undefined;
}

export const SANDBOX_CUB = levelToCub(LEVELS[0]!);
