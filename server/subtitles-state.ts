/**
 * The Discs page's side of the subtitle converter (disc-subs on the host). Like the ripper it is
 * files in the DVDs folder: the converter writes `_subs/index.json` (every movie file and its
 * subtitle tracks), `_subs/current.json` (what it is doing) and `_subs/done/*.json` (what it
 * did), and reads a request file for each movie to convert in `_subs/queue/`. The page also
 * writes `_settings/subs`, 1 or 0, which says whether new discs are converted by themselves.
 */

import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { discsDir, outputFolder } from './disc-state';
import type {
  HeldFile,
  SubtitleFile,
  SubtitleRequest,
  SubtitleResult,
  SubtitlesState,
  SubtitleTrack,
} from '../src/types/subtitles';

const MAX_RECENT = 40;

/** Plex's folders for a movie's extras: their subtitles are not converted, so not listed. */
const EXTRA_FOLDERS = new Set([
  'other',
  'extras',
  'featurettes',
  'behind the scenes',
  'deleted scenes',
  'interviews',
  'scenes',
  'shorts',
  'trailers',
]);

export function isExtra(file: string): boolean {
  return file
    .split('/')
    .slice(0, -1)
    .some((part) => EXTRA_FOLDERS.has(part.toLowerCase()));
}

function requestName(
  relative: string,
  action: string = 'convert',
  track?: number,
): string {
  const key =
    action === 'convert'
      ? relative
      : action === 'clear'
        ? 'clear'
        : action === 'droptrack'
          ? `${action}:${relative}:${track}`
          : `${action}:${relative}`;
  return createHash('md5').update(key).digest('hex').slice(0, 12);
}

