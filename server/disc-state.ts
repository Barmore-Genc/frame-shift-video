/**
 * The Discs page's side of the DVD ripper. The ripper runs on the host; Frame Shift
 * sees the same share, so the two trade small files in the DVDs folder:
 *
 *   _status/drive.txt, _status/run.txt   written by the host: the drive and the ripper
 *   ATTENTION - <name>.txt               written by the ripper: something needs a person
 *   _converting/<disc>/STATUS.txt        written by the ripper: a disc's log
 *   _images/<disc>/                      a copied disc waiting to be told what it is
 *   _images/<disc>/suggest.txt           written by the ripper: what TMDB made of its label
 *   _settings/eject                      written here: 1 or 0, read by the ripper
 *   _settings/auto                       written here: 1 or 0, whether a disc is ripped as it goes in
 *   _settings/movie-only                 written here: 1 or 0, whether a movie's extras are left out
 *   _settings/next                       written here: a note for the next disc
 *   _commands/<id>.cmd                   written here, run by the host: eject, rip, rename, match,
 *                                        search (TMDB; the host holds the token)
 *   _commands/done/<id>.result           written by the host: "ok" or "error", then a sentence
 *
 * Everything written here is made of a small set of checked values, and the host
 * checks it again, so the page can only ask for those five things. The one exception is
 * extras-state.ts, which renames an extra of a ripped movie in place.
 */

import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { JobService } from './db-service';
import { readContents } from './disc-contents';
import type {
  DiscAttention,
  DiscCommand,
  DiscCommandResult,
  DiscConversion,
  DiscCopy,
  DiscConvert,
  DiscDone,
  DiscPreset,
  DiscDrive,
  DiscNext,
  DiscParked,
  DiscRun,
  DiscsState,
  DiscStage,
  DiscWorking,
} from '../src/types/discs';

/** The drive helper reports every 30 seconds at least; past this it is not running. */
const DRIVE_ALIVE_SECONDS = 90;
const MAX_NAME_LENGTH = 100;
const MAX_LIST = 100;
/** How many filed discs the page can show when it is asked for all of them. */
const RECENT_COUNT = 200;

/** Where the ripper's folder is, as this server sees it. */
export function discsDir(): string {
  if (process.env.DISC_RIP_DIR) return process.env.DISC_RIP_DIR;
  return path.join(process.env.FRAME_SHIFT_HOME || '/', 'DVDs');
}

/**
 * A name that is safe in a file name and in the ripper's own rules: letters, digits,
 * spaces and ( ) & , . ' { } - only. Throws when nothing is left.
 */
export function cleanName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('A name is needed');
  const cleaned = value
    .replace(/[^A-Za-z0-9 ()&,.'{}-]/g, '')
    .replace(/ +/g, ' ')
    .trim();
  if (!cleaned) throw new Error('The name has no usable characters');
  if (cleaned.length > MAX_NAME_LENGTH) throw new Error('The name is too long');
  return cleaned;
}

/** A whole number from 1 to 999. */
export function cleanNumber(value: unknown, what: string): number {
  const number = typeof value === 'string' ? Number(value) : value;
  if (
    typeof number !== 'number' ||
    !Number.isInteger(number) ||
    number < 1 ||
    number > 999
  ) {
    throw new Error(`${what} must be a whole number from 1 to 999`);
  }
  return number;
}

/** A four-digit year, for narrowing a TMDB search. */
export function cleanYear(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1888 ||
    value > 2100
  ) {
    throw new Error('The year must be a four-digit year');
  }
  return value;
}

/** Reads a file, or null when it is not there. */
async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** key=value lines. */
function parseKeyValues(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) values[line.slice(0, at)] = line.slice(at + 1).trim();
  }
  return values;
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function lastLines(text: string, count: number): string[] {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-count);
}

async function readDrive(dir: string, now: number): Promise<DiscDrive | null> {
  const text = await readText(path.join(dir, '_status', 'drive.txt'));
  if (text === null) return null;
  const values = parseKeyValues(text);
  const updated = Number(values.updated) || null;
  return {
    media: values.media === '1',
    label: values.label ?? '',
    updated,
    alive: updated !== null && now - updated < DRIVE_ALIVE_SECONDS,
  };
}

