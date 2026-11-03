/**
 * The names a movie's bonus features are listed under, from every database we can ask, with the
 * lengths they give: DVD Compare (Region 1, through the listener container), TheDiscDB (Region 1
 * DVDs) and DVD Fandom (names only). A database that has no page for the movie, or cannot be
 * reached, is left out; the others still count.
 */

import {
  compareAt,
  menuAt,
  type CompareAnswer,
  type MenuAnswer,
} from './extras-eyes';
import { discDbSources } from './discdb';
import { fandomHint } from './fandom-hints';
import { kindOf } from './extras-match';
import type { FandomHint, NameSource } from '../src/types/discs';

const KEPT_MS = 60 * 60 * 1000;
/** The disc menus are slow the first time: the other lists do not wait longer than this for them. */
const MENU_WAIT_MS = 25 * 1000;

export interface SourceDeps {
  compare: (title: string, year: number | null) => Promise<CompareAnswer>;
  discdb: (movie: string) => Promise<NameSource[]>;
  fandom: (movie: string) => Promise<FandomHint>;
  menu: (title: string, year: number | null) => Promise<MenuAnswer>;
}

const realDeps: SourceDeps = {
  compare: (title, year) => compareAt(title, year),
  discdb: (movie) => discDbSources(movie),
  fandom: (movie) => fandomHint(movie),
  menu: (title, year) => menuAt(title, year),
};

/** "Teacher's Pet (2004)" -> its title and year. */
export function titleAndYear(movie: string): {
  title: string;
  year: number | null;
} {
  const match = movie.match(/^(.*?)\s*\((\d{4})\)\s*$/);
  return match
    ? { title: match[1]!.trim(), year: Number(match[2]) }
    : { title: movie.trim(), year: null };
}

export function fromCompare(answer: CompareAnswer): NameSource[] {
  if (!answer.found || !answer.url) return [];
  return (answer.releases ?? []).map((release) => ({
    source: 'DVD Compare' as const,
    page: answer.film ?? 'DVD Compare',
    url: answer.url!,
    release: release.name,
    features: release.features.map((f) => ({
      text: f.title,
      depth: f.depth,
      seconds: f.seconds,
      playAll: f.play_all || undefined,
      kind: kindOf(f.type),
    })),
  }));
}

/**
 * What the menus of the movie's own disc say: every button that plays one title, with that title's
 * exact length. A "Play All" button is marked so that it is explained, not named.
 */
export function fromMenu(answer: MenuAnswer): NameSource[] {
  if (!answer.found || !answer.entries?.length) return [];
  return [
    {
      source: 'DVD menu',
      page: `The menus of the disc image ${answer.disc ?? ''}`.trim(),
      url: '',
      features: answer.entries.map((entry) => ({
        text: entry.name,
        depth: 1,
        seconds: entry.seconds,
        playAll: entry.play_all || undefined,
        kind: kindOf(entry.menu),
      })),
    },
  ];
}

export function fromFandom(hint: FandomHint): NameSource[] {
  if (!hint.found || !hint.page || !hint.url) return [];
  return [
    {
      source: 'DVD Fandom',
      page: hint.page,
      url: hint.url,
      runtime: hint.runtime,
      features: (hint.features ?? []).map((f) => ({
        text: f.text,
        depth: f.depth,
        seconds: null,
      })),
    },
  ];
}

const kept = new Map<string, { at: number; sources: NameSource[] }>();

export function clearSourceCache(): void {
  kept.clear();
}

/** Every database's list for the movie, asked at the same time. Kept an hour. */
export async function nameSources(
  movie: string,
  deps: SourceDeps = realDeps,
  now: number = Date.now(),
  menuWaitMs: number = MENU_WAIT_MS,
): Promise<NameSource[]> {
  const hit = kept.get(movie);
  if (hit && now - hit.at < KEPT_MS) return hit.sources;
  const { title, year } = titleAndYear(movie);
  let failed = false;
  const guard = <T>(work: Promise<T>, empty: T): Promise<T> =>
    work.catch(() => {
      failed = true;
      return empty;
    });
  // The first read of a disc's menus can take a minute: not waited for, and not remembered as empty,
  // so the next look finds it done.
  const menuIn = async (work: Promise<NameSource[]>): Promise<NameSource[]> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<NameSource[]>((resolve) => {
      timer = setTimeout(() => {
        failed = true;
        resolve([]);
      }, menuWaitMs);
    });
    try {
      return await Promise.race([work, late]);
    } finally {
      clearTimeout(timer);
    }
  };
  const [compare, discdb, fandom, menu] = await Promise.all([
    guard(deps.compare(title, year).then(fromCompare), [] as NameSource[]),
    guard(deps.discdb(movie), [] as NameSource[]),
    guard(deps.fandom(movie).then(fromFandom), [] as NameSource[]),
    menuIn(guard(deps.menu(title, year).then(fromMenu), [] as NameSource[])),
  ]);
  const sources = [...menu, ...compare, ...discdb, ...fandom];
  // A database that could not be asked is tried again next time, not remembered as having nothing.
  if (!failed) kept.set(movie, { at: now, sources });
  return sources;
}
