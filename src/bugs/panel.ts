/**
 * "Bugs & ideas": a form and the public list of what has been reported, opened
 * from the start screen. With an admin link (/bugs/admin#key=…) every report
 * also gets a delete button.
 *
 * Everything people typed is put on the page with textContent only — nothing in
 * this file uses innerHTML.
 */

import {
  BugApiError,
  deleteReport,
  isAdminPath,
  keyFromLocation,
  LIMITS,
  listReports,
  sendReport,
  type Report,
  type ReportType,
} from './api';

const KEY_STORAGE = 'cub3d-bugs-admin-key';

type Attrs = Record<string, string | number | boolean>;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false) continue;
    if (name === 'class') node.className = String(value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  node.append(...children); // strings become text nodes
  return node;
}

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Reads the key from an admin link once, then takes it out of the address bar. */
function adminKey(): string | null {
  if (!isAdminPath(location.pathname)) return null;
  const fromUrl = keyFromLocation(location);
  if (fromUrl) {
    try {
      storage()?.setItem(KEY_STORAGE, fromUrl);
    } catch {
      /* private mode: the key just won't survive a reload */
    }
    history.replaceState(null, '', location.pathname);
    return fromUrl;
  }
  try {
    return storage()?.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

const LABEL: Record<ReportType, string> = { bug: 'BUG', suggestion: 'IDEA' };

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function mountBugBoard(openButton: HTMLElement): void {
  const key = adminKey();
  const admin = key !== null;

  // ---- the form ----
  const kindBug = h('input', { type: 'radio', name: 'bug-kind', value: 'bug', checked: true });
  const kindIdea = h('input', { type: 'radio', name: 'bug-kind', value: 'suggestion' });
  const message = h('textarea', {
    name: 'message',
    rows: 4,
    maxlength: LIMITS.messageMax,
    required: true,
    placeholder: 'e.g. on level 2 I got stuck inside a wall',
  });
  const counter = h('span', { class: 'bugs-counter' }, `0/${LIMITS.messageMax}`);
  const name = h('input', {
    type: 'text',
    name: 'name',
    maxlength: LIMITS.nameMax,
    autocomplete: 'nickname',
    placeholder: 'your name or 42 login (optional)',
  });
  // Honeypot: hidden from people, irresistible to form-filling bots.
  const website = h('input', { type: 'text', name: 'website', tabindex: -1, autocomplete: 'off' });
  const send = h('button', { type: 'submit' }, h('code', {}, ':w'), ' send');

  const form = h(
    'form',
    { class: 'bugs-form', novalidate: true },
    h(
      'p',
      { class: 'howto' },
      'Something broken, or an idea for the game? Tell me here. Everyone can read this list, so do not write anything private.',
    ),
    h(
      'div',
      { class: 'bugs-kind', role: 'radiogroup', 'aria-label': 'What is it?' },
      h('label', {}, kindBug, h('span', {}, 'bug: something is broken')),
      h('label', {}, kindIdea, h('span', {}, 'idea: make it better')),
    ),
    h('label', { class: 'bugs-field' }, h('span', {}, 'what happened? ', counter), message),
    h('label', { class: 'bugs-field' }, h('span', {}, 'name'), name),
    h('div', { class: 'bugs-trap', 'aria-hidden': 'true' }, website),
    h('div', { class: 'bugs-actions' }, send),
  );

  // ---- the list ----
  const listTitle = h('p', { class: 'side-title' }, 'already reported');
  const list = h('ul', { class: 'bugs-list' });

  // ---- chrome ----
  const status = h('div', { class: 'terminal-status', role: 'status', 'aria-live': 'polite' });
  const close = h('button', { type: 'button', class: 'bugs-close', 'aria-label': 'Close' }, ':q close');
  const root = h(
    'div',
    { class: 'terminal', id: 'bugs', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Bugs and ideas' },
    h(
      'div',
      { class: 'terminal-frame bugs-frame' },
      h(
        'header',
        {},
        h('span', { class: 'dot' }),
        h('span', { class: 'title' }, admin ? 'BUGS & IDEAS · ADMIN' : 'BUGS & IDEAS'),
        h('span', { class: 'hint' }, 'Esc closes'),
        close,
      ),
      h('div', { class: 'terminal-body bugs-body' }, form, h('section', { class: 'bugs-board' }, listTitle, list)),
      status,
    ),
    h('div', { class: 'scanlines', 'aria-hidden': 'true' }),
  );
  root.hidden = true;
  document.querySelector('#stage')!.append(root);

  const say = (text: string, tone: 'ok' | 'warn' | 'error' | '' = ''): void => {
    status.textContent = text;
    status.dataset.tone = tone;
  };

  let reports: Report[] = [];

  function renderList(): void {
    listTitle.textContent = `already reported (${reports.length})`;
    if (reports.length === 0) {
      list.replaceChildren(h('li', { class: 'bugs-empty' }, 'Nothing yet. You could be the first!'));
      return;
    }
    list.replaceChildren(
      ...reports.map((report) => {
        const meta = h(
          'span',
          { class: 'bugs-meta' },
          `#${report.id} · ${report.name ? `${report.name} · ` : ''}${when(report.createdAt)}`,
        );
        const item = h(
          'li',
          { class: 'bugs-item' },
          h('b', { class: `bugs-tag ${report.type}` }, LABEL[report.type] ?? 'BUG'),
          h('p', { class: 'bugs-message' }, report.message),
          meta,
        );
        if (admin) {
          const remove = h('button', { type: 'button', class: 'bugs-delete' }, 'delete');
          remove.addEventListener('click', () => void removeReport(report, remove));
          item.append(remove);
        }
        return item;
      }),
    );
  }

  async function refresh(): Promise<void> {
    list.replaceChildren(h('li', { class: 'bugs-empty' }, 'loading…'));
    try {
      reports = await listReports();
      renderList();
      setOnline(true);
    } catch (error) {
      setOnline(false);
      listTitle.textContent = 'already reported';
      list.replaceChildren(
        h('li', { class: 'bugs-empty' }, 'The list could not be loaded. The game works fine; only this board is offline.'),
      );
      if (!(error instanceof BugApiError && error.offline)) say('Could not load the list.', 'warn');
    }
  }

  function setOnline(online: boolean): void {
    send.disabled = !online;
    if (!online) say('The bug board is offline right now — try again later.', 'warn');
  }

  async function removeReport(report: Report, button: HTMLButtonElement): Promise<void> {
    if (!key) {
      say('This admin link has no key in it.', 'error');
      return;
    }
    if (!window.confirm(`Delete #${report.id}?\n\n${report.message.slice(0, 200)}`)) return;
    button.disabled = true;
    try {
      await deleteReport(report.id, key);
      reports = reports.filter((r) => r.id !== report.id);
      renderList();
      say(`Deleted #${report.id}.`, 'ok');
    } catch (error) {
      button.disabled = false;
      say(error instanceof BugApiError ? error.message : 'Delete failed.', 'error');
    }
  }

  message.addEventListener('input', () => {
    counter.textContent = `${[...message.value].length}/${LIMITS.messageMax}`;
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit();
  });

  async function submit(): Promise<void> {
    const text = message.value.trim();
    if ([...text].length < LIMITS.messageMin) {
      say('Write a little more, so I know what you mean.', 'warn');
      message.focus();
      return;
    }
    send.disabled = true;
    say('sending…');
    try {
      const report = await sendReport({
        type: kindIdea.checked ? 'suggestion' : 'bug',
        message: text,
        name: name.value.trim(),
        website: website.value,
      });
      if (report) {
        reports = [report, ...reports];
        renderList();
      }
      message.value = '';
      counter.textContent = `0/${LIMITS.messageMax}`;
      say('Thanks! It is on the list now.', 'ok');
      send.disabled = false;
    } catch (error) {
      if (error instanceof BugApiError && error.offline) {
        setOnline(false);
        return;
      }
      say(error instanceof BugApiError ? error.message : 'Sending failed.', 'error');
      send.disabled = false;
    }
  }

  let returnFocus: HTMLElement | null = null;

  function open(): void {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.hidden = false;
    say(admin ? (key ? 'Admin mode: delete what is fixed.' : 'Admin link without a key.') : '');
    void refresh();
    (admin ? close : message).focus();
  }

  function hide(): void {
    root.hidden = true;
    returnFocus?.focus();
  }

  openButton.addEventListener('click', open);
  close.addEventListener('click', hide);
  // Keys typed here are for the form, not the game listening on window.
  root.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') hide();
  });
  // Focus can also sit outside the panel (on the page behind it).
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !root.hidden) hide();
  });

  if (admin) open();
}
