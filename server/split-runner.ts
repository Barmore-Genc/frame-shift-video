/**
 * Runs the Split page's work: probing files, finding where combined episodes should be cut, cutting
 * them, and rewriting files without their extra tracks. Work is queued and run one task at a time;
 * the page polls `listTasks()` for progress. State lives in memory (these are short, restartable
 * jobs, so nothing is persisted).
 */

import fs from 'fs/promises';
import path from 'path';
import {
  DEFAULT_SPLIT_OPTIONS,
  buildSplitArgs,
  buildTrackArgs,
  cleanedPath,
  isVideoFile,
  parseBlackdetect,
  planSegments,
  planTracks,
  relativeToHome,
  resolveInHome,
  sanitizeFilename,
  type Segment,
  type SplitPlan,
  type StreamInfo,
  type TrackOptions,
  type TrackPlan,
} from './split-tools';

export interface ProbeResult {
  duration: number;
  fps: number;
  streams: StreamInfo[];
}

interface Process {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Run a program, collecting its output. `onStderrLine` sees each line as it arrives. */
async function run(
  cmd: string[],
  options: { signal?: AbortSignal; onStderrLine?: (line: string) => void } = {},
): Promise<Process> {
  // The environment is passed on purpose: programs are looked up on the PATH as it is now.
  const proc = Bun.spawn(cmd, {
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  });
  const abort = () => proc.kill();
  options.signal?.addEventListener('abort', abort);
  try {
    const readStderr = (async () => {
      let text = '';
      let pending = '';
      const decoder = new TextDecoder();
      for await (const chunk of proc.stderr as unknown as AsyncIterable<Uint8Array>) {
        const part = decoder.decode(chunk, { stream: true });
        text += part;
        if (options.onStderrLine) {
          pending += part;
          const lines = pending.split(/[\r\n]/);
          pending = lines.pop() ?? '';
          lines.forEach(options.onStderrLine);
        }
      }
      return text;
    })();
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      readStderr,
    ]);
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
  } finally {
    options.signal?.removeEventListener('abort', abort);
  }
}

export async function probe(file: string): Promise<ProbeResult> {
  const { exitCode, stdout } = await run([
    'ffprobe',
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_streams',
    '-show_format',
    file,
  ]);
  if (exitCode !== 0) throw new Error('ffprobe could not read this file');
  const data = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<Record<string, any>>;
  };
  const streams: StreamInfo[] = (data.streams ?? []).map((s) => ({
    index: s.index,
    type:
      s.codec_type === 'video' ||
      s.codec_type === 'audio' ||
      s.codec_type === 'subtitle'
        ? s.codec_type
        : 'other',
    codec: s.codec_name,
    language: s.tags?.language,
    title: s.tags?.title,
    default: s.disposition?.default === 1,
  }));
  const video = (data.streams ?? []).find(
    (s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1,
  );
  let fps = DEFAULT_SPLIT_OPTIONS.fps;
  const rate = String(video?.avg_frame_rate ?? video?.r_frame_rate ?? '');
  const [num, den] = rate.split('/').map(Number);
  if (num > 0 && den > 0) fps = num / den;
  return { duration: Number(data.format?.duration ?? 0), fps, streams };
}

/** Video files in a folder (not recursive into hidden folders), or just the file itself. */
export async function listVideos(target: string): Promise<string[]> {
  const stat = await fs.stat(target);
  if (stat.isFile()) return isVideoFile(target) ? [target] : [];
  // Files this page writes itself (half-written, temporary, cleaned copies) are not sources.
  const isLeftover = (name: string) =>
    /\.(partial|fs-temp|cleaned)(\.|$)/i.test(name);
  const found: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (
        entry.isFile() &&
        isVideoFile(entry.name) &&
        !isLeftover(entry.name)
      )
        found.push(full);
    }
  };
  await walk(target);
  const { orderBy } = await import('natural-orderby');
  return orderBy(found, [(f) => f], ['asc']);
}

// ---------------------------------------------------------------------------
// Planning (read-only)
// ---------------------------------------------------------------------------

