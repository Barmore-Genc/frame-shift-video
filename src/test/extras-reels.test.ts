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
import { findDuplicates, listenerSum } from '../../server/extras-duplicates';
import { candidateRuns, findReels, type Look } from '../../server/extras-reels';
import { discsExtrasDuplicatesHandler } from '../../server/handlers/discs';

const MOVIE = 'Charlotte (2003)';
const extra = (n: number) => `_converted/${MOVIE}/Other/Extra ${n}.mkv`;
const [REEL, P1, P2, P3, SHORT, DECOY] = [1, 2, 3, 4, 5, 6].map(extra);

let dir: string;
let sample: string;
const realEnv = process.env.DISC_RIP_DIR;
const realEyes = process.env.EXTRAS_EYES_URL;
const realFetch = globalThis.fetch;

/** What the listener makes: small grey pictures, one a second (here with the ffmpeg on this machine). */
function pictures(
  file: string,
  from: number,
  count: number,
  width: number,
  height: number,
): Uint8Array[] {
  const out = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-ss',
      String(from),
      '-i',
      file,
      '-t',
      String(count),
      '-an',
      '-sn',
      '-vf',
      `fps=1,scale=${width}:${height},format=gray`,
      '-f',
      'rawvideo',
      '-',
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const size = width * height;
  const frames: Uint8Array[] = [];
  for (let at = 0; at + size <= out.length; at += size) {
    frames.push(out.subarray(at, at + size));
  }
  return frames;
}

/** A look that reads the extras of the test's library directly. */
const local: Look = async (relative, from, count) =>
  pictures(path.join(dir, relative), from, count, 32, 24);

/** The listener, standing in for colossus's extras-eyes: answers /thumbs from the test's library. */
type Ask = {
  path: string;
  start: number;
  count: number;
  width: number;
  height: number;
};

