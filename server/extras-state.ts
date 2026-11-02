/**
 * The extras of ripped movies (trailers, featurettes, anything else on the disc), and naming them.
 *
 * The ripper cannot know what an extra is: a DVD stores no names for them. It sorts them into Plex's
 * extras folders by length and calls them "Trailer 01 (2 min)", "Featurette 01 (20 min)". This is
 * where a person gives them their real names. Plex shows a file's name as the extra's title and its
 * folder as the kind, so both can be changed here.
 *
 * Only a video file that is already inside one of those folders of a movie can be renamed, and only
 * to a plain name in one of those folders.
 */

import fs from 'fs/promises';
import path from 'path';
import { outputFolder } from './disc-state';
import { EXTRA_FOLDERS, VIDEO } from './disc-contents';
import type { ExtraItem, ExtraMovie, RemovedExtra } from '../src/types/discs';

/** The names the ripper gives: "Trailer 01 (2 min).mkv". */
const GENERIC =
  /^(Trailer|Featurette|Extra|Alternate Version) \d+ \(\d+ min\)$/;
const MAX_MOVIES = 200;
const MAX_NAME = 150;

async function listNames(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).sort();
  } catch {
    return [];
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** The movies that have extras: those still called by the ripper's names come first. */
export async function readExtras(dir: string): Promise<ExtraMovie[]> {
  const output = await outputFolder(dir);
  const movies: ExtraMovie[] = [];
  for (const parent of [output, '']) {
    for (const movie of await listNames(path.join(dir, parent))) {
      if (movie.startsWith('_') || movie.startsWith('.') || movie === output) {
        continue;
      }
      const items: ExtraItem[] = [];
      for (const folder of EXTRA_FOLDERS) {
        const where = path.join(dir, parent, movie, folder);
        for (const file of await listNames(where)) {
          if (!VIDEO.test(file)) continue;
          const name = file.replace(VIDEO, '');
          items.push({
            path: [parent, movie, folder, file].filter(Boolean).join('/'),
            folder,
            name,
            unnamed: GENERIC.test(name),
          });
        }
      }
      if (items.length > 0) movies.push({ movie, items });
    }
  }
  movies.sort(
    (a, b) =>
      Number(b.items.some((i) => i.unnamed)) -
        Number(a.items.some((i) => i.unnamed)) ||
      a.movie.localeCompare(b.movie),
  );
  return movies.slice(0, MAX_MOVIES);
}

/** A name for a file: plain text, no folders, nothing that is awkward on a share. */
export function cleanExtraName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Give the extra a name');
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Give the extra a name');
  if (name.length > MAX_NAME) throw new Error('That name is too long');
  if (/[/\\:*?"<>|\u0000-\u001f]/.test(name)) {
    throw new Error('A name cannot have / \\ : * ? " < > | in it');
  }
  if (name.startsWith('.')) throw new Error('A name cannot start with a dot');
  return name;
}

/**
 * Where the file is: its movie's folder, the extras folder and its name, and which of the two roots
 * (the finished-discs folder, or the DVDs folder itself) holds the movie.
 */
export function locate(
  file: string,
  output: string,
): { parent: string; movie: string; folder: string; base: string } {
  const parts = file.split('/');
  const parent = parts.length === 4 ? parts[0]! : '';
  if (parts.length !== (parent ? 4 : 3) || (parent && parent !== output)) {
    throw new Error('That is not an extra of a movie');
  }
  const [movie, folder, base] = parent
    ? [parts[1]!, parts[2]!, parts[3]!]
    : [parts[0]!, parts[1]!, parts[2]!];
  if (
    [movie, folder, base].some(
      (part) => !part || part === '.' || part === '..' || part.startsWith('_'),
    ) ||
    !(EXTRA_FOLDERS as readonly string[]).includes(folder) ||
    !VIDEO.test(base)
  ) {
    throw new Error('That is not an extra of a movie');
  }
  return { parent, movie, folder, base };
}

/**
 * The file of an extra, to watch it: the same paths as renaming (a video inside an extras folder
 * of a movie, nothing else), and it has to be a real file that really sits under the DVDs folder.
 */
export async function extraFilePath(
  dir: string,
  file: string,
): Promise<string> {
  const output = await outputFolder(dir);
  const here = locate(file, output);
  const absolute = path.join(
    dir,
    here.parent,
    here.movie,
    here.folder,
    here.base,
  );
  let real: string;
  try {
    real = await fs.realpath(absolute);
    if (!(await fs.stat(real)).isFile()) throw new Error('not a file');
  } catch {
    throw new Error('That extra is not there any more');
  }
  const root = await fs.realpath(dir);
  if (!real.startsWith(root + path.sep)) {
    throw new Error('That is not an extra of a movie');
  }
  return real;
}

/**
 * Gives an extra its name, and moves it to another extras folder if asked. Returns where it is now.
 * Nothing is overwritten: a name that is taken is refused.
 */
export async function renameExtra(
  dir: string,
  file: string,
  newName: unknown,
  newFolder?: unknown,
): Promise<string> {
  const output = await outputFolder(dir);
  const here = locate(file, output);
  const name = cleanExtraName(newName);
  const folder =
    newFolder === undefined || newFolder === null ? here.folder : newFolder;
  if (
    typeof folder !== 'string' ||
    !(EXTRA_FOLDERS as readonly string[]).includes(folder)
  ) {
    throw new Error('Pick one of the extras folders');
  }
  const root = path.join(dir, here.parent, here.movie);
  const from = path.join(root, here.folder, here.base);
  if (!(await isDirectory(root))) throw new Error('That movie is not there');
  try {
    if (!(await fs.stat(from)).isFile()) throw new Error('not a file');
  } catch {
    throw new Error('That extra is not there any more');
  }
  const base = `${name}${path.extname(here.base)}`;
  const to = path.join(root, folder, base);
  if (to === from) return file;
  // A name that differs only in case is the same file on some shares; let it through.
  const same = to.toLowerCase() === from.toLowerCase();
  if (!same) {
    try {
      await fs.access(to);
      throw new Error('There is already an extra with that name');
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('There is'))
        throw error;
    }
  }
  await fs.mkdir(path.join(root, folder), { recursive: true });
  await fs.rename(from, to);
  return [here.parent, here.movie, folder, base].filter(Boolean).join('/');
}

