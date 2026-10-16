import { parseCub, serializeCub, validateWalls } from '../format/cub';
import type { Game } from '../main';
import { explainer, Terminal } from './terminal';

const SPAWNS = new Set(['N', 'S', 'E', 'W']);
const MAX_SIDE = 64;

/** What a click or a drag puts down. `spawn` is the player, facing `facing`. */
type Brush = '1' | '0' | ' ' | 'spawn';

const BRUSH_KEYS: Record<string, Brush> = { '1': '1', '0': '0', ' ': ' ' };
const FACING_NAMES: Record<string, string> = { N: 'north', E: 'east', S: 'south', W: 'west' };
const TURN_RIGHT: Record<string, string> = { N: 'E', E: 'S', S: 'W', W: 'N' };

const PATH_EXPLAINER = `
<p>In the C version a line like <code>NO ./textures/wall_n.xpm</code> is a <em>path</em>.
The <code>./</code> means &ldquo;start looking from the folder I launched the program in&rdquo;.
The operating system walks that path, opens the file, and the program checks it ends in
<code>.xpm</code> and that its first 255 bytes contain the words <code>XPM</code> and
<code>static char</code> before trusting it. Then it decodes the text into pixels.</p>
<p>A browser has no such folder. When you pick a file, the page is handed the <em>bytes</em>
and never the location &mdash; a web page is not allowed to learn where things sit on your
disk. So this game keeps a small dictionary instead: the text <code>./user/north.png</code>
simply stands for the image you gave it, held in your browser.</p>
<p>Same idea either way &mdash; a short name standing in for a pile of pixels. Only the
lookup differs.</p>
`;

