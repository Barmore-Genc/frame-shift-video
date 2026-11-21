/**
 * Pure planning logic for the Split page: finding where combined episode files should be cut
 * (black screens between episodes), naming the pieces, and deciding which audio and subtitle
 * tracks to keep. No processes are started here, so all of it can be tested directly.
 *
 * Ported from the Separate-Episodes and Remove-extra-audio-tracks scripts, using the same idea as
 * https://github.com/yzRobo/scene-segment-splitter (find the fade between episodes, cut there).
 */

import path from 'path';

export const VIDEO_EXTENSIONS = [
  '.mkv',
  '.mp4',
  '.m4v',
  '.mov',
  '.avi',
  '.webm',
  '.ts',
];

export function isVideoFile(file: string): boolean {
  return VIDEO_EXTENSIONS.includes(path.extname(file).toLowerCase());
}

/** The folder everything on the Split page is confined to. */
export function homeDir(): string {
  return process.env.FRAME_SHIFT_HOME || process.env.HOME || '/';
}

/**
 * Turn a path the page sent (relative to the home folder) into an absolute one, refusing
 * anything that would leave the home folder.
 */
export function resolveInHome(relative: string, home = homeDir()): string {
  const root = path.resolve(home);
  const full = path.resolve(root, relative.replace(/^\/+/, ''));
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error('That path is outside the home folder');
  }
  return full;
}

/** The home-relative form of an absolute path, for showing to the page. */
export function relativeToHome(full: string, home = homeDir()): string {
  return path.relative(path.resolve(home), full);
}

// ---------------------------------------------------------------------------
// Splitting combined episodes
// ---------------------------------------------------------------------------

export interface BlackSegment {
  start: number;
  end: number;
}

export interface Segment {
  start: number;
  end: number;
}

/** Read `black_start:… black_end:…` lines out of ffmpeg's blackdetect output. */
export function parseBlackdetect(stderr: string): BlackSegment[] {
  const found: BlackSegment[] = [];
  for (const line of stderr.split('\n')) {
    const match = line.match(/black_start:([\d.]+)\s+black_end:([\d.]+)/);
    if (match) found.push({ start: Number(match[1]), end: Number(match[2]) });
  }
  return found;
}

export interface SplitPlanOptions {
  /** How many episodes the file holds. */
  episodes: number;
  /** Frames to keep inside the black screen on each side of a cut. */
  frameOffset: number;
  fps: number;
  /** Ignore black screens this close to the start or end of the file, in seconds. */
  edgeMargin: number;
  /** How far a black screen may be from where an even split would put it, in seconds. */
  tolerance: number;
}

export const DEFAULT_SPLIT_OPTIONS: SplitPlanOptions = {
  episodes: 2,
  frameOffset: 6,
  fps: 25,
  edgeMargin: 120,
  tolerance: 120,
};

export interface SplitPlan {
  segments: Segment[];
  boundaries: BlackSegment[];
  /** True when a cut was found for every gap between episodes. */
  complete: boolean;
  warning?: string;
}

/**
 * Choose the black screens that separate the episodes and turn them into one start and end time
 * per episode. A file is only `complete` when every expected gap has a black screen near where an
 * even split would put it; an incomplete plan is never run, so a file is not cut in wrong places.
 */
