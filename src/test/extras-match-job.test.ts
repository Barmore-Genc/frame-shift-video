import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  clearMatches,
  matchState,
  startMatch,
  type Deps,
} from '../../server/extras-match-job';
import { ListenerUnavailable, lookAt } from '../../server/extras-eyes';
import type { Look } from '../../server/extras-match';
import type { NameSource } from '../types/discs';

let dir: string;
const MOVIE = 'Stellaluna (2004)';
const CARD = `_converted/${MOVIE}/Featurettes/Featurette 01 (20 min).mkv`;
const BLANK = `_converted/${MOVIE}/Trailers/Trailer 01 (2 min).mkv`;
const NAMED = `_converted/${MOVIE}/Featurettes/Making Of.mkv`;

const LOOKS: Record<string, Look> = {
  [CARD]: {
    seconds: 5,
    ocr: [{ t: 0.5, lines: ['THE NOT-SO-SCARY', 'WORLD OF BATS'] }],
    speech: [
      { start: 0, end: 4, text: 'Welcome to the not so scary world of bats.' },
    ],
  },
  [BLANK]: { seconds: 60, ocr: [], speech: [] },
};

const FANDOM: NameSource = {
  source: 'DVD Fandom',
  page: 'Stellaluna',
  url: 'https://dvd.fandom.com/wiki/Stellaluna',
  features: [
    { text: 'Featurettes', depth: 1, seconds: null },
    { text: 'The Not-So-Scary World of Bats', depth: 2, seconds: null },
    { text: 'Create Your Own Stellaluna', depth: 2, seconds: null },
  ],
};
// A database that gives lengths: the trailer is 2 minutes, which is what BLANK measures.
const COMPARE: NameSource = {
  source: 'DVD Compare',
  page: 'Stellaluna',
  url: 'https://www.dvdcompare.net/comparisons/film.php?fid=1',
  release: 'R1 America',
  features: [
    { text: 'Theatrical Trailer', depth: 1, seconds: 120 },
    { text: 'Bat Facts', depth: 1, seconds: 90 },
  ],
};
const LENGTHS: Record<string, number> = { [CARD]: 1200, [BLANK]: 121 };

let asked: string[];
const deps = (over: Partial<Deps> = {}): Deps => ({
  look: async (relative) => {
    asked.push(relative);
    return LOOKS[relative]!;
  },
  sources: async () => [FANDOM],
  seconds: async (_dir, relative) => LENGTHS[relative] ?? null,
  ...over,
});

