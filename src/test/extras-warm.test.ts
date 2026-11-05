import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { startWarming, warmAll } from '../../server/extras-warm';

let dir: string;

async function place(relative: string) {
  const file = path.join(dir, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, 'video');
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'extras-warm-'));
  for (const movie of ['Alpha (2001)', 'Beta (2002)', 'Gamma (2003)']) {
    await place(`_converted/${movie}/${movie}.mkv`);
  }
  await place('_converted/Alpha (2001)/Other/Extra 01.mkv');
  await place('_converted/Alpha (2001)/Other/Extra 02.mkv');
  await place('_converted/Beta (2002)/Other/Extra 01.mkv'); // one extra: nothing to compare
  await place('_converted/Gamma (2003)/Other/Extra 01.mkv');
  await place('_converted/Gamma (2003)/Other/Extra 02.mkv');
  await place('_converted/Gamma (2003)/Other/Extra 03.mkv');
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('warming every movie', () => {
  test('each movie with two or more extras is warmed, one at a time', async () => {
    const warmed: string[] = [];
    let running = 0;
    let most = 0;
    const warm = async (movie: string) => {
      most = Math.max(most, ++running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      warmed.push(movie);
      running--;
    };
    expect(await warmAll(dir, { warm, listener: true })).toBe(2);
    expect(warmed.sort()).toEqual(['Alpha (2001)', 'Gamma (2003)']);
    expect(most).toBe(1);
  });

  test('with no listener there is nothing to warm with', async () => {
    let asked = 0;
    const warm = async () => {
      asked++;
    };
    expect(await warmAll(dir, { warm, listener: false })).toBe(0);
    expect(asked).toBe(0);
  });

  test('one movie failing is said and the others are still warmed', async () => {
    const logged: string[] = [];
    const warmed: string[] = [];
    const warm = async (movie: string) => {
      if (movie === 'Alpha (2001)') throw new Error('the listener fell over');
      warmed.push(movie);
    };
    const count = await warmAll(dir, {
      warm,
      listener: true,
      log: (message, detail) => logged.push(`${message} ${detail?.movie}`),
    });
    expect(count).toBe(1);
    expect(warmed).toEqual(['Gamma (2003)']);
    expect(logged).toEqual([
      'Could not warm the copies of a movie Alpha (2001)',
    ]);
  });
});

describe('starting the warming', () => {
  const nap = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  test('a first pass after the delay, then another after each pass ends, never overlapping', async () => {
    const times: number[] = [];
    let running = 0;
    let most = 0;
    const began = Date.now();
    const pass = async () => {
      most = Math.max(most, ++running);
      times.push(Date.now() - began);
      await nap(30);
      running--;
    };
    const stop = startWarming(dir, { delayMs: 40, everyMs: 20, pass });
    await nap(40 - 20);
    expect(times).toEqual([]);
    await nap(200);
    stop();
    expect(times.length).toBeGreaterThanOrEqual(3);
    expect(times[0]).toBeGreaterThanOrEqual(35);
    // The next pass starts only after the one before it ended and `everyMs` went by.
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(45);
    expect(most).toBe(1);
  });

  test('stopping stops it, and a pass that throws does not end it', async () => {
    let passes = 0;
    const pass = async () => {
      passes++;
      throw new Error('the listener fell over');
    };
    const stop = startWarming(dir, { delayMs: 5, everyMs: 10, pass });
    await nap(80);
    expect(passes).toBeGreaterThanOrEqual(3);
    stop();
    const seen = passes;
    await nap(60);
    expect(passes).toBe(seen);
  });

  test('stopping while a pass is running lets it end and starts no other', async () => {
    let passes = 0;
    const pass = async () => {
      passes++;
      await nap(40);
    };
    const stop = startWarming(dir, { delayMs: 5, everyMs: 5, pass });
    await nap(20);
    stop();
    await nap(120);
    expect(passes).toBe(1);
  });
});
