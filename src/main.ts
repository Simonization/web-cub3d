import './style.css';

import { Display } from './engine/framebuffer';
import { Input } from './engine/input';
import { ejectFromWall, Player } from './engine/player';
import { renderScene, tileKey, type WallTextures } from './engine/raycaster';
import { blitScaled, drawSprites, rotationFrame, type Billboard } from './engine/sprites';
import { solidTexture, TextureStore, type Texture } from './engine/textures';
import { parseCub, type CubLevel } from './format/cub';
import { BOSS, DEATH_ROW, Enemy, type World } from './game/enemy';
import enemyFrames from './game/enemyFrames.json';
import { finaleAt, finaleCues } from './game/finale';
import { doorTexture, finalDoorTexture, pickupTexture } from './game/generatedTextures';
import { doorTile, LEVELS, levelToCub, type LevelDef } from './game/levels';
import { formatTime, RunStats } from './game/stats';
import { playBossSting, playFlash } from './game/sting';
import { shoot, Weapon, WEAPON_FRAMES, type ShotResult } from './game/weapon';

/**
 * CINEMATIC: the fake ending is playing — no input, enemies frozen, pointer lock kept.
 * VICTORY: the real ending; the run stats are up.
 */
type Mode =
  | 'CURTAIN'
  | 'PLAYING'
  | 'MAP_EDITOR'
  | 'COLOR_EDITOR'
  | 'BETWEEN'
  | 'CINEMATIC'
  | 'VICTORY';

const MAX_DELTA = 0.1;
const PITCH_LIMIT = 0.42;
const MAX_HEALTH = 100;
const START_AMMO = 40;
const DOOR_REACH = 1.6;
/** The real exit asks you to actually walk up to it, so a boss dying nearby does not end the game. */
const FINAL_DOOR_REACH = 1.05;
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
const targetEl = el('#target');
const targetNameEl = el('#target-name');
const targetHpEl = el('#target-hp');
const targetBarEl = el('#target .bar > i');
const hitmarkerEl = el('#hitmarker');
const floatersEl = el('#floaters');
const noAmmoEl = el('#noammo');
const finaleEl = el('#finale');
const finaleVeil = el('#finale .veil');
const finaleFlash = el('#finale .flash');
const finaleEnd = el('#finale-end');
const finaleBoss = el('#finale-boss');
const victoryEl = el('#victory');
const hintSandbox = el('#hint-sandbox');
const hintLevel = el('#hint-level');
const touchMapButton = el('#touch-map');
const touchColourButton = el('#touch-colour');
const touchHelp = el('#touch-help');
/** The secret level the door really leads to. */
const BOSS_LEVEL = LEVELS.findIndex((def) => def.secret);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MAX_AMMO_BAR = START_AMMO;

function setVital(node: HTMLElement, value: number, max: number): void {
  node.querySelector('b')!.textContent = String(value);
  (node.querySelector('.bar > i') as HTMLElement).style.width = `${Math.min(100, (value / max) * 100)}%`;
}

/** Restart a CSS animation class (the same trick showBanner uses). */
function pop(node: Element, cls: string): void {
  node.classList.remove(cls);
  void (node as HTMLElement).offsetWidth;
  node.classList.add(cls);
}