async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function readJson(file: string): Promise<unknown> {
  const text = await readText(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The requests waiting, as the relative paths they ask for. */
async function readQueued(dir: string): Promise<string[]> {
  const folder = path.join(dir, '_subs', 'queue');
  let names: string[];
  try {
    names = await fs.readdir(folder);
  } catch {
    return [];
  }
  const queued: string[] = [];
  for (const name of names.filter((n) => n.endsWith('.req')).sort()) {
    const text = await readText(path.join(folder, name));
    const lines = text?.split('\n') ?? [];
    // Only conversions mark a file as waiting; a restore or a clear is another kind of request.
    const action = lines.find((l) => l.startsWith('action='));
    if (action && action !== 'action=convert' && action !== 'action=recheck')
      continue;
    const line = lines.find((l) => l.startsWith('path='));
    if (line) queued.push(line.slice('path='.length));
  }
  return queued;
}

/**
 * How big the current run of requests is, kept in _subs/batch.json so the page can say "3 of 14"
 * after a reload or on another device. A request that arrives while others are still waiting
 * joins the run; one that arrives when nothing is waiting starts a new one.
 */
async function growBatch(dir: string, action: Action): Promise<void> {
  const waiting = (await readQueued(dir)).length;
  const before = await readBatch(dir);
  const joins = before !== null && waiting > 1;
  const total = joins ? before.total + 1 : Math.max(waiting, 1);
  const kind = joins && before.kind !== action ? 'mixed' : action;
  const file = path.join(dir, '_subs', 'batch.json');
  await fs.writeFile(file, JSON.stringify({ total, kind }), { mode: 0o666 });
  await fs.chmod(file, 0o666).catch(() => undefined);
}

async function readBatch(
  dir: string,
): Promise<{ total: number; kind: string } | null> {
  const raw = await readJson(path.join(dir, '_subs', 'batch.json'));
  if (
    !isRecord(raw) ||
    typeof raw.total !== 'number' ||
    typeof raw.kind !== 'string'
  ) {
    return null;
  }
  return { total: raw.total, kind: raw.kind };
}

function readTrack(value: unknown): SubtitleTrack | null {
  if (!isRecord(value)) return null;
  return {
    language: typeof value.language === 'string' ? value.language : 'und',
    codec: typeof value.codec === 'string' ? value.codec : '',
    name: typeof value.name === 'string' ? value.name : '',
    default: value.default === true,
    forced: value.forced === true,
  };
}

/** What the page shows about subtitles. */
export async function readSubtitlesState(
  dir: string = discsDir(),
): Promise<SubtitlesState> {
  const index = await readJson(path.join(dir, '_subs', 'index.json'));
  const autoText = await readText(path.join(dir, '_settings', 'subs'));
  const auto = autoText === null ? true : autoText.trim() !== '0';

  const currentRaw = await readJson(path.join(dir, '_subs', 'current.json'));
  const current =
    isRecord(currentRaw) && typeof currentRaw.path === 'string'
      ? {
          path: currentRaw.path,
          step: typeof currentRaw.step === 'string' ? currentRaw.step : '',
          done: typeof currentRaw.done === 'number' ? currentRaw.done : null,
          total: typeof currentRaw.total === 'number' ? currentRaw.total : null,
        }
      : null;

  const waiting = await readQueued(dir);
  const queued = new Set(waiting);
  const run = await readBatch(dir);
  const batch =
    run && waiting.length > 0
      ? (() => {
          const total = Math.max(run.total, waiting.length);
          const kind: 'convert' | 'recheck' | 'mixed' =
            run.kind === 'convert' || run.kind === 'recheck'
              ? run.kind
              : 'mixed';
          return { kind, total, done: total - waiting.length };
        })()
      : null;

  const files: SubtitleFile[] = [];
  let updated: number | null = null;
  if (isRecord(index) && Array.isArray(index.files)) {
    updated = typeof index.updated === 'number' ? index.updated : null;
    for (const raw of index.files) {
      if (!isRecord(raw) || typeof raw.path !== 'string') continue;
      if (isExtra(raw.path)) continue;
      const tracks = (Array.isArray(raw.tracks) ? raw.tracks : [])
        .map(readTrack)
        .filter((t): t is SubtitleTrack => t !== null);
      // A file with no subtitle tracks has nothing to show or convert.
      if (tracks.length === 0) continue;
      const status =
        current?.path === raw.path
          ? 'converting'
          : queued.has(raw.path)
            ? 'queued'
            : null;
      // Pictures the converter already tried and could not read are not offered again.
      const unreadable = raw.unreadable === true;
      files.push({
        path: raw.path,
        tracks,
        pictures: unreadable
          ? 0
          : tracks.filter((t) => t.codec === 'picture').length,
        unreadable,
        needsClean: raw.needs_clean === true,
        status,
      });
    }
  }

  const held: HeldFile[] = [];
  if (isRecord(index) && Array.isArray(index.held)) {
    for (const raw of index.held) {
      if (!isRecord(raw) || typeof raw.path !== 'string') continue;
      held.push({
        path: raw.path,
        size: typeof raw.size === 'number' ? raw.size : 0,
        at: typeof raw.at === 'number' ? raw.at : 0,
        version: typeof raw.version === 'number' ? raw.version : 0,
      });
    }
  }

  const recent: SubtitleResult[] = [];
  try {
    const folder = path.join(dir, '_subs', 'done');
    for (const name of await fs.readdir(folder)) {
      const raw = await readJson(path.join(folder, name));
      if (!isRecord(raw) || typeof raw.path !== 'string') continue;
      recent.push({
        id: name,
        path: raw.path,
        ok: raw.ok === true,
        message: typeof raw.message === 'string' ? raw.message : '',
        at: typeof raw.at === 'number' ? raw.at : 0,
        details: Array.isArray(raw.details)
          ? raw.details.filter((d): d is string => typeof d === 'string')
          : [],
      });
    }
  } catch {
    // Nothing converted yet.
  }
  recent.sort((a, b) => b.at - a.at);

  return {
    available: index !== null,
    auto,
    updated,
    files,
    held,
    current,
    batch,
    recent: recent.slice(0, MAX_RECENT),
  };
}

/**
 * A movie file the converter may be asked about: relative, inside the folder, an .mkv. Folders
 * starting with _ are the ripper's own, except the one finished discs are put in.
 */
export function cleanSubtitlePath(
  value: unknown,
  output = '_converted',
): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Say which file');
  }
  const text = value.trim();
  if (
    text.startsWith('/') ||
    text.includes('\\') ||
    text.includes('\0') ||
    text.length > 400
  ) {
    throw new Error('That is not a file in the DVDs folder');
  }
  const parts = text.split('/');
  if (
    parts.some((p) => p === '' || p === '..' || p === '.') ||
    (parts[0].startsWith('_') && parts[0] !== output) ||
    !text.toLowerCase().endsWith('.mkv')
  ) {
    throw new Error('That is not a movie file in the DVDs folder');
  }
  return text;
}

