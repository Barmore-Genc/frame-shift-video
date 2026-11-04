import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { clearCopiesCache, findCopies } from '../../server/extras-copies';

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