const isTouchDevice = matchMedia('(hover: none) and (pointer: coarse)').matches;
// CSS keys off this (not off the viewport width) to hide the keyboard hint.
document.body.classList.toggle('touch', isTouchDevice);

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
  /** The boss arena's real exit: sealed until the boss dies, then open for the walk out. */
  private finalDoorOpen = false;
  private finalDoorTextures?: { sealed: Texture; open: Texture; bright: Texture };
  /** Shots, hits, damage, deaths and playing time for the current run (levels 1-4 only). */
  readonly run = new RunStats();
  /** performance.now() when the fake ending began; null while it is not running. */
  private finaleStart: number | null = null;
  /** Elapsed ms at the last finale frame, so each cue fires once. */
  private finaleClock = 0;
  private finaleSwapped = false;
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
    if (key === 'm') this.openEditor('MAP_EDITOR');
    if (key === 'c') this.openEditor('COLOR_EDITOR');
    if (key === 'r') void this.loadLevel(this.levelIndex);
  }

  /**
   * The keyboard and the touch M / C buttons both come through here. The editors
   * belong to the sandbox; mid-fight they would just be an escape hatch.
   */
  openEditor(mode: 'MAP_EDITOR' | 'COLOR_EDITOR'): void {
    if (this.mode === 'PLAYING' && this.levelIndex === 0) this.setMode(mode);
  }

  /** What the HUD offers depends on where you are: the sandbox has editors, levels have a gun. */
  private syncContext(): void {
    const sandbox = this.levelIndex === 0;
    hintSandbox.hidden = !sandbox;
    hintLevel.hidden = sandbox;
    touchMapButton.hidden = !sandbox;
    touchColourButton.hidden = !sandbox;
  }

  onModeChange(listener: (mode: Mode) => void): void {
    this.listeners.push(listener);
  }

  setMode(mode: Mode): void {
    // Anything that takes the screen away mid-finale cancels it, but the door has
    // still been walked through: land in the boss arena, not back on level 3.
    if (mode !== 'CINEMATIC' && this.finaleStart !== null) {
      const swapped = this.finaleSwapped;
      this.clearFinale();
      if (!swapped) void this.loadLevel(BOSS_LEVEL);
    }
    this.mode = mode;
    const playing = mode === 'PLAYING';
    this.input.enabled = playing;
    curtain.hidden = mode !== 'CURTAIN';
    between.hidden = mode !== 'BETWEEN';
    victoryEl.hidden = mode !== 'VICTORY';
    hud.hidden = !playing;
    touch.hidden = !playing || !isTouchDevice;
    this.syncContext();

    if (playing && !isTouchDevice) this.input.requestPointerLock();
    // The finale keeps the lock, so the fight can resume without another click.
    if (!playing && mode !== 'CINEMATIC') this.input.exitPointerLock();
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

    // A new run starts when level 1 is picked, when a real level is entered from the
    // sandbox, or after the last run ended at the final door. Dying and retrying, the
    // R key and Next all reload a level mid-run and keep counting.
    if (index >= 1 && (this.run.finished || this.levelIndex === 0 || (index === 1 && this.levelIndex !== 1))) {
      this.run.reset();
    }
    this.levelIndex = index;
    this.syncContext();
    this.levelDef = def;
    this.level = parsed.level;
    this.enemies = def.enemies.map((spawn) => new Enemy(spawn.kind, spawn.x, spawn.y));
    this.pickups = (def.pickups ?? []).map((p) => ({ ...p, taken: false }));
    this.health = MAX_HEALTH;
    this.weapon = new Weapon(10, START_AMMO);
    this.doorUsed = false;
    this.finalDoorOpen = false;
    this.player.spawn(parsed.level.spawn.x, parsed.level.spawn.y, parsed.level.spawn.facing);
    this.player.pitch = 0;

    this.door = doorTile(def);
    this.overrides = new Map();
    if (this.door) {
      // Level 3's door is the fake THE END; the arena's is the real one, shut for now.
      const texture = index === BOSS_LEVEL ? this.finalDoor().sealed : doorTexture();
      this.overrides.set(tileKey(this.door.x, this.door.y), texture);
    }

    await this.loadTextures();
    this.showBanner(`${def.name} — ${def.subtitle}`);
  }

  private finalDoor(): { sealed: Texture; open: Texture; bright: Texture } {
    this.finalDoorTextures ??= {
      sealed: finalDoorTexture('sealed'),
      open: finalDoorTexture('open'),
      bright: finalDoorTexture('open-bright'),
    };
    return this.finalDoorTextures;
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
    const before = this.health;
    this.health = Math.max(0, this.health - amount);
    if (this.levelIndex >= 1) this.run.recordHurt(before - this.health);
    this.hurtAt = performance.now();
    pop(healthEl, 'pop');
    if (this.health === 0) {
      if (this.levelIndex >= 1) this.run.recordDeath();
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
    if (!result) {
      // Clicking with an empty gun: say so, loudly.
      if (this.weapon.ammo <= 0) pop(noAmmoEl, 'show');
      return;
    }
    this.lastShot = result;
    if (this.levelIndex >= 1) this.run.recordShot(result.enemy !== null);
    pop(ammoEl, 'pop');
    if (result.enemy) {
      result.enemy.hurt(this.weapon.damage, this.world());
      this.showTarget(result.enemy, this.weapon.damage);
    }
    // A shot into the wall is the noise that wakes the room — DOOM's P_NoiseAlert,
    // without the sectors to flood through.
    else for (const enemy of this.enemies) if (!enemy.dead) enemy.wake(this.world());
  }

  private targetUntil = 0;

  /** Show the enemy's name and health bar for a moment, plus a hit marker and a floating -damage. */
  private showTarget(enemy: Enemy, damage: number): void {
    const max = enemy.kind.health;
    const hp = Math.max(0, enemy.health);
    targetNameEl.textContent = enemy.kind === BOSS ? 'BOSS' : 'GRUNT';
    targetHpEl.textContent = hp === 0 ? 'DEAD' : `${hp} / ${max}`;
    targetBarEl.style.width = `${(hp / max) * 100}%`;
    targetEl.hidden = false;
    this.targetUntil = performance.now() + 1500;
    pop(hitmarkerEl, 'show');
    const floater = document.createElement('span');
    floater.textContent = `-${damage}`;
    floater.style.left = `${46 + Math.random() * 8}%`;
    floatersEl.appendChild(floater);
    setTimeout(() => floater.remove(), 900);
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
    // Enter and Space work straight away, like on the victory screen.
    betweenGo.focus();
  }

  private showBanner(text: string): void {
    bannerEl.textContent = text;
    bannerEl.classList.remove('show');
    void bannerEl.offsetWidth;
    bannerEl.classList.add('show');
  }

  private checkDoor(): void {
    if (this.mode !== 'PLAYING' || !this.door || this.doorUsed) return;
    // The arena's door does nothing until the boss is dead.
    if (this.levelIndex === BOSS_LEVEL && !this.finalDoorOpen) return;
    const distance = Math.hypot(this.door.x + 0.5 - this.player.x, this.door.y + 0.5 - this.player.y);
    if (distance > (this.levelIndex === BOSS_LEVEL ? FINAL_DOOR_REACH : DOOR_REACH)) return;
    this.doorUsed = true;
    if (this.levelIndex === BOSS_LEVEL) this.showVictory();
    else this.startFinale();
  }

  /**
   * The surprise: the door fades to black and rolls credits, then a white flash
   * drops you into the boss arena. The timeline lives in game/finale.ts; this only
   * starts it. Retry after dying in the arena reloads the level, never this.
   */
  private startFinale(): void {
    if (this.finaleStart !== null) return;
    this.finaleStart = performance.now();
    this.finaleClock = 0;
    this.finaleSwapped = false;
    finaleEl.hidden = false;
    this.setMode('CINEMATIC');
  }

  /** One frame of the finale: overlays, the level swap under the flash, and the hand-back. */
  private updateFinale(): void {
    if (this.finaleStart === null) return;
    const t = performance.now() - this.finaleStart;
    for (const cue of finaleCues(this.finaleClock, t)) {
      if (cue === 'flash') {
        // loadLevel swaps the level before its first await, so the frame drawn
        // under the white is already the arena.
        this.finaleSwapped = true;
        void this.loadLevel(BOSS_LEVEL);
        playFlash();
      } else {
        playBossSting();
      }
    }
    this.finaleClock = t;

    const f = finaleAt(t);
    finaleVeil.style.opacity = String(f.black);
    finaleFlash.style.opacity = String(f.white);
    finaleEnd.hidden = f.text !== 'end';
    finaleBoss.hidden = f.text !== 'boss';
    const shake = reducedMotion ? 0 : f.shake * 14;
    canvas.style.transform = shake
      ? `translate(${(Math.random() - 0.5) * shake}px, ${(Math.random() - 0.5) * shake}px) scale(1.04)`
      : '';
    if (f.done) this.finishFinale();
  }

  private clearFinale(): void {
    this.finaleStart = null;
    finaleEl.hidden = true;
    finaleEnd.hidden = true;
    finaleBoss.hidden = true;
    canvas.style.transform = '';
  }

  /** The reveal is over: the fight starts. */
  private finishFinale(): void {
    this.clearFinale();
    const fight = (): void => this.showBanner(`${this.levelDef.name} — ${this.levelDef.subtitle}`);
    if (isTouchDevice || this.input.pointerLocked) {
      fight();
      this.setMode('PLAYING');
      return;
    }
    // Esc during the cinematic dropped pointer lock; getting it back needs a click.
    this.pause('SURPRISE', 'It has seen you. This room has no door.', 'Fight', fight);
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
    // The door may have started the finale earlier this frame (or the player just
    // died): never paint "Cleared" over it.
    if (this.mode !== 'PLAYING') return;
    if (this.levelIndex === 0 || this.enemies.some((e) => !e.dead)) return;

    // Killing the boss does not end the game: it opens the way out (see checkDoor).
    if (this.levelIndex === BOSS_LEVEL) {
      if (!this.finalDoorOpen) this.onFinalBossDefeated();
      return;
    }
    if (this.door && !this.doorUsed) return;
    const next = this.levelIndex + 1;
    this.pause('Cleared', `${LEVELS[next]!.name} — ${LEVELS[next]!.subtitle}`, 'Next', () =>
      void this.loadLevel(next),
    );
  }

  /**
   * The boss is dead: the arena's exit unseals. Called once per arena visit, from
   * checkCleared. Walking into it (checkDoor) is what ends the run.
   */
  private onFinalBossDefeated(): void {
    this.finalDoorOpen = true;
    if (this.door) this.overrides.set(tileKey(this.door.x, this.door.y), this.finalDoor().open);
    this.showBanner('The way out is open');
    playFlash();
  }

  /** The player walked through the real door: freeze the clock and show how it went. */
  private showVictory(): void {
    this.run.finish();
    const r = this.run.summary();
    const set = (id: string, text: string): void => {
      el(id).textContent = text;
    };
    set('#v-time', formatTime(r.ms));
    set('#v-acc', r.accuracy === null ? '--' : `${r.accuracy}%`);
    set('#v-shots', String(r.shots));
    set('#v-hits', String(r.hits));
    set('#v-misses', String(r.misses));
    set('#v-hurt', String(r.timesHit));
    set('#v-hp', String(r.damageTaken));
    set('#v-deaths', String(r.deaths));
    const bar = el('#v-acc-bar');
    bar.style.width = '0%';
    this.setMode('VICTORY');
    // Next frame, so the fill animates from empty.
    requestAnimationFrame(() => {
      bar.style.width = `${r.accuracy ?? 0}%`;
    });
    el<HTMLButtonElement>('#victory-again').focus();
  }

  /** Play again: a fresh run from level 1 (loadLevel resets the finished run). */
  playAgain(): void {
    void this.loadLevel(1);
    this.setMode('PLAYING');
  }

  /** Menu: park in the sandbox so Enter on the curtain does not resume the boss arena. */
  backToMenu(): void {
    void this.loadLevel(0);
    this.setMode('CURTAIN');
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

  /** Once open, the exit blinks between two greens so it cannot be missed. */
  private pulseFinalDoor(now: number): void {
    if (!this.finalDoorOpen || !this.door) return;
    const textures = this.finalDoor();
    const lit = Math.floor(now / 350) % 2 === 0 ? textures.open : textures.bright;
    this.overrides.set(tileKey(this.door.x, this.door.y), lit);
  }

  private updateHud(): void {
    setVital(healthEl, this.health, MAX_HEALTH);
    setVital(ammoEl, this.weapon.ammo, MAX_AMMO_BAR);
    ammoEl.classList.toggle('low', this.weapon.ammo <= 10);
    if (!targetEl.hidden && performance.now() > this.targetUntil) targetEl.hidden = true;
    const alive = this.enemies.filter((e) => !e.dead).length;
    leftEl.textContent =
      this.levelIndex === 0 ? 'sandbox' : this.finalDoorOpen ? 'EXIT IS OPEN' : `${alive} left`;
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
      if (this.levelIndex >= 1) this.run.addTime(dt);
      this.updateHud();
      this.pulseFinalDoor(now);
    }

    // Enemies are not updated here, so nothing can hurt the player mid-cinematic.
    if (this.mode === 'CINEMATIC') this.updateFinale();

    if (
      this.mode === 'PLAYING' ||
      this.mode === 'BETWEEN' ||
      this.mode === 'CURTAIN' ||
      this.mode === 'CINEMATIC' ||
      this.mode === 'VICTORY'
    ) {
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

  // Bugs & ideas board on the start screen; the game never depends on it being up.
  const { mountBugBoard } = await import('./bugs/panel');
  mountBugBoard(el('#bugs-open'));

  el('#victory-again').addEventListener('click', () => game.playAgain());
  el('#victory-menu').addEventListener('click', () => game.backToMenu());
  // loadLevel swaps the level in before its first await, so everything below can
  // run now, inside the click that pointer lock needs.
  const startSandbox = (mode: 'MAP_EDITOR' | 'COLOR_EDITOR'): void => {
    if (game.levelIndex !== 0) void game.loadLevel(0);
    game.setMode(mode);
  };
  el('#start-map').addEventListener('click', () => startSandbox('MAP_EDITOR'));
  el('#start-colour').addEventListener('click', () => startSandbox('COLOR_EDITOR'));
  el('#start').addEventListener('click', () => {
    // From the sandbox this is level 1; after Esc mid-level it picks that level back up.
    if (game.levelIndex === 0) void game.loadLevel(1);
    game.setMode('PLAYING');
  });

  // The level picker lives on the curtain, which Esc (or the touch ≡ button) brings back.
  const levelsEl = el('#levels');
  const startLabel = el('#start');
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
    startLabel.innerHTML =
      game.levelIndex === 0
        ? 'Play <small>(Level 1)</small>'
        : `Resume <small>(${game.levelDef.secret ? 'boss' : game.levelDef.name})</small>`;
  };
  renderLevels();
  game.onModeChange((mode) => {
    if (mode === 'CURTAIN') {
      renderLevels();
      // Enter on the curtain means "play".
      startLabel.focus({ preventScroll: true });
    }
  });
  startLabel.focus({ preventScroll: true });
  el('#touch-menu').addEventListener('click', () => game.setMode('CURTAIN'));
  canvas.addEventListener('click', () => {
    if (game.mode === 'CURTAIN') game.setMode('PLAYING');
  });
  touchMapButton.addEventListener('click', () => game.openEditor('MAP_EDITOR'));
  touchColourButton.addEventListener('click', () => game.openEditor('COLOR_EDITOR'));

  // A short "how do I move" overlay for the first touch, gone as soon as a finger lands.
  if (isTouchDevice) {
    touchHelp.hidden = false;
    canvas.addEventListener('pointerdown', () => (touchHelp.hidden = true), { once: true });
  }
  const fireButton = el('#touch-fire');
  fireButton.addEventListener('pointerdown', () => game.input.setTouchFiring(true));
  fireButton.addEventListener('pointerup', () => game.input.setTouchFiring(false));
  fireButton.addEventListener('pointercancel', () => game.input.setTouchFiring(false));

  requestAnimationFrame(game.frame);
}

export type { Game };

void boot();
