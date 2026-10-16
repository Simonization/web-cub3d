/** Shared chrome for the M and C screens: a full-screen fake terminal. */

export interface TerminalCommand {
  /** What gets typed, without the colon: `w`. */
  command: string;
  /** The word the letter stands for: `write`. */
  word: string;
  /** What it does, in plain words: `save and play`. */
  does: string;
}

export interface TerminalOptions {
  id: string;
  title: string;
  hint: string;
  /** Shown as buttons above the prompt; a click types the command, then runs it. */
  commands: TerminalCommand[];
}

/** Long enough to see the command land in the box before the screen closes. */
const TYPED_PAUSE_MS = 240;

export class Terminal {
  readonly root: HTMLDivElement;
  readonly body: HTMLDivElement;
  readonly status: HTMLDivElement;
  readonly prompt: HTMLInputElement;

  private handlers: Array<(command: string, args: string[]) => void> = [];

  constructor(options: TerminalOptions) {
    this.root = document.createElement('div');
    this.root.className = 'terminal';
    this.root.id = options.id;
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="terminal-frame">
        <header>
          <span class="dot"></span>
          <span class="title">${options.title}</span>
          <span class="hint">${options.hint}</span>
        </header>
        <div class="terminal-body"></div>
        <div class="terminal-status"></div>
        <div class="terminal-commands">
          <p>
            Done? Type a command in the box at the very bottom and press <kbd>Enter</kbd>,
            or click it here. The colon means &ldquo;this is a command&rdquo;; the letters
            come from <i>vim</i>, a text editor that lives in the terminal.
          </p>
          <div class="command-buttons">
            ${options.commands
              .map(
                (c) => `<button type="button" data-command="${c.command}">
                  <code>:${c.command}</code>
                  <span>${c.word === c.command ? '' : `<b>${c.word}</b> &mdash; `}${c.does}</span>
                </button>`,
              )
              .join('')}
          </div>
        </div>
        <label class="terminal-prompt">
          <span>&gt;</span>
          <input type="text" spellcheck="false" autocomplete="off" autocapitalize="off"
                 placeholder="type :${options.commands[0]?.command ?? 'help'} here and press Enter" />
        </label>
      </div>
      <div class="scanlines" aria-hidden="true"></div>
    `;
    this.body = this.root.querySelector('.terminal-body')!;
    this.status = this.root.querySelector('.terminal-status')!;
    this.prompt = this.root.querySelector('.terminal-prompt input')!;

    this.prompt.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') this.submit();
    });

    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-command]')) {
      button.addEventListener('click', () => this.type(`:${button.dataset.command}`));
    }

    document.querySelector('#stage')!.append(this.root);
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.prompt.value = '';
    this.prompt.classList.remove('typed');
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  setStatus(text: string, tone: 'ok' | 'warn' | 'error' | 'muted' = 'muted'): void {
    this.status.textContent = text;
    this.status.dataset.tone = tone;
  }

  onCommand(handler: (command: string, args: string[]) => void): void {
    this.handlers.push(handler);
  }

  /**
   * What a command button does: puts the text in the box, as if typed, and then
   * runs it. The point is that the player sees the button and the box are the
   * same thing, and can type it themselves next time.
   */
  private type(text: string): void {
    this.prompt.value = text;
    this.prompt.classList.add('typed');
    window.setTimeout(() => {
      this.prompt.classList.remove('typed');
      this.submit();
    }, TYPED_PAUSE_MS);
  }

  private submit(): void {
    const raw = this.prompt.value.trim().replace(/^:/, '');
    this.prompt.value = '';
    if (raw.length === 0) return;
    const [command, ...args] = raw.split(/\s+/);
    for (const handler of this.handlers) handler(command!.toLowerCase(), args);
  }
}

/** A collapsible plain-English explainer, used by both screens. */
export function explainer(title: string, html: string): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'explainer';
  details.innerHTML = `<summary>${title}</summary><div>${html}</div>`;
  return details;
}