export interface SplitPreviewFile {
  path: string;
  duration: number;
  plan: SplitPlan;
}

/** Find the episode breaks of one file. This decodes the whole video, so it can take a while. */
export async function previewSplit(
  file: string,
  episodes: number,
  frameOffset: number,
  signal?: AbortSignal,
): Promise<SplitPreviewFile> {
  const info = await probe(file);
  const { stderr } = await run(
    [
      'ffmpeg',
      '-hide_banner',
      '-i',
      file,
      '-vf',
      'blackdetect=d=0.4:pix_th=0.10:pic_th=0.98',
      '-an',
      '-sn',
      '-f',
      'null',
      '-',
    ],
    { signal },
  );
  const plan = planSegments(parseBlackdetect(stderr), info.duration, {
    ...DEFAULT_SPLIT_OPTIONS,
    episodes,
    frameOffset,
    fps: info.fps,
  });
  return {
    path: relativeToHome(file),
    duration: info.duration,
    plan,
  };
}

export interface TrackPreviewFile {
  path: string;
  streams: StreamInfo[];
  plan: TrackPlan;
}

export async function previewTracks(
  file: string,
  options: TrackOptions,
): Promise<TrackPreviewFile> {
  const info = await probe(file);
  return {
    path: relativeToHome(file),
    streams: info.streams,
    plan: planTracks(info.streams, options, file),
  };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type TaskStatus =
  'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'skipped';

export interface SplitTask {
  id: string;
  kind: 'split' | 'tracks';
  label: string;
  status: TaskStatus;
  /** 0 to 1 while running. */
  progress: number;
  message: string;
  createdAt: number;
}

interface InternalTask extends SplitTask {
  work: (task: InternalTask, signal: AbortSignal) => Promise<TaskStatus | void>;
  controller: AbortController;
}

const MAX_KEPT = 200;
const tasks: InternalTask[] = [];
let draining = false;
let counter = 0;

function enqueue(
  kind: SplitTask['kind'],
  label: string,
  work: InternalTask['work'],
): void {
  tasks.push({
    id: `${Date.now().toString(36)}-${(counter++).toString(36)}`,
    kind,
    label,
    status: 'queued',
    progress: 0,
    message: 'Waiting',
    createdAt: Date.now(),
    work,
    controller: new AbortController(),
  });
  void drain();
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const next = tasks.find((t) => t.status === 'queued');
      if (!next) break;
      next.status = 'running';
      next.message = 'Starting';
      try {
        const outcome = await next.work(next, next.controller.signal);
        if (next.controller.signal.aborted) {
          next.status = 'cancelled';
          next.message = 'Cancelled';
        } else {
          next.status = outcome ?? 'done';
          next.progress = next.status === 'done' ? 1 : next.progress;
        }
      } catch (error) {
        if (next.controller.signal.aborted) {
          next.status = 'cancelled';
          next.message = 'Cancelled';
        } else {
          next.status = 'failed';
          next.message = error instanceof Error ? error.message : String(error);
        }
      }
    }
  } finally {
    draining = false;
  }
}

export function listTasks(): SplitTask[] {
  return tasks.map(({ work: _work, controller: _controller, ...task }) => task);
}

export function cancelTask(id: string): boolean {
  const task = tasks.find((t) => t.id === id);
  if (!task || (task.status !== 'queued' && task.status !== 'running')) {
    return false;
  }
  task.controller.abort();
  if (task.status === 'queued') {
    task.status = 'cancelled';
    task.message = 'Cancelled';
  }
  return true;
}

/** Forget finished tasks. */
export function clearFinished(): number {
  const before = tasks.length;
  for (let i = tasks.length - 1; i >= 0; i--) {
    if (!['queued', 'running'].includes(tasks[i].status)) tasks.splice(i, 1);
  }
  if (tasks.length > MAX_KEPT) tasks.splice(0, tasks.length - MAX_KEPT);
  return before - tasks.length;
}

