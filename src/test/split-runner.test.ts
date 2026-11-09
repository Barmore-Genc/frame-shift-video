/**
 * Tests for the Split page's server side, run against real ffmpeg and ffprobe on small videos
 * made in beforeAll (so they need both programs, as the CI job installs). Nothing is mocked: the
 * assertions read the files that come out.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  cancelTask,
  clearFinished,
  listTasks,
  listVideos,
  previewSplit,
  previewTracks,
  queueSplit,
  queueTrackCleanup,
} from '../../server/split-runner';
import { DEFAULT_TRACK_OPTIONS } from '../../server/split-tools';
import {
  splitCancelHandler,
  splitClearHandler,
  splitPreviewHandler,
  splitRunHandler,
  splitTasksHandler,
  tracksPreviewHandler,
  tracksRunHandler,
} from '../../server/handlers/split';

// Real encodes: give every test and hook room.
setDefaultTimeout(120000);

let home: string;
const realHome = process.env.FRAME_SHIFT_HOME;

function ff(args: string[]) {
  const result = Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', ...args]);
  if (result.exitCode !== 0) {
    throw new Error(`ffmpeg ${args.join(' ')}: ${result.stderr.toString()}`);
  }
}

interface Probed {
  duration: number;
  streams: Array<{ type: string; language?: string; codec?: string }>;
}

function probeFile(file: string): Probed {
  const result = Bun.spawnSync([
    'ffprobe',
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    '-show_format',
    file,
  ]);
  const data = JSON.parse(result.stdout.toString());
  return {
    duration: Number(data.format.duration),
    streams: data.streams.map((s: any) => ({
      type: s.codec_type,
      language: s.tags?.language,
      codec: s.codec_name,
    })),
  };
}

const SRT = '1\n00:00:01,000 --> 00:00:03,000\nHello\n';

/** A video of `parts` joined, each part testsrc or black, at 10 fps and a tiny size. */
function makeCombined(
  out: string,
  parts: Array<'show' | 'black'>,
  seconds: number[],
  extra: string[],
  muxArgs: string[],
) {
  const inputs: string[] = [];
  parts.forEach((kind, i) => {
    inputs.push(
      '-f',
      'lavfi',
      '-i',
      kind === 'black'
        ? `color=black:s=160x120:r=10:d=${seconds[i]}`
        : `testsrc2=s=160x120:r=10:d=${seconds[i]}`,
    );
  });
  const concat = `${parts.map((_, i) => `[${i}:v]`).join('')}concat=n=${parts.length}:v=1:a=0[v]`;
  ff([
    ...inputs,
    ...extra,
    '-filter_complex',
    concat,
    '-map',
    '[v]',
    ...muxArgs,
    out,
  ]);
}