function fakeListener(): Ask[] {
  const asked: Ask[] = [];
  process.env.EXTRAS_EYES_URL = 'http://eyes.test';
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const ask = JSON.parse(String(init?.body)) as Ask;
    asked.push(ask);
    const frames = pictures(
      path.join(dir, ask.path),
      ask.start,
      ask.count,
      ask.width,
      ask.height,
    ).map((frame) => Buffer.from(frame).toString('base64'));
    return new Response(JSON.stringify({ frames }));
  }) as unknown as typeof fetch;
  return asked;
}

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
  // The same length as p1, another picture.
  color(path.join(sample, 'p1b.mkv'), '0x404040', 12);
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
  globalThis.fetch = realFetch;
  if (realEyes === undefined) delete process.env.EXTRAS_EYES_URL;
  else process.env.EXTRAS_EYES_URL = realEyes;
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
    expect(await findReels(dir, MOVIE, local)).toEqual([
      { path: REEL, parts: [P1, P2, P3] },
    ]);
  });

  test('the right length with other pictures is not a reel', async () => {
    await place(DECOY, 'decoy.mkv');
    await place(P1, 'p1.mkv');
    await place(P2, 'p2.mkv');
    await place(P3, 'p3.mkv');
    expect(await findReels(dir, MOVIE, local)).toEqual([]);
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
    expect(await findReels(dir, MOVIE, local)).toEqual([]);
  });

  test('a part is found anywhere in the reel, in any order, and not found when it is nowhere', async () => {
    await place(REEL, 'reel.mkv');
    await place(P1, 'p1.mkv');
    await place(P2, 'p2.mkv');
    await place(P3, 'p3.mkv');
    // The reel shows one picture at second `when`; every part shows that one.
    const oneAt =
      (when: number | null): Look =>
      async (file, from) =>
        file.endsWith('Extra 1.mkv')
          ? Array.from({ length: 80 }, (_, i) =>
              new Uint8Array(768).fill(from + i === when ? 50 : 200),
            )
          : [new Uint8Array(768).fill(file.endsWith('Extra 2.mkv') ? 50 : 50)];
    // Near the start, in the middle and at the end: wherever it is, the parts are in it.
    for (const when of [2, 40, 75]) {
      expect(await findReels(dir, MOVIE, oneAt(when))).toHaveLength(1);
    }
    // In no part's place (it is nowhere): they are not.
    expect(await findReels(dir, MOVIE, oneAt(null))).toEqual([]);
  });

  test('the reel is looked at no more than it takes to be sure', async () => {
    await place(REEL, 'reel.mkv');
    await place(P1, 'p1.mkv');
    await place(P2, 'p2.mkv');
    await place(P3, 'p3.mkv');
    const asked = { reel: 0, part: 0 };
    // The first seconds of the reel show 200 and those of every part show `start`; the rest of the
    // reel shows 200 and each part shows `value`.
    const picture =
      (value: number, start = 200): Look =>
      async (file, _from, count) => {
        const reel = file.endsWith('Extra 1.mkv');
        asked[reel ? 'reel' : 'part']++;
        if (count === 5) {
          return [new Uint8Array(768).fill(reel ? 200 : start)];
        }
        return reel
          ? Array.from({ length: 80 }, () => new Uint8Array(768).fill(200))
          : [new Uint8Array(768).fill(value)];
      };
    // Every part is in it: a look at the start of the reel and of the first part, then each part at
    // its first moment, and the pictures of the whole reel (30 s: one piece), asked for once.
    expect(await findReels(dir, MOVIE, picture(200))).toHaveLength(1);
    expect(asked).toEqual({ reel: 2, part: 4 });
    // A reel that does not start like any of its parts is looked at no more.
    asked.reel = asked.part = 0;
    expect(await findReels(dir, MOVIE, picture(200, 50))).toEqual([]);
    expect(asked).toEqual({ reel: 1, part: 3 });
    // None of the parts is in it: every part is tried at its three moments.
    asked.reel = asked.part = 0;
    expect(await findReels(dir, MOVIE, picture(50))).toEqual([]);
    expect(asked).toEqual({ reel: 2, part: 10 });
  });

  test('the whole reel is asked for in pieces the listener can give, and once', async () => {
    color(path.join(sample, 'long.mkv'), '0x646464', 200);
    color(path.join(sample, 'hundred.mkv'), '0x646464', 100);
    await place(extra(1), 'long.mkv');
    await place(extra(2), 'hundred.mkv');
    await place(extra(3), 'hundred.mkv');
    const pieces: number[][] = [];
    const every: Look = async (file, from, count) => {
      if (file.endsWith('Extra 1.mkv') && count > 5) pieces.push([from, count]);
      return [new Uint8Array(768).fill(100)];
    };
    expect(await findReels(dir, MOVIE, every)).toHaveLength(1);
    // 200 s in pieces of at most 90 s: 0-90, 90-180, 180-200 (each asked for once, not per part).
    expect(pieces.sort((a, b) => a[0]! - b[0]!)).toEqual([
      [0, 90],
      [90, 90],
      [180, 90],
    ]);
  });

  test('parts are looked for a few at a time, and no more once enough are found', async () => {
    color(path.join(sample, 'six.mkv'), '0x646464', 120);
    color(path.join(sample, 'twenty.mkv'), '0x646464', 20);
    await place(extra(1), 'six.mkv');
    for (let n = 2; n <= 7; n++) await place(extra(n), 'twenty.mkv');
    let parts = 0;
    let running = 0;
    let most = 0;
    const every: Look = async (file) => {
      const isPart = !file.endsWith('Extra 1.mkv');
      if (isPart) {
        parts++;
        most = Math.max(most, ++running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
      }
      return [new Uint8Array(768).fill(100)];
    };
    const found = await findReels(dir, MOVIE, every);
    expect(found).toHaveLength(1);
    // Six parts need four found: the start of the first, then the first four together and the other
    // two not at all.
    expect(parts).toBe(5);
    // ...and a few at a time, not one by one and not all at once.
    expect(most).toBe(4);
  });

  test('parts are not looked for any more once too many are missing', async () => {
    color(path.join(sample, 'six.mkv'), '0x646464', 120);
    color(path.join(sample, 'twenty.mkv'), '0x646464', 20);
    await place(extra(1), 'six.mkv');
    for (let n = 2; n <= 7; n++) await place(extra(n), 'twenty.mkv');
    let parts = 0;
    const none: Look = async (file, _from, count) => {
      if (!file.endsWith('Extra 1.mkv')) parts++;
      if (count === 5) return [new Uint8Array(768).fill(100)]; // the starts are alike
      return [
        new Uint8Array(768).fill(file.endsWith('Extra 1.mkv') ? 200 : 50),
      ];
    };
    expect(await findReels(dir, MOVIE, none)).toEqual([]);
    // Six parts need four found, so three missing is enough to say no: the start of the first part,
    // then the first four parts at their three moments each, and the other two not at all.
    expect(parts).toBe(1 + 4 * 3);
  });

  test('a Play All that plays the parts in another order than the files are listed is still a reel', async () => {
    // The reel is 20 + 20 + 20 s that show pictures 1, 2, 3; its parts are listed as 3, 1, 2.
    color(path.join(sample, 'sixty.mkv'), '0x646464', 60);
    color(path.join(sample, 'twenty.mkv'), '0x646464', 20);
    await place(extra(1), 'sixty.mkv');
    for (let n = 2; n <= 4; n++) await place(extra(n), 'twenty.mkv');
    const shows = (second: number) =>
      Uint8Array.from(
        { length: 768 },
        (_, i) => (i * 31 + second * 97 + (i % 7) * second * 11) % 256,
      );
    // The reel's second t shows picture t; Extra 2 is the part at 40-60 s, 3 at 0-20, 4 at 20-40.
    const where: Record<string, number> = {
      'Extra 2.mkv': 40,
      'Extra 3.mkv': 0,
      'Extra 4.mkv': 20,
    };
    const shuffled: Look = async (file, from, count) => {
      if (file.endsWith('Extra 1.mkv')) {
        return Array.from({ length: count }, (_, i) => shows(from + i));
      }
      const base = where[file.split('/').pop()!]!;
      return [shows(base + Math.round(from))];
    };
    expect(await findReels(dir, MOVIE, shuffled)).toEqual([
      { path: extra(1), parts: [extra(2), extra(3), extra(4)] },
    ]);
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

  test('the route says the reels beside the groups, with pictures from the listener', async () => {
    const asked = fakeListener();
    await place(REEL, 'reel.mkv');
    await place(P1, 'p1.mkv');
    await place(P2, 'p2.mkv');
    await place(P3, 'p3.mkv');
    await place(extra(7), 'p1.mkv'); // a copy of the first part
    const response = await discsExtrasDuplicatesHandler(
      new Request(`http://x/api?${new URLSearchParams({ movie: MOVIE })}`),
      {},
    );
    const body = (await response.json()) as {
      groups: string[][];
      reels: { path: string; parts: string[] }[];
    };
    // The copies are looked for with the listener's pictures too (the big ones).
    expect(asked.some((a) => a.width === 160)).toBe(true);
    expect(body.groups).toEqual([[P1, extra(7)]]);
    expect(body.reels).toEqual([{ path: REEL, parts: [P1, P2, P3] }]);
  });
});

describe('copies, with pictures from the listener', () => {
  test('the same pictures are a copy and other pictures are not', async () => {
    const asked = fakeListener();
    await place(extra(1), 'p1.mkv');
    await place(extra(2), 'p1.mkv');
    await place(extra(3), 'p1b.mkv'); // the same length, another picture
    await place(extra(4), 'p2.mkv'); // another length
    const groups = await findDuplicates(dir, MOVIE, listenerSum);
    expect(groups).toEqual([[extra(1), extra(2)]]);
    // A picture at each of three moments of a 12 s extra, one at a time, as the listener makes them.
    const first = asked.filter((a) => a.path === extra(1));
    expect([...new Set(first.map((a) => a.start))].sort()).toEqual([
      2.4, 6, 9.6,
    ]);
    expect(first.every((a) => a.count === 1 && a.width === 160)).toBe(true);
  });

  test('with no listener, a picture cannot be had and nothing is called a copy', async () => {
    delete process.env.EXTRAS_EYES_URL;
    await place(extra(1), 'p1.mkv');
    await place(extra(2), 'p1.mkv');
    expect(await findDuplicates(dir, MOVIE, listenerSum)).toEqual([]);
  });
});
