import './style.css';

import { Display } from './engine/framebuffer';
import { Input } from './engine/input';
import { ejectFromWall, Player } from './engine/player';
import { renderScene, tileKey, type WallTextures } from './engine/raycaster';
import { blitScaled, drawSprites, rotationFrame, type Billboard } from './engine/sprites';
import { solidTexture, TextureStore, type Texture } from './engine/textures';
import { parseCub, type CubLevel } from './format/cub';
import { DEATH_ROW, Enemy, type World } from './game/enemy';
import enemyFrames from './game/enemyFrames.json';
import { doorTexture, pickupTexture } from './game/generatedTextures';
import { doorTile, LEVELS, levelToCub, type LevelDef } from './game/levels';
import { shoot, Weapon, WEAPON_FRAMES, type ShotResult } from './game/weapon';

type Mode = 'CURTAIN' | 'PLAYING' | 'MAP_EDITOR' | 'COLOR_EDITOR' | 'BETWEEN';

const MAX_DELTA = 0.1;
const PITCH_LIMIT = 0.42;
const MAX_HEALTH = 100;
const START_AMMO = 40;
const DOOR_REACH = 1.6;
const PICKUP_REACH = 0.6;
const LADDER_START = 3;

const el = <T extends HTMLElement>(selector: string): T =>
  document.querySelector<T>(selector)!;

const canvas = el<HTMLCanvasElement>('#screen');
const curtain = el('#curtain');
const hud = el('#hud');
const touch = el('#touch');
const stats = el('#stats');
const between = el('#between');
const betweenTitle = el('#between-title');
const betweenText = el('#between-text');
const betweenGo = el<HTMLButtonElement>('#between-go');
const healthEl = el('#health');
const ammoEl = el('#ammo');
const leftEl = el('#left');
const bannerEl = el('#banner');
const damageEl = el('#damage');

const isTouchDevice = matchMedia('(hover: none) and (pointer: coarse)').matches;

interface Pickup {
  x: number;
  y: number;
  kind: 'health' | 'ammo';
  taken: boolean;
}

class Game {
  readonly display: Display;
  readonly input: Input;
  readonly player = new Player();
  readonly store = new TextureStore();

  level!: CubLevel;
  levelDef!: LevelDef;
  levelIndex = 0;
  mode: Mode = 'CURTAIN';

  enemies: Enemy[] = [];
  pickups: Pickup[] = [];
  weapon = new Weapon(10, START_AMMO);
  health = MAX_HEALTH;

  private overrides = new Map<string, Texture>();
  private gunFrames: Texture[] = [];
  private pickupTextures = new Map<string, Texture>();
  private enemyAtlas: Texture = solidTexture(0xff00ff);
  private door?: { x: number; y: number };
  /** The sandbox as the player last saved it, so visiting a level does not wipe it. */
  private sandbox?: CubLevel;
  private doorUsed = false;
  private hurtAt = -Infinity;
  private listeners: Array<(mode: Mode) => void> = [];

  private last = 0;
  private frames = 0;
  private fpsClock = 0;

  constructor() {
    this.display = new Display(canvas, isTouchDevice ? 1 : LADDER_START);
    this.input = new Input(canvas, (key) => this.onCommand(key));
    this.player.setAspect(this.display.surface.width, this.display.surface.height);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    canvas.addEventListener('mousedown', () => {
      if (this.mode === 'PLAYING' && this.input.pointerLocked) this.fire();
    });
  }

  private onPointerLockChange = (): void => {
    if (!this.input.pointerLocked && this.mode === 'PLAYING' && !isTouchDevice) {
      this.setMode('CURTAIN');
    }
  };

  private onCommand(key: string): void {
    if (key === 'escape') {
      if (this.mode === 'PLAYING') this.input.exitPointerLock();
      else if (this.mode === 'MAP_EDITOR' || this.mode === 'COLOR_EDITOR') this.setMode('PLAYING');
      return;
    }
    if (this.mode !== 'PLAYING') return;
    // The editors belong to the sandbox; mid-fight they would just be an escape hatch.
    if (key === 'm' && this.levelIndex === 0) this.setMode('MAP_EDITOR');
    if (key === 'c' && this.levelIndex === 0) this.setMode('COLOR_EDITOR');
    if (key === 'r') void this.loadLevel(this.levelIndex);
  }

