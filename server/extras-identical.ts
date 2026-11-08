/**
 * Extras that are the same file twice, byte for byte. Unlike extras-duplicates.ts (which says what
 * looks the same), this is exact, so it is safe to act on without asking: one of each set is kept
 * and the rest are moved to the _removed folder (see removeExtras), where they can be put back.
 */

import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import fs from 'fs/promises';
import { extraFilePath, readExtras, removeExtras } from './extras-state';

/** A checksum of the whole file. */
async function sumOf(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/**
 * The groups of extras of `movie` whose files are identical (two or more paths in each, in the order
 * the page lists them). Files are only read when another has the same size.
 */
export async function findIdentical(
  dir: string,
  movie: string,
): Promise<string[][]> {
  const found = (await readExtras(dir)).find((m) => m.movie === movie);
  if (!found) throw new Error('That movie has no extras');
  const bySize = new Map<number, { path: string; real: string }[]>();
  for (const item of found.items) {
    try {
      const real = await extraFilePath(dir, item.path);
      const { size } = await fs.stat(real);
      bySize.set(size, [
        ...(bySize.get(size) ?? []),
        { path: item.path, real },
      ]);
    } catch {
      // Not readable: not compared.
    }
  }
  const groups = new Map<string, string[]>();
  for (const [size, same] of bySize) {
    if (same.length < 2) continue;
    for (const file of same) {
      try {
        const id = `${size}|${await sumOf(file.real)}`;
        groups.set(id, [...(groups.get(id) ?? []), file.path]);
      } catch {
        // Not readable: not compared.
      }
    }
  }
  const order = found.items.map((i) => i.path);
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => g.sort((a, b) => order.indexOf(a) - order.indexOf(b)))
    .sort((a, b) => order.indexOf(a[0]!) - order.indexOf(b[0]!));
}

/**
 * Keeps one of each set of identical extras of `movie` (a named one if there is one, else the first
 * the page lists) and moves the others out. Answers what was kept and removed.
 */
export async function removeIdentical(
  dir: string,
  movie: string,
): Promise<{
  kept: string[];
  removed: string[];
  failed: { path: string; error: string }[];
}> {
  const groups = await findIdentical(dir, movie);
  if (groups.length === 0) return { kept: [], removed: [], failed: [] };
  const items = (await readExtras(dir)).find((m) => m.movie === movie)!.items;
  const kept: string[] = [];
  const extra: string[] = [];
  for (const group of groups) {
    const keep =
      group.find((p) => items.find((i) => i.path === p)?.unnamed === false) ??
      group[0]!;
    kept.push(keep);
    extra.push(...group.filter((p) => p !== keep));
  }
  return { kept, ...(await removeExtras(dir, extra)) };
}
