import type { TmdbResult } from '@/types/discs';

/**
 * Reads the ripper helper's answer to a TMDB search: one result per line, with kind, id,
 * name, size, description and poster separated by tabs. Lines that are not results (an
 * error sentence, a blank line) are skipped.
 */
export function parseTmdbResults(message: string | undefined): TmdbResult[] {
  const results: TmdbResult[] = [];
  for (const line of (message ?? '').split('\n')) {
    const [kind, id, name, size, overview, poster, source] = line.split('\t');
    if (
      (kind !== 'movie' && kind !== 'tv') ||
      !name ||
      !/^\d+$/.test(id ?? '')
    ) {
      continue;
    }
    results.push({
      kind,
      id: Number(id),
      name,
      size: size ?? '',
      overview: overview ?? '',
      poster: poster ?? '',
      source: source === 'tvdb' ? 'tvdb' : 'tmdb',
    });
  }
  return results;
}

/**
 * A poster's address: TMDB's image server for its path, TheTVDB's own address as it gave it
 * (only on its artwork server), or null when there is no poster.
 */
export function posterUrl(path: string): string | null {
  if (path.startsWith('/')) return `https://image.tmdb.org/t/p/w154${path}`;
  return /^https:\/\/artworks\.thetvdb\.com\//.test(path) ? path : null;
}

/** The name of the database a result is from. */
export function sourceName(result: TmdbResult): string {
  return result.source === 'tvdb' ? 'TVDB' : 'TMDB';
}

/**
 * How a result's database is shown, in the site's own colors: TMDB's cyan and TheTVDB's green.
 * `badge` is the label's colors and `stripe` the left edge of the result's row. The words stay on
 * the label, so the color is never the only thing that says where a result is from.
 */
export function sourceColors(result: TmdbResult): {
  badge: string;
  stripe: string;
} {
  return result.source === 'tvdb'
    ? { badge: 'bg-[#6cd491] text-[#0b1f14]', stripe: 'border-l-[#6cd491]' }
    : { badge: 'bg-[#01b4e4] text-[#032541]', stripe: 'border-l-[#01b4e4]' };
}

/**
 * The folder name for a movie matched to a result: "Title (Year)", with Plex's id tag after it when
 * asked and the result is TMDB's ("Title (Year) {tmdb-123}"). Plex reads TMDB and IMDb ids in a
 * movie's name, not TheTVDB's, so a TVDB result gets no tag.
 */
export function matchedName(result: TmdbResult, withId: boolean): string {
  return withId && result.source === 'tmdb'
    ? `${result.name} {tmdb-${result.id}}`
    : result.name;
}

/** The page of a result on its database, to check it is the one. */
export function tmdbPage(result: TmdbResult): string {
  return result.source === 'tvdb'
    ? `https://thetvdb.com/dereferrer/${result.kind === 'tv' ? 'series' : 'movie'}/${result.id}`
    : `https://www.themoviedb.org/${result.kind}/${result.id}`;
}

/**
 * A disc label as a title to search for, with the season and disc it names when it does:
 * BILLY_EXTERMINATOR_S4_D1 is "Billy Exterminator", season 4, disc 1. The same reading the
 * ripper does, so the page and the ripper agree.
 */
export function parseLabel(label: string): {
  title: string;
  season: number | null;
  disc: number | null;
} {
  let text = label.replace(/[_.]+/g, ' ').trim();
  let season: number | null = null;
  let disc: number | null = null;

  const seasonMatch = /\b(?:season|s)\s*(\d{1,2})\b/i.exec(text);
  if (seasonMatch) {
    season = Number(seasonMatch[1]);
    text = text.replace(seasonMatch[0], ' ');
  }
  const discMatch = /\b(?:disc|disk|dvd|d)\s*(\d{1,2})\b/i.exec(text);
  if (discMatch) {
    disc = Number(discMatch[1]);
    text = text.replace(discMatch[0], ' ');
  }
  text = text.replace(/\b(?:ws|fs|ntsc|pal|dvd)\b/gi, ' ');

  const title = text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  return { title, season, disc };
}
