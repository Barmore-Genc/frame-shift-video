/**
 * Extras that are the same video twice: the same length (within half a second) and the same picture
 * at three moments. Disc menus often play one clip from two places, and the ripper makes a file of
 * each. A person decides which to keep; this only says which ones look the same.
 */

import { readExtras, extraFilePath } from './extras-state';
import { frameSum, videoSeconds } from './extras-preview';

const SAME_LENGTH_SECONDS = 0.5;
const MOMENTS = [0.2, 0.5, 0.8];

/** A checksum of the picture at a moment (frameSum; a test can give another). */
export type Sum = (file: string, at: number) => Promise<string>;

/** Whether two videos show the same picture at the moments checked. */
async function samePicture(
  a: string,
  b: string,
  seconds: number,
  sum: Sum,
): Promise<boolean> {
  for (const part of MOMENTS) {
    const at = Math.floor(seconds * part * 10) / 10;
    try {
      if ((await sum(a, at)) !== (await sum(b, at))) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export type Measured = { path: string; real: string; seconds: number };

/** The extras of `movie` in the order the page lists them, with their files and lengths. Extras that cannot be measured are left out. */
export async function measureExtras(
  dir: string,
  movie: string,
): Promise<Measured[]> {
  const found = (await readExtras(dir)).find((m) => m.movie === movie);
  if (!found) throw new Error('That movie has no extras');
  const measured: Measured[] = [];
  for (const item of found.items) {
    try {
      const real = await extraFilePath(dir, item.path);
      measured.push({
        path: item.path,
        real,
        seconds: await videoSeconds(real),
      });
    } catch {
      // Not measurable: not compared.
    }
  }
  return measured;
}

/**
 * The groups of extras of `movie` that are copies of each other (each group has two or more paths, in
 * the order the page lists them). Extras that cannot be measured are left out.
 */
export async function findDuplicates(
  dir: string,
  movie: string,
  sum: Sum = frameSum,
): Promise<string[][]> {
  const measured = await measureExtras(dir, movie);
  const groups: string[][] = [];
  const used = new Set<string>();
  for (const first of measured) {
    if (used.has(first.path)) continue;
    const group = [first];
    for (const other of measured) {
      if (other === first || used.has(other.path)) continue;
      if (
        Math.abs(other.seconds - first.seconds) <= SAME_LENGTH_SECONDS &&
        (await samePicture(first.real, other.real, first.seconds, sum))
      ) {
        group.push(other);
      }
    }
    if (group.length > 1) {
      group.forEach((g) => used.add(g.path));
      groups.push(group.map((g) => g.path));
    }
  }
  return groups;
}
