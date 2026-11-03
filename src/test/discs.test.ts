import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  conversionOf,
  stageOf,
  cleanName,
  cleanNumber,
  commandLines,
  commandResult,
  dismissAttention,
  readDiscsState,
  sendCommand,
  setEject,
  setNext,
  setAutoScan,
  setMovieOnly,
  setPreset,
  savePreset,
  deletePreset,
} from '../../server/disc-state';

let dir: string;

async function write(relative: string, text: string) {
  const file = path.join(dir, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'discs-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('cleanName', () => {
  test('keeps what Plex names use', () => {
    expect(cleanName('The Fairly OddParents (2001) {tmdb-1}')).toBe(
      'The Fairly OddParents (2001) {tmdb-1}',
    );
    expect(cleanName("Don't Stop")).toBe("Don't Stop");
  });

  test('drops shell and path characters and squeezes spaces', () => {
    expect(cleanName('$(touch x) ; echo  hi')).toBe('(touch x) echo hi');
    expect(cleanName('../etc/passwd')).toBe('..etcpasswd');
    expect(cleanName('  Two   Spaces  ')).toBe('Two Spaces');
  });

  test('refuses an empty or non-text name', () => {
    expect(() => cleanName('///')).toThrow();
    expect(() => cleanName(5)).toThrow();
    expect(() => cleanName('x'.repeat(101))).toThrow();
  });
});

describe('cleanNumber', () => {
  test('accepts whole numbers, as text or number', () => {
    expect(cleanNumber(2, 'The season')).toBe(2);
    expect(cleanNumber('07', 'The season')).toBe(7);
  });

  test('refuses everything else', () => {
    for (const bad of [0, -1, 1.5, 1000, 'abc', '', null, undefined]) {
      expect(() => cleanNumber(bad, 'The season')).toThrow();
    }
  });
});

describe('readDiscsState', () => {
  test('a missing folder is reported as not available', async () => {
    const state = await readDiscsState(path.join(dir, 'nope'));
    expect(state.available).toBe(false);
    expect(state.attention).toEqual([]);
  });

  test('an empty folder has nothing in it', async () => {
    const state = await readDiscsState(dir);
    expect(state).toEqual({
      available: true,
      eject: true,
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
    });
  });

  test('reads the drive, and says when the helper has gone quiet', async () => {
    await write('_status/drive.txt', 'media=1\nlabel=ANDRE\nupdated=1000\n');
    const fresh = await readDiscsState(dir, 1030);
    expect(fresh.drive).toEqual({
      media: true,
      label: 'ANDRE',
      updated: 1000,
      alive: true,
    });
    const stale = await readDiscsState(dir, 1200);
    expect(stale.drive?.alive).toBe(false);
  });

  test('reads what the ripper is doing', async () => {
    await write(
      '_status/run.txt',
      'state=running\nname=Andre\nstep=Copying the disc\nupdated=5\n',
    );
    const state = await readDiscsState(dir);
    expect(state.run).toEqual({
      state: 'running',
      name: 'Andre',
      step: 'Copying the disc',
      updated: 5,
    });
  });

  test('reads how far the copy of a disc has got, only while it is being copied', async () => {
    const progress =
      'total=4600000000\nbytes=1200000000\nstarted=1000\nupdated=1600\n';
    await write('_converting/Copying/STATUS.txt', 'Copying the disc\n');
    await write('_converting/Copying/stage.txt', 'copying\n');
    await write('_converting/Copying/progress.txt', progress);
    // A disc past the copy has no bar, even if an old file was left behind.
    await write('_converting/Later/STATUS.txt', 'x\n');
    await write('_converting/Later/stage.txt', 'extracting\n');
    await write('_converting/Later/progress.txt', progress);
    // Missing, garbled and impossible files give no bar.
    await write('_converting/Garbled/STATUS.txt', 'x\n');
    await write('_converting/Garbled/stage.txt', 'copying\n');
    await write('_converting/Garbled/progress.txt', 'total=abc\nbytes=\n');
    await write('_converting/Backwards/STATUS.txt', 'x\n');
    await write('_converting/Backwards/stage.txt', 'copying\n');
    await write(
      '_converting/Backwards/progress.txt',
      'total=100\nbytes=5\nstarted=50\nupdated=10\n',
    );
    await write('_converting/Nothing/STATUS.txt', 'x\n');
    await write('_converting/Nothing/stage.txt', 'copying\n');
    const state = await readDiscsState(dir);
    const byName = Object.fromEntries(
      state.working.map((w) => [w.name, w.copy]),
    );
    expect(byName.Copying).toEqual({
      total: 4600000000,
      bytes: 1200000000,
      startedAt: 1000,
      updatedAt: 1600,
    });
    expect(byName.Later).toBeNull();
    expect(byName.Garbled).toBeNull();
    expect(byName.Backwards).toBeNull();
    expect(byName.Nothing).toBeNull();
  });

  test("a disc ripped again under the same folder name does not show the old rip's conversions", async () => {
    const old = [
      {
        input_file: '/videos/DVDs/_converting/Again/Again.mkv',
        status: 'completed',
        progress: 100,
      },
    ];
    await write('_converting/Again/STATUS.txt', 'Copying the disc\n');
    await write('_converting/Again/stage.txt', 'copying\n');
    const copying = await readDiscsState(dir, undefined, old);
    expect(copying.working[0]?.conversion).toBeNull();
    // Once it has been given to Frame Shift, its own jobs count.
    await write('_converting/Again/submitted', '');
    const queued = await readDiscsState(dir, undefined, old);
    expect(queued.working[0]?.conversion).toMatchObject({ total: 1, done: 1 });
  });

  test('reads the notes, the logs and the parked discs', async () => {
    await write('ATTENTION - Andre.txt', 'one\ntwo\n');
    await write('ATTENTION - Other.txt', 'three\n');
    await write('notes.txt', 'not a note');
    await write(
      '_converting/Andre/STATUS.txt',
      Array.from({ length: 9 }, (_, i) => `line ${i + 1}`).join('\n') + '\n',
    );
    await write('_converting/Andre/submitted', '');
    await write('_converting/.lock', '');
    await write('_images/Showdisc/Showdisc.iso', '');
    await write('_images/Showdisc/.waiting', '');
    const state = await readDiscsState(dir);
    expect(state.attention.map((note) => note.name)).toEqual([
      'Andre',
      'Other',
    ]);
    expect(state.attention[0]?.lines).toEqual(['one', 'two']);
    expect(state.working).toHaveLength(1);
    expect(state.working[0]?.lines).toEqual([
      'line 4',
      'line 5',
      'line 6',
      'line 7',
      'line 8',
      'line 9',
    ]);
    expect(state.working[0]?.queued).toBe(true);
    expect(state.parked).toEqual([{ name: 'Showdisc', suggestion: null }]);
  });

  test('lists finished folders that have no year', async () => {
    await write('Stellaluna/Stellaluna.mkv', '');
    await write('Andre (2020)/Andre (2020).mkv', '');
    await write('_images/x/y', '');
    const state = await readDiscsState(dir);
    expect(state.needsYear).toEqual(['Stellaluna']);
    expect(state.finishedCount).toBe(2);
  });
});

