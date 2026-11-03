import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExtrasSection } from '@/components/extras-section';

const MOVIES = [
  {
    movie: 'Duma (2005)',
    items: [
      {
        path: '_converted/Duma (2005)/Trailers/Trailer 01 (2 min).mkv',
        folder: 'Trailers',
        name: 'Trailer 01 (2 min)',
        unnamed: true,
      },
      {
        path: '_converted/Duma (2005)/Featurettes/Making Of.mkv',
        folder: 'Featurettes',
        name: 'Making Of',
        unnamed: false,
      },
    ],
  },
];

type Rename = { path: string; name: string; folder?: string };
let renames: Rename[];
let failWith: string | null;
let sources: unknown[];
let hintAsked: string[];
let previewAsked: string[];
let previewFails: boolean;
let matchState: unknown;
let matchStarted: string[];
let dupGroups: string[][];
let dupReels: { path: string; parts: string[] }[];
let removed: string[][];
let removedList: unknown[];
let restored: string[][];
let movieList: unknown[];
let removeFails: { path: string; error: string }[];
const realFetch = globalThis.fetch;

beforeEach(() => {
  renames = [];
  failWith = null;
  hintAsked = [];
  previewAsked = [];
  previewFails = false;
  matchState = null;
  matchStarted = [];
  dupGroups = [];
  dupReels = [];
  removed = [];
  removedList = [];
  restored = [];
  movieList = MOVIES;
  removeFails = [];
  try {
    localStorage.clear();
  } catch {
    // Not there: nothing to clear.
  }
  sources = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes('/discs/extras/duplicates')) {
      return new Response(
        JSON.stringify({ groups: dupGroups, reels: dupReels }),
      );
    }
    if (String(url).includes('/discs/extras/removed')) {
      return new Response(JSON.stringify({ extras: removedList }));
    }
    if (String(url).includes('/discs/extras/restore')) {
      const paths = JSON.parse(String(init?.body)).paths as string[];
      restored.push(paths);
      return new Response(JSON.stringify({ restored: paths, failed: [] }));
    }
    if (String(url).includes('/discs/extras/remove')) {
      const paths = JSON.parse(String(init?.body)).paths as string[];
      removed.push(paths);
      return new Response(
        JSON.stringify({
          removed: paths.filter((p) => !removeFails.some((f) => f.path === p)),
          failed: removeFails,
        }),
      );
    }
    if (String(url).includes('/discs/extras/match')) {
      if (init?.method === 'POST') {
        matchStarted.push(JSON.parse(String(init.body)).movie);
        matchState = { status: 'running', total: 2, done: 0, suggestions: {} };
      }
      return new Response(JSON.stringify({ match: matchState }));
    }
    if (String(url).includes('/discs/extras/preview')) {
      previewAsked.push(
        new URL(String(url), 'http://x').searchParams.get('path')!,
      );
      return previewFails
        ? new Response(JSON.stringify({ error: 'That video has no length' }), {
            status: 404,
          })
        : new Response(JSON.stringify({ seconds: 80, times: [5, 15, 25] }));
    }
    if (String(url).includes('/discs/extras/sources')) {
      hintAsked.push(
        new URL(String(url), 'http://x').searchParams.get('movie')!,
      );
      return new Response(JSON.stringify({ sources }));
    }
    if (String(url).endsWith('/discs/extras/rename')) {
      renames.push(JSON.parse(String(init?.body)));
      return failWith
        ? new Response(JSON.stringify({ error: failWith }), { status: 400 })
        : new Response(JSON.stringify({ path: 'x' }));
    }
    return new Response(JSON.stringify({ movies: movieList }));
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

function page() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ExtrasSection />
    </QueryClientProvider>,
  );
}

const nameBox = (label: string) =>
  screen.findByRole('textbox', { name: label }) as Promise<HTMLInputElement>;

