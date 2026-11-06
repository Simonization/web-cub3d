/** Talks to the bug board API (server/), same origin under /api/bugs. */

export type ReportType = 'bug' | 'suggestion';

export interface Report {
  id: number;
  type: ReportType;
  message: string;
  name: string | null;
  createdAt: string;
}

/** Mirrors LIMITS in server/core.mjs; the server is the one that enforces them. */
export const LIMITS = { messageMin: 3, messageMax: 500, nameMax: 40 } as const;

const TIMEOUT_MS = 6000;

export class BugApiError extends Error {
  /** 0 means the API could not be reached at all. */
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }

  get offline(): boolean {
    return this.status === 0;
  }
}

const OFFLINE = 'The bug board is not reachable right now.';

async function call<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new BugApiError(OFFLINE, 0);
  }
  if (res.status === 204) return null;
  // Without the API behind it, the static site answers /api/* with index.html
  // (try_files) or a proxy error page: anything that is not JSON means "offline".
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  if (!isJson) throw new BugApiError(OFFLINE, 0);
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new BugApiError(body?.error ?? `The server said ${res.status}.`, res.status);
  return body;
}

export async function listReports(): Promise<Report[]> {
  const body = await call<{ reports: Report[] }>('/api/bugs');
  return Array.isArray(body?.reports) ? body.reports : [];
}

export async function sendReport(input: {
  type: ReportType;
  message: string;
  name: string;
  website: string;
}): Promise<Report | null> {
  const body = await call<{ report: Report | null }>('/api/bugs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return body?.report ?? null;
}

export async function deleteReport(id: number, key: string): Promise<void> {
  await call(`/api/bugs/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${key}` } });
}

/**
 * The admin key from a link like /bugs/admin#key=… (or ?key=…). Prefer the #
 * form: a fragment never leaves the browser, so it never lands in a server log.
 */
export function keyFromLocation(loc: { hash: string; search: string }): string | null {
  for (const part of [loc.hash.replace(/^#/, ''), loc.search.replace(/^\?/, '')]) {
    const key = new URLSearchParams(part).get('key');
    if (key) return key;
  }
  return null;
}

export const isAdminPath = (pathname: string): boolean => /^\/bugs\/admin\/?$/.test(pathname);
