import { packRGB, unpackRGB, type CubLevel } from '../format/cub';
import { textureFromBlob } from '../engine/textures';
import { BUILTIN_TEXTURES } from '../game/levels';
import type { Game } from '../main';
import { getImage, listImages, putImage } from './imageStore';
import { explainer, Terminal } from './terminal';

type Face = 'NO' | 'SO' | 'WE' | 'EA';

const FACES: ReadonlyArray<{ id: Face; label: string }> = [
  { id: 'NO', label: 'North wall' },
  { id: 'SO', label: 'South wall' },
  { id: 'WE', label: 'West wall' },
  { id: 'EA', label: 'East wall' },
];

const RGB_EXPLAINER = `
<p>Every colour on your screen is three numbers: how much <b class="r">red</b>,
<b class="g">green</b> and <b class="b">blue</b> to mix, each from 0 to 255. Zero is none
of it, 255 is all of it. <code>255,0,0</code> is red, <code>255,255,0</code> is red and
green together, which your eye reads as yellow. <code>0,0,0</code> is black,
<code>255,255,255</code> is white.</p>
<p>Why 255? Because each number gets one byte &mdash; 8 bits &mdash; and 8 bits count from
0 to 255. Three bytes, one per colour, is 16.7 million combinations.</p>
<p>The line <code>F 220,100,0</code> in a .cub file is read by splitting on the commas,
checking each piece is digits only and no more than 255, and then squeezing all three into
a single number:</p>
<pre>colour = (red &lt;&lt; 16) | (green &lt;&lt; 8) | blue</pre>
<p><code>&lt;&lt;</code> slides the bits left. Red slides 16 places, green 8, blue stays put,
so the three bytes end up side by side inside one 32-bit integer and never collide. To draw
a pixel the screen needs them separated again, which is the same move backwards:
<code>red = (colour &gt;&gt; 16) &amp; 255</code>.</p>
<p>Drag a slider and watch the packed number at the end of the row change.</p>
`;

