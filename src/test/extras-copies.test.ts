import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  clearCopiesCache,
  findCopies,
  keptCopies,
  REFRESH_MS,
  warmCopies,
} from '../../server/extras-copies';

const MOVIE = 'Charlotte (2003)';
const A = `_converted/${MOVIE}/Other/Extra 01.mkv`;
const B = `_converted/${MOVIE}/Other/Extra 02.mkv`;
const ANSWER = { groups: [[A, B]], reels: [] };

let dir: string;

async function place(relative: string, content: string) {
  const file = path.join(dir, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

beforeEach(async () => {
  clearCopiesCache();
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'extras-copies-'));
  await place(`_converted/${MOVIE}/${MOVIE}.mkv`, 'movie');
  await place(A, 'one');
  await place(B, 'two');
});
afterEach(async () => {
  clearCopiesCache();
  await fs.rm(dir, { recursive: true, force: true });
});

function counting(answer = ANSWER, delayMs = 0) {
  const calls = { n: 0 };
  const search = async () => {
    calls.n++;
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return answer;
  };
  return { calls, search };
}

describe('keeping the copies and reels of a movie', () => {
  test('the second look does not search again', async () => {
    const { calls, search } = counting();
    expect(await findCopies(dir, MOVIE, { search })).toEqual(ANSWER);
    expect(await findCopies(dir, MOVIE, { search })).toEqual(ANSWER);
    expect(calls.n).toBe(1);
  });

  test('two looks at the same time share one search', async () => {
    const { calls, search } = counting(ANSWER, 30);
    const both = await Promise.all([
      findCopies(dir, MOVIE, { search }),
      findCopies(dir, MOVIE, { search }),
    ]);
    expect(both).toEqual([ANSWER, ANSWER]);
    expect(calls.n).toBe(1);
  });

  test('another movie is searched on its own', async () => {
    const other = 'Duma (2005)';
    await place(`_converted/${other}/${other}.mkv`, 'movie');
    await place(`_converted/${other}/Other/Extra 01.mkv`, 'x');
    const { calls, search } = counting();
    await findCopies(dir, MOVIE, { search });
    await findCopies(dir, other, { search });
    // Each is kept: asking about the first again does not search again.
    await findCopies(dir, MOVIE, { search });
    expect(calls.n).toBe(2);
  });

  test('it is searched again after an hour', async () => {
    const { calls, search } = counting();
    const start = Date.now();
    await findCopies(dir, MOVIE, { search, now: start });
    await findCopies(dir, MOVIE, { search, now: start + 59 * 60 * 1000 });
    expect(calls.n).toBe(1);
    await findCopies(dir, MOVIE, { search, now: start + 61 * 60 * 1000 });
    expect(calls.n).toBe(2);
  });

  test('it is searched again when an extra changes, is added or is gone', async () => {
    const { calls, search } = counting();
    await findCopies(dir, MOVIE, { search });
    // Another size, with the time put back to what it was.
    const before = await fs.stat(path.join(dir, B));
    await place(B, 'two, longer');
    await fs.utimes(path.join(dir, B), before.atime, before.mtime);
    await findCopies(dir, MOVIE, { search });
    expect(calls.n).toBe(2);
    await place(`_converted/${MOVIE}/Other/Extra 03.mkv`, 'three');
    await findCopies(dir, MOVIE, { search });
    expect(calls.n).toBe(3);
    await fs.rm(path.join(dir, A));
    await findCopies(dir, MOVIE, { search });
    expect(calls.n).toBe(4);
  });

  test('a search that failed is not kept', async () => {
    let n = 0;
    const search = async () => {
      n++;
      if (n === 1) throw new Error('the listener fell over');
      return ANSWER;
    };
    await expect(findCopies(dir, MOVIE, { search })).rejects.toThrow('fell');
    expect(await findCopies(dir, MOVIE, { search })).toEqual(ANSWER);
    expect(n).toBe(2);
  });

  test('a movie with no extras is refused', async () => {
    await expect(findCopies(dir, 'Nothing (1999)', {})).rejects.toThrow(
      'no extras',
    );
  });
});

