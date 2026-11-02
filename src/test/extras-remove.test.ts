import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  readExtras,
  readRemoved,
  removeExtras,
  restoreExtras,
} from '../../server/extras-state';
import { findDuplicates } from '../../server/extras-duplicates';
import {
  discsExtrasDuplicatesHandler,
  discsExtrasRemoveHandler,
} from '../../server/handlers/discs';

const MOVIE = 'Charlotte (2003)';
const A = `_converted/${MOVIE}/Other/Extra 01 (6 min).mkv`;
const B = `_converted/${MOVIE}/Trailers/Previews.mkv`;
const C = `_converted/${MOVIE}/Other/Extra 03 (6 min).mkv`;
const D = `_converted/${MOVIE}/Other/Extra 04 (6 min).mkv`;

let dir: string;
let sample: string;
const realEnv = process.env.DISC_RIP_DIR;

function video(file: string, source: string, seconds: number) {
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `${source}=size=320x180:rate=24:duration=${seconds}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${seconds}`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    file,
  ]);
}

beforeAll(async () => {
  sample = await fs.mkdtemp(path.join(os.tmpdir(), 'extras-samples-'));
  video(path.join(sample, 'a.mkv'), 'testsrc', 4);
  video(path.join(sample, 'other.mkv'), 'testsrc2', 4);
  // The same pictures as a.mkv for longer: stream-copied from it, looped, so its frames are the same.
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-stream_loop',
    '1',
    '-i',
    path.join(sample, 'a.mkv'),
    '-c',
    'copy',
    '-t',
    '5.5',
    path.join(sample, 'longer.mkv'),
  ]);
});
afterAll(async () => {
  await fs.rm(sample, { recursive: true, force: true });
});

async function place(relative: string, from?: string) {
  const file = path.join(dir, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (from) await fs.copyFile(path.join(sample, from), file);
  else await fs.writeFile(file, 'video');
}
const exists = (relative: string) =>
  fs.access(path.join(dir, relative)).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'extras-remove-'));
  process.env.DISC_RIP_DIR = dir;
  await place(`_converted/${MOVIE}/${MOVIE}.mkv`);
});
afterEach(async () => {
  if (realEnv === undefined) delete process.env.DISC_RIP_DIR;
  else process.env.DISC_RIP_DIR = realEnv;
  await fs.rm(dir, { recursive: true, force: true });
});