async function readRun(dir: string): Promise<DiscRun | null> {
  const text = await readText(path.join(dir, '_status', 'run.txt'));
  if (text === null) return null;
  const values = parseKeyValues(text);
  return {
    state: values.state === 'running' ? 'running' : 'idle',
    name: values.name ?? '',
    step: values.step ?? '',
    updated: Number(values.updated) || 0,
  };
}

async function readNext(dir: string): Promise<DiscNext | null> {
  const text = await readText(path.join(dir, '_settings', 'next'));
  if (text === null) return null;
  const values = parseKeyValues(text);
  if (values.mode === 'tv' && values.show && values.season) {
    return {
      mode: 'tv',
      show: values.show,
      season: Number(values.season),
      episode: values.episode ? Number(values.episode) : 1,
    };
  }
  if (values.mode === 'movie') {
    return {
      mode: 'movie',
      ...(values.name ? { name: values.name } : {}),
      ...(values.for === 'drive' ? { current: true } : {}),
    };
  }
  return null;
}

async function readAttention(dir: string): Promise<DiscAttention[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const notes: DiscAttention[] = [];
  for (const file of names.sort()) {
    const match = /^ATTENTION - (.+)\.txt$/.exec(file);
    if (!match) continue;
    const text = (await readText(path.join(dir, file))) ?? '';
    notes.push({
      file,
      name: match[1]!,
      lines: text
        .split('\n')
        .map((line) => line.trimEnd())
        .filter(Boolean),
    });
  }
  return notes.slice(0, MAX_LIST);
}

/**
 * Discs that were copied and parked to be told what they are, with the ripper's guess from
 * TMDB when it left one.
 */
async function readParked(dir: string): Promise<DiscParked[]> {
  const folders = await listDirs(path.join(dir, '_images'));
  const parked: DiscParked[] = [];
  for (const name of folders) {
    if (parked.length >= MAX_LIST) break;
    // Only a disc the ripper parked to be told what it is. A kept copy of one that was
    // already filed stays in _images too, without this marker.
    const waiting = await readText(path.join(dir, '_images', name, '.waiting'));
    if (waiting === null) continue;
    const text = await readText(path.join(dir, '_images', name, 'suggest.txt'));
    const values = text === null ? {} : parseKeyValues(text);
    const season = Number(values.season);
    const disc = Number(values.disc);
    const suggestion = {
      ...(values.show ? { show: values.show } : {}),
      ...(Number.isInteger(season) && season > 0 ? { season } : {}),
      ...(Number.isInteger(disc) && disc > 0 ? { disc } : {}),
    };
    parked.push({
      name,
      suggestion: Object.keys(suggestion).length > 0 ? suggestion : null,
    });
  }
  return parked;
}

/** The part of a Frame Shift job the queue needs. */
export interface QueueJob {
  input_file: string;
  status: string;
  progress: number | null;
}

/** The jobs in Frame Shift's list, as the queue reads them. */
function readJobs(): QueueJob[] {
  try {
    return (['pending', 'processing', 'completed', 'failed'] as const).flatMap(
      (status) => JobService.getByStatus(status),
    );
  } catch {
    return [];
  }
}

/** How far the conversions of one disc's working folder have got, or null when there are none. */
export function conversionOf(
  folder: string,
  jobs: QueueJob[],
): DiscConversion | null {
  const marker = `/_converting/${folder}/`;
  const mine = jobs.filter((job) => job.input_file.includes(marker));
  if (mine.length === 0) return null;
  const done = mine.filter((job) => job.status === 'completed').length;
  const failed = mine.filter((job) => job.status === 'failed').length;
  const points = mine.reduce(
    (sum, job) =>
      sum +
      (job.status === 'completed' || job.status === 'failed'
        ? 100
        : Math.min(100, Math.max(0, job.progress ?? 0))),
    0,
  );
  return {
    total: mine.length,
    done,
    failed,
    percent: Math.round(points / mine.length),
  };
}

/** Where a disc is, from what its folder holds and what Frame Shift is doing with it. */
export function stageOf(
  stage: string | null,
  hasManifest: boolean,
  queued: boolean,
  conversion: DiscConversion | null,
): DiscStage {
  if (queued || stage === 'queued') {
    if (!conversion) return 'waiting';
    if (conversion.done + conversion.failed >= conversion.total)
      return 'filing';
    return conversion.percent > 0 || conversion.done > 0
      ? 'converting'
      : 'waiting';
  }
  if (stage === 'copying') return 'copying';
  if (stage === 'staged' || hasManifest) return 'waiting';
  return 'extracting';
}