export function mountColorEditor(game: Game): void {
  const terminal = new Terminal({
    id: 'color-editor',
    title: 'COLOUR',
    hint: 'drag the sliders · upload an image per wall',
    commands: [
      { command: 'w', word: 'write', does: 'save these colours and play' },
      { command: 'q', word: 'quit', does: 'leave without saving' },
    ],
  });

  const layout = document.createElement('div');
  layout.className = 'colour-layout';
  layout.innerHTML = `
    <section class="swatches"></section>
    <section class="faces"></section>
    <section class="explainers"></section>
  `;
  terminal.body.append(layout);

  const swatchesEl = layout.querySelector<HTMLElement>('.swatches')!;
  const facesEl = layout.querySelector<HTMLElement>('.faces')!;
  layout.querySelector('.explainers')!.append(explainer('What is RGB, actually?', RGB_EXPLAINER));

  let draft: CubLevel;
  let uploads: string[] = [];

  interface ChannelBlock {
    element: HTMLElement;
    sync(): void;
  }

  function buildChannel(key: 'floor' | 'ceiling', label: string, letter: string): ChannelBlock {
    const block = document.createElement('div');
    block.className = 'swatch';
    block.innerHTML = `
      <div class="swatch-head">
        <span class="preview"></span>
        <span class="name">${label}</span>
        <code class="cub-line"></code>
      </div>
      ${(['r', 'g', 'b'] as const)
        .map(
          (c) => `<label class="slider ${c}">
            <span>${c.toUpperCase()}</span>
            <input type="range" min="0" max="255" data-channel="${c}" />
            <output></output>
          </label>`,
        )
        .join('')}
      <div class="packed"></div>
    `;

    const preview = block.querySelector<HTMLElement>('.preview')!;
    const cubLine = block.querySelector<HTMLElement>('.cub-line')!;
    const packedEl = block.querySelector<HTMLElement>('.packed')!;
    const inputs = [...block.querySelectorAll<HTMLInputElement>('input')];

    const sync = (): void => {
      const [r, g, b] = unpackRGB(draft[key]);
      const values = { r, g, b };
      for (const input of inputs) {
        const channel = input.dataset.channel as 'r' | 'g' | 'b';
        input.value = String(values[channel]);
        input.nextElementSibling!.textContent = String(values[channel]).padStart(3, ' ');
      }
      preview.style.background = `rgb(${r},${g},${b})`;
      cubLine.textContent = `${letter} ${r},${g},${b}`;
      packedEl.innerHTML =
        `(${r} &lt;&lt; 16) | (${g} &lt;&lt; 8) | ${b} = ` +
        `<b>0x${draft[key].toString(16).padStart(8, '0').toUpperCase()}</b>`;
    };

    block.addEventListener('input', (event) => {
      const input = event.target as HTMLInputElement;
      const [r, g, b] = unpackRGB(draft[key]);
      const values = { r, g, b };
      values[input.dataset.channel as 'r' | 'g' | 'b'] = Number(input.value);
      draft[key] = packRGB(values.r, values.g, values.b);
      sync();
    });

    return { element: block, sync };
  }

  const floorBlock = buildChannel('floor', 'Floor', 'F');
  const ceilingBlock = buildChannel('ceiling', 'Ceiling', 'C');
  swatchesEl.append(ceilingBlock.element, floorBlock.element);

  function renderFaces(): void {
    facesEl.replaceChildren(
      ...FACES.map(({ id, label }) => {
        const row = document.createElement('div');
        row.className = 'face';
        const current = draft.textures[id];
        const options = [
          ...BUILTIN_TEXTURES.map((t) => ({ value: t.path, label: t.label })),
          ...uploads.map((path) => ({ value: path, label: `${path.split('/').pop()} (yours)` })),
        ];
        row.innerHTML = `
          <span class="face-name">${label}</span>
          <select data-face="${id}">
            ${options
              .map(
                (o) =>
                  `<option value="${o.value}"${o.value === current ? ' selected' : ''}>${o.label}</option>`,
              )
              .join('')}
          </select>
          <button type="button" data-upload="${id}">upload</button>
          <code class="cub-line">${id} ${current}</code>
        `;
        return row;
      }),
    );
  }

  facesEl.addEventListener('change', (event) => {
    const select = event.target as HTMLSelectElement;
    if (!select.dataset.face) return;
    draft.textures[select.dataset.face as Face] = select.value;
    renderFaces();
  });

  facesEl.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-upload]');
    if (!button) return;
    const face = button.dataset.upload as Face;
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0];
      if (!file) return;
      // The path is a label, not a location — see the explainer on the map screen.
      const path = `./user/${face.toLowerCase()}-${Date.now().toString(36)}.png`;
      try {
        game.store.set(path, await textureFromBlob(file));
        await putImage(path, file);
        uploads = await listImages();
        draft.textures[face] = path;
        renderFaces();
        terminal.setStatus(`${file.name} is now the ${face} wall`, 'ok');
      } catch (error) {
        terminal.setStatus(`could not read ${file.name}: ${String(error)}`, 'error');
      }
    });
    picker.click();
  });

  async function restoreUploads(): Promise<void> {
    uploads = await listImages();
    await Promise.all(
      uploads.map(async (path) => {
        if (game.store.has(path)) return;
        const blob = await getImage(path);
        if (blob) game.store.set(path, await textureFromBlob(blob));
      }),
    );
  }

  async function open(): Promise<void> {
    draft = { ...game.level, textures: { ...game.level.textures } };
    await restoreUploads();
    floorBlock.sync();
    ceilingBlock.sync();
    renderFaces();
    terminal.setStatus('drag a slider, or upload an image for any wall', 'muted');
    terminal.show();
  }

  function close(): void {
    terminal.hide();
    game.setMode('PLAYING');
  }

  async function apply(): Promise<void> {
    await game.applyLevel(draft);
    close();
  }

  terminal.onCommand((command) => {
    switch (command) {
      case 'w':
        void apply();
        break;
      case 'q':
        close();
        break;
      case 'help':
        terminal.setStatus(':w write (save and play) · :q quit (no save) · Esc = :q', 'muted');
        break;
      default:
        terminal.setStatus(`unknown command "${command}" — try :help`, 'warn');
    }
  });

  terminal.root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  game.onModeChange((mode) => {
    if (mode === 'COLOR_EDITOR') void open();
    else if (terminal.visible) terminal.hide();
  });
}