type Action =
  'convert' | 'restore' | 'clear' | 'recheck' | 'droptrack' | 'droppictures';

async function writeRequest(
  dir: string,
  relative: string,
  action: Action = 'convert',
  track?: number,
): Promise<void> {
  const folder = path.join(dir, '_subs', 'queue');
  await fs.mkdir(folder, { recursive: true });
  // Written here as root and cleaned up by the converter as another user, so open to both.
  await fs.chmod(folder, 0o777).catch(() => undefined);
  // The same name the converter gives, so asking twice is one request.
  const name = requestName(relative, action, track);
  const file = path.join(folder, `${name}.req`);
  try {
    await fs.writeFile(
      file,
      action === 'clear'
        ? `action=clear\nat=${Math.floor(Date.now() / 1000)}\n`
        : `action=${action}\npath=${relative}\n${
            track === undefined ? '' : `track=${track}\n`
          }at=${Math.floor(Date.now() / 1000)}\n`,
      { flag: 'wx', mode: 0o666 },
    );
    await fs.chmod(file, 0o666).catch(() => undefined);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
    throw error;
  }
  if (action === 'convert' || action === 'recheck')
    await growBatch(dir, action);
}

/** Asks for one file, or every file with picture subtitles, to be converted. Returns how many. */
export async function requestSubtitles(
  dir: string,
  request: SubtitleRequest,
): Promise<number> {
  const output = await outputFolder(dir);
  if ('all' in request) {
    const state = await readSubtitlesState(dir);
    const wanted = state.files.filter(
      (f) => f.pictures > 0 && f.status === null,
    );
    for (const file of wanted)
      await writeRequest(dir, cleanSubtitlePath(file.path, output));
    return wanted.length;
  }
  const relative = cleanSubtitlePath(request.path, output);
  const state = await readSubtitlesState(dir);
  const known = state.files.find((f) => f.path === relative);
  if (!known) throw new Error('That file is not in the list of movies');
  if (known.unreadable) {
    throw new Error(
      'Its picture subtitles were tried and cannot be read. You can remove them under the file.',
    );
  }
  if (known.pictures === 0) throw new Error('It has no picture subtitles');
  await writeRequest(dir, relative);
  return 1;
}

/** Asks for the text subtitles in one file, or in every file that needs it, to be cleaned. */
export async function requestClean(
  dir: string,
  request: { path: string } | { all: true },
): Promise<number> {
  const output = await outputFolder(dir);
  const state = await readSubtitlesState(dir);
  if ('all' in request) {
    const wanted = state.files.filter((f) => f.needsClean && f.status === null);
    for (const file of wanted) {
      await writeRequest(dir, cleanSubtitlePath(file.path, output), 'recheck');
    }
    return wanted.length;
  }
  const relative = cleanSubtitlePath(request.path, output);
  const known = state.files.find((f) => f.path === relative);
  if (!known) throw new Error('That file is not in the list of movies');
  await writeRequest(dir, relative, 'recheck');
  return 1;
}

/**
 * Asks for one subtitle track to be taken out of a file. The number counts the file's subtitle
 * tracks from 0, in the order the page lists them. The old file is kept first.
 */
export async function requestDropTrack(
  dir: string,
  value: unknown,
  track: unknown,
): Promise<string> {
  const output = await outputFolder(dir);
  const relative = cleanSubtitlePath(value, output);
  const state = await readSubtitlesState(dir);
  const known = state.files.find((f) => f.path === relative);
  if (!known) throw new Error('That file is not in the list of movies');
  if (
    typeof track !== 'number' ||
    !Number.isInteger(track) ||
    track < 0 ||
    track >= known.tracks.length
  ) {
    throw new Error('That subtitle track is not in the file');
  }
  if (known.status !== null) {
    throw new Error('That file is being worked on, try again in a minute');
  }
  await writeRequest(dir, relative, 'droptrack', track);
  return relative;
}

