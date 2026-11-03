import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import {
  cleanSubtitlePath,
  dismissSubtitles,
  isExtra,
  readSubtitlesState,
  requestClean,
  requestClearOldCopies,
  requestDropPictures,
  requestDropTrack,
  requestRestore,
  requestSubtitles,
  setSubtitlesAuto,
} from '../../server/subtitles-state';
import { describeTrack, movieName } from '../components/subtitles-section';

let dir: string;

async function write(relative: string, text: string) {
  const file = path.join(dir, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

const DUMA = 'Duma (2005)/Duma (2005).mkv';
const HERO = "Everyone's Hero (2006)/Everyone's Hero (2006).mkv";

async function writeIndex() {
  await write(
    '_subs/index.json',
    JSON.stringify({
      updated: 1000,
      files: [
        {
          path: DUMA,
          size: 1,
          mtime: 1,
          tracks: [
            {
              language: 'eng',
              codec: 'picture',
              name: '',
              default: true,
              forced: false,
            },
            {
              language: 'fre',
              codec: 'picture',
              name: '',
              default: false,
              forced: false,
            },
          ],
        },
        {
          path: HERO,
          size: 1,
          mtime: 1,
          tracks: [
            {
              language: 'eng',
              codec: 'S_TEXT/UTF8',
              name: 'English',
              default: true,
              forced: false,
            },
          ],
        },
        { path: 'Odd/odd.mkv', size: 1, mtime: 1, tracks: [] },
      ],
    }),
  );
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subs-test-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('the subtitles state', () => {
  test('is not available until the converter has listed the movies', async () => {
    const state = await readSubtitlesState(dir);
    expect(state.available).toBe(false);
    expect(state.files).toEqual([]);
    expect(state.auto).toBe(true);
    expect(state.current).toBeNull();
  });

  test('lists each file with how many picture tracks it has', async () => {
    await writeIndex();
    const state = await readSubtitlesState(dir);
    expect(state.available).toBe(true);
    expect(state.updated).toBe(1000);
    expect(state.files.map((f) => [f.path, f.pictures, f.status])).toEqual([
      [DUMA, 2, null],
      [HERO, 0, null],
    ]);
  });

  test('says which file is being converted and which are waiting', async () => {
    await writeIndex();
    await write(
      '_subs/current.json',
      JSON.stringify({
        path: DUMA,
        step: 'Reading the subtitles',
        done: 1,
        total: 4,
      }),
    );
    await write('_subs/queue/abc.req', `path=${HERO}\nat=5\n`);
    const state = await readSubtitlesState(dir);
    expect(state.current).toEqual({
      path: DUMA,
      step: 'Reading the subtitles',
      done: 1,
      total: 4,
    });
    expect(state.files[0]?.status).toBe('converting');
    expect(state.files[1]?.status).toBe('queued');
  });

  test('keeps the words that were corrected, and ignores a details field that is not a list', async () => {
    await writeIndex();
    await write(
      '_subs/done/a.json',
      JSON.stringify({
        path: DUMA,
        ok: true,
        message: 'ok',
        at: 1,
        details: ['commetion → commotion', 7, 'broccoll → broccoli'],
      }),
    );
    await write(
      '_subs/done/b.json',
      JSON.stringify({
        path: HERO,
        ok: true,
        message: 'ok',
        at: 2,
        details: 'x',
      }),
    );
    await write(
      '_subs/done/c.json',
      JSON.stringify({ path: HERO, ok: true, message: 'ok', at: 3 }),
    );
    const state = await readSubtitlesState(dir);
    const byAt = Object.fromEntries(state.recent.map((r) => [r.at, r.details]));
    expect(byAt[1]).toEqual(['commetion → commotion', 'broccoll → broccoli']);
    expect(byAt[2]).toEqual([]);
    expect(byAt[3]).toEqual([]);
  });

  test('keeps what was done, newest first', async () => {
    await writeIndex();
    await write(
      '_subs/done/a.json',
      JSON.stringify({ path: DUMA, ok: true, message: 'ok', at: 100 }),
    );
    await write(
      '_subs/done/b.json',
      JSON.stringify({ path: HERO, ok: false, message: 'broke', at: 200 }),
    );
    await write('_subs/done/c.json', 'not json');
    const state = await readSubtitlesState(dir);
    expect(state.recent.map((r) => [r.path, r.ok, r.at])).toEqual([
      [HERO, false, 200],
      [DUMA, true, 100],
    ]);
  });

  test('converting new discs is on unless it was switched off', async () => {
    expect((await readSubtitlesState(dir)).auto).toBe(true);
    await setSubtitlesAuto(dir, false);
    expect((await readSubtitlesState(dir)).auto).toBe(false);
    expect(await fs.readFile(path.join(dir, '_settings', 'subs'), 'utf8')).toBe(
      '0\n',
    );
    await setSubtitlesAuto(dir, true);
    expect((await readSubtitlesState(dir)).auto).toBe(true);
  });
});

describe('asking for a conversion', () => {
  test('only movie files inside the folder can be asked for', () => {
    expect(cleanSubtitlePath(DUMA)).toBe(DUMA);
    for (const bad of [
      '',
      '/etc/x.mkv',
      '../x.mkv',
      'a/../b.mkv',
      '_subs/x.mkv',
      'a/b.txt',
      'a//b.mkv',
      'a\\b.mkv',
      7,
      null,
    ]) {
      expect(() => cleanSubtitlePath(bad)).toThrow();
    }
  });

  test('one file makes one request, however often it is asked for', async () => {
    await writeIndex();
    expect(await requestSubtitles(dir, { path: DUMA })).toBe(1);
    expect(await requestSubtitles(dir, { path: DUMA })).toBe(1);
    const names = await fs.readdir(path.join(dir, '_subs', 'queue'));
    expect(names).toHaveLength(1);
    const text = await fs.readFile(
      path.join(dir, '_subs', 'queue', names[0] as string),
      'utf8',
    );
    expect(text.split('\n')).toContain(`path=${DUMA}`);
  });

  test('the queue folder and the request are open to the converter, which is another user', async () => {
    await writeIndex();
    await requestSubtitles(dir, { path: DUMA });
    const folder = path.join(dir, '_subs', 'queue');
    expect((await fs.stat(folder)).mode & 0o777).toBe(0o777);
    const [name] = await fs.readdir(folder);
    expect(
      (await fs.stat(path.join(folder, name as string))).mode & 0o666,
    ).toBe(0o666);
  });

  test('the request has the name the converter gives it', async () => {
    await writeIndex();
    await requestSubtitles(dir, { path: DUMA });
    // md5 of the relative path, first 12 characters, as disc-subs --enqueue makes it.
    const { createHash } = await import('crypto');
    const name = `${createHash('md5').update(DUMA).digest('hex').slice(0, 12)}.req`;
    expect(await fs.readdir(path.join(dir, '_subs', 'queue'))).toEqual([name]);
  });

  test('a file that is not listed, or has no picture subtitles, is refused', async () => {
    await writeIndex();
    await expect(
      requestSubtitles(dir, { path: 'Nope/nope.mkv' }),
    ).rejects.toThrow('not in the list');
    await expect(requestSubtitles(dir, { path: HERO })).rejects.toThrow(
      'no picture subtitles',
    );
  });

  test('all asks for every file that has picture subtitles and is not already waiting', async () => {
    await writeIndex();
    await write('_subs/queue/x.req', `path=${DUMA}\nat=1\n`);
    expect(await requestSubtitles(dir, { all: true })).toBe(0);
    await fs.rm(path.join(dir, '_subs', 'queue', 'x.req'));
    expect(await requestSubtitles(dir, { all: true })).toBe(1);
    expect(await requestSubtitles(dir, { all: true })).toBe(0);
  });
});

describe('what is listed', () => {
  test('files with no subtitle tracks and movie extras are left out', async () => {
    await write(
      '_subs/index.json',
      JSON.stringify({
        updated: 1,
        files: [
          {
            path: 'Odd/odd.mkv',
            tracks: [],
          },
          {
            path: 'Movie (2000)/Other/Extra 01 (2 min).mkv',
            tracks: [
              {
                language: 'eng',
                codec: 'picture',
                name: '',
                default: false,
                forced: false,
              },
            ],
          },
          {
            path: 'Movie (2000)/Movie (2000).mkv',
            tracks: [
              {
                language: 'eng',
                codec: 'picture',
                name: '',
                default: false,
                forced: false,
              },
            ],
          },
        ],
      }),
    );
    const state = await readSubtitlesState(dir);
    expect(state.files.map((f) => f.path)).toEqual([
      'Movie (2000)/Movie (2000).mkv',
    ]);
    expect(isExtra('A (1)/Featurettes/x.mkv')).toBe(true);
    expect(isExtra('A (1)/A (1).mkv')).toBe(false);
  });
});

describe('cleaning converted text', () => {
  test('a file that needs it is asked for by a recheck request, not a conversion', async () => {
    await write(
      '_subs/index.json',
      JSON.stringify({
        updated: 1,
        files: [
          {
            path: HERO,
            needs_clean: true,
            tracks: [
              {
                language: 'eng',
                codec: 'S_TEXT/UTF8',
                name: '',
                default: true,
                forced: false,
              },
            ],
          },
        ],
      }),
    );
    expect((await readSubtitlesState(dir)).files[0]?.needsClean).toBe(true);
    expect(await requestClean(dir, { all: true })).toBe(1);
    const queue = path.join(dir, '_subs', 'queue');
    const names = await fs.readdir(queue);
    const text = await fs.readFile(
      path.join(queue, names[0] as string),
      'utf8',
    );
    expect(text).toContain('action=recheck\n');
    expect(text).toContain(`path=${HERO}\n`);
    expect((await readSubtitlesState(dir)).files[0]?.status).toBe('queued');
    expect(await requestClean(dir, { all: true })).toBe(0);
  });
});

describe('movies in the folder for finished discs', () => {
  const FINISHED = '_converted/Rebound (2005)/Rebound (2005).mkv';
  const text = {
    language: 'eng',
    codec: 'S_TEXT/UTF8',
    name: '',
    default: true,
    forced: false,
  };
  const picture = { ...text, codec: 'picture' };

  async function writeFinished(output = '_converted') {
    const path = FINISHED.replace('_converted', output);
    await write(
      '_subs/index.json',
      JSON.stringify({
        updated: 1000,
        files: [
          { path, size: 1, mtime: 1, tracks: [text], needs_clean: true },
          { path: DUMA, size: 1, mtime: 1, tracks: [text], needs_clean: true },
          {
            path: path.replace('Rebound (2005).mkv', 'Pic.mkv'),
            size: 1,
            mtime: 1,
            tracks: [picture],
          },
        ],
      }),
    );
    return path;
  }

  test('the finished folder is allowed, other folders starting with _ are not', () => {
    expect(cleanSubtitlePath(FINISHED)).toBe(FINISHED);
    expect(cleanSubtitlePath('_mine/a/a.mkv', '_mine')).toBe('_mine/a/a.mkv');
    expect(() => cleanSubtitlePath(FINISHED, '_mine')).toThrow();
    expect(() => cleanSubtitlePath('_subs/a/a.mkv')).toThrow();
  });

  test('fixing every typo, and converting every picture, covers the finished folder too', async () => {
    const finished = await writeFinished();
    expect(await requestClean(dir, { all: true })).toBe(2);
    expect(await requestSubtitles(dir, { all: true })).toBe(1);
    const queue = await fs.readdir(path.join(dir, '_subs', 'queue'));
    expect(queue).toHaveLength(3);
    const state = await readSubtitlesState(dir);
    expect(state.files.find((f) => f.path === finished)?.status).toBe('queued');
  });

  test('one file there can be asked for, and its output folder can be renamed', async () => {
    await write('_settings/output', 'Done');
    const finished = await writeFinished('Done');
    expect(await requestClean(dir, { path: finished })).toBe(1);
  });
});

describe('progress through a run of requests', () => {
  const text = {
    language: 'eng',
    codec: 'S_TEXT/UTF8',
    name: '',
    default: true,
    forced: false,
  };
  const names = ['A', 'B', 'C', 'D'].map((n) => `${n}/${n}.mkv`);

  async function writeMany() {
    await write(
      '_subs/index.json',
      JSON.stringify({
        updated: 1,
        files: names.map((path) => ({
          path,
          size: 1,
          mtime: 1,
          tracks: [text],
          needs_clean: true,
        })),
      }),
    );
  }
  test('nothing is shown when nothing was asked for', async () => {
    await writeMany();
    expect((await readSubtitlesState(dir)).batch).toBeNull();
  });

  test('asking for everything starts a run that counts down as files finish', async () => {
    await writeMany();
    await requestClean(dir, { all: true });
    expect((await readSubtitlesState(dir)).batch).toEqual({
      kind: 'recheck',
      total: 4,
      done: 0,
    });
    const queue = path.join(dir, '_subs', 'queue');
    const first = (await fs.readdir(queue)).sort()[0] as string;
    await fs.rm(path.join(queue, first));
    expect((await readSubtitlesState(dir)).batch).toEqual({
      kind: 'recheck',
      total: 4,
      done: 1,
    });
  });

  test('a file asked for while others wait joins the run; after it ends a new run starts', async () => {
    await writeMany();
    await requestClean(dir, { path: names[0] as string });
    await requestClean(dir, { path: names[1] as string });
    expect((await readSubtitlesState(dir)).batch?.total).toBe(2);
    await requestClean(dir, { path: names[1] as string });
    expect((await readSubtitlesState(dir)).batch?.total).toBe(2);
    const queue = path.join(dir, '_subs', 'queue');
    for (const name of await fs.readdir(queue)) {
      await fs.rm(path.join(queue, name));
    }
    expect((await readSubtitlesState(dir)).batch).toBeNull();
    await requestClean(dir, { path: names[2] as string });
    expect((await readSubtitlesState(dir)).batch).toEqual({
      kind: 'recheck',
      total: 1,
      done: 0,
    });
  });

  test('picture conversions and typo fixes together are called mixed', async () => {
    await write(
      '_subs/index.json',
      JSON.stringify({
        updated: 1,
        files: [
          {
            path: names[0],
            size: 1,
            mtime: 1,
            tracks: [{ ...text, codec: 'picture' }],
          },
          { path: names[1], size: 1, mtime: 1, tracks: [text] },
        ],
      }),
    );
    await requestSubtitles(dir, { path: names[0] as string });
    await requestClean(dir, { path: names[1] as string });
    expect((await readSubtitlesState(dir)).batch).toEqual({
      kind: 'mixed',
      total: 2,
      done: 0,
    });
  });
});

describe('picture subtitles that could not be read', () => {
  const picture = {
    language: 'spa',
    codec: 'picture',
    name: '',
    default: false,
    forced: false,
  };
  const REBOUND = 'Rebound (2005)/Rebound (2005).mkv';

  async function writeStuck(unreadable: boolean | undefined) {
    await write(
      '_subs/index.json',
      JSON.stringify({
        updated: 1,
        files: [
          {
            path: REBOUND,
            size: 1,
            mtime: 1,
            tracks: [picture],
            ...(unreadable === undefined ? {} : { unreadable }),
          },
          { path: DUMA, size: 1, mtime: 1, tracks: [picture] },
        ],
      }),
    );
  }

  test('a file the converter already tried is not offered again', async () => {
    await writeStuck(true);
    const state = await readSubtitlesState(dir);
    const rebound = state.files.find((f) => f.path === REBOUND);
    expect(rebound?.unreadable).toBe(true);
    expect(rebound?.pictures).toBe(0);
    expect(rebound?.tracks).toHaveLength(1);
    expect(await requestSubtitles(dir, { all: true })).toBe(1);
    const queue = await fs.readdir(path.join(dir, '_subs', 'queue'));
    expect(queue).toHaveLength(1);
  });

  test('asking for that one file says why it cannot be done', async () => {
    await writeStuck(true);
    await expect(requestSubtitles(dir, { path: REBOUND })).rejects.toThrow(
      /cannot be read/,
    );
  });

  test('a file not tried yet, or an index without the flag, is offered as before', async () => {
    await writeStuck(false);
    expect(
      (await readSubtitlesState(dir)).files.map((f) => [
        f.unreadable,
        f.pictures,
      ]),
    ).toEqual([
      [false, 1],
      [false, 1],
    ]);
    await writeStuck(undefined);
    expect((await readSubtitlesState(dir)).files[0]?.pictures).toBe(1);
  });
});

describe('taking a subtitle track out', () => {
  test('writes a request the converter will recognise, named as it names it', async () => {
    await writeIndex();
    await requestDropTrack(dir, DUMA, 1);
    const name = createHash('md5')
      .update(`droptrack:${DUMA}:1`)
      .digest('hex')
      .slice(0, 12);
    const text = await fs.readFile(
      path.join(dir, '_subs', 'queue', `${name}.req`),
      'utf8',
    );
    expect(text).toContain('action=droptrack\n');
    expect(text).toContain(`path=${DUMA}\n`);
    expect(text).toContain('track=1\n');
  });

  test('refuses a track the file does not have, a bad number, or a file that is busy', async () => {
    await writeIndex();
    await expect(requestDropTrack(dir, DUMA, 2)).rejects.toThrow(
      'not in the file',
    );
    await expect(requestDropTrack(dir, DUMA, -1)).rejects.toThrow();
    await expect(requestDropTrack(dir, DUMA, 0.5)).rejects.toThrow();
    await expect(requestDropTrack(dir, DUMA, '0')).rejects.toThrow();
    await expect(requestDropTrack(dir, 'Nope/x.mkv', 0)).rejects.toThrow(
      'not in the list',
    );
    await write('_subs/queue/abc.req', `path=${DUMA}\nat=5\n`);
    await expect(requestDropTrack(dir, DUMA, 0)).rejects.toThrow(
      'being worked on',
    );
    expect(await fs.readdir(path.join(dir, '_subs', 'queue'))).toEqual([
      'abc.req',
    ]);
  });
});

describe('taking the problem picture subtitles out', () => {
  const REBOUND_FILE = 'Rebound (2005)/Rebound (2005).mkv';
  const picture = {
    language: 'spa',
    codec: 'picture',
    name: '',
    default: false,
    forced: false,
  };
  const text = { ...picture, codec: 'S_TEXT/UTF8', name: 'English' };

  async function writeStuckIndex() {
    await write(
      '_subs/index.json',
      JSON.stringify({
        updated: 1,
        files: [
          {
            path: REBOUND_FILE,
            size: 1,
            mtime: 1,
            tracks: [picture, picture, text],
            unreadable: true,
          },
          { path: DUMA, size: 1, mtime: 1, tracks: [picture] },
          { path: HERO, size: 1, mtime: 1, tracks: [text] },
        ],
      }),
    );
  }

  const queued = async () =>
    (await fs.readdir(path.join(dir, '_subs', 'queue'))).sort();
  const nameOf = (file: string) =>
    createHash('md5')
      .update(`droppictures:${file}`)
      .digest('hex')
      .slice(0, 12) + '.req';

  test('writes a request the converter will recognise, named as it names it', async () => {
    await writeStuckIndex();
    expect(await requestDropPictures(dir, { path: REBOUND_FILE })).toBe(1);
    expect(await queued()).toEqual([nameOf(REBOUND_FILE)]);
    const written = await fs.readFile(
      path.join(dir, '_subs', 'queue', nameOf(REBOUND_FILE)),
      'utf8',
    );
    expect(written).toContain('action=droppictures\n');
    expect(written).toContain(`path=${REBOUND_FILE}\n`);
    expect(written).not.toContain('track=');
  });

  test('"all" asks only for the files whose pictures could not be read', async () => {
    await writeStuckIndex();
    expect(await requestDropPictures(dir, { all: true })).toBe(1);
    expect(await queued()).toEqual([nameOf(REBOUND_FILE)]);
  });

  test('"all" leaves out a file that is being worked on', async () => {
    await writeStuckIndex();
    await write(
      '_subs/queue/abc.req',
      `action=recheck\npath=${REBOUND_FILE}\nat=5\n`,
    );
    expect(await requestDropPictures(dir, { all: true })).toBe(0);
    expect(await queued()).toEqual(['abc.req']);
  });

  test('refuses a file with no pictures, one that is busy, and one that is not listed', async () => {
    await writeStuckIndex();
    await expect(requestDropPictures(dir, { path: HERO })).rejects.toThrow(
      'no picture subtitles',
    );
    await expect(
      requestDropPictures(dir, { path: 'Nope/x.mkv' }),
    ).rejects.toThrow('not in the list');
    await write(
      '_subs/queue/abc.req',
      `action=recheck\npath=${REBOUND_FILE}\nat=5\n`,
    );
    await expect(
      requestDropPictures(dir, { path: REBOUND_FILE }),
    ).rejects.toThrow('being worked on');
    expect(await queued()).toEqual(['abc.req']);
  });
});

describe('dismissing', () => {
  test('a waiting file, the whole queue, and finished entries can be removed', async () => {
    await writeIndex();
    await requestSubtitles(dir, { path: DUMA });
    await write('_subs/queue/zz.req', `path=${HERO}\nat=1\n`);
    const queue = path.join(dir, '_subs', 'queue');
    expect(await dismissSubtitles(dir, { queued: DUMA })).toBe(1);
    expect(await fs.readdir(queue)).toHaveLength(1);
    await requestSubtitles(dir, { path: DUMA });
    expect(await dismissSubtitles(dir, { queue: 'all' })).toBe(2);
    expect(await fs.readdir(queue)).toHaveLength(0);

    await write(
      '_subs/done/a-1.json',
      JSON.stringify({ path: DUMA, ok: true, at: 1 }),
    );
    await write(
      '_subs/done/b-2.json',
      JSON.stringify({ path: HERO, ok: true, at: 2 }),
    );
    const state = await readSubtitlesState(dir);
    expect(state.recent.map((r) => r.id).sort()).toEqual([
      'a-1.json',
      'b-2.json',
    ]);
    expect(await dismissSubtitles(dir, { result: 'a-1.json' })).toBe(1);
    await expect(
      dismissSubtitles(dir, { result: '../x.json' }),
    ).rejects.toThrow();
    expect(await dismissSubtitles(dir, { results: 'all' })).toBe(1);
  });

  test('clearing the queue leaves a restore or a delete the person asked for', async () => {
    await writeIndex();
    await write(
      '_subs/index.json',
      JSON.stringify({
        updated: 1,
        files: [],
        held: [{ path: DUMA, size: 1, at: 1 }],
      }),
    );
    await requestRestore(dir, DUMA);
    expect(await dismissSubtitles(dir, { queue: 'all' })).toBe(0);
    expect(await fs.readdir(path.join(dir, '_subs', 'queue'))).toHaveLength(1);
  });
});

describe('the old copies', () => {
  async function withHeld() {
    await write(
      '_subs/index.json',
      JSON.stringify({
        updated: 1,
        files: [],
        held: [
          { path: DUMA, size: 2e9, at: 50, version: 2 },
          { path: 'bad' },
          7,
        ],
      }),
    );
  }

  test('are listed from the converter, skipping what is not a copy', async () => {
    await withHeld();
    const state = await readSubtitlesState(dir);
    expect(state.held).toEqual([
      { path: DUMA, size: 2e9, at: 50, version: 2 },
      { path: 'bad', size: 0, at: 0, version: 0 },
    ]);
  });

  test('a restore request names the file and is not a conversion', async () => {
    await withHeld();
    await requestRestore(dir, DUMA);
    const names = await fs.readdir(path.join(dir, '_subs', 'queue'));
    expect(names).toHaveLength(1);
    const text = await fs.readFile(
      path.join(dir, '_subs', 'queue', names[0] as string),
      'utf8',
    );
    expect(text).toContain('action=restore\n');
    expect(text).toContain(`path=${DUMA}\n`);
    await write(
      '_subs/index.json',
      JSON.stringify({
        updated: 1,
        files: [
          {
            path: DUMA,
            size: 1,
            mtime: 1,
            tracks: [
              {
                language: 'eng',
                codec: 'S_TEXT/UTF8',
                name: '',
                default: true,
                forced: false,
              },
            ],
          },
        ],
        held: [{ path: DUMA, size: 1, at: 1 }],
      }),
    );
    expect((await readSubtitlesState(dir)).files[0]?.status).toBeNull();
  });

  test('only a file that has an old copy can be restored', async () => {
    await withHeld();
    await expect(requestRestore(dir, HERO)).rejects.toThrow('no old copy');
    await expect(requestRestore(dir, '../x.mkv')).rejects.toThrow();
  });

  test('deleting them is a request of its own and needs there to be some', async () => {
    await expect(requestClearOldCopies(dir)).rejects.toThrow('no old copies');
    await withHeld();
    expect(await requestClearOldCopies(dir)).toBe(2);
    const names = await fs.readdir(path.join(dir, '_subs', 'queue'));
    const text = await fs.readFile(
      path.join(dir, '_subs', 'queue', names[0] as string),
      'utf8',
    );
    expect(text).toContain('action=clear');
    expect(text).not.toContain('path=');
  });
});

describe('how tracks are described', () => {
  test('with the language and what is special about them', () => {
    expect(
      describeTrack({
        language: 'eng',
        codec: 'S_TEXT/UTF8',
        name: '',
        default: true,
        forced: false,
      }),
    ).toBe('English (plays by default)');
    expect(
      describeTrack({
        language: 'spa',
        codec: 'picture',
        name: '',
        default: false,
        forced: true,
      }),
    ).toBe('Spanish (picture, foreign speech only)');
    expect(
      describeTrack({
        language: 'xyz',
        codec: 'x',
        name: '',
        default: false,
        forced: false,
      }),
    ).toBe('xyz');
  });

  test('a movie is named by its folder', () => {
    expect(movieName(DUMA)).toBe('Duma (2005)');
    expect(movieName('Movie.mkv')).toBe('Movie.mkv');
  });
});