export function planSegments(
  black: BlackSegment[],
  duration: number,
  options: SplitPlanOptions,
): SplitPlan {
  const { episodes, frameOffset, fps, edgeMargin, tolerance } = options;
  if (episodes < 2) {
    return {
      segments: [{ start: 0, end: duration }],
      boundaries: [],
      complete: true,
    };
  }

  const candidates = black.filter(
    (b) => b.start >= edgeMargin && b.start <= duration - edgeMargin,
  );
  const average = duration / episodes;
  const chosen: BlackSegment[] = [];
  const used = new Set<number>();

  for (let i = 1; i < episodes; i++) {
    const expected = average * i;
    let best = -1;
    let bestDiff = Infinity;
    candidates.forEach((candidate, index) => {
      if (used.has(index)) return;
      const diff = Math.abs(candidate.start - expected);
      if (diff < bestDiff && diff <= tolerance) {
        bestDiff = diff;
        best = index;
      }
    });
    if (best >= 0) {
      used.add(best);
      chosen.push(candidates[best]);
    }
  }

  const boundaries = chosen.sort((a, b) => a.start - b.start);
  const complete = boundaries.length === episodes - 1;
  if (!complete) {
    return {
      segments: [],
      boundaries,
      complete,
      warning: `Found ${boundaries.length} of ${episodes - 1} episode breaks; this file was left alone`,
    };
  }

  const offset = frameOffset / fps;
  const segments: Segment[] = [];
  // Each episode ends a little inside the black screen after it and starts a little before the
  // end of the black screen before it, so neither piece loses a frame of real picture.
  let start = 0;
  for (const boundary of boundaries) {
    segments.push({ start, end: boundary.start + offset });
    start = Math.max(0, boundary.end - offset);
  }
  segments.push({ start, end: duration });
  return { segments, boundaries, complete };
}

/** Replace the characters that do not belong in a file name. */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:]/g, '-')
    .replace(/[?!*<>]/g, '')
    .replace(/"/g, "'")
    .replace(/\|/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface EpisodeNaming {
  show?: string;
  season: number;
  /** Number of the first episode of the first file. */
  startEpisode: number;
  /** One title per episode, in order starting at `startEpisode`. */
  titles: string[];
}

/** The name for the nth (0-based) episode across the files, without an extension. */
export function episodeName(naming: EpisodeNaming, index: number): string {
  const number = naming.startEpisode + index;
  const code = `S${String(naming.season).padStart(2, '0')}E${String(number).padStart(2, '0')}`;
  const title = naming.titles[index]?.trim();
  const show = naming.show ? sanitizeFilename(naming.show) : '';
  return [show, code, title ? sanitizeFilename(title) : '']
    .filter(Boolean)
    .join(' - ');
}

/** One title per line; blank lines and a leading "1." / "1 -" count are dropped. */
export function parseTitles(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\d+\s*[.)\-:]\s*/, '').trim());
}

/** Arguments for cutting one episode out of a source file. */
export function buildSplitArgs(
  input: string,
  output: string,
  segment: Segment,
  mode: 'reencode' | 'copy',
): string[] {
  const duration = segment.end - segment.start;
  // Seeking before the input is fast but approximate; a second, exact seek after it trims the rest.
  const inputSeek = Math.max(0, segment.start - 5);
  const outputSeek = segment.start - inputSeek;
  const args = [
    '-y',
    '-hide_banner',
    '-ss',
    inputSeek.toFixed(3),
    '-i',
    input,
    '-ss',
    outputSeek.toFixed(3),
    '-t',
    duration.toFixed(3),
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-map',
    '0:s?',
  ];
  if (mode === 'copy') {
    args.push('-c', 'copy');
  } else {
    args.push(
      '-c:v',
      'libx264',
      '-crf',
      '18',
      '-preset',
      'fast',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
    );
    // mov_text only lives in MP4; Matroska keeps its subtitles as they are.
    args.push(
      '-c:s',
      path.extname(output).toLowerCase() === '.mkv' ? 'copy' : 'mov_text',
    );
  }
  args.push(output);
  return args;
}

// ---------------------------------------------------------------------------
// Removing extra audio and subtitle tracks
// ---------------------------------------------------------------------------

export interface StreamInfo {
  index: number;
  type: 'video' | 'audio' | 'subtitle' | 'other';
  codec?: string;
  language?: string;
  title?: string;
  /** Whether the file marks this track as the one to play by default. */
  default?: boolean;
}

const LANGUAGE_ALIASES: Record<string, string> = {
  en: 'eng',
  english: 'eng',
  es: 'spa',
  spanish: 'spa',
  fr: 'fra',
  fre: 'fra',
  french: 'fra',
  de: 'deu',
  ger: 'deu',
  german: 'deu',
  it: 'ita',
  italian: 'ita',
  ja: 'jpn',
  japanese: 'jpn',
  pt: 'por',
  portuguese: 'por',
  ru: 'rus',
  russian: 'rus',
  zh: 'zho',
  chi: 'zho',
  chinese: 'zho',
  ko: 'kor',
  korean: 'kor',
};

