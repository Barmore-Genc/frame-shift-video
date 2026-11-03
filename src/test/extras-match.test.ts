import { describe, expect, test } from 'bun:test';
import {
  candidates,
  candidatesFrom,
  fileName,
  kindOf,
  matchExtra,
  matchMovie,
  words,
  type Candidate,
  type Evidence,
  type Look,
} from '../../server/extras-match';
import type { FandomHint, NameSource } from '../types/discs';

// From the live DVD Fandom pages (trimmed).
const STELLALUNA: FandomHint = {
  found: true,
  features: [
    { text: 'Featurettes', depth: 1 },
    { text: 'The Not-So-Scary World of Bats', depth: 2 },
    { text: 'Create Your Own Stellaluna', depth: 2 },
    { text: 'Learn to Draw Stellaluna', depth: 1 },
    { text: 'Sing-Along version', depth: 1 },
    { text: 'Previews', depth: 1 },
  ],
};

const LION_KING: FandomHint = {
  found: true,
  features: [
    { text: 'Disc 1', depth: 0 },
    { text: 'Hidden Mickey Hunt', depth: 1 },
    { text: 'Deleted Scenes', depth: 1 },
    { text: 'Opening Concept 1', depth: 2 },
    { text: 'Opening Concept 2', depth: 2 },
    { text: 'Old Fearless Buzz', depth: 2 },
    { text: 'Disc 2', depth: 0 },
    { text: 'Featurettes', depth: 1 },
    { text: 'Timon: Behind the Legend', depth: 2 },
    { text: '"Grazing in the Grass" Music Video Performed by Raven', depth: 2 },
    { text: 'Games & Activities', depth: 1 },
    { text: "Timon & Pumbaa's Virtual Safari 1.5", depth: 2 },
  ],
};

// What the listener really made of the fixture video (a title card, narration of the same words).
const BATS_CARD: Look = {
  seconds: 5.1,
  ocr: [{ t: 0.5, lines: ['THE NOT-SO-SCARY', 'WORLD OF BATS'] }],
  speech: [
    {
      start: 0,
      end: 4.7,
      text: 'Welcome to the not so scary world of bats, today we visit a real bat cave and meet the',
    },
  ],
};

const ev = (look: Look | null, seconds: number | null = null): Evidence => ({
  seconds,
  look,
});

const nothing = (): Look => ({ seconds: 60, ocr: [], speech: [] });

describe('the names a wiki list offers', () => {
  test('a heading is a kind and what is under it is the names', () => {
    const found = candidates(STELLALUNA);
    expect(found.map((c) => c.name)).toEqual([
      'The Not-So-Scary World of Bats',
      'Create Your Own Stellaluna',
      'Learn to Draw Stellaluna',
      'Sing-Along version',
      'Previews',
    ]);
    expect(found[0]!.kind).toBe('Featurettes');
    expect(found[0]!.words).toEqual(['not', 'so', 'scary', 'world', 'bats']);
  });

  test('"Disc 1" headings are not names, and a kind carries to what is under it', () => {
    const found = candidates(LION_KING);
    expect(found.map((c) => c.name)).not.toContain('Disc 1');
    expect(found.map((c) => c.name)).not.toContain('Deleted Scenes');
    expect(found.find((c) => c.name === 'Opening Concept 1')?.kind).toBe(
      'Deleted Scenes',
    );
    expect(
      found.find((c) => c.name === 'Timon - Behind the Legend')?.kind,
    ).toBe('Featurettes'); // the wiki puts it under Featurettes, so that is its kind
  });

  test('a name from the wiki is made safe as a file name', () => {
    expect(fileName('Music Video: "Teacher\'s Pet"')).toBe(
      "Music Video - Teacher's Pet",
    );
    expect(fileName('"Grazing in the Grass" Music Video')).toBe(
      'Grazing in the Grass Music Video',
    );
    expect(fileName('A/B <c> | d?')).toBe('AB c d');
  });

  test('no list gives no names', () => {
    expect(candidates({ found: false })).toEqual([]);
  });

  test('words ignores case, accents and punctuation, and reads ½ as 1 2', () => {
    expect(words('Café — THE Lion King 1½!')).toEqual([
      'cafe',
      'the',
      'lion',
      'king',
      '1',
      '1',
      '2',
    ]);
    expect(kindOf('Featurettes', null)).toBe('Featurettes');
    expect(kindOf(null, 'Music Video')).toBeNull();
  });
});