describe('warming the copies and reels of a movie ahead of a page', () => {
  test('a warmed movie is kept, so the page does not search', async () => {
    const { calls, search } = counting();
    await warmCopies(dir, MOVIE, { search });
    expect(await findCopies(dir, MOVIE, { search })).toEqual(ANSWER);
    expect(calls.n).toBe(1);
  });

  test('a page that asks during the first search joins it', async () => {
    const { calls, search } = counting(ANSWER, 30);
    const warming = warmCopies(dir, MOVIE, { search });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await findCopies(dir, MOVIE, { search })).toEqual(ANSWER);
    await warming;
    expect(calls.n).toBe(1);
  });

  test('a fresh answer is left alone and one half an hour old is searched for again', async () => {
    const { calls, search } = counting();
    const start = Date.now();
    await warmCopies(dir, MOVIE, { search, now: start });
    await warmCopies(dir, MOVIE, {
      search,
      now: start + REFRESH_MS - 1000,
    });
    expect(calls.n).toBe(1);
    await warmCopies(dir, MOVIE, {
      search,
      now: start + REFRESH_MS + 1000,
    });
    expect(calls.n).toBe(2);
  });

  test('a page that asks while an old answer is being renewed gets the old one at once', async () => {
    const start = Date.now();
    await findCopies(dir, MOVIE, { search: async () => ANSWER, now: start });
    const renewed = { groups: [], reels: [] };
    const slow = async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return renewed;
    };
    const later = start + REFRESH_MS + 1000;
    const warming = warmCopies(dir, MOVIE, { search: slow, now: later });
    const began = Date.now();
    expect(await findCopies(dir, MOVIE, { search: slow, now: later })).toEqual(
      ANSWER,
    );
    expect(Date.now() - began).toBeLessThan(60);
    await warming;
    // ...and once the search is done, the new answer is the one kept.
    expect(await findCopies(dir, MOVIE, { search: slow, now: later })).toEqual(
      renewed,
    );
  });

  test('a movie whose extras changed is searched for again, and a failed warm is not kept', async () => {
    const { calls, search } = counting();
    await warmCopies(dir, MOVIE, { search });
    await place(`_converted/${MOVIE}/Other/Extra 03.mkv`, 'three');
    await warmCopies(dir, MOVIE, { search });
    expect(calls.n).toBe(2);
    await place(`_converted/${MOVIE}/Other/Extra 04.mkv`, 'four');
    const failing = async (): Promise<typeof ANSWER> => {
      throw new Error('the listener fell over');
    };
    await expect(warmCopies(dir, MOVIE, { search: failing })).rejects.toThrow(
      'fell',
    );
    expect(await findCopies(dir, MOVIE, { search })).toEqual(ANSWER);
    expect(calls.n).toBe(3);
  });
});

describe('what is kept, without searching', () => {
  test('nothing before a search, then the answer, then nothing once it is old or the extras changed', async () => {
    const { calls, search } = counting();
    const start = Date.now();
    expect(await keptCopies(dir, MOVIE, start)).toBeNull();
    await findCopies(dir, MOVIE, { search, now: start });
    expect(await keptCopies(dir, MOVIE, start + 1000)).toEqual(ANSWER);
    expect(await keptCopies(dir, MOVIE, start + 61 * 60 * 1000)).toBeNull();
    await place(`_converted/${MOVIE}/Other/Extra 03.mkv`, 'three');
    expect(await keptCopies(dir, MOVIE, start + 1000)).toBeNull();
    expect(calls.n).toBe(1); // it never searched
  });

  test('a search still going is not waited for', async () => {
    const { search } = counting(ANSWER, 50);
    const going = findCopies(dir, MOVIE, { search });
    expect(await keptCopies(dir, MOVIE)).toBeNull();
    await going;
    expect(await keptCopies(dir, MOVIE)).toEqual(ANSWER);
  });
});
