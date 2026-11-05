/**
 * The copies and reels of a movie's extras, kept. Finding them looks at pictures of every extra,
 * which takes minutes for a disc with dozens of them, so the answer is kept for an hour, and for as
 * long as the movie's extras are the same files (the same names, sizes and times). Two requests for
 * the same movie at once share one search.
 */

import fs from 'fs/promises';
import { findDuplicates, listenerSum, type Sum } from './extras-duplicates';
import { findReels, type Look, type Reel } from './extras-reels';
import { extraFilePath, readExtras } from './extras-state';

const KEPT_MS = 60 * 60 * 1000;
/** The warmer searches again when the answer is older than this, so a page never finds it expired. */
export const REFRESH_MS = 30 * 60 * 1000;

export type Copies = { groups: string[][]; reels: Reel[] };

type Deps = {
  sum?: Sum;
  look?: Look;
  now?: number;
  /** The search itself (a test can give another). */
  search?: () => Promise<Copies>;
};

const kept = new Map<
  string,
  { signature: string; at: number; copies: Copies }
>();
/** Searches under way, by movie and signature: a page and the warmer share one. */
const searching = new Map<string, Promise<Copies>>();

export function clearCopiesCache(): void {
  kept.clear();
  searching.clear();
}

/** What the movie's extras are now: each one's name, size and time. */
async function signatureOf(dir: string, movie: string): Promise<string> {
  const found = (await readExtras(dir)).find((m) => m.movie === movie);
  if (!found) throw new Error('That movie has no extras');
  const parts: string[] = [];
  for (const item of found.items) {
    try {
      const stat = await fs.stat(await extraFilePath(dir, item.path));
      parts.push(`${item.path}|${stat.size}|${stat.mtimeMs}`);
    } catch {
      parts.push(`${item.path}|gone`);
    }
  }
  return parts.join('\n');
}

/** Searches (or joins the search under way) and keeps what it finds. A failed search is not kept. */
function search(
  dir: string,
  movie: string,
  signature: string,
  deps: Deps,
): Promise<Copies> {
  const key = `${dir}|${movie}`;
  const running = searching.get(`${key}|${signature}`);
  if (running) return running;
  const find =
    deps.search ??
    (() =>
      Promise.all([
        findDuplicates(dir, movie, deps.sum),
        findReels(dir, movie, deps.look),
      ]).then(([groups, reels]) => ({ groups, reels })));
  const started = deps.now ?? Date.now();
  const work = find().then((copies) => {
    kept.set(key, { signature, at: started, copies });
    return copies;
  });
  searching.set(`${key}|${signature}`, work);
  const done = () => {
    if (searching.get(`${key}|${signature}`) === work) {
      searching.delete(`${key}|${signature}`);
    }
  };
  work.then(done, done);
  return work;
}

/**
 * The groups of copies and the reels of `movie`'s extras (see extras-duplicates.ts and
 * extras-reels.ts): the kept answer when there is a fresh one, else a search.
 */
export async function findCopies(
  dir: string,
  movie: string,
  deps: Deps = {},
): Promise<Copies> {
  const now = deps.now ?? Date.now();
  const signature = await signatureOf(dir, movie);
  const hit = kept.get(`${dir}|${movie}`);
  if (hit && hit.signature === signature && now - hit.at < KEPT_MS) {
    return hit.copies;
  }
  return search(dir, movie, signature, deps);
}

/**
 * Searches ahead of a page asking: when the movie has no answer, or an old one, or its extras have
 * changed. A page that asks meanwhile is given the kept answer, or joins this search.
 */
export async function warmCopies(
  dir: string,
  movie: string,
  deps: Deps & { maxAgeMs?: number } = {},
): Promise<void> {
  const now = deps.now ?? Date.now();
  const signature = await signatureOf(dir, movie);
  const hit = kept.get(`${dir}|${movie}`);
  if (
    hit &&
    hit.signature === signature &&
    now - hit.at < (deps.maxAgeMs ?? REFRESH_MS)
  ) {
    return;
  }
  await search(dir, movie, signature, deps);
}

/** What the page and the warmer search with: the listener's pictures where there is a listener. */
export function pictureDeps(): Deps {
  return process.env.EXTRAS_EYES_URL ? { sum: listenerSum } : {};
}