describe('matching one extra', () => {
  const names = candidates(STELLALUNA);

  test('a title card that reads the whole name is a match, with its kind and the reason', () => {
    const answer = matchExtra(ev(BATS_CARD), names);
    expect(answer.state).toBe('matched');
    expect(answer.name).toBe('The Not-So-Scary World of Bats');
    expect(answer.kind).toBe('Featurettes');
    expect(answer.note).toContain('writing at 0:00 reads it');
    expect(answer.note).toContain('said in the first minute');
    expect(answer.saw).toBe('THE NOT-SO-SCARY / WORLD OF BATS');
    expect(answer.heard).toContain('scary world of bats');
  });

  test('a letter the reader got wrong does not stop it', () => {
    const look = {
      ...BATS_CARD,
      ocr: [{ t: 1, lines: ['THE NOT-SO-SCARV', 'WORLO OF BATS'] }],
      speech: [],
    };
    expect(matchExtra(ev(look), names).state).toBe('matched');
  });

  test('a longer name said in order is a match even with no title card', () => {
    const look: Look = {
      seconds: 80,
      ocr: [],
      speech: [
        {
          start: 1,
          end: 5,
          text: 'Now, create your own Stellaluna, with paper.',
        },
      ],
    };
    expect(matchExtra(ev(look), names).name).toBe('Create Your Own Stellaluna');
    expect(matchExtra(ev(look), names).state).toBe('matched');
  });

  test('a short name only said in passing is not a match', () => {
    const look: Look = {
      seconds: 80,
      ocr: [],
      speech: [
        { start: 1, end: 5, text: 'We will see the previews of other movies.' },
      ],
    };
    expect(matchExtra(ev(look), names).state).not.toBe('matched');
  });

  test('most of a name is unsure, not a match', () => {
    const look: Look = {
      seconds: 60,
      ocr: [{ t: 2, lines: ['NOT-SO-SCARY WORLD'] }],
      speech: [],
    };
    const answer = matchExtra(ev(look), names);
    expect(answer.state).toBe('unsure');
    expect(answer.note).toContain('only part');
    expect(answer.name).toBe('The Not-So-Scary World of Bats');
  });

  test('a couple of words of a long name are not enough to suggest it', () => {
    const look: Look = {
      seconds: 60,
      ocr: [{ t: 2, lines: ['WORLD OF BATS'] }],
      speech: [],
    };
    expect(matchExtra(ev(look), names).state).toBe('none');
  });

  test('two names that fit about equally are unsure and both are named', () => {
    const lion = candidates(LION_KING);
    const look: Look = {
      seconds: 90,
      ocr: [{ t: 1, lines: ['OPENING CONCEPT'] }],
      speech: [],
    };
    const answer = matchExtra(ev(look), lion);
    expect(answer.state).toBe('unsure');
    expect(answer.note).toContain('Opening Concept 1');
    expect(answer.note).toContain('Opening Concept 2');
  });

  test('a full match with another name that fits as well is unsure, not a match', () => {
    const look: Look = {
      seconds: 90,
      ocr: [{ t: 1, lines: ['OPENING CONCEPT 1', 'OPENING CONCEPT 2'] }],
      speech: [],
    };
    const answer = matchExtra(ev(look), candidates(LION_KING));
    expect(answer.state).toBe('unsure');
    expect(answer.note).toContain('not clear which');
  });

  test('a full match that another name only partly fits is still a match', () => {
    const look: Look = {
      seconds: 90,
      ocr: [{ t: 1, lines: ['OPENING CONCEPT 1'] }],
      speech: [],
    };
    const answer = matchExtra(ev(look), candidates(LION_KING));
    expect(answer.state).toBe('matched');
    expect(answer.name).toBe('Opening Concept 1');
    expect(answer.kind).toBe('Deleted Scenes');
  });

  test('writing that is nothing like a name is no match, and the evidence is kept', () => {
    const look: Look = {
      seconds: 60,
      ocr: [{ t: 1, lines: ['DISNEY ENTERPRISES 2004'] }],
      speech: [{ start: 0, end: 2, text: 'Hello there.' }],
    };
    const answer = matchExtra(ev(look), names);
    expect(answer.state).toBe('none');
    expect(answer.saw).toBe('DISNEY ENTERPRISES 2004');
    expect(answer.heard).toBe('Hello there.');
  });

  test('nothing to read or hear, and no list, are said plainly', () => {
    expect(matchExtra(ev(nothing()), names).note).toContain('watching it');
    expect(matchExtra(ev(BATS_CARD), []).note).toContain('nothing to compare');
  });
});

