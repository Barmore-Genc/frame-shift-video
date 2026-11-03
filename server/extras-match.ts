/**
 * Compares what the listener (eyes.py) read and heard in an extra with the bonus-feature names DVD
 * Fandom lists for its movie, and says whether one of them is clearly it.
 *
 * Two kinds of evidence: how long the extra is against the length a database gives the feature (the
 * only evidence there is when nothing is written or said), and what the listener read and heard.
 * Like Shelver's auto-match it is careful: a name is suggested only when the evidence is clear (the
 * only listed feature of that length, or the title card reads it, or it is said and also written,
 * and nothing else fits nearly as well), and every answer says why. Extras of one length cannot be
 * told apart by length, so those are decided by what was read and heard, or left for a person. Everything else is left for the person, with what was seen and heard, so
 * they still have something to go on. Nothing is renamed by this; a person presses a button.
 */

import type { FandomHint, NameEntry, NameSource } from '../src/types/discs';

export interface Look {
  seconds: number;
  ocr: { t: number; lines: string[] }[];
  speech: { start: number; end: number; text: string }[];
}

export interface Candidate {
  /** The name as it would be a file's name */
  name: string;
  /** The extras folder its place on the page suggests, if it suggests one */
  kind: string | null;
  /** The name's words that have to turn up */
  words: string[];
  /** The length a database gives it, if it gives one */
  seconds: number | null;
  /** Listed as the other extras played one after another, not an extra of its own */
  playAll: boolean;
  /** Which databases list it */
  sources: string[];
}

export interface Suggestion {
  state: 'matched' | 'unsure' | 'none';
  /** How long the extra is, when that was found out */
  seconds?: number | null;
  /** One sentence saying why */
  note: string;
  name?: string;
  kind?: string | null;
  /** What was written on the video and what was said in it, for a person to judge by */
  saw: string;
  heard: string;
}

const STOP = new Set([
  'the',
  'a',
  'an',
  'of',
  'and',
  'to',
  'in',
  'on',
  'for',
  'with',
  'from',
  'at',
  'is',
  'it',
  'by',
  'or',
  'as',
]);

/** The folder a wiki heading or a name's own words point to. */
const KINDS: [RegExp, string][] = [
  [/deleted|extended|alternate scene|outtake/i, 'Deleted Scenes'],
  [/behind the scenes|making of|the making/i, 'Behind The Scenes'],
  [/interview/i, 'Interviews'],
  [/featurette|documentary/i, 'Featurettes'],
  [/trailer|sneak peek|preview|teaser|promo/i, 'Trailers'],
  [/short|bonus episode/i, 'Shorts'],
];

export function kindOf(...texts: (string | null)[]): string | null {
  for (const text of texts) {
    if (!text) continue;
    for (const [pattern, kind] of KINDS) if (pattern.test(text)) return kind;
  }
  return null;
}

/** Lower case, no accents or punctuation, "½" as "1/2": for comparing what was said with a name. */
export function words(text: string): string[] {
  return (
    text
      // Before normalising, which would turn "½" into "1⁄2".
      .replace(/\u00bd/g, ' 1 2 ')
      .normalize('NFKD')
      .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean)
  );
}