/** Normalise a language tag so "en", "English" and "eng" all compare equal. */
export function normalizeLanguage(value: string | undefined): string {
  const lower = (value ?? '').trim().toLowerCase();
  return LANGUAGE_ALIASES[lower] ?? lower;
}

export function parseLanguageList(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map(normalizeLanguage)
    .filter(Boolean);
}

export interface TrackOptions {
  /** Audio languages to keep, in the order they should appear, e.g. ['fra', 'eng']. */
  audioLanguages: string[];
  /** Subtitle languages to keep, in the order they should appear. */
  subtitleLanguages: string[];
  /** Whether to strip audio / subtitle tracks that are not in those languages. */
  filterAudio: boolean;
  filterSubtitles: boolean;
  /** Keep tracks that have no language tag at all. */
  keepUntagged: boolean;
  /** Put kept tracks in the order of the language lists above (otherwise the file's order stays). */
  orderByLanguage: boolean;
  /** Language of the audio track to play by default; empty leaves the file's choice alone. */
  defaultAudio: string;
  /** Subtitles on by default: empty leaves the file alone, 'none' turns them all off by default,
   * anything else is the language of the one that is on. */
  defaultSubtitle: string;
}

export const DEFAULT_TRACK_OPTIONS: TrackOptions = {
  audioLanguages: ['eng'],
  subtitleLanguages: ['eng'],
  filterAudio: true,
  filterSubtitles: true,
  keepUntagged: false,
  orderByLanguage: false,
  defaultAudio: '',
  defaultSubtitle: '',
};

export { TRACK_PRESETS } from '../src/lib/track-presets';

export type TrackAction = 'clean' | 'already-clean' | 'skip-no-audio';

export interface TrackPlan {
  action: TrackAction;
  /** Kept tracks, in the order they will be written. */
  keepAudio: number[];
  keepSubtitles: number[];
  removeAudio: number[];
  removeSubtitles: number[];
  /** Which kept tracks will have the default flag in the result. */
  defaults: number[];
  reason: string;
  /** Things to know about this file's plan, e.g. what its container cannot do. */
  notes: string[];
}

/** MP4-family files cannot have every subtitle track off by default: the first is always on. */
export function isMp4Family(file: string): boolean {
  return ['.mp4', '.m4v', '.mov'].includes(path.extname(file).toLowerCase());
}

function languageOf(stream: StreamInfo): string {
  const language = normalizeLanguage(stream.language);
  return language === 'und' ? '' : language;
}

function keeps(
  stream: StreamInfo,
  languages: string[],
  keepUntagged: boolean,
): boolean {
  const language = languageOf(stream);
  return language ? languages.includes(language) : keepUntagged;
}

/** Kept tracks in the order of the language list; tracks of one language keep the file's order. */
function ordered(
  streams: StreamInfo[],
  languages: string[],
  byLanguage: boolean,
): StreamInfo[] {
  if (!byLanguage) return streams;
  const rank = (s: StreamInfo) => {
    const at = languages.indexOf(languageOf(s));
    return at < 0 ? languages.length : at;
  };
  return streams
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
    .map(({ s }) => s);
}

/**
 * Decide which audio and subtitle tracks stay, in what order, and which is the default of each
 * kind. A file with no audio in a kept language is skipped entirely rather than falling back to
 * another language. A file is "clean" (needs work) if anything differs from what was asked for.
 */
