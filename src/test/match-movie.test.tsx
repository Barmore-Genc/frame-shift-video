import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MatchMovie, titleToSearch } from '@/components/match-movie';
import { matchFolder } from '@/components/subtitles-section';
import { matchedName } from '@/lib/tmdb-results';

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

const slow = { timeout: 4000 };
let sent: Record<string, unknown>[];
let renameAnswer: { ok: boolean; message: string };
let searchAnswer: string;
const realFetch = globalThis.fetch;

beforeEach(() => {
  sent = [];
  renameAnswer = { ok: true, message: 'Renamed.' };
  searchAnswer = [
    row('tmdb', 14688, '95 min'),
    row('tvdb', 14688, '90 min'),
  ].join('\n');
  let last: Record<string, unknown> = {};
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/discs/commands') && init?.method === 'POST') {
      last = JSON.parse(String(init.body));
      sent.push(last);
      return new Response(JSON.stringify({ id: `r${sent.length}` }));
    }
    if (last.action === 'rename') {
      return new Response(JSON.stringify({ done: true, ...renameAnswer }));
    }
    return new Response(
      JSON.stringify({ done: true, ok: true, message: searchAnswer }),
    );
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

function show(folder = 'The Proud Famil') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MatchMovie folder={folder} />
    </QueryClientProvider>,
  );
}

async function pick(which: number) {
  fireEvent.click(await screen.findByText('Match this movie to TMDB…'));
  fireEvent.click(screen.getByRole('button', { name: 'Look it up' }));
  await waitFor(
    () =>
      expect(
        screen.queryAllByRole('button', { name: 'Use this' }),
      ).toHaveLength(2),
    { timeout: 4000 },
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Use this' })[which]!);
}

describe('the names a match makes', () => {
  test('a TMDB result gets the id tag Plex reads, only when asked', () => {
    const tmdb = {
      kind: 'movie' as const,
      id: 14688,
      name: 'The Proud Family Movie (2005)',
      size: '',
      overview: '',
      poster: '',
      source: 'tmdb' as const,
    };
    expect(matchedName(tmdb, true)).toBe(
      'The Proud Family Movie (2005) {tmdb-14688}',
    );
    expect(matchedName(tmdb, false)).toBe('The Proud Family Movie (2005)');
  });

  test('a TheTVDB result never gets a tag, since Plex does not read its ids in a movie name', () => {
    const tvdb = {
      kind: 'movie' as const,
      id: 52065,
      name: 'Santa vs. the Snowman (2002)',
      size: '',
      overview: '',
      poster: '',
      source: 'tvdb' as const,
    };
    expect(matchedName(tvdb, true)).toBe('Santa vs. the Snowman (2002)');
  });

  test('the title to search is the folder name without its year or tag', () => {
    expect(titleToSearch('The Proud Famil')).toBe('The Proud Famil');
    expect(titleToSearch('Duma (2005) {tmdb-1}')).toBe('Duma');
  });

  test("only a movie's own file, named like its folder, can be matched", () => {
    expect(matchFolder('_converted/Rebound (2005)/Rebound (2005).mkv')).toBe(
      'Rebound (2005)',
    );
    expect(matchFolder('Rebound (2005)/Rebound (2005).mkv')).toBe(
      'Rebound (2005)',
    );
    expect(matchFolder('Show/Season 01/Show - s01e01.mkv')).toBeNull();
    expect(matchFolder('movie.mkv')).toBeNull();
  });
});

describe('matching a filed movie', () => {
  test('a TMDB result renames the folder to Title (Year) {tmdb-id}', async () => {
    show();
    await pick(0);
    expect(
      await screen.findByText(
        /Rename “The Proud Famil” to “The Proud Family Movie \(2005\) \{tmdb-14688\}”/,
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() =>
      expect(sent.filter((c) => c.action === 'rename')).toEqual([
        {
          action: 'rename',
          old: 'The Proud Famil',
          new: 'The Proud Family Movie (2005) {tmdb-14688}',
        },
      ]),
    );
    expect((await screen.findByRole('status', {}, slow)).textContent).toBe(
      'Renamed.',
    );
  });

  test('the id can be left out', async () => {
    show();
    await pick(0);
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() =>
      expect(sent.find((c) => c.action === 'rename')?.new).toBe(
        'The Proud Family Movie (2005)',
      ),
    );
  });

  test('a TheTVDB result offers no id box and renames without a tag', async () => {
    show();
    await pick(1);
    expect(await screen.findByText(/does not read TheTVDB ids/)).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() =>
      expect(sent.find((c) => c.action === 'rename')?.new).toBe(
        'The Proud Family Movie (2005)',
      ),
    );
  });

  test('a name that is taken says so, and Replace the older copy asks the host to set it aside', async () => {
    renameAnswer = {
      ok: false,
      message:
        '"The Proud Family Movie (2005) {tmdb-14688}" already exists in /array/share/DVDs.',
    };
    show();
    await pick(0);
    expect(
      screen.queryByRole('button', { name: 'Replace the older copy' }),
    ).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }));
    const replace = await screen.findByRole(
      'button',
      { name: 'Replace the older copy' },
      slow,
    );
    expect((await screen.findByRole('alert', {}, slow)).textContent).toContain(
      'already exists',
    );
    fireEvent.click(replace);
    await waitFor(() =>
      expect(sent.filter((c) => c.action === 'rename')).toHaveLength(2),
    );
    expect(sent.filter((c) => c.action === 'rename')[1]).toEqual({
      action: 'rename',
      old: 'The Proud Famil',
      new: 'The Proud Family Movie (2005) {tmdb-14688}',
      replace: true,
    });
  });

  test('a different failure does not offer to replace anything', async () => {
    renameAnswer = {
      ok: false,
      message: '"The Proud Famil" is still converting.',
    };
    show();
    await pick(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }));
    expect((await screen.findByRole('alert', {}, slow)).textContent).toContain(
      'still converting',
    );
    expect(
      screen.queryByRole('button', { name: 'Replace the older copy' }),
    ).toBeNull();
  });
});
