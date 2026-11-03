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
import { candidateRuns, findReels, type Look } from '../../server/extras-reels';
import { discsExtrasDuplicatesHandler } from '../../server/handlers/discs';

const MOVIE = 'Charlotte (2003)';
const extra = (n: number) => `_converted/${MOVIE}/Other/Extra ${n}.mkv`;
const [REEL, P1, P2, P3, SHORT, DECOY] = [1, 2, 3, 4, 5, 6].map(extra);

let dir: string;
let sample: string;
const realEnv = process.env.DISC_RIP_DIR;

function color(file: string, hex: string, seconds: number) {
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=${hex}:size=320x180:rate=12:duration=${seconds}`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    file,
  ]);
}

beforeAll(async () => {
  sample = await fs.mkdtemp(path.join(os.tmpdir(), 'reel-samples-'));
  color(path.join(sample, 'p1.mkv'), '0x202020', 12);
  color(path.join(sample, 'p2.mkv'), '0x646464', 10);
  color(path.join(sample, 'p3.mkv'), '0xc8c8c8', 8);
  color(path.join(sample, 'short.mkv'), '0x9a9a9a', 5);
  color(path.join(sample, 'tenreel.mkv'), '0x9a9a9a', 10);
  // The same length as the three, but not their pictures.
  color(path.join(sample, 'decoy.mkv'), '0x404040', 30);
  await fs.writeFile(
    path.join(sample, 'list.txt'),
    ['p1', 'p2', 'p3']
      .map((n) => `file '${path.join(sample, n)}.mkv'`)
      .join('\n'),
  );
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    path.join(sample, 'list.txt'),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    path.join(sample, 'reel.mkv'),
  ]);
});
afterAll(async () => {
  await fs.rm(sample, { recursive: true, force: true });
});

async function place(relative: string, from: string) {
  const file = path.join(dir, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.copyFile(path.join(sample, from), file);
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'extras-reels-'));
  process.env.DISC_RIP_DIR = dir;
  await fs.mkdir(path.join(dir, `_converted/${MOVIE}`), { recursive: true });
  await fs.writeFile(path.join(dir, `_converted/${MOVIE}/${MOVIE}.mkv`), 'm');
});
afterEach(async () => {
  if (realEnv === undefined) delete process.env.DISC_RIP_DIR;
  else process.env.DISC_RIP_DIR = realEnv;
  await fs.rm(dir, { recursive: true, force: true });
});

const at = (seconds: number, path = '') => ({ path, real: path, seconds });

describe('which runs of extras add up to a reel', () => {
  test('a run of two or more next to each other that adds up to the reel', () => {
    const others = [
      at(50, 'a'),
      at(12, 'b'),
      at(10, 'c'),
      at(8, 'd'),
      at(70, 'e'),
    ];
    const runs = candidateRuns(at(30), others);
    expect(runs.map((r) => r.map((m) => m.path))).toEqual([['b', 'c', 'd']]);
  });

  test('one extra of the reel length is a copy, not a reel', () => {
    expect(candidateRuns(at(30), [at(30, 'a'), at(5, 'b')])).toEqual([]);
  });

  test('a run that skips an extra in between does not count', () => {
    expect(
      candidateRuns(at(30), [at(12, 'a'), at(99, 'x'), at(18, 'b')]),
    ).toEqual([]);
  });

  test('a little off is allowed, a lot is not, and the longest run comes first', () => {
    const close = candidateRuns(at(1000), [at(500, 'a'), at(488, 'b')]);
    expect(close).toHaveLength(1);
    expect(candidateRuns(at(1000), [at(500, 'a'), at(470, 'b')])).toEqual([]);
    // The shorter run is found first in the list, and still comes second.
    const both = candidateRuns(at(30), [
      at(20, 'd'),
      at(10, 'a'),
      at(10, 'b'),
      at(10, 'c'),
    ]);
    expect(both.map((r) => r.length)).toEqual([3, 2]);
  });
});

describe('finding reels', () => {
  test('the reel is found by its length and its pictures, with its parts in order', async () => {
    await place(REEL, 'reel.mkv');
    await place(P1, 'p1.mkv');
    await place(P2, 'p2.mkv');
    await place(P3, 'p3.mkv');
    await place(SHORT, 'short.mkv');
    expect(await findReels(dir, MOVIE)).toEqual([
      { path: REEL, parts: [P1, P2, P3] },
    ]);
  });

  test('the right length with other pictures is not a reel', async () => {
    await place(DECOY, 'decoy.mkv');
    await place(P1, 'p1.mkv');
    await place(P2, 'p2.mkv');
    await place(P3, 'p3.mkv');
    expect(await findReels(dir, MOVIE)).toEqual([]);
  });

  test('most of the parts have to be in the reel', async () => {
    await place(REEL, 'reel.mkv');
    await place(P1, 'p1.mkv');
    await place(P2, 'p2.mkv');
    await place(P3, 'p3.mkv');
    const pictures =
      (ids: number[]): Look =>
      async (file) =>
        file.endsWith('Extra 1.mkv')
          ? Array.from({ length: 80 }, () => new Uint8Array(768).fill(50))
          : [
              new Uint8Array(768).fill(
                ids.includes(Number(/Extra (\d)/.exec(file)![1])) ? 50 : 200,
              ),
            ];
    // One part in three is in the reel: not enough.
    expect(await findReels(dir, MOVIE, pictures([2]))).toEqual([]);
    // Two in three are.
    expect(await findReels(dir, MOVIE, pictures([2, 3]))).toHaveLength(1);
  });

  test('a reel of ten seconds is too short to be told from two clips that look alike', async () => {
    await place(REEL, 'tenreel.mkv');
    await place(P1, 'short.mkv');
    await place(P2, 'short.mkv');
    expect(await findReels(dir, MOVIE)).toEqual([]);
  });

  test('a part is looked for where it should be in the reel, not anywhere', async () => {
    await place(REEL, 'reel.mkv');
    await place(P1, 'p1.mkv');
    await place(P2, 'p2.mkv');
    await place(P3, 'p3.mkv');
    // The reel's pictures are all alike but for one, at second `when`; every part shows that one.
    const oneAt =
      (when: number): Look =>
      async (file) =>
        file.endsWith('Extra 1.mkv')
          ? Array.from({ length: 80 }, (_, i) =>
              new Uint8Array(768).fill(i === when ? 50 : 200),
            )
          : [new Uint8Array(768).fill(50)];
    // Where the second and third parts are expected (from about 12 and 22 s): found.
    expect(await findReels(dir, MOVIE, oneAt(30))).toHaveLength(1);
    // Far from where any of them is expected: not found.
    expect(await findReels(dir, MOVIE, oneAt(75))).toEqual([]);
  });

  test('the reel is looked at no more than it takes to be sure', async () => {
    await place(REEL, 'reel.mkv');
    await place(P1, 'p1.mkv');
    await place(P2, 'p2.mkv');
    await place(P3, 'p3.mkv');
    const asked = { reel: 0, part: 0 };
    const picture =
      (value: number): Look =>
      async (file) => {
        if (file.endsWith('Extra 1.mkv')) {
          asked.reel++;
          return Array.from({ length: 80 }, () =>
            new Uint8Array(768).fill(200),
          );
        }
        asked.part++;
        return [new Uint8Array(768).fill(value)];
      };
    // Every part is in it: the first two parts say so, and the third is not looked at (a look at the reel would be new).
    expect(await findReels(dir, MOVIE, picture(200))).toHaveLength(1);
    // (The first two parts are near the start, so one look at the reel serves both.)
    expect(asked).toEqual({ reel: 1, part: 2 });
    // None is: the first two parts, each at its three moments, say so.
    asked.reel = asked.part = 0;
    expect(await findReels(dir, MOVIE, picture(50))).toEqual([]);
    expect(asked).toEqual({ reel: 1, part: 6 });
  });

  test('what a reel is made of is not looked at as a reel of its own', async () => {
    // The reel is 48 + 40 + 32 s. The 40 s part is also the 12 and 28 s extras together, which
    // would make it a reel of those two if it were looked at.
    for (const [name, seconds] of [
      ['r', 120],
      ['q1', 12],
      ['q2', 28],
      ['b1', 48],
      ['b2', 40],
      ['b3', 32],
    ] as const) {
      color(path.join(sample, `${name}.mkv`), '0x646464', seconds);
    }
    await place(extra(1), 'r.mkv');
    await place(extra(2), 'q1.mkv');
    await place(extra(3), 'q2.mkv');
    await place(extra(4), 'b1.mkv');
    await place(extra(5), 'b2.mkv');
    await place(extra(6), 'b3.mkv');
    const every: Look = async () => [new Uint8Array(768).fill(100)];
    expect(await findReels(dir, MOVIE, every)).toEqual([
      { path: extra(1), parts: [extra(4), extra(5), extra(6)] },
    ]);
  });

  test('a picture that cannot be read is not found', async () => {
    await place(REEL, 'reel.mkv');
    await place(P1, 'p1.mkv');
    await place(P2, 'p2.mkv');
    await place(P3, 'p3.mkv');
    const broken: Look = async () => {
      throw new Error('no picture');
    };
    expect(await findReels(dir, MOVIE, broken)).toEqual([]);
  });

  test('the route says the reels beside the groups', async () => {
    await place(REEL, 'reel.mkv');
    await place(P1, 'p1.mkv');
    await place(P2, 'p2.mkv');
    await place(P3, 'p3.mkv');
    const response = await discsExtrasDuplicatesHandler(
      new Request(`http://x/api?${new URLSearchParams({ movie: MOVIE })}`),
      {},
    );
    const body = (await response.json()) as {
      groups: string[][];
      reels: { path: string; parts: string[] }[];
    };
    expect(body.groups).toEqual([]);
    expect(body.reels).toEqual([{ path: REEL, parts: [P1, P2, P3] }]);
  });
});