describe('the "Name the extras" section', () => {
  test('lists each extra under its movie, and says which are not named yet', async () => {
    page();
    expect(await screen.findByText('Duma (2005)')).toBeTruthy();
    expect(screen.getByText('1 not named')).toBeTruthy();
    expect(
      screen.getByText('Not named yet (Trailer 01 (2 min)). What is this one?'),
    ).toBeTruthy();
    expect(
      (await nameBox('Name of the extra Making Of in Duma (2005)')).value,
    ).toBe('Making Of');
  });

  test('a box for an extra with no name yet starts empty, and the length is not in it', async () => {
    page();
    const box = await nameBox(
      'Name of the extra Trailer 01 (2 min) in Duma (2005)',
    );
    expect(box.value).toBe('');
    expect(box.placeholder).toBe('Type its name');
    expect(box.value).not.toContain('min');
  });

  test('each extra has a link to watch it and one to save it', async () => {
    page();
    const path = '_converted/Duma (2005)/Trailers/Trailer 01 (2 min).mkv';
    const watch = (await screen.findByRole('link', {
      name: 'Watch the extra Trailer 01 (2 min) in Duma (2005)',
    })) as HTMLAnchorElement;
    expect(watch.getAttribute('href')).toBe(
      `/api/discs/extras/file?${new URLSearchParams({ path })}`,
    );
    expect(watch.target).toBe('_blank');
    const save = screen.getByRole('link', {
      name: 'Download the extra Trailer 01 (2 min) in Duma (2005)',
    }) as HTMLAnchorElement;
    expect(save.getAttribute('href')).toBe(
      `/api/discs/extras/file?${new URLSearchParams({ path, download: '1' })}`,
    );
  });

  test('an empty box with nothing else changed saves nothing', async () => {
    page();
    await nameBox('Name of the extra Trailer 01 (2 min) in Duma (2005)');
    const [save] = screen.getAllByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });

  test('Save waits until something is changed, then sends the new name', async () => {
    page();
    const box = await nameBox(
      'Name of the extra Trailer 01 (2 min) in Duma (2005)',
    );
    const [save] = screen.getAllByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: 'Theatrical Trailer' } });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save!);
    await waitFor(() => expect(renames).toHaveLength(1));
    expect(renames[0]).toEqual({
      path: '_converted/Duma (2005)/Trailers/Trailer 01 (2 min).mkv',
      name: 'Theatrical Trailer',
    });
  });

  test('choosing another kind sends the folder too', async () => {
    page();
    const kind = (await screen.findByRole('combobox', {
      name: 'Kind of the extra Trailer 01 (2 min) in Duma (2005)',
    })) as HTMLSelectElement;
    fireEvent.change(kind, { target: { value: 'Deleted Scenes' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);
    await waitFor(() => expect(renames).toHaveLength(1));
    expect(renames[0]).toMatchObject({
      name: 'Trailer 01 (2 min)',
      folder: 'Deleted Scenes',
    });
  });

  test('what the server refuses is shown next to that extra', async () => {
    failWith = 'There is already an extra with that name';
    page();
    const box = await nameBox(
      'Name of the extra Trailer 01 (2 min) in Duma (2005)',
    );
    fireEvent.change(box, { target: { value: 'Making Of' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);
    expect((await screen.findByRole('alert')).textContent).toContain(
      'already an extra',
    );
  });

  test('nothing is shown when there are no extras', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ movies: [] }))) as unknown as typeof fetch;
    const { container } = page();
    await new Promise((r) => setTimeout(r, 100));
    expect(container.textContent).toBe('');
  });

  test("the disc's own menus are listed with no link, since there is no page for them", async () => {
    sources = [
      {
        source: 'DVD menu',
        page: 'The menus of the disc image Duma',
        url: '',
        features: [{ text: 'Making Of', depth: 1, seconds: 154.8 }],
      },
    ];
    page();
    expect(
      await screen.findByText(
        'What the databases list on this disc (DVD menu)',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Making Of (2:34)')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'DVD menu' })).toBeNull();
    expect(screen.getByText('DVD menu')).toBeTruthy();
  });

  test('shows what every database lists, with the lengths they give', async () => {
    sources = [
      {
        source: 'DVD Compare',
        page: 'Duma',
        url: 'https://www.dvdcompare.net/comparisons/film.php?fid=13117',
        release: 'R1 America - Warner Home Video',
        features: [
          { text: 'Extended Scenes', depth: 1, seconds: null },
          { text: 'Play All', depth: 1, seconds: 108, playAll: true },
          { text: 'Xan and Ripkuna at the Airplane', depth: 1, seconds: 59 },
        ],
      },
      {
        source: 'DVD Fandom',
        page: 'Duma',
        url: 'https://dvd.fandom.com/wiki/Duma',
        runtime: 'Approx. 100 minutes',
        features: [
          { text: 'Disc 2', depth: 0, seconds: null },
          { text: 'Zebra Cut', depth: 2, seconds: null },
        ],
      },
    ];
    page();
    expect(
      await screen.findByText(
        'What the databases list on this disc (DVD Compare, DVD Fandom)',
      ),
    ).toBeTruthy();
    expect(hintAsked).toEqual(['Duma (2005)']);
    expect(
      screen.getByText('Xan and Ripkuna at the Airplane (0:59)'),
    ).toBeTruthy();
    expect(
      screen.getByText('Play All (1:48) (plays the others in a row)'),
    ).toBeTruthy();
    expect(screen.getByText('Extended Scenes')).toBeTruthy();
    expect(screen.getByText('Zebra Cut')).toBeTruthy();
    expect(screen.getByText(/R1 America - Warner Home Video/)).toBeTruthy();
    expect(screen.getByText(/the movie: Approx. 100 minutes/)).toBeTruthy();
    const link = screen.getByRole('link', {
      name: 'DVD Compare',
    }) as HTMLAnchorElement;
    expect(link.href).toBe(
      'https://www.dvdcompare.net/comparisons/film.php?fid=13117',
    );
  });

  test('says so when no database has a list, and still lets the extras be named', async () => {
    page();
    expect(
      await screen.findByText(
        'DVD Compare, TheDiscDB and DVD Fandom have no list for this movie.',
      ),
    ).toBeTruthy();
    expect(
      await nameBox('Name of the extra Trailer 01 (2 min) in Duma (2005)'),
    ).toBeTruthy();
  });

  test('a movie whose extras are all named is not looked up', async () => {
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes('/discs/extras/sources'))
        hintAsked.push('asked');
      return new Response(
        JSON.stringify({
          movies: [
            {
              movie: 'Done (2001)',
              items: [
                {
                  path: 'a',
                  folder: 'Featurettes',
                  name: 'Making Of',
                  unnamed: false,
                },
              ],
            },
          ],
        }),
      );
    }) as unknown as typeof fetch;
    page();
    expect(await screen.findByText('Done (2001)')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 100));
    expect(hintAsked).toEqual([]);
    expect(screen.queryByText(/DVD Compare/)).toBeNull();
  });

  const openPreview = async (name: string) => {
    const summary = await screen.findByLabelText(
      `Preview the extra ${name} in Duma (2005)`,
    );
    const details = summary.closest('details') as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event('toggle'));
  };

  test('a preview is not made until it is opened, then shows pictures from the video', async () => {
    page();
    await nameBox('Name of the extra Trailer 01 (2 min) in Duma (2005)');
    expect(previewAsked).toEqual([]);
    await openPreview('Trailer 01 (2 min)');
    await screen.findByText('1:20 long. Press a picture to watch from there.');
    expect(previewAsked).toEqual([
      '_converted/Duma (2005)/Trailers/Trailer 01 (2 min).mkv',
    ]);
    const path = '_converted/Duma (2005)/Trailers/Trailer 01 (2 min).mkv';
    const link = screen.getByRole('link', {
      name: 'Watch from 0:15',
    }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(
      `/api/discs/extras/file?${new URLSearchParams({ path })}#t=15`,
    );
    expect(link.querySelector('img')?.getAttribute('src')).toBe(
      `/api/discs/extras/frame?${new URLSearchParams({ path, t: '15' })}`,
    );
  });

  test('a video that cannot be looked into says so', async () => {
    previewFails = true;
    page();
    await openPreview('Trailer 01 (2 min)');
    expect((await screen.findByRole('alert')).textContent).toContain(
      'no length',
    );
  });

  const PATH = '_converted/Duma (2005)/Trailers/Trailer 01 (2 min).mkv';

  test('Try to match the names starts the listening and shows how far it has got', async () => {
    page();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Try to match the names' }),
    );
    await waitFor(() => expect(matchStarted).toEqual(['Duma (2005)']));
    expect(await screen.findByText('0 of 2 looked at')).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: 'Listening...',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  test('a clear suggestion says why, and Use this name fills the box and the kind but does not save', async () => {
    matchState = {
      status: 'done',
      total: 1,
      done: 1,
      suggestions: {
        [PATH]: {
          state: 'matched',
          note: 'Looks like “Theatrical Trailer”: the writing at 0:01 reads it.',
          name: 'Theatrical Trailer',
          kind: 'Deleted Scenes',
          saw: 'THEATRICAL TRAILER',
          heard: 'coming soon',
        },
      },
    };
    page();
    expect(
      await screen.findByText(/Looks like “Theatrical Trailer”/),
    ).toBeTruthy();
    expect(screen.getByText('Done: 1 of 1 matched clearly.')).toBeTruthy();
    expect(screen.getByText('Written on it: THEATRICAL TRAILER')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use this name' }));
    const box = await nameBox(
      'Name of the extra Trailer 01 (2 min) in Duma (2005)',
    );
    expect(box.value).toBe('Theatrical Trailer');
    expect(
      (
        screen.getByRole('combobox', {
          name: 'Kind of the extra Trailer 01 (2 min) in Duma (2005)',
        }) as HTMLSelectElement
      ).value,
    ).toBe('Deleted Scenes');
    expect(renames).toEqual([]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);
    await waitFor(() => expect(renames).toHaveLength(1));
    expect(renames[0]).toEqual({
      path: PATH,
      name: 'Theatrical Trailer',
      folder: 'Deleted Scenes',
    });
  });

  test('a maybe offers the name only as "Use it anyway", and no match offers none', async () => {
    matchState = {
      status: 'done',
      total: 1,
      done: 1,
      suggestions: {
        [PATH]: {
          state: 'unsure',
          note: 'Could be “A” or “B”; it is not clear which.',
          name: 'A',
          saw: '',
          heard: '',
        },
      },
    };
    const first = page();
    expect(await screen.findByText(/not clear which/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use it anyway' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use this name' })).toBeNull();
    first.unmount();

    matchState = {
      status: 'done',
      total: 1,
      done: 1,
      suggestions: {
        [PATH]: {
          state: 'none',
          note: 'Nothing is written on it or said in it that could be read.',
          saw: '',
          heard: '',
        },
      },
    };
    page();
    expect(await screen.findByText(/Nothing is written on it/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Use/ })).toBeNull();
  });

  test('an extra that is already named gets no suggestion', async () => {
    matchState = {
      status: 'done',
      total: 1,
      done: 1,
      suggestions: {
        '_converted/Duma (2005)/Trailers/Trailer 01 (2 min).mkv': {
          state: 'none',
          note: 'The answer for the one with no name.',
          saw: '',
          heard: '',
        },
        '_converted/Duma (2005)/Featurettes/Making Of.mkv': {
          state: 'matched',
          note: 'Looks like “Something Else”.',
          name: 'Something Else',
          saw: '',
          heard: '',
        },
      },
    };
    page();
    // Once the answer for the unnamed one is on the page, the named one's would be too.
    expect(
      await screen.findByText('The answer for the one with no name.'),
    ).toBeTruthy();
    expect(screen.queryByText(/Something Else/)).toBeNull();
  });

  test('the listener being down is shown', async () => {
    matchState = {
      status: 'failed',
      total: 2,
      done: 0,
      suggestions: {},
      error: 'The listener could not be reached',
    };
    page();
    expect((await screen.findByRole('alert')).textContent).toContain(
      'could not be reached',
    );
  });

  test('a warning that did not stop the matching is shown beside the answers', async () => {
    matchState = {
      status: 'done',
      total: 1,
      done: 0,
      suggestions: {},
      warning:
        'The listener could not be reached, so these suggestions are by length only.',
    };
    page();
    expect(await screen.findByText(/by length only/)).toBeTruthy();
  });

  test('a movie whose extras are all named has no match button', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          movies: [
            {
              movie: 'Done (2001)',
              items: [
                {
                  path: 'a',
                  folder: 'Featurettes',
                  name: 'Making Of',
                  unnamed: false,
                },
              ],
            },
          ],
        }),
      )) as unknown as typeof fetch;
    page();
    expect(await screen.findByText('Done (2001)')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Try to match the names' }),
    ).toBeNull();
  });

  const TRAILER = '_converted/Duma (2005)/Trailers/Trailer 01 (2 min).mkv';
  const MAKING = '_converted/Duma (2005)/Featurettes/Making Of.mkv';
  const pick = (name: string) =>
    screen.findByRole('checkbox', {
      name: `Select the extra ${name} in Duma (2005)`,
    }) as Promise<HTMLInputElement>;
  const checked = async () => [
    (await pick('Trailer 01 (2 min)')).checked,
    (await pick('Making Of')).checked,
  ];
  const click = (name: string) =>
    fireEvent.click(screen.getByRole('button', { name }));

  test('Select all, Select none and Invert selection', async () => {
    page();
    expect(await checked()).toEqual([false, false]);
    click('Select all');
    expect(await checked()).toEqual([true, true]);
    click('Select none');
    expect(await checked()).toEqual([false, false]);
    fireEvent.click(await pick('Making Of'));
    expect(await checked()).toEqual([false, true]);
    click('Invert selection');
    expect(await checked()).toEqual([true, false]);
  });

  test('Remove selected needs a selection, then moves just those at once', async () => {
    page();
    await pick('Making Of');
    expect(
      (
        screen.getByRole('button', {
          name: 'Remove selected',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(await pick('Trailer 01 (2 min)'));
    click('Remove selected (1)');
    await waitFor(() => expect(removed).toEqual([[TRAILER]]));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect((await screen.findByRole('status')).textContent).toContain(
      'Moved 1 extra to the Removed tab',
    );
    expect((await pick('Trailer 01 (2 min)')).checked).toBe(false);
  });

  test('the Remove button of one extra moves only that one', async () => {
    page();
    await pick('Making Of');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Remove the extra Making Of from Duma (2005)',
      }),
    );
    await waitFor(() => expect(removed).toEqual([[MAKING]]));
  });

  test('the Removed tab lists what was taken out, and puts it back', async () => {
    removedList = [
      {
        path: '_removed/Duma (2005)/Other/Extra 02 (2 min).mkv',
        movie: 'Duma (2005)',
        folder: 'Other',
        name: 'Extra 02 (2 min)',
      },
      {
        path: '_removed/Duma (2005)/Trailers/Trailer 02 (1 min).mkv',
        movie: 'Duma (2005)',
        folder: 'Trailers',
        name: 'Trailer 02 (1 min)',
      },
    ];
    page();
    fireEvent.click(await screen.findByRole('tab', { name: 'Removed (2)' }));
    expect(screen.getByText('Extra 02 (2 min)')).toBeTruthy();
    expect(screen.queryByText('Making Of')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Put Trailer 02 (1 min) back in Duma (2005)',
      }),
    );
    await waitFor(() =>
      expect(restored).toEqual([
        ['_removed/Duma (2005)/Trailers/Trailer 02 (1 min).mkv'],
      ]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Put all back (2)' }));
    await waitFor(() => expect(restored.length).toBe(2));
    expect(restored[1]).toEqual([
      '_removed/Duma (2005)/Other/Extra 02 (2 min).mkv',
      '_removed/Duma (2005)/Trailers/Trailer 02 (1 min).mkv',
    ]);
  });

  test('the Removed tab says when nothing was removed', async () => {
    page();
    fireEvent.click(await screen.findByRole('tab', { name: 'Removed (0)' }));
    expect(screen.getByText(/Nothing has been removed/)).toBeTruthy();
  });

  test('a movie folds away, and says how many extras it has left to name', async () => {
    page();
    const heading = await screen.findByRole('button', {
      name: /^Duma \(2005\)\s*\d+ extras?/,
    });
    expect(heading.getAttribute('aria-expanded')).toBe('true');
    expect(heading.textContent).toContain('2 extras, 1 not named');
    fireEvent.click(heading);
    expect(heading.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Select all' })).toBeNull();
    expect(
      screen.queryByRole('textbox', {
        name: 'Name of the extra Making Of in Duma (2005)',
      }),
    ).toBeNull();
    fireEvent.click(heading);
    expect(
      await nameBox('Name of the extra Making Of in Duma (2005)'),
    ).toBeTruthy();
  });

  test('a movie with everything named starts folded, and Expand all opens every movie', async () => {
    movieList = [
      {
        movie: 'Done (2001)',
        items: [
          {
            path: '_converted/Done (2001)/Featurettes/Making Of.mkv',
            folder: 'Featurettes',
            name: 'Making Of',
            unnamed: false,
          },
        ],
      },
      ...MOVIES,
    ];
    page();
    const done = await screen.findByRole('button', {
      name: /^Done \(2001\)\s*\d+ extras?/,
    });
    expect(done.getAttribute('aria-expanded')).toBe('false');
    expect(done.textContent).toContain('all named');
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(done.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(
      screen
        .getAllByRole('button', { name: /^.+ \(\d{4}\)\s*\d+ extras?/ })
        .map((b) => b.getAttribute('aria-expanded')),
    ).toEqual(['false', 'false']);
  });

  test('Enter in the name box saves, but not when nothing was typed', async () => {
    page();
    const box = await nameBox(
      'Name of the extra Trailer 01 (2 min) in Duma (2005)',
    );
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(renames).toEqual([]);
    fireEvent.change(box, { target: { value: 'Teaser' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() =>
      expect(renames).toEqual([
        {
          path: '_converted/Duma (2005)/Trailers/Trailer 01 (2 min).mkv',
          name: 'Teaser',
        },
      ]),
    );
  });

  test('copies are pointed out, and Select copies keeps the named one', async () => {
    dupGroups = [[TRAILER, MAKING]];
    page();
    expect(
      await screen.findByText(/The same video as “Making Of”: the same length/),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /The same video as “Trailer 01 \(2 min\)”: the same length/,
      ),
    ).toBeTruthy();
    click('Select copies (1)');
    expect(await checked()).toEqual([true, false]);
  });

  test('an extra that is the others played in a row is pointed out, and Select copies picks only it', async () => {
    const at = (name: string) => `_converted/Duma (2005)/Other/${name}.mkv`;
    const names = ['Extra 01 (19 min)', 'One', 'Two', 'Three', 'Four'];
    movieList = [
      {
        movie: 'Duma (2005)',
        items: names.map((name, i) => ({
          path: at(name),
          folder: 'Other',
          name,
          unnamed: i === 0,
        })),
      },
    ];
    dupReels = [{ path: at(names[0]!), parts: names.slice(1).map(at) }];
    page();
    expect(
      await screen.findByText(
        /This is 4 extras played one after another \(“One” to “Four”\), so it is a second copy of them\./,
      ),
    ).toBeTruthy();
    click('Select copies (1)');
    const boxes = await Promise.all(
      names.map(
        async (name) =>
          (
            (await screen.findByRole('checkbox', {
              name: `Select the extra ${name} in Duma (2005)`,
            })) as HTMLInputElement
          ).checked,
      ),
    );
    expect(boxes).toEqual([true, false, false, false, false]);
  });

  test('a reel of three or fewer names its parts', async () => {
    const at = (name: string) => `_converted/Duma (2005)/Other/${name}.mkv`;
    const names = ['Extra 01 (5 min)', 'One', 'Two', 'Three'];
    movieList = [
      {
        movie: 'Duma (2005)',
        items: names.map((name, i) => ({
          path: at(name),
          folder: 'Other',
          name,
          unnamed: i === 0,
        })),
      },
    ];
    dupReels = [{ path: at(names[0]!), parts: names.slice(1).map(at) }];
    page();
    expect(
      await screen.findByText(
        /This is 3 extras played one after another \(“One”, “Two”, “Three”\)/,
      ),
    ).toBeTruthy();
  });

  test('with no copies, Select copies is not offered', async () => {
    page();
    await pick('Making Of');
    expect(
      (
        screen.getByRole('button', {
          name: 'Select copies',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  test('one that could not be removed is said, with why', async () => {
    removeFails = [{ path: MAKING, error: 'That extra is not there any more' }];
    page();
    await pick('Making Of');
    click('Select all');
    click('Remove selected (2)');
    expect(
      (await screen.findAllByRole('alert')).map((a) => a.textContent).join(' '),
    ).toContain('Making Of (That extra is not there any more)');
  });
});