/** A name from the wiki's words, as a file name (no characters a share dislikes). */
export function fileName(text: string): string {
  return text
    .replace(/^["“]|["”]$/g, '')
    .replace(/:\s*/g, ' - ')
    .replace(/["“”<>|*?\\/]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The names a list offers: its items that have nothing under them (a heading such as "Deleted
 * Scenes" is a kind, not a name; what is under it is the names), with the kind they sit under.
 */
function fromEntries(entries: NameEntry[], source: string): Candidate[] {
  const out: Candidate[] = [];
  const parents: (string | null)[] = [];
  entries.forEach((line, index) => {
    if (line.depth === 0) {
      parents.length = 0;
      return;
    }
    parents.length = line.depth - 1;
    parents[line.depth - 1] = line.text;
    const next = entries[index + 1];
    if (next && next.depth > line.depth) return;
    const name = fileName(line.text);
    const significant = words(name).filter((w) => !STOP.has(w));
    if (!name || significant.length === 0) return;
    out.push({
      name,
      kind: line.kind ?? kindOf(...parents.slice(0, -1).reverse(), line.text),
      words: significant,
      seconds: line.seconds,
      playAll: Boolean(line.playAll) || /^play all$/i.test(name),
      sources: [source],
    });
  });
  return out;
}

/** The names a DVD Fandom list offers (it gives no lengths). */
export function candidates(hint: FandomHint): Candidate[] {
  return fromEntries(
    (hint.features ?? []).map((f) => ({ ...f, seconds: null })),
    'DVD Fandom',
  );
}

/**
 * The names of all the databases together: a feature several list is one name, with the length any of
 * them gives (the first that gives one), and every database that lists it.
 */
export function candidatesFrom(sources: NameSource[]): Candidate[] {
  const merged = new Map<string, Candidate>();
  for (const source of sources) {
    for (const found of fromEntries(source.features, source.source)) {
      const key = found.words.join(' ');
      const have = merged.get(key);
      if (!have) {
        merged.set(key, found);
        continue;
      }
      have.seconds ??= found.seconds;
      have.kind ??= found.kind;
      have.playAll ||= found.playAll;
      if (!have.sources.includes(source.source))
        have.sources.push(source.source);
    }
  }
  return [...merged.values()];
}

/** The edit distance between two short words, capped: only "off by one letter" matters here. */
function near(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1)
    return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const restA = a.slice(i);
  const restB = b.slice(i);
  return (
    restA.slice(1) === restB.slice(1) ||
    restA.slice(1) === restB ||
    restA === restB.slice(1)
  );
}

/** How much of the name's words are among the heard words (a word off by one letter counts). */
function coverage(name: string[], heard: string[]): number {
  if (name.length === 0) return 0;
  const hit = name.filter((w) => heard.some((h) => near(w, h))).length;
  return hit / name.length;
}

/** Whether the name's words are said one after another, in order, with at most one word between. */
function inOrder(name: string[], heard: string[]): boolean {
  for (let start = 0; start < heard.length; start++) {
    let at = start;
    let gaps = 0;
    let ok = true;
    for (const w of name) {
      let found = -1;
      for (let j = at; j < Math.min(at + 2, heard.length); j++) {
        if (near(w, heard[j]!)) {
          found = j;
          break;
        }
      }
      if (found < 0) {
        ok = false;
        break;
      }
      if (found > at) gaps++;
      at = found + 1;
    }
    if (ok && gaps <= 1) return true;
  }
  return false;
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** How far a length may be from a listed one and still be it, and how far and still be close. */
export const CLEAR_SECONDS = 6;
/** A length read from the disc's own menu is exact, so it only needs a small margin */
export const EXACT_SECONDS = 1;
const slack = (n: Candidate) =>
  n.sources.includes('DVD menu') ? EXACT_SECONDS : CLEAR_SECONDS;
export const NEAR_SECONDS = 15;

type Scored = {
  candidate: Candidate;
  onScreen: number;
  saidOut: number;
  strong: boolean;
  score: number;
};

/** What was read and heard against each name, best first. */
function scoreText(look: Look | null, names: Candidate[]): Scored[] {
  if (!look) return [];
  const writtenWords = words(look.ocr.flatMap((m) => m.lines).join(' '));
  const spokenWords = words(look.speech.map((s) => s.text).join(' '));
  return names
    .map((candidate) => {
      const onScreen = coverage(candidate.words, writtenWords);
      const saidOut = coverage(candidate.words, spokenWords);
      const inSpeech =
        candidate.words.length >= 3 && inOrder(candidate.words, spokenWords);
      // A title card that reads the whole name, or a name both written and said, is clear.
      // Speech alone is clear only for a longer name said in order (a short one is said in passing).
      const strong =
        (candidate.words.length >= 2 && onScreen >= 0.99) ||
        (candidate.words.length >= 2 && onScreen >= 0.6 && saidOut >= 0.6) ||
        inSpeech;
      const score = Math.max(
        onScreen,
        0.9 * saidOut * (inSpeech ? 1 : 0.7),
        (onScreen + saidOut) / 2,
      );
      return { candidate, onScreen, saidOut, strong, score };
    })
    .sort((a, b) => b.score - a.score);
}

/** Why a name fits what was read and heard. */
function because(look: Look, s: Scored): string {
  const parts: string[] = [];
  const card = look.ocr.find(
    (m) => coverage(s.candidate.words, words(m.lines.join(' '))) >= 0.6,
  );
  if (s.onScreen >= 0.6 && card)
    parts.push(`the writing at ${clock(card.t)} reads it`);
  if (s.saidOut >= 0.6) parts.push('it is said in the first minute and a half');
  return parts.join(' and ');
}

const where = (c: Candidate) => c.sources.join(' and ');

/** The card shown before a movie preview ("The following preview has been approved for all audiences..."). */
const PREVIEW_CARD =
  /following\s+(?:preview|trailer)s?\s+(?:has|have)\s+been\s+(?:approved|rated)|approved\s+for\s+(?:all|appropriate)\s+audiences/i;

/** What a reel of previews looks like to someone naming it: probably "Previews", a trailer. */
function previewReel(base: {
  seconds: number | null;
  saw: string;
  heard: string;
}): Suggestion {
  return {
    ...base,
    state: 'unsure',
    name: 'Previews',
    kind: 'Trailers',
    note: 'It starts with the ratings card shown before movie previews, so it is probably a reel of previews for other movies.',
  };
}

/** What one extra is: how long it is, and what was read and heard in it (either may be missing). */
export interface Evidence {
  seconds: number | null;
  look: Look | null;
}

function sayings(look: Look | null) {
  return {
    saw: look ? look.ocr.flatMap((m) => m.lines).join(' / ') : '',
    heard: look ? look.speech.map((s) => s.text).join(' ') : '',
  };
}

/**
 * Compares one extra with the names. `sameLength` is how many other extras are as long as it, which
 * decides whether its length alone can name it.
 */
export function matchExtra(
  evidence: Evidence,
  names: Candidate[],
  sameLength: (candidate: Candidate) => number = () => 0,
): Suggestion {
  const { look, seconds } = evidence;
  const { saw, heard } = sayings(look);
  const base = { seconds, saw, heard };
  const previewCard = PREVIEW_CARD.test(saw);
  if (names.length === 0) {
    if (previewCard) return previewReel(base);
    return {
      ...base,
      state: 'none',
      note: 'No database lists bonus-feature names for this movie, so there is nothing to compare with.',
    };
  }
  const scored = scoreText(look, names);
  const text = scored[0];

  // By length: the listed features this one is as long as.
  const fits =
    seconds === null
      ? []
      : names
          .filter(
            (n) =>
              n.seconds !== null && Math.abs(seconds - n.seconds) <= slack(n),
          )
          .sort(
            (a, b) =>
              Math.abs(seconds - a.seconds!) - Math.abs(seconds - b.seconds!),
          );
  const real = fits.filter((n) => !n.playAll);
  if (fits.length > 0 && real.length === 0) {
    const all = fits[0]!;
    return {
      ...base,
      state: 'none',
      note: `It is ${clock(seconds!)} long, the length of the “Play All” (${clock(all.seconds!)}) that ${where(all)} lists: probably the extras above it played one after another, not an extra of its own.`,
    };
  }
  if (real.length > 0) {
    const long = `${clock(seconds!)}`;
    const textName = text?.strong ? text.candidate : null;
    if (textName && real.includes(textName)) {
      return {
        ...base,
        state: 'matched',
        name: textName.name,
        kind: textName.kind,
        note: `Looks like “${textName.name}”: it is ${long} long, the length ${where(textName)} lists, and ${because(look!, text!)}.`,
      };
    }
    if (textName && !real.includes(textName)) {
      return {
        ...base,
        state: 'unsure',
        name: real[0]!.name,
        kind: real[0]!.kind,
        note: `Its length fits “${real[0]!.name}”, but what was read or heard looks like “${textName.name}”.`,
      };
    }
    if (real.length === 1) {
      const only = real[0]!;
      const others = sameLength(only);
      if (others === 0) {
        return {
          ...base,
          state: 'matched',
          name: only.name,
          kind: only.kind,
          note: `Looks like “${only.name}”: it is ${long} long, the only feature of that length ${where(only)} lists (${clock(only.seconds!)}).`,
        };
      }
      return {
        ...base,
        state: 'unsure',
        name: only.name,
        kind: only.kind,
        note: `It is ${long} long, the length of “${only.name}”, but ${others === 1 ? 'another extra is' : `${others} other extras are`} that length too, so length alone cannot tell which is which.`,
      };
    }
    return {
      ...base,
      state: 'unsure',
      name: real[0]!.name,
      kind: real[0]!.kind,
      note: `It is ${long} long, and ${real.map((n) => `“${n.name}”`).join(', ')} are all about that length, so length alone cannot tell which it is.`,
    };
  }

  // No listed length fits: what was read and heard, as before.
  const rivals = scored.filter(
    (s) => text && s !== text && s.score >= 0.6 && s.score >= text.score - 0.25,
  );
  if (text && text.strong && rivals.length === 0) {
    return {
      ...base,
      state: 'matched',
      name: text.candidate.name,
      kind: text.candidate.kind,
      note: `Looks like “${text.candidate.name}”: ${because(look!, text)}.`,
    };
  }
  if (text && text.score >= 0.6) {
    const others = [text, ...rivals].map((s) => `“${s.candidate.name}”`);
    return {
      ...base,
      state: 'unsure',
      name: text.candidate.name,
      kind: text.candidate.kind,
      note:
        rivals.length > 0
          ? `Could be ${others.join(' or ')}; it is not clear which.`
          : `Might be “${text.candidate.name}”, but only part of it was found.`,
    };
  }
  const closest =
    seconds === null
      ? null
      : names
          .filter(
            (n) =>
              n.seconds !== null &&
              !n.playAll &&
              Math.abs(seconds - n.seconds) <= NEAR_SECONDS,
          )
          .sort(
            (a, b) =>
              Math.abs(seconds - a.seconds!) - Math.abs(seconds - b.seconds!),
          )[0];
  if (closest) {
    return {
      ...base,
      state: 'unsure',
      name: closest.name,
      kind: closest.kind,
      note: `Close in length to “${closest.name}” (${clock(closest.seconds!)} listed, ${clock(seconds!)} here), but not close enough to be sure.`,
    };
  }
  if (previewCard) return previewReel(base);
  const nothing = !look || (look.ocr.length === 0 && look.speech.length === 0);
  return {
    ...base,
    state: 'none',
    note: nothing
      ? 'No listed feature is its length, and nothing is written on it or said in it that could be read, so it has to be named by watching it.'
      : 'No listed feature is its length, and what was written or said does not look like any of the listed names.',
  };
}

/**
 * Matches all of a movie's extras, and takes back a name that two extras both matched (one of them
 * is wrong, and which is not clear), saying so.
 */
export function matchMovie(
  items: ({ path: string } & Evidence)[],
  names: Candidate[],
): Record<string, Suggestion> {
  const sameLength = (self: string) => (candidate: Candidate) =>
    candidate.seconds === null
      ? 0
      : items.filter(
          (o) =>
            o.path !== self &&
            o.seconds !== null &&
            Math.abs(o.seconds - candidate.seconds!) <= slack(candidate),
        ).length;
  const out: Record<string, Suggestion> = {};
  for (const item of items)
    out[item.path] = matchExtra(item, names, sameLength(item.path));
  const claimed = new Map<string, string[]>();
  for (const [path, s] of Object.entries(out)) {
    if (s.state === 'matched' && s.name) {
      claimed.set(s.name, [...(claimed.get(s.name) ?? []), path]);
    }
  }
  for (const [name, paths] of claimed) {
    if (paths.length < 2) continue;
    // A length read from the disc menu is exact: the one file that has it keeps the name, and a
    // text match on a file of another length is the one that is wrong.
    const listed = names.find((n) => n.name === name);
    const exact = listed?.sources.includes('DVD menu') ? listed.seconds : null;
    const owners =
      exact === null || exact === undefined
        ? []
        : paths.filter((path) => {
            const seconds = items.find((o) => o.path === path)?.seconds;
            return (
              seconds != null && Math.abs(seconds - exact) <= EXACT_SECONDS
            );
          });
    for (const path of paths) {
      const s = out[path]!;
      if (owners.length === 1) {
        if (path === owners[0]) continue;
        out[path] = {
          ...s,
          state: 'unsure',
          note: `What was read or heard looks like “${name}”, but that is ${clock(exact!)} on the disc menu, and this is ${clock(s.seconds!)}.`,
        };
        continue;
      }
      out[path] = {
        ...s,
        state: 'unsure',
        note: `Two extras look like “${s.name}”, so it is not clear which is right.`,
      };
    }
  }
  return out;
}