describe('parked discs', () => {
  test('carry what TMDB made of their label, when the ripper left it', async () => {
    await write('_images/Billy_S4_D1/Billy_S4_D1.iso', '');
    await write('_images/Billy_S4_D1/.waiting', '');
    await write(
      '_images/Billy_S4_D1/suggest.txt',
      'show=Billy the Exterminator (2009)\nseason=4\ndisc=1\n',
    );
    await write('_images/Other/Other.iso', '');
    await write('_images/Other/.waiting', '');
    await write('_images/Half/suggest.txt', 'show=Only A Show\nseason=x\n');
    await write('_images/Half/.waiting', '');
    // A kept copy of a disc that was already filed is not waiting for anything.
    await write('_images/Air_Bud/Air_Bud.iso', '');
    await write('_images/Air_Bud/.keep', '');
    const state = await readDiscsState(dir);
    expect(state.parked).toEqual([
      {
        name: 'Billy_S4_D1',
        suggestion: {
          show: 'Billy the Exterminator (2009)',
          season: 4,
          disc: 1,
        },
      },
      { name: 'Half', suggestion: { show: 'Only A Show' } },
      { name: 'Other', suggestion: null },
    ]);
  });
});

describe('settings the page writes', () => {
  test('movie-only is off unless it was switched on', async () => {
    expect((await readDiscsState(dir)).movieOnly).toBe(false);
    await setMovieOnly(dir, true);
    expect((await readDiscsState(dir)).movieOnly).toBe(true);
    expect(
      await fs.readFile(path.join(dir, '_settings', 'movie-only'), 'utf8'),
    ).toBe('1\n');
    await setMovieOnly(dir, false);
    expect((await readDiscsState(dir)).movieOnly).toBe(false);
  });

  test('auto-scan is on unless it was switched off', async () => {
    expect((await readDiscsState(dir)).autoScan).toBe(true);
    await setAutoScan(dir, false);
    expect((await readDiscsState(dir)).autoScan).toBe(false);
    expect(await fs.readFile(path.join(dir, '_settings', 'auto'), 'utf8')).toBe(
      '0\n',
    );
    await setAutoScan(dir, true);
    expect((await readDiscsState(dir)).autoScan).toBe(true);
  });

  test('eject is on unless it was switched off', async () => {
    expect((await readDiscsState(dir)).eject).toBe(true);
    await setEject(dir, false);
    expect((await readDiscsState(dir)).eject).toBe(false);
  });

  test('eject is read back as written', async () => {
    await setEject(dir, true);
    expect((await readDiscsState(dir)).eject).toBe(true);
    await setEject(dir, false);
    expect((await readDiscsState(dir)).eject).toBe(false);
  });

  test('a note for a TV disc is written for the ripper to read', async () => {
    await setNext(dir, {
      mode: 'tv',
      show: 'Show (2010)',
      season: 3,
      episode: 7,
    });
    const text = await fs.readFile(path.join(dir, '_settings', 'next'), 'utf8');
    expect(text).toBe('mode=tv\nshow=Show (2010)\nseason=3\nepisode=7\n');
    expect((await readDiscsState(dir)).next).toEqual({
      mode: 'tv',
      show: 'Show (2010)',
      season: 3,
      episode: 7,
    });
  });

  test('a note for a movie, with and without a name', async () => {
    await setNext(dir, { mode: 'movie', name: 'Stellaluna (1996)' });
    expect((await readDiscsState(dir)).next).toEqual({
      mode: 'movie',
      name: 'Stellaluna (1996)',
    });
    await setNext(dir, { mode: 'movie' });
    expect((await readDiscsState(dir)).next).toEqual({ mode: 'movie' });
  });

  test('a note for the disc being ripped says so and is read back', async () => {
    await setNext(dir, {
      mode: 'movie',
      name: 'Air Bud - Spikes Back (2003)',
      current: true,
    });
    expect(await fs.readFile(path.join(dir, '_settings', 'next'), 'utf8')).toBe(
      'for=drive\nmode=movie\nname=Air Bud - Spikes Back (2003)\n',
    );
    expect((await readDiscsState(dir)).next).toEqual({
      mode: 'movie',
      name: 'Air Bud - Spikes Back (2003)',
      current: true,
    });
  });

  test('a note for the next disc has no for line', async () => {
    await setNext(dir, { mode: 'movie', name: 'Stellaluna (1996)' });
    expect(
      await fs.readFile(path.join(dir, '_settings', 'next'), 'utf8'),
    ).not.toContain('for=');
  });

  test('a note can be taken back', async () => {
    await setNext(dir, { mode: 'movie' });
    await setNext(dir, null);
    expect((await readDiscsState(dir)).next).toBeNull();
    await setNext(dir, null);
  });

  test('a note with a bad value is refused and nothing is written', async () => {
    await expect(
      setNext(dir, { mode: 'tv', show: 'Show', season: 0 }),
    ).rejects.toThrow();
    await expect(setNext(dir, { mode: 'sideways' } as never)).rejects.toThrow();
    expect((await readDiscsState(dir)).next).toBeNull();
  });
});