/**
 * Asks for every picture subtitle track to be taken out of one file, or of every file whose
 * pictures could not be read (the ones that otherwise stay as pictures for good). The old file is
 * kept first. Returns how many files were asked for.
 */
export async function requestDropPictures(
  dir: string,
  request: { path: unknown } | { all: true },
): Promise<number> {
  const output = await outputFolder(dir);
  const state = await readSubtitlesState(dir);
  if ('all' in request) {
    const wanted = state.files.filter((f) => f.unreadable && f.status === null);
    for (const file of wanted)
      await writeRequest(dir, file.path, 'droppictures');
    return wanted.length;
  }
  const relative = cleanSubtitlePath(request.path, output);
  const known = state.files.find((f) => f.path === relative);
  if (!known) throw new Error('That file is not in the list of movies');
  if (!known.tracks.some((t) => t.codec === 'picture')) {
    throw new Error('It has no picture subtitles');
  }
  if (known.status !== null) {
    throw new Error('That file is being worked on, try again in a minute');
  }
  await writeRequest(dir, relative, 'droppictures');
  return 1;
}

/** Asks for the old copy of a file to be put back; the converted file is kept in its place. */
export async function requestRestore(
  dir: string,
  value: unknown,
): Promise<string> {
  const output = await outputFolder(dir);
  const relative = cleanSubtitlePath(value, output);
  const state = await readSubtitlesState(dir);
  if (!state.held.some((h) => h.path === relative)) {
    throw new Error('There is no old copy of that file');
  }
  await writeRequest(dir, relative, 'restore');
  return relative;
}

/** Asks for every old copy to be deleted for good. Only the page's confirmed button calls this. */
export async function requestClearOldCopies(dir: string): Promise<number> {
  const state = await readSubtitlesState(dir);
  if (state.held.length === 0) throw new Error('There are no old copies');
  await writeRequest(dir, '', 'clear');
  return state.held.length;
}

/**
 * Takes things off the page's list. Waiting requests are removed before the converter picks
 * them up; finished entries are only records of what was done, so no movie file is touched.
 */
export async function dismissSubtitles(
  dir: string,
  what: Record<string, unknown>,
): Promise<number> {
  const output = await outputFolder(dir);
  const queueDir = path.join(dir, '_subs', 'queue');
  const doneDir = path.join(dir, '_subs', 'done');
  if (typeof what.queued === 'string') {
    const relative = cleanSubtitlePath(what.queued, output);
    const file = path.join(queueDir, `${requestName(relative)}.req`);
    const existed = await fs
      .rm(file)
      .then(() => 1)
      .catch(() => 0);
    return existed;
  }
  if (what.queue === 'all') {
    let removed = 0;
    for (const name of await fs.readdir(queueDir).catch(() => [] as string[])) {
      if (!name.endsWith('.req')) continue;
      const text = await readText(path.join(queueDir, name));
      const action = text?.split('\n').find((l) => l.startsWith('action='));
      // Only the conversions waiting; a restore or a delete the person asked for stays.
      if (action && action !== 'action=convert' && action !== 'action=recheck')
        continue;
      removed += await fs
        .rm(path.join(queueDir, name))
        .then(() => 1)
        .catch(() => 0);
    }
    return removed;
  }
  if (typeof what.result === 'string') {
    if (!/^[A-Za-z0-9._-]+\.json$/.test(what.result)) {
      throw new Error('That is not a record');
    }
    return fs
      .rm(path.join(doneDir, what.result))
      .then(() => 1)
      .catch(() => 0);
  }
  if (what.results === 'all') {
    let removed = 0;
    for (const name of await fs.readdir(doneDir).catch(() => [] as string[])) {
      if (!name.endsWith('.json')) continue;
      removed += await fs
        .rm(path.join(doneDir, name))
        .then(() => 1)
        .catch(() => 0);
    }
    return removed;
  }
  throw new Error('Say what to dismiss');
}

/** Turns converting the subtitles of new discs on or off. */
export async function setSubtitlesAuto(
  dir: string,
  enabled: boolean,
): Promise<void> {
  await fs.mkdir(path.join(dir, '_settings'), { recursive: true });
  await fs.writeFile(
    path.join(dir, '_settings', 'subs'),
    enabled ? '1\n' : '0\n',
  );
}