/** What to call a disc: where it will be filed, which its manifest says, else its folder. */
function titleOf(folder: string, manifest: string | null): string {
  const first = manifest?.split('\n')[0]?.split('\t')[1];
  const filed = first?.split('/')[0]?.trim();
  return filed || folder.replace(/_+/g, ' ').trim();
}

/** How far the copy of a disc has got, from the ripper's progress file, or null. */
async function readCopy(folder: string): Promise<DiscCopy | null> {
  const text = await readText(path.join(folder, 'progress.txt'));
  if (text === null) return null;
  const values = parseKeyValues(text);
  const total = Number(values.total);
  const bytes = Number(values.bytes);
  const startedAt = Number(values.started);
  const updatedAt = Number(values.updated);
  if (![total, bytes, startedAt, updatedAt].every(Number.isFinite)) {
    return null;
  }
  if (total <= 0 || bytes < 0 || updatedAt < startedAt) return null;
  return { total, bytes, startedAt, updatedAt };
}

async function readWorking(
  dir: string,
  jobs: QueueJob[],
  now: number,
): Promise<DiscWorking[]> {
  const folders = await listDirs(path.join(dir, '_converting'));
  const working: DiscWorking[] = [];
  for (const name of folders) {
    const folder = path.join(dir, '_converting', name);
    const log = await readText(path.join(folder, 'STATUS.txt'));
    const queued = (await readText(path.join(folder, 'submitted'))) !== null;
    const manifest = await readText(path.join(folder, 'manifest.tsv'));
    const stage =
      (await readText(path.join(folder, 'stage.txt')))?.trim() ?? null;
    // Only once the disc has been given to Frame Shift: a disc ripped again under the same folder
    // name would otherwise show the finished conversions of the earlier rip as its own.
    const conversion = queued ? conversionOf(name, jobs) : null;
    let quietSeconds: number | null = null;
    try {
      const stat = await fs.stat(path.join(folder, 'STATUS.txt'));
      quietSeconds = Math.max(0, now - Math.floor(stat.mtimeMs / 1000));
    } catch {
      quietSeconds = null;
    }
    const discStage = stageOf(stage, manifest !== null, queued, conversion);
    working.push({
      name,
      title: titleOf(name, manifest),
      stage: discStage,
      lines: lastLines(log ?? '', 6),
      queued,
      conversion,
      quietSeconds,
      copy: discStage === 'copying' ? await readCopy(folder) : null,
    });
  }
  return working.slice(0, MAX_LIST);
}

/** A finished folder and the folder that holds it. */
interface Finished {
  name: string;
  parent: string;
}

/**
 * The folder inside the DVDs folder where finished discs go: _settings/output, which must be one
 * plain folder name (the ripper applies the same rule), else _converted.
 */
export async function outputFolder(dir: string): Promise<string> {
  const text = (await readText(path.join(dir, '_settings', 'output')))?.trim();
  if (!text || !/^[A-Za-z0-9_][A-Za-z0-9._ -]*$/.test(text))
    return '_converted';
  return text;
}

/**
 * Every finished folder: the ones in the output folder, and the ones filed in the DVDs folder
 * itself before that folder existed.
 */
async function readFinished(dir: string): Promise<Finished[]> {
  const output = await outputFolder(dir);
  const inOutput = path.join(dir, output);
  const finished: Finished[] = [];
  for (const name of await listDirs(inOutput)) {
    finished.push({ name, parent: inOutput });
  }
  for (const name of await listDirs(dir)) {
    // The output folder is where they are kept, not a disc.
    if (!name.startsWith('_') && name !== output) {
      finished.push({ name, parent: dir });
    }
  }
  return finished;
}