  onModeChange(listener: (mode: Mode) => void): void {
    this.listeners.push(listener);
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    const playing = mode === 'PLAYING';
    this.input.enabled = playing;
    curtain.hidden = mode !== 'CURTAIN';
    between.hidden = mode !== 'BETWEEN';
    hud.hidden = !playing;
    touch.hidden = !playing || !isTouchDevice;

    if (playing && !isTouchDevice) this.input.requestPointerLock();
    if (!playing) this.input.exitPointerLock();
    for (const listener of this.listeners) listener(mode);
  }

  async boot(): Promise<void> {
    await Promise.all([
      this.store.load('enemy', '/textures/enemy.png').then(() => {
        this.enemyAtlas = this.store.get('enemy');
      }),
      ...Array.from({ length: WEAPON_FRAMES }, (_, i) =>
        this.store.load(`gun${i}`, `/textures/w${i + 1}.png`),
      ),
    ]);
    this.gunFrames = Array.from({ length: WEAPON_FRAMES }, (_, i) => this.store.get(`gun${i}`));
    this.pickupTextures.set('health', pickupTexture('health'));
    this.pickupTextures.set('ammo', pickupTexture('ammo'));
    await this.loadLevel(0);
  }

  async loadLevel(index: number): Promise<void> {
    const def = LEVELS[index]!;
    const parsed =
      index === 0 && this.sandbox
        ? { ok: true as const, level: this.sandbox }
        : parseCub(levelToCub(def));
    if (!parsed.ok) {
      throw new Error(`level ${index}: ${parsed.errors.map((e) => e.message).join('; ')}`);
    }

    this.levelIndex = index;
    this.levelDef = def;
    this.level = parsed.level;
    this.enemies = def.enemies.map((spawn) => new Enemy(spawn.kind, spawn.x, spawn.y));
    this.pickups = (def.pickups ?? []).map((p) => ({ ...p, taken: false }));
    this.health = MAX_HEALTH;
    this.weapon = new Weapon(10, START_AMMO);
    this.doorUsed = false;
    this.player.spawn(parsed.level.spawn.x, parsed.level.spawn.y, parsed.level.spawn.facing);
    this.player.pitch = 0;

    this.door = doorTile(def);
    this.overrides = new Map();
    if (this.door) this.overrides.set(tileKey(this.door.x, this.door.y), doorTexture());

    await this.loadTextures();
    this.showBanner(`${def.name} — ${def.subtitle}`);
  }

  /** Applies an edited level: reload textures, keep the player, dig them out if buried. */
  async applyLevel(level: CubLevel, respawn = false): Promise<void> {
    this.level = level;
    if (this.levelIndex === 0) this.sandbox = level;
    await this.loadTextures();
    if (respawn) this.player.spawn(level.spawn.x, level.spawn.y, level.spawn.facing);
    else ejectFromWall(level.grid, this.player);
  }

