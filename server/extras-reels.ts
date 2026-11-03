/**
 * Extras that are other extras played one after another. A disc's "Play All" button plays the
 * extras in a row, and the ripper makes a file of that too, so the same footage is on the disc twice
 * (once as the reel and once as its parts). The parts are the ones worth keeping, because each can
 * be named; the reel is the copy. A reel is found by its length (the lengths of a run of the
 * other extras add up to it) and then by its pictures (each part's pictures are in the reel where
 * that part should be). A person decides what to remove; this only says which ones are reels.
 */

import { measureExtras, type Measured } from './extras-duplicates';
import { thumbsOf } from './extras-eyes';

/** The parts of a reel may add up to this much (a share of the reel) off its length: menus trim a little. */
const LENGTH_SHARE = 0.015;
const LENGTH_FLOOR_SECONDS = 3;
const MIN_REEL_SECONDS = 30;
/** Where a part is looked for in the reel: its expected place, give or take this many seconds. */
const WINDOW_SECONDS = 20;
const PART_MOMENTS = [0.25, 0.5, 0.75];
const WIDTH = 32;
const HEIGHT = 24;
/** The most two small grey pictures may differ (mean per pixel, 0-255) and still be the same picture. */
const SAME_PICTURE = 7;
/** The share of parts that must be found in the reel. */
const FOUND_SHARE = 0.6;

export type Reel = { path: string; parts: string[] };

/**
 * Small grey pictures of an extra (its path under the DVDs folder), one a second from `from`:
 * `count` of them.
 */
export type Look = (
  path: string,
  from: number,
  count: number,
) => Promise<Uint8Array[]>;

/** The pictures come from the listener (see extras-eyes.ts). */
export const looks: Look = (path, from, count) =>
  thumbsOf(path, Math.max(0, from), count, WIDTH, HEIGHT);

function difference(a: Uint8Array, b: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i]! - b[i]!);
  return total / a.length;
}

/** Runs of two or more of `others`, next to each other, whose lengths add up to the reel's. */
export function candidateRuns(
  reel: Measured,
  others: Measured[],
): Measured[][] {
  const tolerance = Math.max(LENGTH_FLOOR_SECONDS, reel.seconds * LENGTH_SHARE);
  const runs: Measured[][] = [];
  for (let first = 0; first < others.length - 1; first++) {
    let sum = 0;
    for (let last = first; last < others.length; last++) {
      sum += others[last]!.seconds;
      if (sum > reel.seconds + tolerance) break;
      if (last > first && Math.abs(sum - reel.seconds) <= tolerance) {
        runs.push(others.slice(first, last + 1));
      }
    }
  }
  // The longest run first: a shorter run inside it adds up by luck.
  return runs.sort((a, b) => b.length - a.length);
}

/** A Look that asks the same question once. */
function remembered(look: Look): Look {
  const answers = new Map<string, Promise<Uint8Array[]>>();
  return (file, from, count) => {
    const key = `${file}|${from}|${count}`;
    let answer = answers.get(key);
    if (!answer) {
      answer = look(file, from, count);
      answers.set(key, answer);
    }
    return answer;
  };
}

/**
 * Whether most of the parts' pictures are in the reel, where each part should be. Looking at a
 * reel is slow, so it stops as soon as the answer cannot change: enough parts found, or too many
 * missing, and each part is looked for at one moment after another until it is found.
 */
async function partsAreIn(
  reel: Measured,
  parts: Measured[],
  look: Look,
): Promise<boolean> {
  const total = parts.reduce((sum, p) => sum + p.seconds, 0);
  const scale = reel.seconds / total;
  const needed = Math.max(2, Math.ceil(parts.length * FOUND_SHARE));
  let found = 0;
  let missed = 0;
  let before = 0;
  for (const part of parts) {
    const start = before * scale;
    before += part.seconds;
    let matched = false;
    for (const moment of PART_MOMENTS) {
      try {
        const [mine] = await look(part.path, part.seconds * moment, 1);
        if (!mine) continue;
        // Where it should be in the reel, as a place in the pictures taken from `from`.
        const expected = start + part.seconds * moment * scale;
        const from = Math.max(0, expected - WINDOW_SECONDS);
        const inReel = await look(reel.path, from, 2 * WINDOW_SECONDS + 1);
        const near = Math.round(expected - from);
        for (let i = near - WINDOW_SECONDS; i <= near + WINDOW_SECONDS; i++) {
          const theirs = inReel[i];
          if (theirs && difference(mine, theirs) <= SAME_PICTURE) {
            matched = true;
            break;
          }
        }
      } catch {
        // A picture that cannot be read is not found.
      }
      if (matched) break;
    }
    if (matched) found++;
    else missed++;
    if (found >= needed) return true;
    if (missed > parts.length - needed) return false;
  }
  return false;
}

/**
 * The extras of `movie` that are runs of its other extras played in a row. Each reel says its parts
 * (paths, in order). Extras that cannot be measured are left out.
 */
export async function findReels(
  dir: string,
  movie: string,
  asked: Look = looks,
): Promise<Reel[]> {
  const look = remembered(asked);
  const measured = await measureExtras(dir, movie);
  const reels: Reel[] = [];
  const parted = new Set<string>();
  // The longest first: what a reel is made of is not looked at as a reel of its own.
  const longestFirst = [...measured].sort((a, b) => b.seconds - a.seconds);
  for (const reel of longestFirst) {
    if (reel.seconds < MIN_REEL_SECONDS || parted.has(reel.path)) continue;
    const others = measured.filter(
      (m) => m !== reel && m.seconds < reel.seconds,
    );
    for (const parts of candidateRuns(reel, others)) {
      if (await partsAreIn(reel, parts, look)) {
        reels.push({ path: reel.path, parts: parts.map((p) => p.path) });
        parts.forEach((p) => parted.add(p.path));
        break;
      }
    }
  }
  return reels;
}
