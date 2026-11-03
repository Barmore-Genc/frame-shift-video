/**
 * The client of the listener (colossus's extras-eyes container, eyes.py): asks it what an extra
 * shows at its start and says in its first minute and a half.
 */

import type { Look } from './extras-match';

const TIMEOUT_MS = 4 * 60 * 1000;

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export class ListenerUnavailable extends Error {}

/** Asks the listener about the extra at `path` (under the DVDs folder). */
export async function lookAt(
  path: string,
  fetcher: Fetcher = fetch,
  base: string | undefined = process.env.EXTRAS_EYES_URL,
): Promise<Look> {
  if (!base) throw new ListenerUnavailable('The listener is not set up here');
  let response: Response;
  try {
    response = await fetcher(`${base.replace(/\/$/, '')}/look`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ListenerUnavailable('The listener could not be reached');
  }
  const body = (await response.json().catch(() => null)) as
    (Partial<Look> & { error?: string }) | null;
  if (!response.ok || !body) {
    throw new Error(body?.error ?? 'The listener could not look at that');
  }
  return {
    seconds: Number(body.seconds) || 0,
    ocr: Array.isArray(body.ocr) ? body.ocr : [],
    speech: Array.isArray(body.speech) ? body.speech : [],
  };
}

/** What dvdcompare.net lists for a movie's Region 1 DVD, as the listener answers it. */
export interface CompareAnswer {
  found: boolean;
  film?: string;
  year?: number | null;
  url?: string;
  releases?: {
    name: string;
    features: {
      title: string;
      seconds: number | null;
      type: string | null;
      play_all: boolean;
      depth: number;
    }[];
  }[];
}

/** Asks the listener to look the movie up on dvdcompare.net (slow the first time). */
export async function compareAt(
  title: string,
  year: number | null,
  fetcher: Fetcher = fetch,
  base: string | undefined = process.env.EXTRAS_EYES_URL,
): Promise<CompareAnswer> {
  if (!base) throw new ListenerUnavailable('The listener is not set up here');
  let response: Response;
  try {
    response = await fetcher(`${base.replace(/\/$/, '')}/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, year }),
      signal: AbortSignal.timeout(90 * 1000),
    });
  } catch {
    throw new ListenerUnavailable('The listener could not be reached');
  }
  const body = (await response.json().catch(() => null)) as
    (CompareAnswer & { error?: string }) | null;
  if (!response.ok || !body) {
    throw new Error(body?.error ?? 'DVD Compare could not be asked');
  }
  return body;
}

/** What the menus of a movie's disc image say about its titles, as the listener answers it. */
export interface MenuAnswer {
  found: boolean;
  disc?: string;
  entries?: {
    title: number;
    seconds: number | null;
    name: string;
    play_all: boolean;
    menu: string;
  }[];
}

/**
 * Asks the listener to read the menus of the movie's disc image (slow the first time: a minute for
 * a disc with many menus; it keeps the answer). Not every movie has an image kept.
 */
export async function menuAt(
  title: string,
  year: number | null,
  fetcher: Fetcher = fetch,
  base: string | undefined = process.env.EXTRAS_EYES_URL,
  timeoutMs: number = 3 * 60 * 1000,
): Promise<MenuAnswer> {
  if (!base) throw new ListenerUnavailable('The listener is not set up here');
  let response: Response;
  try {
    response = await fetcher(`${base.replace(/\/$/, '')}/menu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, year }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ListenerUnavailable('The listener could not be reached');
  }
  const body = (await response.json().catch(() => null)) as
    (MenuAnswer & { error?: string }) | null;
  if (!response.ok || !body) {
    throw new Error(body?.error ?? 'The disc menus could not be read');
  }
  return body;
}

/**
 * Small grey pictures of the extra at `path`, one a second from `start` (at most `count`, so fewer
 * near the end), as the listener makes them. Frame Shift's own ffmpeg cannot decode the library's
 * 10-bit HEVC, so the pictures for comparing extras come from the listener.
 */
export async function thumbsOf(
  path: string,
  start: number,
  count: number,
  width: number,
  height: number,
  fetcher: Fetcher = fetch,
  base: string | undefined = process.env.EXTRAS_EYES_URL,
): Promise<Uint8Array[]> {
  if (!base) throw new ListenerUnavailable('The listener is not set up here');
  let response: Response;
  try {
    response = await fetcher(`${base.replace(/\/$/, '')}/thumbs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, start, count, width, height }),
      signal: AbortSignal.timeout(60 * 1000),
    });
  } catch {
    throw new ListenerUnavailable('The listener could not be reached');
  }
  const body = (await response.json().catch(() => null)) as {
    frames?: string[];
    error?: string;
  } | null;
  if (!response.ok || !body || !Array.isArray(body.frames)) {
    throw new Error(body?.error ?? 'The listener could not make pictures');
  }
  return body.frames.map(
    (frame) => new Uint8Array(Buffer.from(frame, 'base64')),
  );
}