/** The last few folders filed, newest first. */
async function readRecent(folders: Finished[]): Promise<DiscDone[]> {
  const stamped: DiscDone[] = [];
  for (const { name, parent } of folders) {
    try {
      const folder = path.join(parent, name);
      const stat = await fs.stat(folder);
      stamped.push({
        name,
        at: Math.floor(stat.mtimeMs / 1000),
        contents: null,
      });
    } catch {
      // Gone since it was listed.
    }
  }
  const newest = stamped.sort((a, b) => b.at - a.at).slice(0, RECENT_COUNT);
  for (const done of newest) {
    const parent = folders.find((f) => f.name === done.name)?.parent;
    if (!parent) continue;
    try {
      done.contents = await readContents(path.join(parent, done.name));
    } catch {
      done.contents = null;
    }
  }
  return newest;
}

/** Everything the Discs page shows, from the files in the DVDs folder. */
export async function readDiscsState(
  dir: string = discsDir(),
  now: number = Math.floor(Date.now() / 1000),
  jobs: QueueJob[] = readJobs(),
): Promise<DiscsState> {
  try {
    await fs.access(dir);
  } catch {
    return {
      available: false,
      eject: false,
      autoScan: true,
      movieOnly: false,
      drive: null,
      run: null,
      next: null,
      attention: [],
      working: [],
      parked: [],
      needsYear: [],
      finishedCount: 0,
      recent: [],
      convert: { presets: [], chosen: '' },
      outputFolder: '_converted',
    };
  }

  const ejectText = await readText(path.join(dir, '_settings', 'eject'));
  const autoText = await readText(path.join(dir, '_settings', 'auto'));
  const movieOnlyText = await readText(
    path.join(dir, '_settings', 'movie-only'),
  );
  const folders = await readFinished(dir);
  return {
    available: true,
    // On unless it was switched off: the ripper ejects a disc once it is not needed.
    eject: ejectText === null ? true : ejectText.trim() !== '0',
    // On unless it was switched off: a disc that goes in is scanned and ripped by itself.
    autoScan: autoText === null ? true : autoText.trim() !== '0',
    // Off unless it was switched on: a movie's extras are made too.
    movieOnly: movieOnlyText?.trim() === '1',
    drive: await readDrive(dir, now),
    run: await readRun(dir),
    next: await readNext(dir),
    attention: await readAttention(dir),
    working: await readWorking(dir, jobs, now),
    parked: await readParked(dir),
    needsYear: folders
      .map((folder) => folder.name)
      .filter((name) => !/\(\d{4}\)/.test(name))
      .slice(0, MAX_LIST),
    finishedCount: folders.length,
    recent: await readRecent(folders),
    convert: await readConvert(dir),
    outputFolder: await outputFolder(dir),
  };
}

const PRESET_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const CONTAINERS = ['mkv', 'mp4'];
const VIDEOS = ['libx265', 'libx264', 'libsvtav1', 'copy'];
const AUDIOS = ['copy', 'aac', 'ac3'];
const SUBTITLES = ['keep', 'none'];
const SPEEDS = [
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow',
];
/** The ones the ripper writes the first time: they are not changed or deleted from the page. */
const BUILT_IN_PRESETS = ['hevc-mkv', 'h264-mp4', 'h264-mkv', 'original-mkv'];
/** The most presets the page will let the list grow to. */
const MAX_PRESETS = 30;

/**
 * One preset made safe, or null when it has no usable id or name. The same rules as the ripper's
 * disc-preset: values that cannot work together are corrected, so a preset is always usable.
 */
function cleanPreset(raw: unknown): DiscPreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== 'string' || !PRESET_ID.test(item.id)) return null;
  if (typeof item.name !== 'string') return null;
  const name = [...item.name]
    .map((char) => (/\p{C}/u.test(char) ? ' ' : char))
    .join('')
    .trim()
    .slice(0, 60);
  if (!name) return null;
  const container = CONTAINERS.includes(String(item.container))
    ? String(item.container)
    : 'mkv';
  const video = VIDEOS.includes(String(item.video))
    ? String(item.video)
    : 'libx265';
  const quality =
    typeof item.quality === 'number' &&
    Number.isFinite(item.quality) &&
    item.quality >= 0 &&
    item.quality <= 51
      ? Math.trunc(item.quality)
      : 22;
  return {
    id: item.id,
    name,
    container,
    video,
    quality,
    speed: SPEEDS.includes(String(item.speed)) ? String(item.speed) : 'faster',
    // The ffmpeg build in Frame Shift has 10-bit for x265 and AV1 only.
    tenBit:
      item.tenBit === true && (video === 'libx265' || video === 'libsvtav1'),
    audio: AUDIOS.includes(String(item.audio)) ? String(item.audio) : 'copy',
    // A copied picture cannot be filtered.
    deinterlace: item.deinterlace !== false && video !== 'copy',
    // A DVD's subtitles are pictures, which an MP4 cannot hold.
    subtitles:
      container === 'mp4' || item.subtitles === 'none' ? 'none' : 'keep',
    builtIn: BUILT_IN_PRESETS.includes(item.id),
  };
}