describe('dismissAttention', () => {
  test('removes a note the ripper left', async () => {
    await write('ATTENTION - Andre.txt', 'x\n');
    await dismissAttention(dir, 'ATTENTION - Andre.txt');
    expect((await readDiscsState(dir)).attention).toEqual([]);
  });

  test('refuses anything that is not a listed note', async () => {
    await write('Stellaluna/Stellaluna.mkv', '');
    await write('secret.txt', 'keep');
    await expect(dismissAttention(dir, 'secret.txt')).rejects.toThrow();
    await expect(dismissAttention(dir, '../secret.txt')).rejects.toThrow();
    await expect(
      dismissAttention(dir, 'ATTENTION - ../../secret.txt'),
    ).rejects.toThrow();
    expect(await fs.readFile(path.join(dir, 'secret.txt'), 'utf8')).toBe(
      'keep',
    );
  });
});

describe('commands', () => {
  test('redoing a movie over the filed one is asked for only when it is true', () => {
    const base = { action: 'rip', mode: 'movie', name: 'A (2000)' } as const;
    expect(commandLines({ ...base, replace: true })).toEqual([
      'action=rip',
      'mode=movie',
      'name=A (2000)',
      'replace=1',
    ]);
    expect(commandLines({ ...base, replace: false })).not.toContain(
      'replace=1',
    );
    expect(commandLines(base)).not.toContain('replace=1');
  });

  test('a rename sets the folder that has the name aside only when it is true', () => {
    const base = {
      action: 'rename',
      old: 'The Proud Famil',
      new: 'The Proud Family Movie (2005) {tmdb-14688}',
    } as const;
    expect(commandLines({ ...base, replace: true })).toEqual([
      'action=rename',
      'old=The Proud Famil',
      'new=The Proud Family Movie (2005) {tmdb-14688}',
      'replace=1',
    ]);
    expect(commandLines({ ...base, replace: false })).not.toContain(
      'replace=1',
    );
    expect(commandLines(base)).toEqual([
      'action=rename',
      'old=The Proud Famil',
      'new=The Proud Family Movie (2005) {tmdb-14688}',
    ]);
  });

  test('each request becomes the lines the host reads', () => {
    expect(commandLines({ action: 'eject' })).toEqual(['action=eject']);
    expect(
      commandLines({ action: 'rip', mode: 'movie', name: 'Stellaluna (1996)' }),
    ).toEqual(['action=rip', 'mode=movie', 'name=Stellaluna (1996)']);
    expect(
      commandLines({
        action: 'rip',
        mode: 'tv',
        show: 'Show (2001)',
        season: 2,
        episode: 5,
        image: 'Showdisc',
      }),
    ).toEqual([
      'action=rip',
      'image=Showdisc',
      'mode=tv',
      'show=Show (2001)',
      'season=2',
      'episode=5',
    ]);
    expect(
      commandLines({
        action: 'rename',
        old: 'Stellaluna',
        new: 'Stellaluna (1996)',
      }),
    ).toEqual(['action=rename', 'old=Stellaluna', 'new=Stellaluna (1996)']);
  });

  test('a search carries its kind, a cleaned query and a checked year', () => {
    expect(
      commandLines({
        action: 'search',
        kind: 'any',
        query: '  Andre   (1994) & friends ',
        year: 1994,
      }),
    ).toEqual([
      'action=search',
      'kind=any',
      'query=Andre (1994) & friends',
      'year=1994',
    ]);
    expect(
      commandLines({ action: 'search', kind: 'movie', query: 'Andre' }),
    ).toEqual(['action=search', 'kind=movie', 'query=Andre']);
  });

  test('a pasted address stays whole in a search', () => {
    const address =
      'https://www.themoviedb.org/movie/21352-andre?language=en-US';
    expect(
      commandLines({ action: 'search', kind: 'any', query: address }),
    ).toContain(`query=${address}`);
  });

  test('a newline in a search cannot start another line of the request', () => {
    const lines = commandLines({
      action: 'search',
      kind: 'movie',
      query: 'Andre\naction=eject',
    });
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('query=Andre action=eject');
  });

  test('bad searches are refused', () => {
    expect(() =>
      commandLines({ action: 'search', kind: 'any', query: '   ' }),
    ).toThrow();
    expect(() =>
      commandLines({ action: 'search', kind: 'sideways' as never, query: 'x' }),
    ).toThrow();
    expect(() =>
      commandLines({ action: 'search', kind: 'any', query: 'x'.repeat(201) }),
    ).toThrow();
    expect(() =>
      commandLines({ action: 'search', kind: 'any', query: 'x', year: 0 }),
    ).toThrow();
  });

  test('a match request names only the folder', () => {
    expect(commandLines({ action: 'match', old: 'Stellaluna' })).toEqual([
      'action=match',
      'old=Stellaluna',
    ]);
    expect(() => commandLines({ action: 'match', old: '../x' })).toThrow();
    expect(() => commandLines({ action: 'match', old: '' })).toThrow();
  });

  test('the first episode defaults to 1', () => {
    expect(
      commandLines({ action: 'rip', mode: 'tv', show: 'Show', season: 1 }),
    ).toContain('episode=1');
  });

  test('bad requests are refused', () => {
    expect(() => commandLines({ action: 'format' } as never)).toThrow();
    expect(() =>
      commandLines({ action: 'rip', mode: 'tv', show: 'Show', season: 0 }),
    ).toThrow();
    expect(() =>
      commandLines({ action: 'rip', mode: 'sideways' } as never),
    ).toThrow();
    expect(() =>
      commandLines({ action: 'rip', mode: 'movie', image: '../etc' }),
    ).toThrow();
    expect(() =>
      commandLines({ action: 'rename', old: '../x', new: 'Y (2000)' }),
    ).toThrow();
    expect(() =>
      commandLines({ action: 'rename', old: 'X', new: '///' }),
    ).toThrow();
  });

  test('a newline in a value cannot add a line of its own', () => {
    const lines = commandLines({
      action: 'rip',
      mode: 'movie',
      name: 'Name\naction=eject',
    });
    expect(lines).toEqual(['action=rip', 'mode=movie', 'name=Nameactioneject']);
  });

  test('a request is written whole, under its id, and read back when answered', async () => {
    const id = await sendCommand(dir, { action: 'eject' });
    expect(id).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(
      await fs.readFile(path.join(dir, '_commands', `${id}.cmd`), 'utf8'),
    ).toBe('action=eject\n');
    expect(await fs.readdir(path.join(dir, '_commands'))).toEqual([
      `${id}.cmd`,
    ]);

    expect(await commandResult(dir, id)).toEqual({ done: false });
    await write(`_commands/done/${id}.result`, 'ok\nEjected.\n');
    expect(await commandResult(dir, id)).toEqual({
      done: true,
      ok: true,
      message: 'Ejected.',
    });
    await write(`_commands/done/${id}.result`, 'error\nThe ripper is busy.\n');
    expect(await commandResult(dir, id)).toEqual({
      done: true,
      ok: false,
      message: 'The ripper is busy.',
    });
  });

  test('an id with a path in it is refused', async () => {
    await expect(commandResult(dir, '../x')).rejects.toThrow();
  });
});