async function write(relative: string) {
  const file = path.join(dir, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, 'video');
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'extras-match-'));
  asked = [];
  clearMatches();
  await write(`_converted/${MOVIE}/${MOVIE}.mkv`);
  await write(CARD);
  await write(BLANK);
  await write(NAMED);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('matching a movie', () => {
  test('listens to each unnamed extra in turn and suggests the clear one', async () => {
    const { state, finished } = await startMatch(dir, MOVIE, deps());
    expect(state.status).toBe('running');
    expect(state.total).toBe(2);
    await finished;
    expect(state.status).toBe('done');
    expect(state.done).toBe(2);
    expect(asked.sort()).toEqual([BLANK, CARD].sort());
    expect(state.suggestions[CARD]).toMatchObject({
      state: 'matched',
      name: 'The Not-So-Scary World of Bats',
      kind: 'Featurettes',
    });
    expect(state.suggestions[BLANK]?.state).toBe('none');
    expect(matchState(MOVIE)).toBe(state);
  });

  test('an extra that already has a name is left alone', async () => {
    const { finished } = await startMatch(dir, MOVIE, deps());
    await finished;
    expect(asked).not.toContain(NAMED);
  });

  test('one at a time: they are looked at in order, not together', async () => {
    let active = 0;
    let most = 0;
    const slow = deps({
      look: async (relative) => {
        active++;
        most = Math.max(most, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        return LOOKS[relative]!;
      },
    });
    await (
      await startMatch(dir, MOVIE, slow)
    ).finished;
    expect(most).toBe(1);
  });

  test('starting again while it is going does not start a second run', async () => {
    const first = await startMatch(dir, MOVIE, deps());
    const second = await startMatch(dir, MOVIE, deps());
    expect(second.state).toBe(first.state);
    await first.finished;
    expect(asked).toHaveLength(2);
  });

  test('what was heard is kept while the file is unchanged, and listened to again when it changes', async () => {
    await (
      await startMatch(dir, MOVIE, deps())
    ).finished;
    await (
      await startMatch(dir, MOVIE, deps())
    ).finished;
    expect(asked).toHaveLength(2);
    await new Promise((r) => setTimeout(r, 20));
    await fs.writeFile(path.join(dir, CARD), 'a different video');
    await (
      await startMatch(dir, MOVIE, deps())
    ).finished;
    expect(asked.filter((a) => a === CARD)).toHaveLength(2);
    expect(asked.filter((a) => a === BLANK)).toHaveLength(1);
  });

  test('with no wiki list, the evidence is still kept and nothing is suggested', async () => {
    const none = deps({ sources: async () => [] });
    const { state, finished } = await startMatch(dir, MOVIE, none);
    await finished;
    expect(state.suggestions[CARD]?.state).toBe('none');
    expect(state.suggestions[CARD]?.saw).toContain('WORLD OF BATS');
  });

  test('two extras that look like one name are both taken back', async () => {
    const same = deps({ look: async () => LOOKS[CARD]! });
    const { state, finished } = await startMatch(dir, MOVIE, same);
    await finished;
    expect(state.suggestions[CARD]?.state).toBe('unsure');
    expect(state.suggestions[BLANK]?.state).toBe('unsure');
  });

  test('one extra the listener cannot look at does not stop the others', async () => {
    const flaky = deps({
      look: async (relative) => {
        if (relative === BLANK) throw new Error('bad video');
        return LOOKS[relative]!;
      },
    });
    const { state, finished } = await startMatch(dir, MOVIE, flaky);
    await finished;
    expect(state.status).toBe('done');
    expect(state.warning).toContain('could not look at one extra');
    expect(state.suggestions[BLANK]?.state).toBe('none');
    expect(state.suggestions[CARD]?.state).toBe('matched');
  });

  test('a movie with no extras, or all named, is refused', async () => {
    await expect(startMatch(dir, 'Nothing (1999)', deps())).rejects.toThrow(
      'no extras',
    );
    await fs.rm(path.join(dir, CARD));
    await fs.rm(path.join(dir, BLANK));
    await expect(startMatch(dir, MOVIE, deps())).rejects.toThrow('named');
  });

  test('lengths name an extra at once, before any listening', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const slow = deps({
      sources: async () => [COMPARE, FANDOM],
      look: async (relative) => {
        await gate;
        return LOOKS[relative]!;
      },
    });
    const { state, finished } = await startMatch(dir, MOVIE, slow);
    // The page can already be told what the length says, while the listener is still working.
    await new Promise((r) => setTimeout(r, 30));
    expect(state.status).toBe('running');
    expect(state.done).toBe(0);
    expect(state.suggestions[BLANK]).toMatchObject({
      state: 'matched',
      name: 'Theatrical Trailer',
      seconds: 121,
    });
    expect(state.sources).toEqual(['DVD Compare', 'DVD Fandom']);
    release();
    await finished;
    expect(state.suggestions[CARD]?.name).toBe(
      'The Not-So-Scary World of Bats',
    );
  });

  test('the listener being down leaves the suggestions by length, with a warning', async () => {
    const down = deps({
      sources: async () => [COMPARE],
      look: async () => {
        throw new ListenerUnavailable('The listener could not be reached');
      },
    });
    const { state, finished } = await startMatch(dir, MOVIE, down);
    await finished;
    expect(state.status).toBe('done');
    expect(state.warning).toContain('by length only');
    expect(state.suggestions[BLANK]?.name).toBe('Theatrical Trailer');
  });

  test('an extra whose length cannot be measured is still looked at', async () => {
    const noLengths = deps({ seconds: async () => null });
    const { state, finished } = await startMatch(dir, MOVIE, noLengths);
    await finished;
    expect(state.suggestions[CARD]?.state).toBe('matched');
    expect(state.suggestions[CARD]?.seconds).toBeNull();
  });

  test('after a failure it can be started again', async () => {
    const down = deps({
      look: async () => {
        throw new ListenerUnavailable('down');
      },
    });
    await (
      await startMatch(dir, MOVIE, down)
    ).finished;
    const again = await startMatch(dir, MOVIE, deps());
    await again.finished;
    expect(again.state.status).toBe('done');
  });
});