const REMOVED = '_removed';
const MAX_REMOVE = 200;

/** A name in `dir` that is free: "Name.mkv", then "Name (2).mkv", "Name (3).mkv". */
async function freeName(dir: string, base: string): Promise<string> {
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  for (let n = 1; n < 1000; n++) {
    const name = n === 1 ? base : `${stem} (${n})${ext}`;
    try {
      await fs.access(path.join(dir, name));
    } catch {
      return name;
    }
  }
  throw new Error('Too many files with that name');
}

/**
 * Takes extras out of the movie: each is moved to `_removed/<movie>/<extras folder>/` in the DVDs
 * folder, where Plex and this page do not look. Nothing is deleted, so a mistake is undone by moving
 * the file back. Only files that can be renamed here (a video in an extras folder of a movie) can be
 * removed. One that cannot be is reported and the rest are still moved.
 */
export async function removeExtras(
  dir: string,
  files: unknown,
): Promise<{
  removed: string[];
  failed: { path: string; error: string }[];
}> {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('Pick the extras to remove');
  }
  if (files.length > MAX_REMOVE) throw new Error('That is too many at once');
  const output = await outputFolder(dir);
  const removed: string[] = [];
  const failed: { path: string; error: string }[] = [];
  for (const file of new Set(files)) {
    try {
      if (typeof file !== 'string')
        throw new Error('That is not an extra of a movie');
      await extraFilePath(dir, file);
      const here = locate(file, output);
      const from = path.join(
        dir,
        here.parent,
        here.movie,
        here.folder,
        here.base,
      );
      const toDir = path.join(dir, REMOVED, here.movie, here.folder);
      await fs.mkdir(toDir, { recursive: true });
      await fs.rename(from, path.join(toDir, await freeName(toDir, here.base)));
      // A folder with nothing left in it is tidied away; one with something is left alone.
      await fs
        .rmdir(path.join(dir, here.parent, here.movie, here.folder))
        .catch(() => {});
      removed.push(file);
    } catch (error) {
      failed.push({
        path: String(file),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { removed, failed };
}

/** Where a removed extra is: "_removed/<movie>/<extras folder>/<file>". */
function locateRemoved(file: string): {
  movie: string;
  folder: string;
  base: string;
} {
  const parts = file.split('/');
  const [root, movie, folder, base] = parts;
  if (
    parts.length !== 4 ||
    root !== REMOVED ||
    [movie, folder, base].some(
      (part) => !part || part === '.' || part === '..' || part.startsWith('.'),
    ) ||
    !(EXTRA_FOLDERS as readonly string[]).includes(folder!) ||
    !VIDEO.test(base!)
  ) {
    throw new Error('That is not a removed extra');
  }
  return { movie: movie!, folder: folder!, base: base! };
}

/** The extras that were taken out of movies, the movie they came from first. */
export async function readRemoved(dir: string): Promise<RemovedExtra[]> {
  const found: RemovedExtra[] = [];
  for (const movie of await listNames(path.join(dir, REMOVED))) {
    if (movie.startsWith('.')) continue;
    for (const folder of EXTRA_FOLDERS) {
      const where = path.join(dir, REMOVED, movie, folder);
      for (const file of await listNames(where)) {
        if (!VIDEO.test(file)) continue;
        found.push({
          path: [REMOVED, movie, folder, file].join('/'),
          movie,
          folder,
          name: file.replace(VIDEO, ''),
        });
      }
    }
  }
  return found;
}

/**
 * Puts removed extras back in their movie, in the extras folder they came from. A name that is
 * taken again gets "(2)". One whose movie is gone is reported and the rest are still put back.
 */
export async function restoreExtras(
  dir: string,
  files: unknown,
): Promise<{
  restored: string[];
  failed: { path: string; error: string }[];
}> {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('Pick the extras to put back');
  }
  if (files.length > MAX_REMOVE) throw new Error('That is too many at once');
  const output = await outputFolder(dir);
  const restored: string[] = [];
  const failed: { path: string; error: string }[] = [];
  for (const file of new Set(files)) {
    try {
      if (typeof file !== 'string')
        throw new Error('That is not a removed extra');
      const here = locateRemoved(file);
      const from = path.join(dir, file);
      if (!(await fs.stat(from).catch(() => null))?.isFile()) {
        throw new Error('That extra is not there any more');
      }
      let movieDir: string | null = null;
      for (const parent of [output, '']) {
        const candidate = path.join(dir, parent, here.movie);
        if (await isDirectory(candidate)) {
          movieDir = candidate;
          break;
        }
      }
      if (!movieDir) throw new Error('That movie is not there any more');
      const toDir = path.join(movieDir, here.folder);
      await fs.mkdir(toDir, { recursive: true });
      await fs.rename(from, path.join(toDir, await freeName(toDir, here.base)));
      const old = path.join(dir, REMOVED, here.movie);
      await fs.rmdir(path.join(old, here.folder)).catch(() => {});
      await fs.rmdir(old).catch(() => {});
      restored.push(file);
    } catch (error) {
      failed.push({
        path: String(file),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { restored, failed };
}