beforeAll(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'split-runner-'));
  process.env.FRAME_SHIFT_HOME = home;
  const dir = (name: string) =>
    fs.mkdir(path.join(home, name), { recursive: true });
  await Promise.all(
    [
      'two',
      'three',
      'noeng',
      'clean',
      'nobreak',
      'mixed',
      'big',
      'numbering',
    ].map(dir),
  );
  const srt = (name: string) => fs.writeFile(path.join(home, name), SRT);
  await Promise.all(['en.srt', 'fr.srt', 'xx.srt'].map(srt));
  const sub = (n: string) => path.join(home, n);

  // Two episodes (150 s each, 3 s black between), mkv, eng+jpn audio, eng/fre/untagged subtitles.
  // Inputs: 0 show, 1 black, 2 show, 3 eng audio, 4 jpn audio, 5-7 subtitles.
  makeCombined(
    path.join(home, 'two/Two.mkv'),
    ['show', 'black', 'show'],
    [148, 3, 149],
    [
      '-f',
      'lavfi',
      '-i',
      'sine=f=440:d=300',
      '-f',
      'lavfi',
      '-i',
      'sine=f=880:d=300',
      '-i',
      sub('en.srt'),
      '-i',
      sub('fr.srt'),
      '-i',
      sub('xx.srt'),
    ],
    [
      '-map',
      '3:a',
      '-map',
      '4:a',
      '-map',
      '5',
      '-map',
      '6',
      '-map',
      '7',
      '-metadata:s:a:0',
      'language=eng',
      '-metadata:s:a:1',
      'language=jpn',
      '-metadata:s:s:0',
      'language=eng',
      '-metadata:s:s:1',
      'language=fre',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-c:a',
      'aac',
      '-c:s',
      'srt',
      '-t',
      '300',
    ],
  );

  // Three episodes (about 138 s each), mp4, eng+jpn audio, mov_text eng+fre subtitles.
  // Inputs: 0-4 parts, 5 eng audio, 6 jpn audio, 7-8 subtitles.
  makeCombined(
    path.join(home, 'three/Three.mp4'),
    ['show', 'black', 'show', 'black', 'show'],
    [138, 3, 138, 3, 138],
    [
      '-f',
      'lavfi',
      '-i',
      'sine=f=440:d=420',
      '-f',
      'lavfi',
      '-i',
      'sine=f=880:d=420',
      '-i',
      sub('en.srt'),
      '-i',
      sub('fr.srt'),
    ],
    [
      '-map',
      '5:a',
      '-map',
      '6:a',
      '-map',
      '7',
      '-map',
      '8',
      '-metadata:s:a:0',
      'language=eng',
      '-metadata:s:a:1',
      'language=jpn',
      '-metadata:s:s:0',
      'language=eng',
      '-metadata:s:s:1',
      'language=fre',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-c:a',
      'aac',
      '-c:s',
      'mov_text',
      '-t',
      '420',
    ],
  );

  // No audio in English: Japanese only, French subtitles.
  ff([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=160x120:r=10:d=20',
    '-f',
    'lavfi',
    '-i',
    'sine=f=440:d=20',
    '-i',
    sub('fr.srt'),
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-map',
    '2',
    '-metadata:s:a:0',
    'language=jpn',
    '-metadata:s:s:0',
    'language=fre',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-c:a',
    'aac',
    '-c:s',
    'srt',
    path.join(home, 'noeng/NoEnglish.mkv'),
  ]);

  // Already only English.
  ff([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=160x120:r=10:d=20',
    '-f',
    'lavfi',
    '-i',
    'sine=f=440:d=20',
    '-i',
    sub('en.srt'),
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-map',
    '2',
    '-metadata:s:a:0',
    'language=eng',
    '-metadata:s:s:0',
    'language=eng',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-c:a',
    'aac',
    '-c:s',
    'srt',
    path.join(home, 'clean/Clean.mkv'),
  ]);

  // 300 s with no black screen anywhere.
  ff([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=160x120:r=10:d=300',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    path.join(home, 'nobreak/NoBreak.mkv'),
  ]);

  // Numbering: good, no break, good (alphabetical order).
  await fs.copyFile(
    path.join(home, 'two/Two.mkv'),
    path.join(home, 'numbering/a.mkv'),
  );
  await fs.copyFile(
    path.join(home, 'nobreak/NoBreak.mkv'),
    path.join(home, 'numbering/b.mkv'),
  );
  await fs.copyFile(
    path.join(home, 'two/Two.mkv'),
    path.join(home, 'numbering/c.mkv'),
  );

  // A mixed folder: other file types and leftovers that must not be listed.
  await fs.writeFile(path.join(home, 'mixed/notes.txt'), 'x');
  await fs.writeFile(path.join(home, 'mixed/Show.mkv'), 'x');
  await fs.writeFile(path.join(home, 'mixed/Show.cleaned.mkv'), 'x');
  await fs.writeFile(path.join(home, 'mixed/Show.fs-temp.mkv'), 'x');
  await fs.writeFile(path.join(home, 'mixed/Ep.mkv.partial.mkv'), 'x');
  await fs.writeFile(path.join(home, 'mixed/.hidden.mkv'), 'x');
  await fs.writeFile(path.join(home, 'mixed/clip.MP4'), 'x');

  // 720p source for a split long enough to cancel while it runs.
  ff([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=1280x720:r=25:d=240',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    path.join(home, 'big/Big.mkv'),
  ]);
}, 300000);

afterAll(async () => {
  process.env.FRAME_SHIFT_HOME = realHome;
  if (realHome === undefined) delete process.env.FRAME_SHIFT_HOME;
  await fs.rm(home, { recursive: true, force: true });
});