describe('removing extras', () => {
  test('moves each to _removed in its folder, deleting nothing', async () => {
    await place(A);
    await place(B);
    const answer = await removeExtras(dir, [A, B]);
    expect(answer).toEqual({ removed: [A, B], failed: [] });
    expect(await exists(A)).toBe(false);
    expect(await exists(`_removed/${MOVIE}/Other/Extra 01 (6 min).mkv`)).toBe(
      true,
    );
    expect(await exists(`_removed/${MOVIE}/Trailers/Previews.mkv`)).toBe(true);
    expect(
      await fs.readFile(
        path.join(dir, `_removed/${MOVIE}/Trailers/Previews.mkv`),
        'utf8',
      ),
    ).toBe('video');
  });

  test('a name already in _removed gets a number, so nothing is overwritten', async () => {
    await place(B);
    await removeExtras(dir, [B]);
    await fs.writeFile(
      path.join(dir, `_removed/${MOVIE}/Trailers/Previews.mkv`),
      'first',
    );
    await place(B);
    await removeExtras(dir, [B]);
    expect(
      await fs.readFile(
        path.join(dir, `_removed/${MOVIE}/Trailers/Previews.mkv`),
        'utf8',
      ),
    ).toBe('first');
    expect(await exists(`_removed/${MOVIE}/Trailers/Previews (2).mkv`)).toBe(
      true,
    );
  });

  test('an extras folder left empty is tidied away, one with files is left', async () => {
    await place(A);
    await place(C);
    await place(B);
    await removeExtras(dir, [B]);
    expect(await exists(`_converted/${MOVIE}/Trailers`)).toBe(false);
    await removeExtras(dir, [A]);
    expect(await exists(`_converted/${MOVIE}/Other`)).toBe(true);
    expect(await exists(C)).toBe(true);
  });

  test('what cannot be removed is reported and the rest still are', async () => {
    await place(A);
    await place('secret.mkv');
    const answer = await removeExtras(dir, [
      '_converted/' + MOVIE + '/' + MOVIE + '.mkv',
      '../etc/Other/x.mkv',
      'secret.mkv',
      `_converted/${MOVIE}/Other/Gone.mkv`,
      A,
    ]);
    expect(answer.removed).toEqual([A]);
    expect(answer.failed.map((f) => f.path)).toEqual([
      `_converted/${MOVIE}/${MOVIE}.mkv`,
      '../etc/Other/x.mkv',
      'secret.mkv',
      `_converted/${MOVIE}/Other/Gone.mkv`,
    ]);
    expect(await exists(`_converted/${MOVIE}/${MOVIE}.mkv`)).toBe(true);
    expect(await exists('secret.mkv')).toBe(true);
  });

  test('a link out of the library is refused and its target untouched', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'extras-out-'));
    await fs.writeFile(path.join(outside, 'x.mkv'), 'leak');
    await fs.mkdir(path.join(dir, `_converted/${MOVIE}/Other`), {
      recursive: true,
    });
    await fs.symlink(path.join(outside, 'x.mkv'), path.join(dir, A));
    const answer = await removeExtras(dir, [A]);
    expect(answer.removed).toEqual([]);
    expect(await fs.readFile(path.join(outside, 'x.mkv'), 'utf8')).toBe('leak');
    await fs.rm(outside, { recursive: true, force: true });
  });

  test('nothing, too many, and the same path twice', async () => {
    await expect(removeExtras(dir, [])).rejects.toThrow('Pick');
    await expect(removeExtras(dir, 'x')).rejects.toThrow('Pick');
    await expect(
      removeExtras(
        dir,
        Array.from({ length: 201 }, (_, i) => `a${i}`),
      ),
    ).rejects.toThrow('too many');
    await place(A);
    expect((await removeExtras(dir, [A, A])).removed).toEqual([A]);
  });

  test('the route moves them, and refuses a body with no paths', async () => {
    await place(A);
    const response = await discsExtrasRemoveHandler(
      new Request('http://x/api', {
        method: 'POST',
        body: JSON.stringify({ paths: [A] }),
      }),
      {},
    );
    expect(await response.json()).toEqual({ removed: [A], failed: [] });
    const bad = await discsExtrasRemoveHandler(
      new Request('http://x/api', { method: 'POST', body: JSON.stringify({}) }),
      {},
    );
    expect(bad.status).toBe(400);
  });
});

describe('finding duplicates', () => {
  test('every one of the three moments has to match', async () => {
    await place(A, 'a.mkv');
    await place(B, 'a.mkv');
    const asked: number[] = [];
    const sameUntil = (moment: number) => async (_file: string, at: number) => {
      asked.push(at);
      return at < moment ? 'same' : `${_file}-${at}`;
    };
    // Alike at the first moment and the second, different at the last: not a copy.
    expect(await findDuplicates(dir, MOVIE, sameUntil(3))).toEqual([]);
    expect([...new Set(asked)].sort()).toEqual([0.8, 2, 3.2]);
    // Alike at the first only: not a copy.
    expect(await findDuplicates(dir, MOVIE, sameUntil(1))).toEqual([]);
    // Alike at all three: a copy.
    expect(await findDuplicates(dir, MOVIE, sameUntil(100))).toHaveLength(1);
  });

  test('a picture that cannot be read is not called the same', async () => {
    await place(A, 'a.mkv');
    await place(B, 'a.mkv');
    const broken = async () => {
      throw new Error('no picture');
    };
    expect(await findDuplicates(dir, MOVIE, broken)).toEqual([]);
  });

  test('the same length and the same pictures is a copy, and only that', async () => {
    await place(A, 'a.mkv');
    await place(B, 'a.mkv');
    await place(C, 'other.mkv'); // the same length, another picture
    await place(D, 'longer.mkv'); // the same picture, another length
    const groups = await findDuplicates(dir, MOVIE);
    expect(groups).toHaveLength(1);
    // In the order the page lists them: Trailers before Other.
    expect(groups[0]).toEqual([B, A]);
  });

  test('three copies are one group', async () => {
    await place(A, 'a.mkv');
    await place(B, 'a.mkv');
    await place(C, 'a.mkv');
    const groups = await findDuplicates(dir, MOVIE);
    expect(groups).toHaveLength(1);
    expect([...groups[0]!].sort()).toEqual([A, B, C].sort());
  });

  test('nothing alike gives no groups, and a file that is not a video is not compared', async () => {
    await place(A, 'a.mkv');
    await place(C, 'other.mkv');
    await place(D);
    expect(await findDuplicates(dir, MOVIE)).toEqual([]);
  });

  test('a movie with no extras is refused', async () => {
    await expect(findDuplicates(dir, 'Nothing (1999)')).rejects.toThrow(
      'no extras',
    );
  });

  test('the route says the groups', async () => {
    await place(A, 'a.mkv');
    await place(B, 'a.mkv');
    const response = await discsExtrasDuplicatesHandler(
      new Request(`http://x/api?${new URLSearchParams({ movie: MOVIE })}`),
      {},
    );
    expect(
      ((await response.json()) as { groups: string[][] }).groups,
    ).toHaveLength(1);
    expect(
      (await discsExtrasDuplicatesHandler(new Request('http://x/api'), {}))
        .status,
    ).toBe(400);
  });
});