/** Run ffmpeg, reporting progress from its `time=` output. */
async function runFfmpeg(
  args: string[],
  duration: number,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const result = await run(['ffmpeg', ...args], {
    signal,
    onStderrLine: (line) => {
      const match = line.match(/time=(\d+):(\d+):([\d.]+)/);
      if (match && duration > 0) {
        const seconds =
          Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        onProgress(Math.min(seconds / duration, 1));
      }
    },
  });
  if (result.exitCode !== 0) {
    const tail = result.stderr.trim().split('\n').slice(-3).join(' ');
    throw new Error(`ffmpeg failed: ${tail.slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------------------
// Queueing work
// ---------------------------------------------------------------------------

export interface SplitJobInput {
  /** Home-relative path of the combined file. */
  path: string;
  /** Output name (no extension) and times for each episode. */
  episodes: Array<{ name: string; start: number; end: number }>;
}

export interface SplitJobOptions {
  mode: 'reencode' | 'copy';
  /** Home-relative folder to write into; defaults to a "Split" folder beside each source file. */
  outputDir?: string;
  /** Overwrite a file of the same name instead of failing. */
  overwrite: boolean;
}

export function queueSplit(
  inputs: SplitJobInput[],
  options: SplitJobOptions,
): number {
  let queued = 0;
  for (const input of inputs) {
    const source = resolveInHome(input.path);
    const outDir = options.outputDir
      ? resolveInHome(options.outputDir)
      : path.join(path.dirname(source), 'Split');
    const ext = path.extname(source) || '.mkv';
    const segments = input.episodes.map((e) => ({
      name: sanitizeFilename(e.name),
      segment: { start: e.start, end: e.end } satisfies Segment,
    }));
    if (segments.some((s) => !s.name || !(s.segment.end > s.segment.start))) {
      throw new Error(`Bad episode list for ${input.path}`);
    }
    enqueue('split', path.basename(source), async (task, signal) => {
      await fs.mkdir(outDir, { recursive: true });
      for (let i = 0; i < segments.length; i++) {
        const { name, segment } = segments[i];
        const output = path.join(outDir, `${name}${ext}`);
        if (!options.overwrite) {
          const exists = await fs.stat(output).then(
            () => true,
            () => false,
          );
          if (exists) {
            throw new Error(`${name}${ext} already exists`);
          }
        }
        task.message = `Episode ${i + 1} of ${segments.length}: ${name}`;
        const partial = `${output}.partial${ext}`;
        try {
          await runFfmpeg(
            buildSplitArgs(source, partial, segment, options.mode),
            segment.end - segment.start,
            signal,
            (fraction) => {
              task.progress = (i + fraction) / segments.length;
            },
          );
          await fs.rename(partial, output);
        } catch (error) {
          await fs.rm(partial, { force: true });
          throw error;
        }
      }
      task.message = `Wrote ${segments.length} episodes to ${relativeToHome(outDir) || '.'}`;
    });
    queued++;
  }
  return queued;
}

export function queueTrackCleanup(
  paths: string[],
  options: TrackOptions & { replace: boolean },
): number {
  for (const relative of paths) {
    const source = resolveInHome(relative);
    enqueue('tracks', path.basename(source), async (task, signal) => {
      const info = await probe(source);
      const plan = planTracks(info.streams, options, source);
      if (plan.action === 'skip-no-audio') {
        task.message = `Skipped: ${plan.reason}`;
        return 'skipped';
      }
      if (plan.action === 'already-clean') {
        task.message = plan.reason;
        return 'skipped';
      }
      const output = cleanedPath(source, options.replace);
      try {
        await runFfmpeg(
          buildTrackArgs(source, output, plan),
          info.duration,
          signal,
          (fraction) => {
            task.progress = fraction;
          },
        );
        // Make sure the result is readable before the original is touched.
        await probe(output);
        if (options.replace) await fs.rename(output, source);
      } catch (error) {
        await fs.rm(output, { force: true });
        throw error;
      }
      task.message = `${plan.reason}${options.replace ? ' (original replaced)' : ` (saved as ${path.basename(output)})`}`;
    });
  }
  return paths.length;
}