export function planTracks(
  streams: StreamInfo[],
  options: TrackOptions,
  /** The file's name, for what its container can do. */
  file = '',
): TrackPlan {
  const audio = streams.filter((s) => s.type === 'audio');
  const subs = streams.filter((s) => s.type === 'subtitle');
  const audioKept = options.filterAudio
    ? audio.filter((s) =>
        keeps(s, options.audioLanguages, options.keepUntagged),
      )
    : audio;
  const subsKept = options.filterSubtitles
    ? subs.filter((s) =>
        keeps(s, options.subtitleLanguages, options.keepUntagged),
      )
    : subs;
  const audioOut = ordered(
    audioKept,
    options.audioLanguages,
    options.orderByLanguage,
  );
  const subsOut = ordered(
    subsKept,
    options.subtitleLanguages,
    options.orderByLanguage,
  );

  // Which track gets the default flag. Unasked or not found means the file's own flags stay.
  const wantAudio = normalizeLanguage(options.defaultAudio);
  const audioDefault = wantAudio
    ? audioOut.find((s) => languageOf(s) === wantAudio)
    : undefined;
  const wantSub = normalizeLanguage(options.defaultSubtitle);
  const notes: string[] = [];
  let subDefault =
    wantSub && wantSub !== 'none'
      ? subsOut.find((s) => languageOf(s) === wantSub)
      : undefined;
  if (wantSub === 'none' && subsOut.length > 0 && isMp4Family(file)) {
    subDefault = subsOut[0];
    notes.push(
      'MP4 always plays its first subtitle track; use an MKV to keep subtitles off by default',
    );
  }
  const changesAudio = !!audioDefault;
  const changesSubs = wantSub === 'none' || !!subDefault;

  const audioDefaults = audioOut.filter((s) =>
    changesAudio ? s === audioDefault : !!s.default,
  );
  // If the default audio track was removed, the first one left takes its place.
  if (
    audioDefaults.length === 0 &&
    audioOut.length > 0 &&
    audio.some((s) => s.default)
  ) {
    audioDefaults.push(audioOut[0]);
  }
  const defaults = [
    ...audioDefaults,
    ...subsOut.filter((s) => (changesSubs ? s === subDefault : !!s.default)),
  ].map((s) => s.index);

  const base = {
    keepAudio: audioOut.map((s) => s.index),
    keepSubtitles: subsOut.map((s) => s.index),
    removeAudio: audio
      .filter((s) => !audioKept.includes(s))
      .map((s) => s.index),
    removeSubtitles: subs
      .filter((s) => !subsKept.includes(s))
      .map((s) => s.index),
    defaults,
    notes,
  };

  if (options.filterAudio && audio.length > 0 && audioKept.length === 0) {
    return {
      ...base,
      action: 'skip-no-audio',
      reason: 'No audio in the languages to keep',
    };
  }

  const removed = base.removeAudio.length + base.removeSubtitles.length;
  const reordered =
    audioOut.some((s, i) => s !== audioKept[i]) ||
    subsOut.some((s, i) => s !== subsKept[i]);
  const flagsDiffer = [...audioOut, ...subsOut].some(
    (s) => !!s.default !== defaults.includes(s.index),
  );
  const parts: string[] = [];
  if (removed > 0)
    parts.push(`Remove ${removed} track${removed === 1 ? '' : 's'}`);
  if (reordered) parts.push('Reorder tracks');
  if (flagsDiffer) parts.push('Change default tracks');
  if (parts.length === 0) {
    return { ...base, action: 'already-clean', reason: 'Nothing to change' };
  }
  return { ...base, action: 'clean', reason: parts.join(', ') };
}

/** Arguments for rewriting a file with only the planned tracks (no re-encoding). */
export function buildTrackArgs(
  input: string,
  output: string,
  plan: TrackPlan,
): string[] {
  const args = [
    '-y',
    '-hide_banner',
    '-i',
    input,
    '-map',
    '0:v',
    '-map_chapters',
    '0',
  ];
  for (const index of plan.keepAudio) args.push('-map', `0:${index}`);
  for (const index of plan.keepSubtitles) args.push('-map', `0:${index}`);
  // Say each kept track's default flag out loud, so exactly the planned ones are on.
  const flag = (kind: 'a' | 's', indexes: number[]) =>
    indexes.forEach((index, n) =>
      args.push(
        `-disposition:${kind}:${n}`,
        plan.defaults.includes(index) ? 'default' : '0',
      ),
    );
  flag('a', plan.keepAudio);
  flag('s', plan.keepSubtitles);
  args.push('-c', 'copy', output);
  return args;
}

/** Where the cleaned copy goes before it replaces (or sits beside) the original. */
export function cleanedPath(input: string, replace: boolean): string {
  const ext = path.extname(input);
  const base = input.slice(0, input.length - ext.length);
  return replace ? `${base}.fs-temp${ext}` : `${base}.cleaned${ext}`;
}