describe('the removed extras', () => {
  const GONE = `_removed/${MOVIE}/Other/Extra 01 (6 min).mkv`;

  test("are listed with their movie and folder, and are no longer the movie's extras", async () => {
    await place(A);
    await place(B);
    await removeExtras(dir, [A, B]);
    // In the order of the extras folders, so a trailer comes before an "Other".
    expect(await readRemoved(dir)).toEqual([
      {
        path: `_removed/${MOVIE}/Trailers/Previews.mkv`,
        movie: MOVIE,
        folder: 'Trailers',
        name: 'Previews',
      },
      { path: GONE, movie: MOVIE, folder: 'Other', name: 'Extra 01 (6 min)' },
    ]);
    expect(await readExtras(dir)).toEqual([]);
  });

  test('nothing removed is an empty list', async () => {
    expect(await readRemoved(dir)).toEqual([]);
  });

  test('putting back returns the file to its folder and tidies the empty one', async () => {
    await place(A);
    await removeExtras(dir, [A]);
    expect(await restoreExtras(dir, [GONE])).toEqual({
      restored: [GONE],
      failed: [],
    });
    expect(await exists(A)).toBe(true);
    expect(await exists(`_removed/${MOVIE}`)).toBe(false);
    expect(await readRemoved(dir)).toEqual([]);
  });

  test('a name taken since gets a number, so the newer file is kept', async () => {
    await place(A);
    await removeExtras(dir, [A]);
    await place(A);
    await fs.writeFile(path.join(dir, A), 'newer');
    await restoreExtras(dir, [GONE]);
    expect(await fs.readFile(path.join(dir, A), 'utf8')).toBe('newer');
    expect(
      await exists(`_converted/${MOVIE}/Other/Extra 01 (6 min) (2).mkv`),
    ).toBe(true);
  });

  test('an extra whose movie is gone is reported, and the others are still put back', async () => {
    await place(A);
    await removeExtras(dir, [A]);
    await place(`_removed/Gone (1999)/Other/Extra 01 (1 min).mkv`);
    const answer = await restoreExtras(dir, [
      `_removed/Gone (1999)/Other/Extra 01 (1 min).mkv`,
      GONE,
    ]);
    expect(answer.restored).toEqual([GONE]);
    expect(answer.failed).toEqual([
      {
        path: `_removed/Gone (1999)/Other/Extra 01 (1 min).mkv`,
        error: 'That movie is not there any more',
      },
    ]);
  });

  test('only a video under _removed in an extras folder can be put back', async () => {
    await place(`_converted/${MOVIE}/Other/Extra 09 (1 min).mkv`);
    const answer = await restoreExtras(dir, [
      `_converted/${MOVIE}/Other/Extra 09 (1 min).mkv`,
      `_removed/${MOVIE}/../${MOVIE}/Other/x.mkv`,
      `_removed/${MOVIE}/Notes/x.mkv`,
      `_removed/${MOVIE}/Other/x.txt`,
      42,
    ]);
    expect(answer.restored).toEqual([]);
    expect(answer.failed).toHaveLength(5);
    expect(
      answer.failed.every((f) => f.error === 'That is not a removed extra'),
    ).toBe(true);
    await expect(restoreExtras(dir, [])).rejects.toThrow('Pick the extras');
  });
});