async function idle(timeout = 120000) {
  const end = Date.now() + timeout;
  while (
    listTasks().some((t) => t.status === 'queued' || t.status === 'running')
  ) {
    if (Date.now() > end) throw new Error('tasks did not finish');
    await Bun.sleep(100);
  }
}

afterEach(async () => {
  for (const task of listTasks()) cancelTask(task.id);
  await idle();
  clearFinished();
  for (const folder of ['two/Split', 'three/out', 'big/Split', 'noeng/Split']) {
    await fs.rm(path.join(home, folder), { recursive: true, force: true });
  }
});

const exists = (rel: string) =>
  fs.stat(path.join(home, rel)).then(
    () => true,
    () => false,
  );

function post(body: unknown): Request {
  return new Request('http://x/api', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('listVideos', () => {
  test('lists only real video files, not leftovers or hidden files', async () => {
    const files = await listVideos(path.join(home, 'mixed'));
    expect(files.map((f) => path.basename(f)).sort()).toEqual([
      'Show.mkv',
      'clip.MP4',
    ]);
  });
  test('a single video file is listed as itself, a text file is not', async () => {
    expect(await listVideos(path.join(home, 'two/Two.mkv'))).toHaveLength(1);
    expect(await listVideos(path.join(home, 'mixed/notes.txt'))).toEqual([]);
  });
});

describe('previewSplit', () => {
  test('finds the one break in a two-episode file', async () => {
    const preview = await previewSplit(path.join(home, 'two/Two.mkv'), 2, 6);
    expect(preview.plan.complete).toBe(true);
    expect(preview.plan.segments).toHaveLength(2);
    expect(preview.plan.boundaries[0].start).toBeCloseTo(148, 0);
    expect(preview.duration).toBeCloseTo(300, 0);
  });
  test('finds both breaks in a three-episode mp4', async () => {
    const preview = await previewSplit(
      path.join(home, 'three/Three.mp4'),
      3,
      6,
    );
    expect(preview.plan.complete).toBe(true);
    expect(preview.plan.boundaries.map((b) => Math.round(b.start))).toEqual([
      138, 279,
    ]);
    expect(preview.plan.segments).toHaveLength(3);
  });
  test('a file with no black screen is not cut', async () => {
    const preview = await previewSplit(
      path.join(home, 'nobreak/NoBreak.mkv'),
      2,
      6,
    );
    expect(preview.plan.complete).toBe(false);
    expect(preview.plan.segments).toEqual([]);
    expect(preview.plan.warning).toContain('0 of 1');
  });
  test('asking for more episodes than there are breaks is not cut', async () => {
    const preview = await previewSplit(path.join(home, 'two/Two.mkv'), 3, 6);
    expect(preview.plan.complete).toBe(false);
  });
});

describe('queueSplit', () => {
  test('re-encode cuts real episodes of the planned length, keeping audio and subtitles', async () => {
    const preview = await previewSplit(path.join(home, 'two/Two.mkv'), 2, 6);
    queueSplit(
      [
        {
          path: 'two/Two.mkv',
          episodes: preview.plan.segments.map((s, i) => ({
            name: `S01E0${i + 1} - Part`,
            ...s,
          })),
        },
      ],
      { mode: 'reencode', overwrite: false },
    );
    await idle();
    expect(listTasks()[0]).toMatchObject({ status: 'done', progress: 1 });
    const first = probeFile(path.join(home, 'two/Split/S01E01 - Part.mkv'));
    const second = probeFile(path.join(home, 'two/Split/S01E02 - Part.mkv'));
    expect(first.duration).toBeCloseTo(148.24, 0);
    expect(second.duration).toBeCloseTo(300 - 150.76, 0);
    for (const ep of [first, second]) {
      expect(ep.streams.filter((s) => s.type === 'video')).toHaveLength(1);
      expect(
        ep.streams.filter((s) => s.type === 'audio').map((s) => s.language),
      ).toEqual(['eng', 'jpn']);
      expect(ep.streams.filter((s) => s.type === 'subtitle')).toHaveLength(3);
    }
    // No half-written files left behind.
    expect((await fs.readdir(path.join(home, 'two/Split'))).sort()).toEqual([
      'S01E01 - Part.mkv',
      'S01E02 - Part.mkv',
    ]);
  });

  test('copy mode cuts an mp4 into three episodes and keeps its tracks', async () => {
    const preview = await previewSplit(
      path.join(home, 'three/Three.mp4'),
      3,
      6,
    );
    queueSplit(
      [
        {
          path: 'three/Three.mp4',
          episodes: preview.plan.segments.map((s, i) => ({
            name: `E${i + 1}`,
            ...s,
          })),
        },
      ],
      { mode: 'copy', outputDir: 'three/out', overwrite: false },
    );
    await idle();
    expect(listTasks()[0].status).toBe('done');
    const durations = [];
    for (const n of [1, 2, 3]) {
      const ep = probeFile(path.join(home, `three/out/E${n}.mp4`));
      durations.push(ep.duration);
      expect(ep.streams.filter((s) => s.type === 'audio')).toHaveLength(2);
      expect(ep.streams.filter((s) => s.type === 'subtitle')).toHaveLength(2);
    }
    // Copy cuts land on keyframes, so allow a few seconds either way.
    durations.forEach((d) => expect(Math.abs(d - 140)).toBeLessThan(6));
  });

  test('refuses to overwrite, leaves the old file alone and cleans up', async () => {
    await fs.mkdir(path.join(home, 'two/Split'), { recursive: true });
    await fs.writeFile(path.join(home, 'two/Split/Keep.mkv'), 'precious');
    queueSplit(
      [
        {
          path: 'two/Two.mkv',
          episodes: [{ name: 'Keep', start: 0, end: 10 }],
        },
      ],
      { mode: 'copy', overwrite: false },
    );
    await idle();
    expect(listTasks()[0]).toMatchObject({ status: 'failed' });
    expect(listTasks()[0].message).toContain('already exists');
    expect(
      await fs.readFile(path.join(home, 'two/Split/Keep.mkv'), 'utf8'),
    ).toBe('precious');
    expect(await fs.readdir(path.join(home, 'two/Split'))).toEqual([
      'Keep.mkv',
    ]);
  });

  test('overwrites when asked', async () => {
    await fs.mkdir(path.join(home, 'two/Split'), { recursive: true });
    await fs.writeFile(path.join(home, 'two/Split/Keep.mkv'), 'old');
    queueSplit(
      [
        {
          path: 'two/Two.mkv',
          episodes: [{ name: 'Keep', start: 0, end: 10 }],
        },
      ],
      { mode: 'copy', overwrite: true },
    );
    await idle();
    expect(listTasks()[0].status).toBe('done');
    expect(
      probeFile(path.join(home, 'two/Split/Keep.mkv')).duration,
    ).toBeGreaterThan(5);
  });

  test('a failing ffmpeg marks the task failed and leaves no partial file', async () => {
    await fs.writeFile(path.join(home, 'noeng/broken.mkv'), 'not a video');
    queueSplit(
      [
        {
          path: 'noeng/broken.mkv',
          episodes: [{ name: 'X', start: 0, end: 5 }],
        },
      ],
      { mode: 'copy', overwrite: false },
    );
    await idle();
    expect(listTasks()[0].status).toBe('failed');
    expect(listTasks()[0].message).toContain('ffmpeg failed');
    expect(await fs.readdir(path.join(home, 'noeng/Split'))).toEqual([]);
  });

  test('rejects bad input before queueing anything', () => {
    const run = (input: any) => () =>
      queueSplit([input], { mode: 'copy', overwrite: false });
    expect(
      run({
        path: '../outside.mkv',
        episodes: [{ name: 'X', start: 0, end: 1 }],
      }),
    ).toThrow('outside');
    expect(
      run({ path: 'two/Two.mkv', episodes: [{ name: 'X', start: 5, end: 5 }] }),
    ).toThrow('Bad episode');
    expect(
      run({ path: 'two/Two.mkv', episodes: [{ name: '', start: 0, end: 5 }] }),
    ).toThrow('Bad episode');
    expect(listTasks()).toEqual([]);
  });

  test('an episode name cannot write outside the output folder', async () => {
    queueSplit(
      [
        {
          path: 'two/Two.mkv',
          episodes: [{ name: '../../escape', start: 0, end: 5 }],
        },
      ],
      { mode: 'copy', overwrite: false },
    );
    await idle();
    expect(await exists('escape.mkv')).toBe(false);
    expect(await exists('two/escape.mkv')).toBe(false);
    expect(await exists('two/Split/..-..-escape.mkv')).toBe(true);
  });

  test('a running split can be cancelled and leaves nothing behind', async () => {
    queueSplit(
      [
        {
          path: 'big/Big.mkv',
          episodes: [{ name: 'Long', start: 0, end: 230 }],
        },
      ],
      { mode: 'reencode', overwrite: false },
    );
    const id = listTasks()[0].id;
    const end = Date.now() + 30000;
    while (
      listTasks()[0].status !== 'running' ||
      listTasks()[0].progress <= 0
    ) {
      if (Date.now() > end) throw new Error('never started');
      await Bun.sleep(50);
    }
    expect(cancelTask(id)).toBe(true);
    await idle();
    expect(listTasks()[0]).toMatchObject({
      status: 'cancelled',
      message: 'Cancelled',
    });
    expect(await fs.readdir(path.join(home, 'big/Split'))).toEqual([]);
  }, 60000);

  test('a queued task can be cancelled before it starts, and never runs', async () => {
    queueSplit(
      [
        {
          path: 'big/Big.mkv',
          episodes: [{ name: 'First', start: 0, end: 230 }],
        },
      ],
      { mode: 'reencode', overwrite: false },
    );
    queueSplit(
      [
        {
          path: 'two/Two.mkv',
          episodes: [{ name: 'Second', start: 0, end: 5 }],
        },
      ],
      { mode: 'copy', overwrite: false },
    );
    const [first, second] = listTasks();
    expect(second.status).toBe('queued');
    expect(cancelTask(second.id)).toBe(true);
    cancelTask(first.id);
    await idle();
    expect(listTasks().map((t) => t.status)).toEqual([
      'cancelled',
      'cancelled',
    ]);
    expect(await exists('two/Split/Second.mkv')).toBe(false);
  }, 60000);

  test('tasks run one at a time, in order', async () => {
    for (const name of ['A', 'B']) {
      queueSplit(
        [{ path: 'two/Two.mkv', episodes: [{ name, start: 0, end: 20 }] }],
        { mode: 'copy', overwrite: true },
      );
    }
    const seen: string[] = [];
    while (listTasks().some((t) => t.status !== 'done')) {
      seen.push(
        listTasks()
          .map((t) => t.status)
          .join(','),
      );
      await Bun.sleep(5);
    }
    expect(seen.some((s) => s === 'running,running')).toBe(false);
  });
});

describe('cancelTask and clearFinished', () => {
  test('cancelling a finished or unknown task does nothing', async () => {
    queueSplit(
      [{ path: 'two/Two.mkv', episodes: [{ name: 'Z', start: 0, end: 5 }] }],
      { mode: 'copy', overwrite: true },
    );
    await idle();
    expect(cancelTask(listTasks()[0].id)).toBe(false);
    expect(listTasks()[0].status).toBe('done');
    expect(cancelTask('nope')).toBe(false);
  });
  test('clearFinished forgets only finished tasks', async () => {
    queueSplit(
      [{ path: 'two/Two.mkv', episodes: [{ name: 'Z', start: 0, end: 5 }] }],
      { mode: 'copy', overwrite: true },
    );
    await idle();
    queueSplit(
      [
        {
          path: 'big/Big.mkv',
          episodes: [{ name: 'Long', start: 0, end: 230 }],
        },
      ],
      { mode: 'reencode', overwrite: false },
    );
    expect(clearFinished()).toBe(1);
    expect(listTasks()).toHaveLength(1);
    expect(listTasks()[0].label).toBe('Big.mkv');
  });
});

describe('track cleanup', () => {
  const kinds = (file: string) => {
    const p = probeFile(file);
    return {
      audio: p.streams.filter((s) => s.type === 'audio').map((s) => s.language),
      subs: p.streams
        .filter((s) => s.type === 'subtitle')
        .map((s) => s.language),
      video: p.streams.filter((s) => s.type === 'video').length,
    };
  };

  test('previews which tracks go', async () => {
    const preview = await previewTracks(
      path.join(home, 'two/Two.mkv'),
      DEFAULT_TRACK_OPTIONS,
    );
    expect(preview.plan.action).toBe('clean');
    expect(preview.plan.removeAudio).toHaveLength(1);
    expect(preview.plan.removeSubtitles).toHaveLength(2);
  });

  test('writes a .cleaned copy with only English, and leaves the original alone', async () => {
    const before = await fs.readFile(path.join(home, 'two/Two.mkv'));
    queueTrackCleanup(['two/Two.mkv'], {
      ...DEFAULT_TRACK_OPTIONS,
      replace: false,
    });
    await idle();
    expect(listTasks()[0].status).toBe('done');
    expect(kinds(path.join(home, 'two/Two.cleaned.mkv'))).toEqual({
      audio: ['eng'],
      subs: ['eng'],
      video: 1,
    });
    expect(
      probeFile(path.join(home, 'two/Two.cleaned.mkv')).duration,
    ).toBeCloseTo(300, 0);
    expect(
      (await fs.readFile(path.join(home, 'two/Two.mkv'))).equals(before),
    ).toBe(true);
    await fs.rm(path.join(home, 'two/Two.cleaned.mkv'));
  });

  test('works on an mp4 with text subtitles', async () => {
    queueTrackCleanup(['three/Three.mp4'], {
      ...DEFAULT_TRACK_OPTIONS,
      replace: false,
    });
    await idle();
    expect(listTasks()[0].status).toBe('done');
    expect(kinds(path.join(home, 'three/Three.cleaned.mp4'))).toEqual({
      audio: ['eng'],
      subs: ['eng'],
      video: 1,
    });
    await fs.rm(path.join(home, 'three/Three.cleaned.mp4'));
  });

  test('replace swaps in the cleaned file and leaves no temporary file', async () => {
    await fs.copyFile(
      path.join(home, 'two/Two.mkv'),
      path.join(home, 'two/Replace.mkv'),
    );
    queueTrackCleanup(['two/Replace.mkv'], {
      ...DEFAULT_TRACK_OPTIONS,
      replace: true,
    });
    await idle();
    expect(listTasks()[0].status).toBe('done');
    expect(listTasks()[0].message).toContain('original replaced');
    expect(kinds(path.join(home, 'two/Replace.mkv')).audio).toEqual(['eng']);
    expect(await exists('two/Replace.fs-temp.mkv')).toBe(false);
    await fs.rm(path.join(home, 'two/Replace.mkv'));
  });

  test('a file with no English audio is skipped and not touched', async () => {
    const before = await fs.readFile(path.join(home, 'noeng/NoEnglish.mkv'));
    queueTrackCleanup(['noeng/NoEnglish.mkv'], {
      ...DEFAULT_TRACK_OPTIONS,
      replace: true,
    });
    await idle();
    expect(listTasks()[0]).toMatchObject({ status: 'skipped' });
    expect(listTasks()[0].message).toContain('No audio');
    expect(
      (await fs.readFile(path.join(home, 'noeng/NoEnglish.mkv'))).equals(
        before,
      ),
    ).toBe(true);
    expect(await exists('noeng/NoEnglish.fs-temp.mkv')).toBe(false);
    expect(await exists('noeng/NoEnglish.cleaned.mkv')).toBe(false);
  });

  test('keeping Japanese instead rewrites that same file', async () => {
    queueTrackCleanup(['noeng/NoEnglish.mkv'], {
      ...DEFAULT_TRACK_OPTIONS,
      keepLanguages: ['jpn'],
      replace: false,
    });
    await idle();
    expect(listTasks()[0].status).toBe('done');
    expect(kinds(path.join(home, 'noeng/NoEnglish.cleaned.mkv'))).toEqual({
      audio: ['jpn'],
      subs: [],
      video: 1,
    });
    await fs.rm(path.join(home, 'noeng/NoEnglish.cleaned.mkv'));
  });

  test('an already clean file is skipped', async () => {
    queueTrackCleanup(['clean/Clean.mkv'], {
      ...DEFAULT_TRACK_OPTIONS,
      replace: true,
    });
    await idle();
    expect(listTasks()[0]).toMatchObject({
      status: 'skipped',
      message: 'Already clean',
    });
    expect(await exists('clean/Clean.cleaned.mkv')).toBe(false);
  });

  test('if ffmpeg claims success but the result is unreadable, the original is kept', async () => {
    await fs.copyFile(
      path.join(home, 'two/Two.mkv'),
      path.join(home, 'two/Guard.mkv'),
    );
    const before = await fs.readFile(path.join(home, 'two/Guard.mkv'));
    const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'fake-ffmpeg-'));
    // A stand-in ffmpeg that exits 0 after writing junk to the last argument (the output file).
    await fs.writeFile(
      path.join(bin, 'ffmpeg'),
      '#!/bin/sh\nfor last; do :; done\necho junk > "$last"\nexit 0\n',
      { mode: 0o755 },
    );
    const realPath = process.env.PATH;
    process.env.PATH = `${bin}:${realPath}`;
    try {
      queueTrackCleanup(['two/Guard.mkv'], {
        ...DEFAULT_TRACK_OPTIONS,
        replace: true,
      });
      await idle();
    } finally {
      process.env.PATH = realPath;
      await fs.rm(bin, { recursive: true, force: true });
    }
    expect(listTasks()[0].status).toBe('failed');
    expect(
      (await fs.readFile(path.join(home, 'two/Guard.mkv'))).equals(before),
    ).toBe(true);
    expect(await exists('two/Guard.fs-temp.mkv')).toBe(false);
    await fs.rm(path.join(home, 'two/Guard.mkv'));
  });

  test('a broken file fails without leaving a temporary file', async () => {
    await fs.writeFile(path.join(home, 'clean/broken.mkv'), 'junk');
    queueTrackCleanup(['clean/broken.mkv'], {
      ...DEFAULT_TRACK_OPTIONS,
      replace: true,
    });
    await idle();
    expect(listTasks()[0].status).toBe('failed');
    expect(await fs.readFile(path.join(home, 'clean/broken.mkv'), 'utf8')).toBe(
      'junk',
    );
    expect(await exists('clean/broken.fs-temp.mkv')).toBe(false);
  });

  test('refuses a path outside the home folder', () => {
    expect(() =>
      queueTrackCleanup(['../x.mkv'], {
        ...DEFAULT_TRACK_OPTIONS,
        replace: false,
      }),
    ).toThrow('outside');
  });
});