describe('matching a whole movie', () => {
  const names = candidates(STELLALUNA);

  test('each extra is matched on its own', () => {
    const out = matchMovie(
      [
        { path: 'a', ...ev(BATS_CARD) },
        { path: 'b', ...ev(nothing()) },
      ],
      names,
    );
    expect(out.a!.state).toBe('matched');
    expect(out.b!.state).toBe('none');
  });

  test('a name two extras both match is taken back from both', () => {
    const out = matchMovie(
      [
        { path: 'a', ...ev(BATS_CARD) },
        { path: 'b', ...ev(BATS_CARD) },
      ],
      names,
    );
    for (const key of ['a', 'b']) {
      expect(out[key]!.state).toBe('unsure');
      expect(out[key]!.note).toContain('Two extras look like');
    }
  });
});

// What DVD Compare really lists for Duma (2005) R1, and the lengths of Duma's four real extras.
const DUMA: NameSource = {
  source: 'DVD Compare',
  page: 'Duma',
  url: 'https://www.dvdcompare.net/comparisons/film.php?fid=13117',
  features: [
    { text: 'Extended Scenes', depth: 1, seconds: null },
    { text: 'Play All', depth: 1, seconds: 108, playAll: true },
    { text: 'Xan and Ripkuna at the Airplane', depth: 1, seconds: 59 },
    {
      text: 'Ripkuna Teaching Xan How to Use the Spear',
      depth: 1,
      seconds: 49,
    },
    { text: 'Theatrical Trailer', depth: 1, seconds: 95, kind: null },
  ],
};
const DUMA_FILES = [
  { path: 'Extra 01', seconds: 99.4 },
  { path: 'Extra 02', seconds: 106.4 },
  { path: 'Extra 03', seconds: 58.0 },
  { path: 'Extra 04', seconds: 48.3 },
];
const lengthOnly = (seconds: number | null, path = 'x') => ({
  path,
  ...ev(null, seconds),
});