describe('the queue', () => {
  const job = (folder: string, status: string, progress: number | null) => ({
    input_file: `/videos/DVDs/_converting/${folder}/${folder}.mkv`,
    status,
    progress,
  });

  test('a disc has no conversion until Frame Shift has jobs for it', () => {
    expect(conversionOf('Duma', [])).toBeNull();
    expect(conversionOf('Duma', [job('Other', 'processing', 50)])).toBeNull();
  });

  test('its conversions are counted and averaged, and finished ones count as whole', () => {
    const jobs = [
      job('Duma', 'completed', 100),
      job('Duma', 'processing', 50),
      job('Duma', 'pending', null),
      job('Other', 'processing', 90),
    ];
    expect(conversionOf('Duma', jobs)).toEqual({
      total: 3,
      done: 1,
      failed: 0,
      percent: 50,
    });
    const failed = conversionOf('Duma', [job('Duma', 'failed', 10)]);
    expect(failed).toMatchObject({ total: 1, failed: 1, percent: 100 });
  });

  test('the stage follows what the folder holds and what Frame Shift is doing', () => {
    expect(stageOf('copying', false, false, null)).toBe('copying');
    expect(stageOf('extracting', false, false, null)).toBe('extracting');
    // Older folders have no stage file: a manifest means it is ready, none means it is extracting.
    expect(stageOf(null, true, false, null)).toBe('waiting');
    expect(stageOf(null, false, false, null)).toBe('extracting');
    expect(stageOf('staged', true, false, null)).toBe('waiting');
    const idle = { total: 2, done: 0, failed: 0, percent: 0 };
    expect(stageOf('queued', true, true, null)).toBe('waiting');
    expect(stageOf('queued', true, true, idle)).toBe('waiting');
    expect(stageOf('queued', true, true, { ...idle, percent: 20 })).toBe(
      'converting',
    );
    expect(
      stageOf('queued', true, true, { ...idle, done: 1, percent: 50 }),
    ).toBe('converting');
    expect(
      stageOf('queued', true, true, {
        total: 2,
        done: 1,
        failed: 1,
        percent: 100,
      }),
    ).toBe('filing');
  });

  test('a working folder shows its stage, its filed name and its progress, and filed discs are listed', async () => {
    await write('_converting/Everyones_Hero/stage.txt', 'queued\n');
    await write('_converting/Everyones_Hero/submitted', '');
    await write(
      '_converting/Everyones_Hero/manifest.tsv',
      "Everyones_Hero.mkv\tEveryone's Hero (2006)/Everyone's Hero (2006).mkv\t5230\n",
    );
    await write(
      '_converting/Everyones_Hero/STATUS.txt',
      'Queued in Frame Shift Video\n',
    );
    await write('_converting/Duma/stage.txt', 'extracting\n');
    await write('_converting/Duma/STATUS.txt', 'Extracting\n');
    await write('Duma (2005)/Duma (2005).mkv', '');
    const state = await readDiscsState(dir, undefined, [
      job('Everyones_Hero', 'processing', 40),
    ]);
    const hero = state.working.find((disc) => disc.name === 'Everyones_Hero');
    expect(hero).toMatchObject({
      title: "Everyone's Hero (2006)",
      stage: 'converting',
      queued: true,
      conversion: { total: 1, done: 0, failed: 0, percent: 40 },
    });
    expect(state.working.find((disc) => disc.name === 'Duma')).toMatchObject({
      title: 'Duma',
      stage: 'extracting',
      conversion: null,
    });
    expect(state.recent.map((done) => done.name)).toEqual(['Duma (2005)']);
  });
});