describe('handlers', () => {
  const cors = {};
  const body = async (r: Response) => ({
    status: r.status,
    ...(await r.json()),
  });

  test('preview needs a path, stays inside home and needs videos', async () => {
    expect(await body(await splitPreviewHandler(post({}), cors))).toMatchObject(
      { status: 400 },
    );
    expect(
      await body(await splitPreviewHandler(post({ path: '../..' }), cors)),
    ).toMatchObject({
      status: 400,
      error: expect.stringContaining('outside'),
    });
    expect(
      await body(
        await splitPreviewHandler(post({ path: 'nobreak/none' }), cors),
      ),
    ).toMatchObject({
      status: 400,
    });
    await fs.mkdir(path.join(home, 'empty'), { recursive: true });
    expect(
      await body(await splitPreviewHandler(post({ path: 'empty' }), cors)),
    ).toMatchObject({
      status: 400,
      error: 'No video files there',
    });
  });

  test('preview names episodes with the season, first number, show and titles', async () => {
    const result = await body(
      await splitPreviewHandler(
        post({
          path: 'two/Two.mkv',
          episodesPerFile: 2,
          frameOffset: 6,
          season: 3,
          startEpisode: 7,
          show: 'My Show',
          titles: '1. Alpha: One\n2. Beta!',
        }),
        cors,
      ),
    );
    expect(result.status).toBe(200);
    expect(result.files[0].episodes.map((e: any) => e.name)).toEqual([
      'My Show - S03E07 - Alpha- One',
      'My Show - S03E08 - Beta',
    ]);
  });

  test('season 0 and episode 0 are kept, not turned into 1', async () => {
    const result = await body(
      await splitPreviewHandler(
        post({
          path: 'two/Two.mkv',
          episodesPerFile: 2,
          frameOffset: 6,
          season: 0,
          startEpisode: 0,
        }),
        cors,
      ),
    );
    expect(result.files[0].episodes.map((e: any) => e.name)).toEqual([
      'S00E00',
      'S00E01',
    ]);
  });

  test('a file that cannot be split does not shift the numbers of the files after it', async () => {
    const result = await body(
      await splitPreviewHandler(
        post({
          path: 'numbering',
          episodesPerFile: 2,
          frameOffset: 6,
          season: 1,
          startEpisode: 1,
        }),
        cors,
      ),
    );
    expect(result.files.map((f: any) => f.path)).toEqual([
      'numbering/a.mkv',
      'numbering/b.mkv',
      'numbering/c.mkv',
    ]);
    expect(result.files[1].episodes).toEqual([]);
    expect(result.files[0].episodes.map((e: any) => e.name)).toEqual([
      'S01E01',
      'S01E02',
    ]);
    expect(result.files[2].episodes.map((e: any) => e.name)).toEqual([
      'S01E05',
      'S01E06',
    ]);
  });

  test('run validates its body and reports path errors', async () => {
    expect(await body(await splitRunHandler(post({}), cors))).toMatchObject({
      status: 400,
    });
    expect(
      await body(
        await splitRunHandler(
          post({
            files: [
              { path: '../x.mkv', episodes: [{ name: 'a', start: 0, end: 1 }] },
            ],
          }),
          cors,
        ),
      ),
    ).toMatchObject({ status: 400, error: expect.stringContaining('outside') });
  });

  test('run queues work that tasks then shows', async () => {
    const run = await body(
      await splitRunHandler(
        post({
          files: [
            {
              path: 'two/Two.mkv',
              episodes: [{ name: 'H1', start: 0, end: 5 }],
            },
          ],
          mode: 'copy',
          overwrite: true,
        }),
        cors,
      ),
    );
    expect(run).toMatchObject({ status: 200, queued: 1 });
    await idle();
    const tasks = await body(
      await splitTasksHandler(new Request('http://x'), cors),
    );
    expect(tasks.tasks[0]).toMatchObject({
      kind: 'split',
      status: 'done',
      label: 'Two.mkv',
    });
    const cleared = await body(await splitClearHandler(post({}), cors));
    expect(cleared.cleared).toBe(1);
  });

  test('tracks preview and run take languages and flags from the body', async () => {
    const preview = await body(
      await tracksPreviewHandler(
        post({ path: 'two', languages: 'jpn, English' }),
        cors,
      ),
    );
    const two = preview.files.find((f: any) => f.path === 'two/Two.mkv');
    expect(two.plan.removeAudio).toEqual([]);
    // jpn and English audio both stay; the French and untagged subtitles go.
    expect(two.plan.removeSubtitles).toHaveLength(2);
    const missing = await body(await tracksPreviewHandler(post({}), cors));
    expect(missing.status).toBe(400);
    expect((await body(await tracksRunHandler(post({}), cors))).status).toBe(
      400,
    );
    expect(
      (await body(await tracksRunHandler(post({ paths: ['../a'] }), cors)))
        .status,
    ).toBe(400);
  });

  test('tracks run leaves the original alone unless replace is asked for', async () => {
    const before = await fs.readFile(path.join(home, 'two/Two.mkv'));
    const res = await body(
      await tracksRunHandler(post({ paths: ['two/Two.mkv'] }), cors),
    );
    expect(res).toMatchObject({ status: 200, queued: 1 });
    await idle();
    expect(
      (await fs.readFile(path.join(home, 'two/Two.mkv'))).equals(before),
    ).toBe(true);
    expect(await exists('two/Two.cleaned.mkv')).toBe(true);
    await fs.rm(path.join(home, 'two/Two.cleaned.mkv'));
  });

  test('cancel answers 404 for an unknown task and 200 for a real one', async () => {
    expect(
      (await body(await splitCancelHandler(post({ id: 'nope' }), cors))).status,
    ).toBe(404);
    expect((await body(await splitCancelHandler(post({}), cors))).status).toBe(
      404,
    );
    queueSplit(
      [{ path: 'big/Big.mkv', episodes: [{ name: 'L', start: 0, end: 230 }] }],
      { mode: 'reencode', overwrite: false },
    );
    const id = listTasks()[0].id;
    expect(
      await body(await splitCancelHandler(post({ id }), cors)),
    ).toMatchObject({
      status: 200,
      cancelled: true,
    });
  }, 30000);
});
