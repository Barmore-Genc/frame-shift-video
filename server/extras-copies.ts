/**
 * The copies and reels of a movie's extras, kept. Finding them looks at pictures of every extra,
 * which takes minutes for a disc with dozens of them, so the answer is kept for an hour, and for as
 * long as the movie's extras are the same files (the same names, sizes and times). Two requests for
 * the same movie at once share one search.
 */

import fs from 'fs/promises';
import { findDuplicates, type Sum } from './extras-duplicates';
import { findReels, type Look, type Reel } from './extras-reels';
import { extraFilePath, readExtras } from './extras-state';

const KEPT_MS = 60 * 60 * 1000;

export type Copies = { groups: string[][]; reels: Reel[] };

const kept = new Map<
  string,
  { signature: string; at: number; copies: Promise<Copies> }
>();

export function clearCopiesCache(): void {
  kept.clear();
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

/** The groups of copies and the reels of `movie`'s extras (see extras-duplicates.ts and extras-reels.ts). */
export async function findCopies(
  dir: string,
  movie: string,
  deps: {
    sum?: Sum;
    look?: Look;
    now?: number;
    /** The search itself (a test can give another). */
    search?: () => Promise<Copies>;
  } = {},
): Promise<Copies> {
  const now = deps.now ?? Date.now();
  const signature = await signatureOf(dir, movie);
  const key = `${dir}|${movie}`;
  const hit = kept.get(key);
  if (hit && hit.signature === signature && now - hit.at < KEPT_MS) {
    return hit.copies;
  }
  const search =
    deps.search ??
    (() =>
      Promise.all([
        findDuplicates(dir, movie, deps.sum),
        findReels(dir, movie, deps.look),
      ]).then(([groups, reels]) => ({ groups, reels })));
  const copies = search();
  kept.set(key, { signature, at: now, copies });
  // An answer that failed is not kept: the next look tries again.
  copies.catch(() => {
    if (kept.get(key)?.copies === copies) kept.delete(key);
  });
  return copies;
}