describe('the folder for finished discs', () => {
  test('finished discs are read from _converted, and old ones from the DVDs folder', async () => {
    await write('_converted/Stellaluna/Stellaluna.mkv', '');
    await write('_converted/Andre (2020)/Andre (2020).mkv', '');
    await write('Old Movie (1999)/Old Movie (1999).mkv', '');
    const state = await readDiscsState(dir);
    expect(state.finishedCount).toBe(3);
    expect(state.needsYear).toEqual(['Stellaluna']);
    expect(state.recent.map((done) => done.name).sort()).toEqual([
      'Andre (2020)',
      'Old Movie (1999)',
      'Stellaluna',
    ]);
    expect(state.outputFolder).toBe('_converted');
  });

  test('the folder named on the page is used, and a name that leaves the folder is not', async () => {
    await write('_settings/output', 'Finished\n');
    await write('Finished/Duma (2005)/Duma (2005).mkv', '');
    await write('_converted/Other (2001)/Other (2001).mkv', '');
    let state = await readDiscsState(dir);
    expect(state.outputFolder).toBe('Finished');
    expect(state.recent.map((done) => done.name)).toEqual(['Duma (2005)']);
    await fs.rm(path.join(dir, 'Finished'), { recursive: true });
    await write('_settings/output', '../escape\n');
    state = await readDiscsState(dir);
    expect(state.outputFolder).toBe('_converted');
    expect(state.recent.map((done) => done.name)).toEqual(['Other (2001)']);
  });
});