async function readPresetItems(dir: string): Promise<unknown[] | null> {
  const text = await readText(path.join(dir, '_settings', 'presets.json'));
  try {
    const items: unknown = JSON.parse(text ?? '').presets;
    return Array.isArray(items) ? items : null;
  } catch {
    return null;
  }
}

/**
 * The conversion presets the ripper offers and the one chosen, from _settings/presets.json and
 * _settings/preset. The deploy writes the file, so it is there before the first disc.
 */
export async function readConvert(dir: string): Promise<DiscConvert> {
  const presets: DiscPreset[] = [];
  for (const item of (await readPresetItems(dir)) ?? []) {
    const preset = cleanPreset(item);
    if (preset && !presets.some((existing) => existing.id === preset.id)) {
      presets.push(preset);
    }
  }
  const picked = (
    await readText(path.join(dir, '_settings', 'preset'))
  )?.trim();
  // The ripper uses the first when the pick is gone, and says so here too.
  const chosen =
    presets.find((preset) => preset.id === picked)?.id ??
    presets.find((preset) => preset.id === 'hevc-mkv')?.id ??
    presets[0]?.id ??
    '';
  return { presets, chosen };
}

/** Picks the conversion preset for the discs queued from now on. */
export async function setPreset(dir: string, id: string): Promise<void> {
  const { presets } = await readConvert(dir);
  if (!presets.some((preset) => preset.id === id)) {
    throw new Error('That is not one of the choices.');
  }
  await fs.mkdir(path.join(dir, '_settings'), { recursive: true });
  await fs.writeFile(path.join(dir, '_settings', 'preset'), `${id}\n`);
}

/** A preset as the file holds it: whether it is built in is worked out when it is read. */
function stored(preset: DiscPreset): Omit<DiscPreset, 'builtIn'> {
  const { builtIn: _builtIn, ...rest } = preset;
  return rest;
}

/** The edits to the list run one after the other, so two at once cannot lose one. */
let presetEdits: Promise<unknown> = Promise.resolve();

function editPresetList<T>(task: () => Promise<T>): Promise<T> {
  const run = presetEdits.then(task, task);
  presetEdits = run.catch(() => undefined);
  return run;
}