  async loadTextures(): Promise<void> {
    const paths = new Set(Object.values(this.level.textures));
    await Promise.all(
      [...paths].map(async (path) => {
        if (this.store.has(path)) return;
        try {
          await this.store.load(path, path.replace(/^\.\//, '/'));
        } catch {
          this.store.set(path, solidTexture(0x8892a0));
        }
      }),
    );
  }

  private walls(): WallTextures {
    const t = this.level.textures;
    return {
      NO: this.store.get(t.NO),
      SO: this.store.get(t.SO),
      WE: this.store.get(t.WE),
      EA: this.store.get(t.EA),
    };
  }

  private world(): World {
    return {
      grid: this.level.grid,
      playerX: this.player.x,
      playerY: this.player.y,
      hurtPlayer: (amount) => this.takeDamage(amount),
    };
  }

  private takeDamage(amount: number): void {
    if (this.health <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.hurtAt = performance.now();
    if (this.health === 0) {
      this.pause(
        'You died',
        `${this.levelDef.name} again — full health, full ammo. Nothing here is unfair.`,
        'Retry',
        () => void this.loadLevel(this.levelIndex),
      );
    }
  }

  /** The most recent shot, kept so the HUD and the smoke test can read the outcome. */
  lastShot: ShotResult | null = null;

  private fire(): void {
    const result = shoot(this.level.grid, this.player, this.enemies, this.weapon);
    if (!result) return;
    this.lastShot = result;
    if (result.enemy) result.enemy.hurt(this.weapon.damage, this.world());
    // A shot into the wall is the noise that wakes the room — DOOM's P_NoiseAlert,
    // without the sectors to flood through.
    else for (const enemy of this.enemies) if (!enemy.dead) enemy.wake(this.world());
  }

  private pause(title: string, text: string, button: string, go: () => void): void {
    betweenTitle.textContent = title;
    betweenText.textContent = text;
    betweenGo.textContent = button;
    betweenGo.onclick = () => {
      go();
      this.setMode('PLAYING');
    };
    this.setMode('BETWEEN');
  }

  private showBanner(text: string): void {
    bannerEl.textContent = text;
    bannerEl.classList.remove('show');
    void bannerEl.offsetWidth;
    bannerEl.classList.add('show');
  }

  private checkDoor(): void {
    if (!this.door || this.doorUsed) return;
    const distance = Math.hypot(this.door.x + 0.5 - this.player.x, this.door.y + 0.5 - this.player.y);
    if (distance > DOOR_REACH) return;
    this.doorUsed = true;
    this.rollCredits();
  }

  /** The surprise: the door really does roll credits, for about three seconds. */
  private rollCredits(): void {
    this.setMode('BETWEEN');
    between.classList.add('credits');
    betweenTitle.textContent = 'THE END';
    betweenText.textContent = 'cub3D — Simon Langerock & agoldber · thanks for playing';
    betweenGo.hidden = true;
    window.setTimeout(() => {
      between.classList.remove('credits');
      betweenGo.hidden = false;
      this.pause(
        'It was not.',
        'Something came through the door behind you.',
        'Turn around',
        () => void this.loadLevel(4),
      );
    }, 3200);
  }

  private checkPickups(): void {
    for (const pickup of this.pickups) {
      if (pickup.taken) continue;
      if (Math.hypot(pickup.x - this.player.x, pickup.y - this.player.y) > PICKUP_REACH) continue;
      pickup.taken = true;
      if (pickup.kind === 'health') this.health = Math.min(MAX_HEALTH, this.health + 35);
      else this.weapon.ammo += 25;
    }
  }

  private checkCleared(): void {
    if (this.levelIndex === 0 || this.enemies.some((e) => !e.dead)) return;
    if (this.door && !this.doorUsed) return;

    if (this.levelIndex === 4) {
      this.pause(
        'You win',
        'That really is the end. Press M in level 0 to build somewhere new.',
        'Back to the sandbox',
        () => void this.loadLevel(0),
      );
      return;
    }
    const next = this.levelIndex + 1;
    this.pause('Cleared', `${LEVELS[next]!.name} — ${LEVELS[next]!.subtitle}`, 'Next', () =>
      void this.loadLevel(next),
    );
  }

  private billboards(): Billboard[] {
    const list: Billboard[] = [];
    const deathFrames = enemyFrames.rows[DEATH_ROW]!;

    for (const enemy of this.enemies) {
      const frames = enemyFrames.rows[enemy.row]!;
      let frame = frames[0]!;
      let mirrored = false;
      if (enemy.sequenceFrame) {
        frame = deathFrames[Math.min(enemy.frame, deathFrames.length - 1)]!;
      } else {
        const rotation = rotationFrame(
          enemy.angle,
          enemy.x,
          enemy.y,
          this.player.x,
          this.player.y,
          frames.length,
        );
        frame = frames[rotation.column]!;
        mirrored = rotation.mirrored;
      }
      list.push({
        x: enemy.x,
        y: enemy.y,
        texture: this.enemyAtlas,
        frame,
        worldHeight: enemy.kind.worldHeight * (enemy.dead ? 0.55 : 1),
        mirrored,
        flash: Math.round(enemy.flash),
      });
    }

    for (const pickup of this.pickups) {
      if (pickup.taken) continue;
      const texture = this.pickupTextures.get(pickup.kind)!;
      list.push({
        x: pickup.x,
        y: pickup.y,
        texture,
        frame: { x: 0, y: 0, w: texture.width, h: texture.height },
        worldHeight: 0.26,
        mirrored: false,
      });
    }
    return list;
  }

  private drawWeapon(): void {
    const frame = this.gunFrames[this.weapon.frame];
    if (!frame) return;
    const surface = this.display.surface;
    const scale = (surface.height * 0.62) / frame.height;
    const x = Math.round(surface.width / 2 - (frame.width * scale) / 2 + this.weapon.bobX);
    const y = Math.round(surface.height - frame.height * scale + this.weapon.bobY);
    blitScaled(surface, frame, x, y, scale);
  }

  private updateHud(): void {
    healthEl.innerHTML = `<b>${this.health}</b> hp`;
    ammoEl.innerHTML = `<b>${this.weapon.ammo}</b> ammo`;
    const alive = this.enemies.filter((e) => !e.dead).length;
    leftEl.textContent = this.levelIndex === 0 ? 'sandbox' : `${alive} left`;
    healthEl.classList.toggle('low', this.health <= 30);

    const since = performance.now() - this.hurtAt;
    damageEl.style.opacity = since < 380 ? String(0.55 * (1 - since / 380)) : '0';
  }

  frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const started = performance.now();
    // A backgrounded tab returns one enormous delta; uncapped it teleports the
    // player through a wall on resume.
    const dt = Math.min((now - this.last) / 1000, MAX_DELTA);
    this.last = now;

    if (this.mode === 'PLAYING') {
      const look = this.input.consumeLook();
      if (look.yaw !== 0) this.player.rotate(-look.yaw);
      if (look.pitch !== 0) {
        const limit = this.display.surface.height * PITCH_LIMIT;
        this.player.pitch = Math.min(Math.max(this.player.pitch - look.pitch, -limit), limit);
      }
      const intent = this.input.readIntent();
      const before = { x: this.player.x, y: this.player.y };
      this.player.update(intent, this.level.grid, dt);
      const moving = this.player.x !== before.x || this.player.y !== before.y;

      if (intent.fire) this.fire();
      this.weapon.update(dt, moving);

      const world = this.world();
      const deathFrames = enemyFrames.rows[DEATH_ROW]!.length;
      for (const enemy of this.enemies) enemy.update(world, dt, deathFrames);

      this.checkPickups();
      this.checkDoor();
      this.checkCleared();
      this.updateHud();
    }

    if (this.mode === 'PLAYING' || this.mode === 'BETWEEN' || this.mode === 'CURTAIN') {
      const surface = this.display.surface;
      renderScene(
        surface,
        this.level.grid,
        this.player,
        this.walls(),
        this.level.ceiling,
        this.level.floor,
        this.overrides,
      );
      drawSprites(surface, this.player, this.billboards());
      this.drawWeapon();
      this.display.present();
    }

    this.display.sample(performance.now() - started, now);

    this.frames++;
    if (now - this.fpsClock >= 500) {
      const fps = Math.round((this.frames * 1000) / (now - this.fpsClock));
      this.frames = 0;
      this.fpsClock = now;
      const { width, height } = this.display.surface;
      stats.textContent = `${fps} fps · ${width}x${height}`;
    }
  };
}

async function boot(): Promise<void> {
  const game = new Game();
  await game.boot();
  // Handle for scripts/smoke.mjs, which drives the real page in a browser.
  (globalThis as Record<string, unknown>).__cub3d = game;

  const { mountMapEditor } = await import('./editor/mapEditor');
  const { mountColorEditor } = await import('./editor/colorEditor');
  mountMapEditor(game);
  mountColorEditor(game);

  el('#start').addEventListener('click', () => game.setMode('PLAYING'));

  // The level picker lives on the curtain, which Esc (or the touch ≡ button) brings back.
  const levelsEl = el('#levels');
  const renderLevels = (): void => {
    const buttons = LEVELS.flatMap((def, index) => {
      if (def.secret) return [];
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = `<b>${index}</b>${index === 0 ? 'Sandbox' : def.subtitle}`;
      button.setAttribute('aria-current', String(index === game.levelIndex));
      button.addEventListener('click', () => {
        // loadLevel swaps the level in before its first await, so play can start
        // now, inside the click that pointer lock needs.
        void game.loadLevel(index);
        game.setMode('PLAYING');
      });
      return [button];
    });
    const label = document.createElement('span');
    label.textContent = 'or pick a level';
    levelsEl.replaceChildren(label, ...buttons);
  };
  renderLevels();
  game.onModeChange((mode) => {
    if (mode === 'CURTAIN') renderLevels();
  });
  el('#touch-menu').addEventListener('click', () => game.setMode('CURTAIN'));
  canvas.addEventListener('click', () => {
    if (game.mode === 'CURTAIN') game.setMode('PLAYING');
  });
  el('#touch-map').addEventListener('click', () => game.setMode('MAP_EDITOR'));
  el('#touch-colour').addEventListener('click', () => game.setMode('COLOR_EDITOR'));
  const fireButton = el('#touch-fire');
  fireButton.addEventListener('pointerdown', () => game.input.setTouchFiring(true));
  fireButton.addEventListener('pointerup', () => game.input.setTouchFiring(false));
  fireButton.addEventListener('pointercancel', () => game.input.setTouchFiring(false));

  requestAnimationFrame(game.frame);
}

export type { Game };

void boot();