describe('how discs are converted', () => {
  const presets = JSON.stringify({
    presets: [
      {
        id: 'hevc-mkv',
        name: 'Small and sharp',
        container: 'mkv',
        video: 'libx265',
        audio: 'copy',
      },
      {
        id: 'h264-mp4',
        name: 'Plays on anything',
        container: 'mp4',
        video: 'libx264',
        audio: 'aac',
      },
      { id: 'Bad Id', name: 'Not usable' },
      { id: 'h264-mp4', name: 'A repeat' },
      {
        id: 'evil',
        name: 'Evil',
        container: 'avi; rm -rf /',
        video: 'x',
        audio: 'y',
      },
    ],
  });

  test('lists the usable presets and which is chosen', async () => {
    await write('_settings/presets.json', presets);
    await write('_settings/preset', 'h264-mp4\n');
    const { convert } = await readDiscsState(dir);
    expect(convert.chosen).toBe('h264-mp4');
    expect(convert.presets.map((preset) => preset.id)).toEqual([
      'hevc-mkv',
      'h264-mp4',
      'evil',
    ]);
    expect(convert.presets[1]).toMatchObject({
      container: 'mp4',
      video: 'libx264',
      audio: 'aac',
    });
    // Anything that is not on the ripper's list of values is shown as its default.
    expect(convert.presets[2]).toMatchObject({
      container: 'mkv',
      video: 'libx265',
      audio: 'copy',
    });
  });

  test('a missing pick means the default, and no file means no choices', async () => {
    expect((await readDiscsState(dir)).convert).toEqual({
      presets: [],
      chosen: '',
    });
    await write('_settings/presets.json', presets);
    await write('_settings/preset', 'gone\n');
    expect((await readDiscsState(dir)).convert.chosen).toBe('hevc-mkv');
    await write('_settings/presets.json', '{not json');
    expect((await readDiscsState(dir)).convert).toEqual({
      presets: [],
      chosen: '',
    });
  });

  test('choosing writes the pick for the ripper, and only a listed one is accepted', async () => {
    await write('_settings/presets.json', presets);
    await setPreset(dir, 'h264-mp4');
    expect(
      (await fs.readFile(path.join(dir, '_settings', 'preset'), 'utf8')).trim(),
    ).toBe('h264-mp4');
    await expect(setPreset(dir, '../../etc/passwd')).rejects.toThrow();
    await expect(setPreset(dir, 'nope')).rejects.toThrow();
    expect(
      (await fs.readFile(path.join(dir, '_settings', 'preset'), 'utf8')).trim(),
    ).toBe('h264-mp4');
  });
});