async function writePresetItems(dir: string, items: unknown[]): Promise<void> {
  const file = path.join(dir, '_settings', 'presets.json');
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify({ presets: items }, null, 2)}\n`);
  // The ripper reads it as another user.
  await fs.chmod(temp, 0o666);
  await fs.rename(temp, file);
}

/** A readable id for a new preset, not used by any in the list. */
function newPresetId(name: string, taken: Set<string>): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30)
      .replace(/-+$/g, '') || 'preset';
  let id = `custom-${slug}`;
  for (let n = 2; taken.has(id); n++) id = `custom-${slug}-${n}`;
  return id;
}

function oneOf(value: unknown, allowed: string[], what: string): string {
  if (typeof value === 'string' && allowed.includes(value)) return value;
  throw new Error(`Pick a ${what} from the list.`);
}

/**
 * Makes a preset of the person's own, or changes one they made (when the input has an id).
 * What is wrong with the input comes back in plain words; values that cannot work together
 * are corrected the way the ripper does.
 */
export async function savePreset(
  dir: string,
  input: Record<string, unknown>,
): Promise<DiscPreset> {
  const name = (typeof input.name === 'string' ? input.name : '')
    .replace(/\p{C}/gu, ' ')
    .trim();
  if (!name) throw new Error('Give the preset a name.');
  if (name.length > 60) throw new Error('Keep the name to 60 letters or less.');
  const quality = input.quality;
  if (
    typeof quality !== 'number' ||
    !Number.isInteger(quality) ||
    quality < 0 ||
    quality > 51
  ) {
    throw new Error('Quality is a whole number from 0 to 51.');
  }
  const fields = {
    name,
    container: oneOf(input.container, CONTAINERS, 'file type'),
    video: oneOf(input.video, VIDEOS, 'video'),
    quality,
    speed: oneOf(input.speed, SPEEDS, 'speed'),
    tenBit: input.tenBit === true,
    audio: oneOf(input.audio, AUDIOS, 'sound'),
    deinterlace: input.deinterlace === true,
    subtitles: oneOf(input.subtitles, SUBTITLES, 'choice for subtitles'),
  };
  return editPresetList(async () => {
    const items = await readPresetItems(dir);
    if (!items) {
      throw new Error(
        'The list of choices is not there yet, so nothing can be added to it.',
      );
    }
    const ids = new Set(items.map((item) => cleanPreset(item)?.id ?? ''));
    let saved: DiscPreset | null;
    if (typeof input.id === 'string') {
      const id = input.id;
      const at = items.findIndex((item) => cleanPreset(item)?.id === id);
      if (at < 0) throw new Error('That preset is not there any more.');
      if (BUILT_IN_PRESETS.includes(id)) {
        throw new Error(
          'The built-in presets cannot be changed. Make your own.',
        );
      }
      saved = cleanPreset({ id, ...fields });
      items[at] = saved && stored(saved);
    } else {
      if (ids.size >= MAX_PRESETS) {
        throw new Error(
          'That is plenty of presets. Delete one you do not use.',
        );
      }
      saved = cleanPreset({ id: newPresetId(name, ids), ...fields });
      if (saved) items.push(stored(saved));
    }
    if (!saved) throw new Error('That preset cannot be saved.');
    await fs.mkdir(path.join(dir, '_settings'), { recursive: true });
    await writePresetItems(dir, items);
    return saved;
  });
}

/** Deletes a preset the person made. The built-in ones stay. */
export async function deletePreset(dir: string, id: string): Promise<void> {
  if (BUILT_IN_PRESETS.includes(id)) {
    throw new Error('The built-in presets cannot be deleted.');
  }
  await editPresetList(async () => {
    const items = await readPresetItems(dir);
    const at = (items ?? []).findIndex((item) => cleanPreset(item)?.id === id);
    if (!items || at < 0) throw new Error('That preset is not there any more.');
    items.splice(at, 1);
    await writePresetItems(dir, items);
    // A pick that points at what was just deleted would choose a new preset made with the
    // same name, so the pick goes too and the default is used.
    const pick = path.join(dir, '_settings', 'preset');
    if ((await readText(pick))?.trim() === id)
      await fs.rm(pick, { force: true });
  });
}

/** Turns ejecting on or off for the ripper. */
export async function setEject(dir: string, enabled: boolean): Promise<void> {
  await fs.mkdir(path.join(dir, '_settings'), { recursive: true });
  await fs.writeFile(
    path.join(dir, '_settings', 'eject'),
    enabled ? '1\n' : '0\n',
  );
}

/** Turns scanning and ripping a disc as it goes in on or off. */
export async function setAutoScan(
  dir: string,
  enabled: boolean,
): Promise<void> {
  await fs.mkdir(path.join(dir, '_settings'), { recursive: true });
  await fs.writeFile(
    path.join(dir, '_settings', 'auto'),
    enabled ? '1\n' : '0\n',
  );
}

/** Turns leaving out a movie's extras on or off. */
export async function setMovieOnly(
  dir: string,
  enabled: boolean,
): Promise<void> {
  await fs.mkdir(path.join(dir, '_settings'), { recursive: true });
  await fs.writeFile(
    path.join(dir, '_settings', 'movie-only'),
    enabled ? '1\n' : '0\n',
  );
}

/** Leaves a note for the next disc (or the disc being ripped), or takes it back when null. */
export async function setNext(
  dir: string,
  note: DiscNext | null,
): Promise<void> {
  const file = path.join(dir, '_settings', 'next');
  if (note === null) {
    await fs.rm(file, { force: true });
    return;
  }
  const lines: string[] = [];
  if (note.mode === 'tv') {
    lines.push(
      'mode=tv',
      `show=${cleanName(note.show)}`,
      `season=${cleanNumber(note.season, 'The season')}`,
      `episode=${cleanNumber(note.episode ?? 1, 'The first episode')}`,
    );
  } else if (note.mode === 'movie') {
    // For the disc being ripped, which the ripper names once it has been copied.
    if (note.current) lines.push('for=drive');
    lines.push('mode=movie');
    if (note.name) lines.push(`name=${cleanName(note.name)}`);
  } else {
    throw new Error('Say whether the next disc is a movie or a TV show');
  }
  await fs.mkdir(path.join(dir, '_settings'), { recursive: true });
  await fs.writeFile(file, lines.join('\n') + '\n');
}

/** Removes a note the ripper left. Only a file that is listed as one can go. */
export async function dismissAttention(
  dir: string,
  file: string,
): Promise<void> {
  const notes = await readAttention(dir);
  if (!notes.some((note) => note.file === file)) {
    throw new Error('No such note');
  }
  await fs.rm(path.join(dir, file), { force: true });
}

/** Checks a request from the page, and turns it into the lines the host reads. */
export function commandLines(command: DiscCommand): string[] {
  switch (command.action) {
    case 'eject':
      return ['action=eject'];
    case 'rip': {
      const lines = ['action=rip'];
      if (command.image) lines.push(`image=${cleanFolder(command.image)}`);
      if (command.mode === 'tv') {
        lines.push(
          'mode=tv',
          `show=${cleanName(command.show)}`,
          `season=${cleanNumber(command.season, 'The season')}`,
          `episode=${cleanNumber(command.episode ?? 1, 'The first episode')}`,
        );
      } else if (command.mode === 'movie') {
        lines.push('mode=movie');
        if (command.name) lines.push(`name=${cleanName(command.name)}`);
        if (command.replace === true) lines.push('replace=1');
      } else {
        throw new Error('Say whether it is a movie or a TV show');
      }
      return lines;
    }
    case 'rename':
      return [
        'action=rename',
        `old=${cleanFolder(command.old)}`,
        `new=${cleanName(command.new)}`,
        ...(command.replace === true ? ['replace=1'] : []),
      ];
    case 'match':
      return ['action=match', `old=${cleanFolder(command.old)}`];
    case 'search': {
      if (
        command.kind !== 'movie' &&
        command.kind !== 'tv' &&
        command.kind !== 'any'
      ) {
        throw new Error('Search for a movie, a show or either');
      }
      const lines = [
        'action=search',
        `kind=${command.kind}`,
        `query=${cleanQuery(command.query)}`,
      ];
      if (command.year !== undefined) {
        lines.push(`year=${cleanYear(command.year)}`);
      }
      return lines;
    }
    default:
      throw new Error('Unknown request');
  }
}

/**
 * What a person typed into a TMDB search box. It can be a title or a pasted address, so
 * punctuation stays; control characters (a newline would start another line of the request)
 * do not.
 */
function cleanQuery(value: unknown): string {
  if (typeof value !== 'string')
    throw new Error('Type something to search for');
  // eslint-disable-next-line no-control-regex
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
  if (!cleaned) throw new Error('Type something to search for');
  if (cleaned.length > 200) throw new Error('That is too long to search for');
  return cleaned;
}

/** A folder name from the page: no slashes, no leading dot or underscore trickery. */
function cleanFolder(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    /[/\\\n]/.test(value) ||
    value.startsWith('.')
  ) {
    throw new Error('Not a folder name');
  }
  return value;
}

/** Hands a request to the host. Returns the id to ask the answer by. */
export async function sendCommand(
  dir: string,
  command: DiscCommand,
): Promise<string> {
  const lines = commandLines(command);
  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const folder = path.join(dir, '_commands');
  await fs.mkdir(folder, { recursive: true });
  // Written whole and then renamed, so the host never reads half a request.
  const temp = path.join(folder, `.${id}.tmp`);
  await fs.writeFile(temp, lines.join('\n') + '\n');
  await fs.rename(temp, path.join(folder, `${id}.cmd`));
  return id;
}

/** The host's answer to a request, once there is one. */
export async function commandResult(
  dir: string,
  id: string,
): Promise<DiscCommandResult> {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('Not a request id');
  const text = await readText(
    path.join(dir, '_commands', 'done', `${id}.result`),
  );
  if (text === null) return { done: false };
  const [status, ...message] = text.split('\n');
  return {
    done: true,
    ok: status?.trim() === 'ok',
    message: message.join('\n').trim(),
  };
}