describe('matching by length', () => {
  const names = candidatesFrom([DUMA]);

  test("Duma's real extras are named by their lengths, the play-all is not given a name", () => {
    const out = matchMovie(
      DUMA_FILES.map((f) => ({ path: f.path, ...ev(null, f.seconds) })),
      names,
    );
    expect(out['Extra 03']).toMatchObject({
      state: 'matched',
      name: 'Xan and Ripkuna at the Airplane',
    });
    expect(out['Extra 03']!.note).toContain('0:58 long');
    expect(out['Extra 03']!.note).toContain('DVD Compare');
    expect(out['Extra 04']).toMatchObject({
      state: 'matched',
      name: 'Ripkuna Teaching Xan How to Use the Spear',
    });
    expect(out['Extra 01']).toMatchObject({
      state: 'matched',
      name: 'Theatrical Trailer',
    });
    expect(out['Extra 02']!.state).toBe('none');
    expect(out['Extra 02']!.name).toBeUndefined();
    expect(out['Extra 02']!.note).toContain('Play All');
  });

  test('two extras of one length cannot be told apart by length, and both say so', () => {
    const list = candidatesFrom([
      {
        ...DUMA,
        features: [{ text: 'Meet the Animals', depth: 1, seconds: 336 }],
      },
    ]);
    const out = matchMovie(
      [
        { path: 'a', ...ev(null, 335.7) },
        { path: 'b', ...ev(null, 335.7) },
      ],
      list,
    );
    for (const key of ['a', 'b']) {
      expect(out[key]!.state).toBe('unsure');
      expect(out[key]!.name).toBe('Meet the Animals');
      expect(out[key]!.note).toContain('length alone cannot tell');
    }
  });

  test('two names of one length are unsure, naming both, unless the writing picks one', () => {
    const list = candidatesFrom([
      {
        ...DUMA,
        features: [
          { text: 'Outtakes', depth: 1, seconds: 60 },
          { text: 'Gag Reel', depth: 1, seconds: 61 },
        ],
      },
    ]);
    const unsure = matchExtra(ev(null, 60), list);
    expect(unsure.state).toBe('unsure');
    expect(unsure.note).toContain('“Outtakes”');
    expect(unsure.note).toContain('“Gag Reel”');
    const card: Look = {
      seconds: 60,
      ocr: [{ t: 1, lines: ['GAG REEL'] }],
      speech: [{ start: 0, end: 2, text: 'And now the gag reel.' }],
    };
    const picked = matchExtra(ev(card, 60), list);
    expect(picked.state).toBe('matched');
    expect(picked.name).toBe('Gag Reel');
    expect(picked.note).toContain('writing at 0:01 reads it');
  });

  test('what is written contradicting the length makes it unsure', () => {
    const list = candidatesFrom([
      {
        ...DUMA,
        features: [
          { text: 'Theatrical Trailer', depth: 1, seconds: 95 },
          { text: 'Making of Duma', depth: 1, seconds: 600 },
        ],
      },
    ]);
    const card: Look = {
      seconds: 95,
      ocr: [{ t: 1, lines: ['MAKING OF DUMA'] }],
      speech: [],
    };
    const answer = matchExtra(ev(card, 95), list);
    expect(answer.state).toBe('unsure');
    expect(answer.note).toContain('Making of Duma');
  });

  test('close but not close enough is a maybe, and far is nothing', () => {
    expect(matchExtra(ev(null, 75), names).state).toBe('none');
    const close = matchExtra(ev(null, 66), names);
    expect(close.state).toBe('unsure');
    expect(close.name).toBe('Xan and Ripkuna at the Airplane');
    expect(close.note).toContain('Close in length');
    expect(matchExtra(ev(null, 5000), names).state).toBe('none');
  });

  test('the edge: six seconds off is a match, seven is not', () => {
    expect(matchExtra(ev(null, 65), names).state).toBe('matched');
    expect(matchExtra(ev(null, 66), names).state).toBe('unsure');
  });

  test('names with no length are matched by what was read and heard as before', () => {
    const fandom = candidatesFrom([
      {
        source: 'DVD Fandom',
        page: 'Stellaluna',
        url: 'x',
        features: STELLALUNA.features!.map((f) => ({ ...f, seconds: null })),
      },
    ]);
    const answer = matchExtra(ev(BATS_CARD, 5), fandom);
    expect(answer.state).toBe('matched');
    expect(answer.name).toBe('The Not-So-Scary World of Bats');
  });

  test('a length alone does not name an extra when nothing is listed with a length', () => {
    const fandom = candidates(STELLALUNA);
    expect(matchExtra(ev(null, 59), fandom).state).toBe('none');
  });

  test('an extra whose length is not known is matched without it', () => {
    expect(lengthOnly(null).seconds).toBeNull();
    expect(matchExtra(ev(BATS_CARD, null), candidates(STELLALUNA)).state).toBe(
      'matched',
    );
  });
});

describe('the names of several databases together', () => {
  test('a feature several list is one name with the first length given and every database', () => {
    const list = candidatesFrom([
      DUMA,
      {
        source: 'TheDiscDB',
        page: 'Duma (2005)',
        url: 'x',
        features: [
          {
            text: 'Theatrical Trailer',
            depth: 1,
            seconds: 96,
            kind: 'Trailers',
          },
        ],
      },
      {
        source: 'DVD Fandom',
        page: 'Duma',
        url: 'x',
        features: [{ text: 'Theatrical Trailer', depth: 1, seconds: null }],
      },
    ]);
    const trailers = list.filter((c) => c.name === 'Theatrical Trailer');
    expect(trailers).toHaveLength(1);
    expect(trailers[0]!.seconds).toBe(95);
    expect(trailers[0]!.kind).toBe('Trailers');
    expect(trailers[0]!.sources).toEqual([
      'DVD Compare',
      'TheDiscDB',
      'DVD Fandom',
    ]);
  });

  test('a database giving a length fills one that did not', () => {
    const list: Candidate[] = candidatesFrom([
      {
        source: 'DVD Fandom',
        page: 'x',
        url: 'x',
        features: [{ text: 'Outtakes', depth: 1, seconds: null }],
      },
      {
        source: 'TheDiscDB',
        page: 'x',
        url: 'x',
        features: [{ text: 'Outtakes', depth: 1, seconds: 120 }],
      },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]!.seconds).toBe(120);
  });
});

