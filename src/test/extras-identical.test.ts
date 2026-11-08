import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { findIdentical, removeIdentical } from '../../server/extras-identical';
import { discsExtrasRemoveIdenticalHandler } from '../../server/handlers/discs';

const MOVIE = 'Charlotte (2003)';
const A = `_converted/${MOVIE}/Other/Extra 01 (6 min).mkv`;
const B = `_converted/${MOVIE}/Other/Extra 02 (6 min).mkv`;
const C = `_converted/${MOVIE}/Other/Extra 03 (6 min).mkv`;
const NAMED = `_converted/${MOVIE}/Trailers/Previews.mkv`;

let dir: string;
const realEnv = process.env.DISC_RIP_DIR;

async function place(relative: string, content: string) {
  const file = path.join(dir, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}
const exists = (relative: string) =>
  fs.access(path.join(dir, relative)).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'extras-identical-'));
  process.env.DISC_RIP_DIR = dir;
  await place(`_converted/${MOVIE}/${MOVIE}.mkv`, 'movie');
});
afterEach(async () => {
  if (realEnv === undefined) delete process.env.DISC_RIP_DIR;
  else process.env.DISC_RIP_DIR = realEnv;
  await fs.rm(dir, { recursive: true, force: true });
});

describe('identical extras', () => {
  test('finds files with the same bytes, in the order the page lists them', async () => {
    await place(A, 'same bytes');
    await place(B, 'other bytes');
    await place(C, 'same bytes');
    expect(await findIdentical(dir, MOVIE)).toEqual([[A, C]]);
  });

  test('files of the same size with different bytes are not identical', async () => {
    await place(A, 'aaaa');
    await place(B, 'aaab');
    expect(await findIdentical(dir, MOVIE)).toEqual([]);
  });

  test('files of different sizes are not identical', async () => {
    await place(A, 'aaaa');
    await place(B, 'aaaaa');
    expect(await findIdentical(dir, MOVIE)).toEqual([]);
  });

  test('keeps one of each set and moves the rest to _removed', async () => {
    await place(A, 'one');
    await place(B, 'one');
    await place(C, 'one');
    const answer = await removeIdentical(dir, MOVIE);
    expect(answer).toEqual({ kept: [A], removed: [B, C], failed: [] });
    expect(await exists(A)).toBe(true);
    expect(await exists(B)).toBe(false);
    expect(await exists(C)).toBe(false);
    expect(await exists(`_removed/${MOVIE}/Other/Extra 02 (6 min).mkv`)).toBe(
      true,
    );
    expect(await exists(`_removed/${MOVIE}/Other/Extra 03 (6 min).mkv`)).toBe(
      true,
    );
  });

  test('keeps the one that has a name over one that is still the ripper’s own', async () => {
    await place(A, 'one');
    await place(NAMED, 'one');
    const answer = await removeIdentical(dir, MOVIE);
    expect(answer.kept).toEqual([NAMED]);
    expect(answer.removed).toEqual([A]);
    expect(await exists(NAMED)).toBe(true);
    expect(await exists(A)).toBe(false);
  });

  test('keeps one of each of several sets', async () => {
    await place(A, 'one');
    await place(B, 'two');
    await place(C, 'one');
    await place(NAMED, 'two');
    const answer = await removeIdentical(dir, MOVIE);
    expect(answer.kept.sort()).toEqual([A, NAMED].sort());
    expect(answer.removed.sort()).toEqual([B, C].sort().reverse().sort());
    expect(answer.failed).toEqual([]);
  });

  test('moves nothing when no two are the same', async () => {
    await place(A, 'one');
    await place(B, 'two');
    expect(await removeIdentical(dir, MOVIE)).toEqual({
      kept: [],
      removed: [],
      failed: [],
    });
    expect(await exists(A)).toBe(true);
    expect(await exists(B)).toBe(true);
    expect(await exists('_removed')).toBe(false);
  });

  test('a movie with no extras is an error', async () => {
    await expect(findIdentical(dir, 'Nothing (1999)')).rejects.toThrow(
      'That movie has no extras',
    );
  });
});

describe('the remove-identical handler', () => {
  const ask = (body: unknown) =>
    discsExtrasRemoveIdenticalHandler(
      new Request('http://x/api/discs/extras/remove-identical', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      {},
    );

  test('answers what was kept and moved', async () => {
    await place(A, 'one');
    await place(B, 'one');
    const response = await ask({ movie: MOVIE });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      kept: [A],
      removed: [B],
      failed: [],
    });
  });

  test('wants a movie', async () => {
    expect((await ask({})).status).toBe(400);
    expect((await ask({ movie: 5 })).status).toBe(400);
  });

  test('a movie with no extras is a bad request', async () => {
    expect((await ask({ movie: 'Nothing (1999)' })).status).toBe(400);
  });
});