describe('an extra that is other extras played in a row', () => {
  test('is not looked at or given a name, says what it is made of, and still counts as done', async () => {
    const reels = async () => [{ path: CARD, parts: [BLANK, NAMED] }];
    const { state, finished } = await startMatch(dir, MOVIE, deps({ reels }));
    await finished;
    expect(state.status).toBe('done');
    expect(state.done).toBe(state.total);
    // Its title card names "The Not-So-Scary World of Bats", but it is not that: it is a reel.
    expect(asked).toEqual([BLANK]);
    expect(state.suggestions[CARD]).toMatchObject({
      state: 'none',
      saw: '',
      heard: '',
    });
    expect(state.suggestions[CARD]!.name).toBeUndefined();
    expect(state.suggestions[CARD]!.note).toBe(
      'It is “Trailer 01 (2 min)”, “Making Of” played one after another, so it is a second copy of them, not an extra of its own.',
    );
    expect(state.suggestions[CARD]!.seconds).toBe(1200);
    // The others are matched as always.
    expect(state.suggestions[BLANK]?.state).toBe('none');
  });

  test('a long reel is named by its first and last parts', async () => {
    const parts = [1, 2, 3, 4].map(
      (n) => `_converted/${MOVIE}/Trailers/Extra 0${n}.mkv`,
    );
    for (const part of parts) await write(part);
    const reels = async () => [{ path: CARD, parts }];
    const { state, finished } = await startMatch(
      dir,
      MOVIE,
      deps({ reels, look: async (r) => LOOKS[r] ?? LOOKS[BLANK]! }),
    );
    await finished;
    expect(state.suggestions[CARD]!.note).toContain(
      '“Extra 01” to “Extra 04” played one after another',
    );
  });

  test('what it would have taken is left for the extra that has it', async () => {
    // Without the reel, two extras that both read as the same name are taken back from both.
    const twin = `_converted/${MOVIE}/Featurettes/Featurette 02 (20 min).mkv`;
    await write(twin);
    LOOKS[twin] = LOOKS[CARD]!;
    try {
      const both = await startMatch(
        dir,
        MOVIE,
        deps({ look: async (r) => LOOKS[r]! }),
      );
      await both.finished;
      expect(both.state.suggestions[twin]!.state).not.toBe('matched');
      clearMatches();
      const reels = async () => [{ path: CARD, parts: [BLANK, NAMED] }];
      const one = await startMatch(
        dir,
        MOVIE,
        deps({ reels, look: async (r) => LOOKS[r]! }),
      );
      await one.finished;
      expect(one.state.suggestions[twin]).toMatchObject({
        state: 'matched',
        name: 'The Not-So-Scary World of Bats',
      });
    } finally {
      delete LOOKS[twin];
    }
  });

  test('a reel as long as a listed feature does not share it with the extra that is that feature', async () => {
    LENGTHS[CARD] = 121; // the same length as the trailer, by chance
    try {
      const sources = async () => [COMPARE];
      const reels = async () => [{ path: CARD, parts: [BLANK, NAMED] }];
      const without = await startMatch(dir, MOVIE, deps({ sources }));
      await without.finished;
      expect(without.state.suggestions[BLANK]!.state).toBe('unsure');
      clearMatches();
      const withReel = await startMatch(dir, MOVIE, deps({ sources, reels }));
      await withReel.finished;
      expect(withReel.state.suggestions[BLANK]).toMatchObject({
        state: 'matched',
        name: 'Theatrical Trailer',
      });
    } finally {
      LENGTHS[CARD] = 1200;
    }
  });

  test('a reel that is not among the unnamed extras, or a lookup that fails, changes nothing', async () => {
    const named = await startMatch(
      dir,
      MOVIE,
      deps({ reels: async () => [{ path: NAMED, parts: [BLANK] }] }),
    );
    await named.finished;
    expect(named.state.suggestions[CARD]?.state).toBe('matched');
    expect(named.state.suggestions[NAMED]).toBeUndefined();
    clearMatches();
    const broken = await startMatch(
      dir,
      MOVIE,
      deps({
        reels: async () => {
          throw new Error('not known');
        },
      }),
    );
    await broken.finished;
    expect(broken.state.status).toBe('done');
    expect(broken.state.suggestions[CARD]?.state).toBe('matched');
  });
});

describe('the listener client', () => {
  const reply = (body: unknown, status = 200) =>
    (async () =>
      new Response(JSON.stringify(body), {
        status,
      })) as unknown as typeof fetch;

  test('sends the path and reads what comes back', async () => {
    let seen: { url: string; body: string } | null = null;
    const fetcher = (async (url: string, init?: RequestInit) => {
      seen = { url, body: String(init?.body) };
      return new Response(JSON.stringify({ seconds: 5, ocr: [], speech: [] }));
    }) as unknown as typeof fetch;
    const look = await lookAt('a/b.mkv', fetcher, 'http://eyes:3002/');
    expect(look).toEqual({ seconds: 5, ocr: [], speech: [] });
    expect(seen!.url).toBe('http://eyes:3002/look');
    expect(JSON.parse(seen!.body)).toEqual({ path: 'a/b.mkv' });
  });

  test('not being set up is said', async () => {
    await expect(lookAt('a.mkv', reply({}), undefined)).rejects.toThrow(
      ListenerUnavailable,
    );
  });

  test('being unreachable is said, as is the listener refusing', async () => {
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(lookAt('a.mkv', down, 'http://x')).rejects.toThrow(
      ListenerUnavailable,
    );
    await expect(
      lookAt(
        'a.mkv',
        reply({ error: 'That is outside the library' }, 400),
        'http://x',
      ),
    ).rejects.toThrow('outside the library');
  });

  test('an odd answer is made into something safe', async () => {
    const look = await lookAt(
      'a.mkv',
      reply({ seconds: 'x', ocr: 5 }),
      'http://x',
    );
    expect(look).toEqual({ seconds: 0, ocr: [], speech: [] });
  });
});