// What the listener really read on Dance Flick's two extras and on Charlotte's Web 2's.
const DANCE_FLICK: Look = {
  seconds: 556,
  ocr: [
    {
      t: 1.5,
      lines: [
        'THE FOLLOWING PREVIEW HAS BEEN APPROVED FOR',
        'ALL AUDIENCES',
        'BY THE MOTION PICTURE ASSOCIATION OF AMERICA, INC.',
        'www. filmratings.com',
      ],
    },
  ],
  speech: [
    {
      start: 3,
      end: 8,
      text: 'We have never faced a threat like this. A team is being assembled.',
    },
  ],
};

describe('a reel of previews', () => {
  test('the ratings card shown before previews makes it "Previews", a trailer, with the reason', () => {
    const answer = matchExtra(ev(DANCE_FLICK, 556), []);
    expect(answer).toMatchObject({
      state: 'unsure',
      name: 'Previews',
      kind: 'Trailers',
    });
    expect(answer.note).toContain('ratings card');
    expect(answer.saw).toContain('FOLLOWING PREVIEW');
  });

  test('it is the answer when the databases list names but none fits', () => {
    const answer = matchExtra(ev(DANCE_FLICK, 556), candidates(LION_KING));
    expect(answer.name).toBe('Previews');
    expect(answer.kind).toBe('Trailers');
  });

  test('a listed name or a length that fits still wins over it', () => {
    const list = candidatesFrom([
      {
        source: 'DVD Compare',
        page: 'x',
        url: 'x',
        features: [{ text: 'Behind the Wayans', depth: 1, seconds: 556 }],
      },
    ]);
    expect(matchExtra(ev(DANCE_FLICK, 556), list)).toMatchObject({
      state: 'matched',
      name: 'Behind the Wayans',
    });
  });

  test('other writing is not taken for it, and neither is nothing', () => {
    const card: Look = {
      seconds: 60,
      ocr: [{ t: 1, lines: ['DISNEY ENTERPRISES 2004'] }],
      speech: [],
    };
    expect(matchExtra(ev(card, 60), candidates(STELLALUNA)).state).toBe('none');
    expect(matchExtra(ev(null, 60), []).state).toBe('none');
  });
});

describe('lengths read from the disc menu', () => {
  // Teacher's Pet: the menu's exact lengths and the real files' lengths, with the neighbours that
  // sit a few seconds away (the old six-second margin called them the same length).
  const menu: NameSource = {
    source: 'DVD menu',
    page: 'The menus of the disc image',
    url: '',
    features: [
      { text: 'A Whole Bunch Of World', depth: 1, seconds: 104.6 },
      { text: 'Small But Mighty', depth: 1, seconds: 62.2 },
      { text: 'Mambo Del Perro', depth: 1, seconds: 98.1 },
    ],
  };
  const files = [
    { path: 'e04', seconds: 104.671 },
    { path: 'e05', seconds: 62.228 },
    { path: 'e07', seconds: 59.893 },
    { path: 'e17', seconds: 65.031 },
    { path: 'e12', seconds: 98.231 },
    { path: 'e15', seconds: 91.091 },
    { path: 'e19', seconds: 94.094 },
  ];

  test('an exact menu length names the one file that has it, not its neighbours', () => {
    const out = matchMovie(
      files.map((f) => ({ ...f, ...ev(nothing(), f.seconds) })),
      candidatesFrom([menu]),
    );
    expect(out.e04!.name).toBe('A Whole Bunch Of World');
    expect(out.e05!.state).toBe('matched');
    expect(out.e05!.name).toBe('Small But Mighty');
    expect(out.e12!.state).toBe('matched');
    expect(out.e12!.name).toBe('Mambo Del Perro');
    for (const near of ['e07', 'e17', 'e15', 'e19'])
      expect(out[near]!.state).not.toBe('matched');
  });
});