export function mountMapEditor(game: Game): void {
  const terminal = new Terminal({
    id: 'map-editor',
    title: 'MAP',
    hint: 'pick a brush · click or drag to paint · arrow keys + 1 0 space to paint by keyboard',
    commands: [
      { command: 'w', word: 'write', does: 'save this map and walk into it' },
      { command: 'q', word: 'quit', does: 'leave without saving' },
      { command: 'help', word: 'help', does: 'list every command' },
    ],
  });

  const layout = document.createElement('div');
  layout.className = 'map-layout';
  layout.innerHTML = `
    <div class="map-grid-wrap"><div class="map-grid" tabindex="0"></div></div>
    <aside class="map-side">
      <div class="brushes" role="radiogroup" aria-label="Paint with">
        <p class="side-title">Paint with</p>
        <button type="button" class="brush" role="radio" data-brush="1">
          <b class="swatch-wall">1</b><span>Wall</span><kbd>1</kbd>
        </button>
        <button type="button" class="brush" role="radio" data-brush="0">
          <b>0</b><span>Floor</span><kbd>0</kbd>
        </button>
        <button type="button" class="brush" role="radio" data-brush=" ">
          <b class="swatch-void">&middot;</b><span>Outside the map</span><kbd>space</kbd>
        </button>
        <button type="button" class="brush" role="radio" data-brush="spawn">
          <b class="swatch-spawn facing">N</b>
          <span>You, facing <i class="facing-name">north</i><small>click again to turn</small></span>
          <kbd>N E S W</kbd>
        </button>
      </div>
      <p class="howto">
        Click a square to paint it with the brush, or hold and drag. Every wall must be
        closed: red squares show where the floor leaks out.
      </p>
      <div class="lint"></div>
      <div class="explainers"></div>
    </aside>
  `;
  terminal.body.append(layout);

  const gridEl = layout.querySelector<HTMLDivElement>('.map-grid')!;
  const lintEl = layout.querySelector<HTMLDivElement>('.lint')!;
  const brushButtons = [...layout.querySelectorAll<HTMLButtonElement>('.brush')];
  const facingEl = layout.querySelector<HTMLElement>('.facing')!;
  const facingNameEl = layout.querySelector<HTMLElement>('.facing-name')!;
  layout
    .querySelector('.explainers')!
    .append(explainer('How does it read an image path?', PATH_EXPLAINER));

  let rows: string[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let brush: Brush = '1';
  let facing = 'N';
  let painting = false;
  // The yellow cursor only exists for keyboard painting. With the mouse there is
  // nothing under it to aim, so a key that picks a brush must not also paint
  // whichever square happened to be clicked last.
  let keyboardCursor = false;

  const width = (): number => rows.reduce((max, row) => Math.max(max, row.length), 0);
  const brushChar = (): string => (brush === 'spawn' ? facing : brush);

  function setCell(x: number, y: number, ch: string): void {
    if (y < 0 || y >= rows.length || x < 0) return;
    const row = rows[y]!.padEnd(x + 1, ' ');
    if (SPAWNS.has(ch)) {
      rows = rows.map((r) => r.replace(/[NSEW]/g, '0'));
    }
    rows[y] = row.slice(0, x) + ch + row.slice(x + 1);
    render();
  }

  /** Puts the brush down. Returns false when it refused to paint over the player. */
  function paint(x: number, y: number): boolean {
    const current = rows[y]?.[x] ?? ' ';
    const ch = brushChar();
    // Only the "you" brush moves the player; the others go round them, so a drag
    // across the room cannot leave the map without anyone in it.
    if (SPAWNS.has(current) && !SPAWNS.has(ch)) return false;
    if (current !== ch) setCell(x, y, ch);
    return true;
  }

  function selectBrush(next: Brush): void {
    brush = next;
    for (const button of brushButtons) {
      const active = button.dataset.brush === next;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', String(active));
    }
    facingEl.textContent = facing;
    facingNameEl.textContent = FACING_NAMES[facing]!;
  }

  /** Turns the player where they stand, so the brush and the map never disagree. */
  function face(next: string): void {
    facing = next;
    rows = rows.map((r) => r.replace(/[NSEW]/g, next));
    selectBrush('spawn');
    render();
  }

  function render(): void {
    const w = Math.max(width(), 1);
    const errors = validateWalls(rows);
    const bad = new Set(errors.map((e) => `${e.col},${e.line}`));

    gridEl.style.setProperty('--cols', String(w));
    gridEl.replaceChildren(
      ...rows.flatMap((row, y) =>
        Array.from({ length: w }, (_, x) => {
          const ch = row[x] ?? ' ';
          const cell = document.createElement('span');
          cell.className = 'cell';
          cell.textContent = ch === ' ' ? '·' : ch;
          cell.dataset.x = String(x);
          cell.dataset.y = String(y);
          if (ch === '1') cell.classList.add('wall');
          else if (SPAWNS.has(ch)) cell.classList.add('spawn');
          else if (ch === ' ') cell.classList.add('void');
          if (bad.has(`${x},${y}`)) cell.classList.add('bad');
          if (keyboardCursor && x === cursorX && y === cursorY) cell.classList.add('cursor');
          return cell;
        }),
      ),
    );

    lint(errors.length);
  }

  function lint(wallErrors: number): void {
    const draft = draftLevel();
    const parsed = parseCub(draft);
    if (parsed.ok) {
      lintEl.innerHTML =
        '<p class="ok">Map is valid. Type <b>:w</b> in the box at the bottom and press ' +
        'Enter to walk into it.</p>';
      terminal.setStatus(`${width()}x${rows.length} · valid`, 'ok');
      return;
    }
    const unique = [...new Map(parsed.errors.map((e) => [e.message, e])).values()];
    lintEl.innerHTML =
      `<p class="err">${parsed.errors.length} problem${parsed.errors.length === 1 ? '' : 's'}</p>` +
      unique
        .map((e) => {
          const where = e.line === undefined ? '' : ` <span class="at">row ${e.line + 1}</span>`;
          return `<div class="lint-row">${e.message}${where}</div>`;
        })
        .join('');
    terminal.setStatus(
      `${width()}x${rows.length} · ${wallErrors} open cell${wallErrors === 1 ? '' : 's'}`,
      'error',
    );
  }

  /** The grid the player is editing, wrapped in the level's current header. */
  function draftLevel(): string {
    return serializeCub({ ...game.level, grid: rows });
  }

  function open(): void {
    rows = [...game.level.grid];
    const spawn = game.level.spawn;
    cursorX = spawn.x;
    cursorY = spawn.y;
    facing = spawn.facing;
    keyboardCursor = false;
    selectBrush(brush);
    terminal.show();
    render();
    gridEl.focus();
  }

  function close(): void {
    terminal.hide();
    game.setMode('PLAYING');
  }

  async function apply(): Promise<void> {
    const parsed = parseCub(draftLevel());
    if (!parsed.ok) {
      terminal.setStatus(`can't save yet: ${parsed.errors[0]!.message}`, 'error');
      return;
    }
    await game.applyLevel(parsed.level);
    close();
  }

  function resize(w: number, h: number): void {
    const cols = Math.min(Math.max(w, 3), MAX_SIDE);
    const height = Math.min(Math.max(h, 3), MAX_SIDE);
    rows = Array.from({ length: height }, (_, y) =>
      Array.from({ length: cols }, (_, x) =>
        y === 0 || y === height - 1 || x === 0 || x === cols - 1 ? '1' : '0',
      ).join(''),
    );
    const midY = height >> 1;
    const midX = cols >> 1;
    rows[midY] = rows[midY]!.slice(0, midX) + facing + rows[midY]!.slice(midX + 1);
    cursorX = midX;
    cursorY = midY;
    render();
  }

  function download(): void {
    const blob = new Blob([draftLevel()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'level.cub';
    link.click();
    URL.revokeObjectURL(url);
    terminal.setStatus('saved level.cub — it runs in the C binary too', 'ok');
  }

  function loadFile(): void {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.cub,text/plain';
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0];
      if (!file) return;
      const parsed = parseCub(await file.text());
      if (!parsed.ok) {
        terminal.setStatus(`${file.name}: ${parsed.errors[0]!.message}`, 'error');
        return;
      }
      rows = [...parsed.level.grid];
      cursorX = parsed.level.spawn.x;
      cursorY = parsed.level.spawn.y;
      facing = parsed.level.spawn.facing;
      selectBrush(brush);
      render();
      terminal.setStatus(`loaded ${file.name}`, 'ok');
    });
    picker.click();
  }

  for (const button of brushButtons) {
    button.addEventListener('click', () => {
      const next = button.dataset.brush as Brush;
      if (next === 'spawn' && brush === 'spawn') face(TURN_RIGHT[facing]!);
      else selectBrush(next);
      gridEl.focus();
    });
  }

  gridEl.addEventListener('keydown', (event) => {
    const key = event.key;
    const upper = key.toUpperCase();
    const w = width();

    if (key === 'Escape') return void close();
    if (key === ':') {
      event.preventDefault();
      terminal.prompt.value = ':';
      terminal.prompt.focus();
      return;
    }
    if (key === 'Enter') {
      event.preventDefault();
      void apply();
      return;
    }

    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const move = moves[key];
    if (move) {
      event.preventDefault();
      if (keyboardCursor) {
        cursorX = Math.min(Math.max(cursorX + move[0], 0), Math.max(w - 1, 0));
        cursorY = Math.min(Math.max(cursorY + move[1], 0), rows.length - 1);
      }
      keyboardCursor = true;
      render();
      return;
    }

    const picked = BRUSH_KEYS[key];
    if (picked !== undefined) {
      event.preventDefault();
      selectBrush(picked);
      if (keyboardCursor) paint(cursorX, cursorY);
      return;
    }
    if (key.length === 1 && SPAWNS.has(upper)) {
      event.preventDefault();
      face(upper);
      if (keyboardCursor) paint(cursorX, cursorY);
    }
  });

  const cellAt = (x: number, y: number): HTMLElement | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return el?.classList.contains('cell') && gridEl.contains(el) ? el : null;
  };

  gridEl.addEventListener('pointerdown', (event) => {
    const cell = cellAt(event.clientX, event.clientY);
    if (!cell) return;
    event.preventDefault();
    gridEl.focus();
    // Touch captures the pointer to the first square; release it so the drag
    // keeps finding the square under the finger.
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    keyboardCursor = false;
    cursorX = Number(cell.dataset.x);
    cursorY = Number(cell.dataset.y);
    painting = true;
    if (!paint(cursorX, cursorY)) {
      terminal.setStatus(
        `that ${rows[cursorY]![cursorX]} is you — pick the "You" brush to move yourself`,
        'warn',
      );
    }
  });

  gridEl.addEventListener('pointermove', (event) => {
    if (!painting) return;
    const cell = cellAt(event.clientX, event.clientY);
    if (!cell) return;
    paint(Number(cell.dataset.x), Number(cell.dataset.y));
  });

  const stopPainting = (): void => {
    painting = false;
  };
  window.addEventListener('pointerup', stopPainting);
  window.addEventListener('pointercancel', stopPainting);

  terminal.onCommand((command, args) => {
    switch (command) {
      case 'w':
        void apply();
        break;
      case 'q':
        close();
        break;
      case 'new':
        resize(Number(args[0] ?? 20), Number(args[1] ?? 12));
        break;
      case 'save':
        download();
        break;
      case 'load':
        loadFile();
        break;
      case 'help':
        terminal.setStatus(
          ':w write (save and play) · :q quit (no save) · :new 20 12 blank map, 20 wide 12 high · ' +
            ':save download it as a .cub file · :load open one · Esc does the same as :q',
          'muted',
        );
        break;
      default:
        terminal.setStatus(`unknown command "${command}" — try :help`, 'warn');
    }
    gridEl.focus();
  });

  game.onModeChange((mode) => {
    if (mode === 'MAP_EDITOR') open();
    else if (terminal.visible) terminal.hide();
  });
}