describe('presets of your own', () => {
  // What the ripper's deploy writes, so these tests start from the real list.
  const seed = [
    {
      id: 'hevc-mkv',
      name: 'Small and sharp (HEVC, MKV)',
      container: 'mkv',
      video: 'libx265',
      quality: 22,
      speed: 'faster',
      tenBit: true,
      audio: 'copy',
      deinterlace: true,
      subtitles: 'keep',
    },
    {
      id: 'h264-mp4',
      name: 'Plays on anything (H.264, MP4)',
      container: 'mp4',
      video: 'libx264',
      quality: 20,
      speed: 'faster',
      tenBit: false,
      audio: 'aac',
      deinterlace: true,
      subtitles: 'none',
    },
    {
      id: 'h264-mkv',
      name: 'Plays on most things, keeps subtitles (H.264, MKV)',
      container: 'mkv',
      video: 'libx264',
      quality: 20,
      speed: 'faster',
      tenBit: false,
      audio: 'copy',
      deinterlace: true,
      subtitles: 'keep',
    },
    {
      id: 'original-mkv',
      name: 'Untouched picture, big files (no re-encode, MKV)',
      container: 'mkv',
      video: 'copy',
      quality: 22,
      speed: 'faster',
      tenBit: false,
      audio: 'copy',
      deinterlace: false,
      subtitles: 'keep',
    },
  ];
  const mine = {
    name: 'My DVDs',
    container: 'mkv',
    video: 'libx265',
    quality: 18,
    speed: 'slow',
    tenBit: true,
    audio: 'ac3',
    deinterlace: true,
    subtitles: 'keep',
  };
  const file = () => path.join(dir, '_settings', 'presets.json');
  const onDisk = async () => JSON.parse(await fs.readFile(file(), 'utf8'));

  beforeEach(async () => {
    await write('_settings/presets.json', JSON.stringify({ presets: seed }));
  });

  test('a new preset is added after the ones that come with it, and can be chosen', async () => {
    const saved = await savePreset(dir, mine);
    expect(saved).toMatchObject({
      id: 'custom-my-dvds',
      name: 'My DVDs',
      quality: 18,
      speed: 'slow',
      audio: 'ac3',
      builtIn: false,
    });
    const items = (await onDisk()).presets;
    expect(items.slice(0, 4)).toEqual(seed);
    expect(items[4]).toMatchObject({ id: 'custom-my-dvds', quality: 18 });
    const { convert } = await readDiscsState(dir);
    expect(convert.presets.map((preset) => preset.builtIn)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
    await setPreset(dir, 'custom-my-dvds');
    expect((await readDiscsState(dir)).convert.chosen).toBe('custom-my-dvds');
  });

  test('the file stays readable by the ripper: other users can read it', async () => {
    await savePreset(dir, mine);
    expect((await fs.stat(file())).mode & 0o666).toBe(0o666);
    expect((await fs.readdir(path.join(dir, '_settings'))).sort()).toEqual([
      'presets.json',
    ]);
  });

  test('the file holds only what the ripper reads', async () => {
    const first = await savePreset(dir, mine);
    await savePreset(dir, { ...mine, id: first.id, quality: 19 });
    const items = (await onDisk()).presets;
    expect(Object.keys(items[4]).sort()).toEqual(
      [
        'audio',
        'container',
        'deinterlace',
        'id',
        'name',
        'quality',
        'speed',
        'subtitles',
        'tenBit',
        'video',
      ].sort(),
    );
  });

  test('two with the same name get different ids', async () => {
    const first = await savePreset(dir, mine);
    const second = await savePreset(dir, mine);
    expect([first.id, second.id]).toEqual([
      'custom-my-dvds',
      'custom-my-dvds-2',
    ]);
  });

  test('changing one keeps its id and its place, and leaves the others alone', async () => {
    const first = await savePreset(dir, mine);
    await savePreset(dir, { ...mine, name: 'Second' });
    const changed = await savePreset(dir, {
      ...mine,
      id: first.id,
      name: 'Renamed',
      quality: 30,
    });
    expect(changed.id).toBe(first.id);
    const items = (await onDisk()).presets;
    expect(items.map((item: { id: string }) => item.id)).toEqual([
      'hevc-mkv',
      'h264-mp4',
      'h264-mkv',
      'original-mkv',
      'custom-my-dvds',
      'custom-second',
    ]);
    expect(items[4]).toMatchObject({ name: 'Renamed', quality: 30 });
    expect(items[5]).toMatchObject({ name: 'Second', quality: 18 });
  });

  test('the ones that come with it cannot be changed or deleted', async () => {
    const before = await fs.readFile(file(), 'utf8');
    await expect(
      savePreset(dir, { ...mine, id: 'hevc-mkv', quality: 40 }),
    ).rejects.toThrow('built-in');
    await expect(deletePreset(dir, 'hevc-mkv')).rejects.toThrow('built-in');
    await expect(deletePreset(dir, 'original-mkv')).rejects.toThrow('built-in');
    expect(await fs.readFile(file(), 'utf8')).toBe(before);
  });

  test('what is wrong is said in plain words, and nothing is written', async () => {
    const before = await fs.readFile(file(), 'utf8');
    const bad: [Record<string, unknown>, string][] = [
      [{ ...mine, name: '   ' }, 'name'],
      [{ ...mine, name: 'x'.repeat(61) }, '60'],
      [{ ...mine, quality: 52 }, 'Quality'],
      [{ ...mine, quality: -1 }, 'Quality'],
      [{ ...mine, quality: 22.5 }, 'Quality'],
      [{ ...mine, quality: '22' }, 'Quality'],
      [{ ...mine, container: 'avi; rm -rf /' }, 'file type'],
      [{ ...mine, video: 'libvpx' }, 'video'],
      [{ ...mine, speed: 'warp' }, 'speed'],
      [{ ...mine, audio: 'opus' }, 'sound'],
      [{ ...mine, subtitles: 'maybe' }, 'subtitles'],
      [{ ...mine, id: 'not-there' }, 'not there'],
    ];
    for (const [input, word] of bad) {
      await expect(savePreset(dir, input)).rejects.toThrow(word);
    }
    expect(await fs.readFile(file(), 'utf8')).toBe(before);
  });

  test('values that cannot work together are corrected, as the ripper does', async () => {
    const mp4 = await savePreset(dir, {
      ...mine,
      name: 'Phone',
      container: 'mp4',
      subtitles: 'keep',
    });
    expect(mp4.subtitles).toBe('none');
    const old = await savePreset(dir, {
      ...mine,
      name: 'Old',
      video: 'libx264',
      tenBit: true,
    });
    expect(old.tenBit).toBe(false);
    const raw = await savePreset(dir, {
      ...mine,
      name: 'Raw',
      video: 'copy',
      deinterlace: true,
    });
    expect(raw.deinterlace).toBe(false);
  });

  test('a name with odd characters stays text, and the id is only letters, digits and dashes', async () => {
    const saved = await savePreset(dir, {
      ...mine,
      name: '../../etc/pass\nwd "; rm -rf / $(x)\u0007',
    });
    expect(saved.id).toMatch(/^custom-[a-z0-9-]+$/);
    expect(saved.id.length).toBeLessThanOrEqual(40);
    expect(saved.name).not.toMatch(/[\u0000-\u001f]/);
    expect(saved.name).toContain('etc/pass');
    const nothing = await savePreset(dir, { ...mine, name: '日本語' });
    expect(nothing.id).toBe('custom-preset');
  });

  test('deleting removes only that one, and a deleted pick falls back to the default', async () => {
    const one = await savePreset(dir, mine);
    await savePreset(dir, { ...mine, name: 'Keep me' });
    await setPreset(dir, one.id);
    await deletePreset(dir, one.id);
    const { convert } = await readDiscsState(dir);
    expect(convert.presets.map((preset) => preset.id)).toEqual([
      'hevc-mkv',
      'h264-mp4',
      'h264-mkv',
      'original-mkv',
      'custom-keep-me',
    ]);
    expect(convert.chosen).toBe('hevc-mkv');
    await expect(deletePreset(dir, one.id)).rejects.toThrow('not there');
  });

  test('deleting the chosen one clears the pick, so a new one with the same name is not chosen by surprise', async () => {
    const one = await savePreset(dir, mine);
    await setPreset(dir, one.id);
    await deletePreset(dir, one.id);
    await expect(
      fs.stat(path.join(dir, '_settings', 'preset')),
    ).rejects.toThrow();
    await savePreset(dir, mine);
    expect((await readDiscsState(dir)).convert.chosen).toBe('hevc-mkv');
    // A pick that is somebody else's is left alone.
    await setPreset(dir, 'h264-mp4');
    await deletePreset(dir, 'custom-my-dvds');
    expect((await readDiscsState(dir)).convert.chosen).toBe('h264-mp4');
  });

  test('without the list there is nothing to add to, and no file is made', async () => {
    await fs.rm(file());
    await expect(savePreset(dir, mine)).rejects.toThrow('not there yet');
    await expect(fs.stat(file())).rejects.toThrow();
    await write('_settings/presets.json', '{not json');
    await expect(savePreset(dir, mine)).rejects.toThrow('not there yet');
    expect(await fs.readFile(file(), 'utf8')).toBe('{not json');
  });

  test('saves at the same moment all land', async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, n) =>
        savePreset(dir, { ...mine, name: `Number ${n}` }),
      ),
    );
    expect((await onDisk()).presets).toHaveLength(16);
  });

  test('the list stops growing at 30', async () => {
    for (let n = 0; n < 26; n++) {
      await savePreset(dir, { ...mine, name: `Number ${n}` });
    }
    await expect(
      savePreset(dir, { ...mine, name: 'One more' }),
    ).rejects.toThrow('plenty');
    expect((await onDisk()).presets).toHaveLength(30);
  });

  test('entries the page does not understand are kept when it saves', async () => {
    await write(
      '_settings/presets.json',
      JSON.stringify({ presets: [...seed, { id: 'Bad Id', odd: true }] }),
    );
    await savePreset(dir, mine);
    expect((await onDisk()).presets[4]).toEqual({ id: 'Bad Id', odd: true });
  });
});
