import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TmdbPicker } from '@/components/tmdb-picker';
import { DriveSection, NextSection } from '@/routes/discs';
import type { DiscsState } from '@/types/discs';

// What the host answers to a search: both the movie and the show of the same name, as TMDB does.
const BOTH = [
  ['movie', 24034, "Teacher's Pet", '2004 · 73 min', 'The movie', ''],
  ['tv', 2398, "Teacher's Pet", '2000 · 39 episodes', 'The show', ''],
]
  .map((row) => row.join('\t'))
  .join('\n');

type Sent = { kind: string; query: string };
let sent: Sent[];
let answer: string;
const realFetch = globalThis.fetch;

beforeEach(() => {
  sent = [];
  answer = BOTH;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/discs/commands') && init?.method === 'POST') {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: `r${sent.length}` }));
    }
    return new Response(
      JSON.stringify({ done: true, ok: true, message: answer }),
    );
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const names = () =>
  screen.queryAllByRole('listitem').map((li) => li.textContent ?? '');
const slow = { timeout: 4000 };

describe('the search follows the kind that is chosen', () => {
  test('only movies are listed when movie is chosen, even if the host sends both', async () => {
    render(
      <TmdbPicker
        kind="movie"
        initialQuery="Teachers Pet"
        autoSearch
        onPick={() => {}}
      />,
    );
    await waitFor(() => expect(names()).toHaveLength(1), slow);
    expect(names()[0]).toContain('The movie');
    expect(names()[0]).not.toContain('TV ·');
    expect(sent[0]?.kind).toBe('movie');
  });

  test('only shows are listed when TV show is chosen', async () => {
    render(
      <TmdbPicker
        kind="tv"
        initialQuery="Teachers Pet"
        autoSearch
        onPick={() => {}}
      />,
    );
    await waitFor(() => expect(names()).toHaveLength(1), slow);
    expect(names()[0]).toContain('The show');
    expect(sent[0]?.kind).toBe('tv');
  });

  test('either shows both', async () => {
    render(
      <TmdbPicker
        kind="any"
        initialQuery="Teachers Pet"
        autoSearch
        onPick={() => {}}
      />,
    );
    await waitFor(() => expect(names()).toHaveLength(2), slow);
  });

  test('switching the kind looks the same title up again and swaps the list', async () => {
    const view = render(
      <TmdbPicker
        kind="movie"
        initialQuery="Teachers Pet"
        autoSearch
        onPick={() => {}}
      />,
    );
    await waitFor(() => expect(names()).toHaveLength(1), slow);
    view.rerender(
      <TmdbPicker
        kind="tv"
        initialQuery="Teachers Pet"
        autoSearch
        onPick={() => {}}
      />,
    );
    expect(names()).toHaveLength(0);
    await waitFor(() => expect(names()[0]).toContain('The show'), slow);
    expect(names()).toHaveLength(1);
    expect(sent.map((s) => s.kind)).toEqual(['movie', 'tv']);
    expect(sent[1]?.query).toBe('Teachers Pet');
  });

  test('switching the kind before anything was searched does not search', () => {
    const view = render(
      <TmdbPicker kind="movie" initialQuery="" onPick={() => {}} />,
    );
    view.rerender(<TmdbPicker kind="tv" initialQuery="" onPick={() => {}} />);
    expect(sent).toHaveLength(0);
  });

  test('using one reports the one that was clicked', async () => {
    const picked: string[] = [];
    render(
      <TmdbPicker
        kind="movie"
        initialQuery="Teachers Pet"
        autoSearch
        onPick={(r) => picked.push(`${r.kind}${r.id}`)}
      />,
    );
    await waitFor(() => expect(names()).toHaveLength(1), slow);
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
    expect(picked).toEqual(['movie24034']);
  });
});

describe('results from TheTVDB', () => {
  const TVDB = [
    'movie',
    52065,
    'Santa vs. the Snowman (2002)',
    '21 min',
    'Once upon a time.',
    'https://artworks.thetvdb.com/banners/movies/52065/posters/52065.jpg',
    'tvdb',
  ].join('\t');

  test('a result only TheTVDB has shows its poster, and says where it is from once used', async () => {
    answer = TVDB;
    const { container } = render(
      <TmdbPicker
        kind="movie"
        initialQuery="Santa vs the Snowman"
        autoSearch
        onPick={() => {}}
      />,
    );
    await waitFor(() => expect(names()).toHaveLength(1), slow);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://artworks.thetvdb.com/banners/movies/52065/posters/52065.jpg',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
    expect(
      await screen.findByText(
        /Using “Santa vs. the Snowman \(2002\)” from TVDB/,
      ),
    ).toBeTruthy();
    expect(
      (screen.getByRole('link', { name: 'movie 52065' }) as HTMLAnchorElement)
        .href,
    ).toBe('https://thetvdb.com/dereferrer/movie/52065');
  });

  test('a TMDB result still says TMDB and links to TMDB', async () => {
    render(
      <TmdbPicker
        kind="movie"
        initialQuery="Teachers Pet"
        autoSearch
        onPick={() => {}}
      />,
    );
    await waitFor(() => expect(names()).toHaveLength(1), slow);
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
    expect(await screen.findByText(/from TMDB/)).toBeTruthy();
    expect(
      (screen.getByRole('link', { name: 'movie 24034' }) as HTMLAnchorElement)
        .href,
    ).toBe('https://www.themoviedb.org/movie/24034');
  });
});

describe('every result says which database it is from', () => {
  const row = (source: string, id: number, size: string) =>
    [
      'movie',
      id,
      'The Proud Family Movie (2005)',
      size,
      'A film.',
      '',
      source,
    ].join('\t');

  test('the same movie from both databases is told apart by label and color, with its own length', async () => {
    answer = [row('tmdb', 14688, '95 min'), row('tvdb', 14688, '90 min')].join(
      '\n',
    );
    render(
      <TmdbPicker
        kind="movie"
        initialQuery="Proud Family Movie"
        autoSearch
        onPick={() => {}}
      />,
    );
    await waitFor(() => expect(names()).toHaveLength(2), slow);
    const [tmdb, tvdb] = screen.getAllByRole('listitem');
    expect(tmdb!.textContent).toContain('95 min');
    expect(tmdb!.textContent).toContain('TMDB');
    expect(tmdb!.className).toContain('border-l-[#01b4e4]');
    expect(tmdb!.innerHTML).toContain('bg-[#01b4e4]');
    expect(tvdb!.textContent).toContain('90 min');
    expect(tvdb!.textContent).toContain('TVDB');
    expect(tvdb!.className).toContain('border-l-[#6cd491]');
    expect(tvdb!.innerHTML).toContain('bg-[#6cd491]');
    // Both are kept (the same id in two databases is not the same result).
    expect(names()).toHaveLength(2);
  });
});

describe('the "Tell it what the disc is" form', () => {
  const state = {
    available: true,
    eject: true,
    autoScan: true,
    movieOnly: true,
    drive: { media: true, label: 'TEACHERS_PET', updated: 1, alive: true },
    run: null,
    next: null,
    attention: [],
    working: [],
    parked: [],
    needsYear: [],
    finishedCount: 0,
    recent: [],
    convert: { presets: [], chosen: '' },
    outputFolder: '_converted',
  } as unknown as DiscsState;

  function form() {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    return render(
      <QueryClientProvider client={client}>
        <NextSection state={state} />
      </QueryClientProvider>,
    );
  }

  test('starts with movies only, and the Movie / TV show choice changes what the search lists', async () => {
    form();
    await waitFor(() => expect(names()).toHaveLength(1), slow);
    expect(names()[0]).toContain('The movie');
    expect(sent[0]?.kind).toBe('movie');

    fireEvent.click(screen.getByRole('radio', { name: 'TV show' }));
    await waitFor(() => expect(names()[0]).toContain('The show'), slow);
    expect(names()).toHaveLength(1);
    expect(sent.map((s) => s.kind)).toEqual(['movie', 'tv']);

    fireEvent.click(screen.getByRole('radio', { name: 'Movie' }));
    await waitFor(() => expect(names()[0]).toContain('The movie'), slow);
    expect(names()).toHaveLength(1);
  });
});

describe('the Drive card while a disc is copied', () => {
  const now = Math.floor(Date.now() / 1000);
  const base = {
    available: true,
    eject: true,
    autoScan: true,
    movieOnly: false,
    drive: { media: true, label: 'TEACHERS_PET', updated: now, alive: true },
    run: {
      state: 'running',
      name: 'Teachers Pet',
      step: 'Copying the disc',
      updated: now,
    },
    next: null,
    attention: [],
    working: [
      {
        name: 'Teachers_Pet',
        title: 'Teachers Pet',
        stage: 'copying',
        lines: [],
        queued: false,
        conversion: null,
        quietSeconds: 5,
        copy: {
          total: 4_000_000_000,
          bytes: 1_000_000_000,
          startedAt: now - 600,
          updatedAt: now,
        },
      },
    ],
    parked: [],
    needsYear: [],
    finishedCount: 0,
    recent: [],
    convert: { presets: [], chosen: '' },
    outputFolder: '_converted',
  } as unknown as DiscsState;

  function card(state: DiscsState) {
    const client = new QueryClient();
    return render(
      <QueryClientProvider client={client}>
        <DriveSection state={state} />
      </QueryClientProvider>,
    );
  }

  test('shows how far the copy is, next to the words "Working on"', () => {
    card(base);
    expect(screen.getByText(/Working/)).toBeTruthy();
    const bar = screen.getByRole('progressbar', {
      name: 'How much of the disc is copied',
    });
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
  });

  test('no bar when nothing is being copied', () => {
    card({ ...base, run: null, working: [] } as unknown as DiscsState);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
