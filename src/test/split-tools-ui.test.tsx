/**
 * Tests for the Split & Tracks page as a person uses it: typing, clicking and reading what is
 * shown. The only fake is the network; every request the page makes is recorded so the tests can
 * check exactly what it sent.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { SplitTools } from '@/components/split-tools';
import { PathPicker } from '@/components/path-picker';
import type {
  SplitPreviewFile,
  SplitTask,
  TrackPreviewFile,
} from '@/lib/split-api';

interface Call {
  url: string;
  method: string;
  body: any;
}

let calls: Call[];
let routes: Record<string, (body: any, url: string) => unknown>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  routes = { '/api/split/tasks': () => ({ tasks: [] }) };
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init?.method ?? 'GET', body });
    const route = Object.keys(routes).find((r) => url.startsWith(r));
    if (!route) return new Response('{}', { status: 404 });
    const result = routes[route](body, url);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), { status: 200 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const posts = (url: string) =>
  calls.filter((c) => c.url === url && c.method === 'POST');

function show(ui = <SplitTools />) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

const episode = (name: string, start: number, end: number) => ({
  name,
  start,
  end,
});

const goodFile = (
  p: string,
  names = ['S01E01', 'S01E02'],
): SplitPreviewFile => ({
  path: p,
  duration: 300,
  plan: { complete: true, boundaries: [{ start: 148, end: 151 }] },
  episodes: [episode(names[0], 0, 148.2), episode(names[1], 150.8, 300)],
});

const badFile = (p: string): SplitPreviewFile => ({
  path: p,
  duration: 300,
  plan: {
    complete: false,
    warning: 'Found 0 of 1 episode breaks; this file was left alone',
    boundaries: [],
  },
  episodes: [],
});

/** The visible tab, or the whole screen where there are no tabs. */
function scope() {
  const panel = screen.queryByRole('tabpanel');
  return panel ? within(panel) : screen;
}

function type(label: string | RegExp, value: string) {
  fireEvent.change(scope().getByLabelText(label), { target: { value } });
}

describe('Separate episodes tab', () => {
  test('nothing can be run until a path is typed', () => {
    show();
    expect(
      screen.getByRole('button', { name: /Find the breaks/ }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Split/ })).toBeDisabled();
    type('Path', 'Shows/Karate');
    expect(
      screen.getByRole('button', { name: /Find the breaks/ }),
    ).toBeEnabled();
    // Still nothing to split until the breaks are found.
    expect(screen.getByRole('button', { name: /^Split/ })).toBeDisabled();
  });

  test('sends what was typed, shows the plan, and runs only what the plan found', async () => {
    routes['/api/split/preview'] = () => ({
      files: [goodFile('Shows/a.mkv', ['S02E05 - One', 'S02E06 - Two'])],
    });
    routes['/api/split/run'] = () => ({ queued: 1 });
    show();
    type('Path', 'Shows');
    type('Season', '2');
    type('First episode number', '5');
    type('Episodes per file', '2');
    type('Frames kept in the black', '4');
    type(/Show name/, 'My Show');
    type(/Episode titles/, 'One\nTwo');
    fireEvent.click(screen.getByRole('button', { name: /Find the breaks/ }));

    await screen.findByText('S02E05 - One', { exact: false });
    expect(posts('/api/split/preview')[0].body).toEqual({
      path: 'Shows',
      episodesPerFile: 2,
      frameOffset: 4,
      season: 2,
      startEpisode: 5,
      show: 'My Show',
      titles: 'One\nTwo',
    });
    expect(screen.getByText(/5:00 long/)).toBeInTheDocument();
    expect(screen.getByText(/0:00 – 2:28/)).toBeInTheDocument();
    expect(screen.getByText(/2:31 – 5:00/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Split 1 file' }));
    await screen.findByText(/Queued/);
    expect(posts('/api/split/run')[0].body).toEqual({
      files: [
        {
          path: 'Shows/a.mkv',
          episodes: [
            episode('S02E05 - One', 0, 148.2),
            episode('S02E06 - Two', 150.8, 300),
          ],
        },
      ],
      mode: 'reencode',
      outputDir: '',
      overwrite: false,
    });
  });

  test('a season of 0 is sent as 0', async () => {
    routes['/api/split/preview'] = () => ({ files: [goodFile('a.mkv')] });
    show();
    type('Path', 'a.mkv');
    type('Season', '0');
    type('First episode number', '0');
    fireEvent.click(screen.getByRole('button', { name: /Find the breaks/ }));
    await screen.findByText(/5:00 long/);
    expect(posts('/api/split/preview')[0].body).toMatchObject({
      season: 0,
      startEpisode: 0,
    });
  });

  test('copy mode, output folder and replacing are sent', async () => {
    routes['/api/split/preview'] = () => ({ files: [goodFile('a.mkv')] });
    routes['/api/split/run'] = () => ({ queued: 1 });
    show();
    type('Path', 'a.mkv');
    fireEvent.click(screen.getByRole('button', { name: /Find the breaks/ }));
    await screen.findByText(/5:00 long/);
    fireEvent.change(screen.getByLabelText('How to cut'), {
      target: { value: 'copy' },
    });
    type(/Output folder/, 'Out/Here');
    fireEvent.click(screen.getByLabelText(/Replace files that already exist/));
    fireEvent.click(screen.getByRole('button', { name: 'Split 1 file' }));
    await screen.findByText(/Queued/);
    expect(posts('/api/split/run')[0].body).toMatchObject({
      mode: 'copy',
      outputDir: 'Out/Here',
      overwrite: true,
    });
  });

  test('a file with no clear break shows why and is left out of the run', async () => {
    routes['/api/split/preview'] = () => ({
      files: [
        goodFile('d/a.mkv'),
        badFile('d/b.mkv'),
        goodFile('d/c.mkv', ['S01E05', 'S01E06']),
      ],
    });
    routes['/api/split/run'] = () => ({ queued: 2 });
    show();
    type('Path', 'd');
    fireEvent.click(screen.getByRole('button', { name: /Find the breaks/ }));
    await screen.findByText(/left alone/);
    fireEvent.click(screen.getByRole('button', { name: 'Split 2 files' }));
    await screen.findByText(/Queued/);
    expect(
      posts('/api/split/run')[0].body.files.map((f: any) => f.path),
    ).toEqual(['d/a.mkv', 'd/c.mkv']);
  });

  test('if no file can be split, Split stays disabled', async () => {
    routes['/api/split/preview'] = () => ({ files: [badFile('d/b.mkv')] });
    show();
    type('Path', 'd');
    fireEvent.click(screen.getByRole('button', { name: /Find the breaks/ }));
    await screen.findByText(/left alone/);
    expect(screen.getByRole('button', { name: /^Split/ })).toBeDisabled();
  });

  test('shows the server error from finding breaks and from running', async () => {
    routes['/api/split/preview'] = () =>
      new Response(JSON.stringify({ error: 'No video files there' }), {
        status: 400,
      });
    show();
    type('Path', 'empty');
    fireEvent.click(screen.getByRole('button', { name: /Find the breaks/ }));
    expect(await screen.findByText('No video files there')).toBeInTheDocument();

    routes['/api/split/preview'] = () => ({ files: [goodFile('a.mkv')] });
    routes['/api/split/run'] = () =>
      new Response(JSON.stringify({ error: 'a.mkv already exists' }), {
        status: 400,
      });
    fireEvent.click(screen.getByRole('button', { name: /Find the breaks/ }));
    await screen.findByText(/5:00 long/);
    fireEvent.click(screen.getByRole('button', { name: 'Split 1 file' }));
    expect(await screen.findByText('a.mkv already exists')).toBeInTheDocument();
    expect(screen.queryByText(/Queued/)).toBeNull();
  });

  test('the button says it is working while the breaks are being found', async () => {
    let release: (value: unknown) => void = () => {};
    const gate = new Promise((resolve) => (release = resolve));
    routes['/api/split/preview'] = () =>
      gate.then(() => ({ files: [] })) as any;
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      if (String(input) === '/api/split/preview') {
        await gate;
        return new Response(JSON.stringify({ files: [goodFile('a.mkv')] }));
      }
      return original(input, init);
    }) as unknown as typeof fetch;
    show();
    type('Path', 'a.mkv');
    fireEvent.click(screen.getByRole('button', { name: /Find the breaks/ }));
    const busy = await screen.findByRole('button', {
      name: /Looking for the breaks/,
    });
    expect(busy).toBeDisabled();
    release(null);
    await screen.findByText(/5:00 long/);
  });
});

const trackFile = (
  p: string,
  action: TrackPreviewFile['plan']['action'],
): TrackPreviewFile => ({
  path: p,
  streams: [
    { index: 0, type: 'video', codec: 'h264' },
    { index: 1, type: 'audio', codec: 'aac', language: 'eng' },
    { index: 2, type: 'audio', codec: 'aac', language: 'jpn' },
    {
      index: 3,
      type: 'subtitle',
      codec: 'subrip',
      language: 'eng',
      title: 'Full',
    },
  ],
  plan: {
    action,
    reason: action === 'clean' ? 'Remove 1 track' : 'Nothing to remove',
    removeAudio: action === 'clean' ? [2] : [],
    removeSubtitles: [],
  },
});

function openTracks() {
  fireEvent.click(screen.getByRole('tab', { name: 'Remove extra tracks' }));
}

describe('keeping what was typed', () => {
  test("going to the other tab and back keeps both tabs' fields", () => {
    show();
    type('Path', 'Shows/One');
    type('Season', '4');
    openTracks();
    type('Path', 'Movies/Two');
    fireEvent.click(screen.getByRole('tab', { name: 'Separate episodes' }));
    expect(scope().getByLabelText('Path')).toHaveValue('Shows/One');
    expect(scope().getByLabelText('Season')).toHaveValue(4);
    openTracks();
    expect(scope().getByLabelText('Path')).toHaveValue('Movies/Two');
  });

  test('a new search clears the old "Queued" message', async () => {
    routes['/api/split/preview'] = () => ({ files: [goodFile('a.mkv')] });
    routes['/api/split/run'] = () => ({ queued: 1 });
    show();
    type('Path', 'a.mkv');
    fireEvent.click(screen.getByRole('button', { name: /Find the breaks/ }));
    await screen.findByText(/5:00 long/);
    fireEvent.click(screen.getByRole('button', { name: 'Split 1 file' }));
    await screen.findByText(/Queued/);
    fireEvent.click(screen.getByRole('button', { name: /Find the breaks/ }));
    await waitFor(() => expect(screen.queryByText(/Queued/)).toBeNull());
  });
});

describe('Remove extra tracks tab: old messages', () => {
  test('a new check clears the old "Queued" message', async () => {
    routes['/api/split/tracks/preview'] = () => ({
      files: [trackFile('a.mkv', 'clean')],
    });
    routes['/api/split/tracks/run'] = () => ({ queued: 1 });
    show();
    openTracks();
    type('Path', 'a.mkv');
    fireEvent.click(screen.getByRole('button', { name: /Check the tracks/ }));
    await screen.findByText('a.mkv');
    fireEvent.click(screen.getByRole('button', { name: 'Clean 1 file' }));
    await screen.findByText(/Queued/);
    fireEvent.click(screen.getByRole('button', { name: /Check the tracks/ }));
    await waitFor(() => expect(screen.queryByText(/Queued/)).toBeNull());
  });
});

describe('Remove extra tracks tab', () => {
  test('switching tabs shows each tab and marks the selected one', () => {
    show();
    expect(
      screen.getByRole('tab', { name: 'Separate episodes' }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByRole('button', { name: /Find the breaks/ }),
    ).toBeInTheDocument();
    openTracks();
    expect(
      screen.getByRole('tab', { name: 'Remove extra tracks' }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByRole('tab', { name: 'Separate episodes' }),
    ).toHaveAttribute('aria-selected', 'false');
    expect(
      screen.queryByRole('button', { name: /Find the breaks/ }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: /Check the tracks/ }),
    ).toBeDisabled();
  });

  test('sends the languages and options, strikes out the tracks that go, cleans only those files', async () => {
    routes['/api/split/tracks/preview'] = () => ({
      files: [
        trackFile('d/a.mkv', 'clean'),
        trackFile('d/b.mkv', 'already-clean'),
        trackFile('d/c.mkv', 'clean'),
      ],
    });
    routes['/api/split/tracks/run'] = () => ({ queued: 2 });
    show();
    openTracks();
    type('Path', 'd');
    type(/Languages to keep/, 'eng, jpn');
    fireEvent.click(screen.getByLabelText('Filter subtitle tracks'));
    fireEvent.click(screen.getByLabelText(/Keep tracks with no language tag/));
    fireEvent.click(screen.getByRole('button', { name: /Check the tracks/ }));
    await screen.findByText('d/a.mkv');
    expect(posts('/api/split/tracks/preview')[0].body).toEqual({
      path: 'd',
      languages: 'eng, jpn',
      filterAudio: true,
      filterSubtitles: false,
      keepUntagged: true,
    });

    // The Japanese track (#2) is struck out in the file that will change; the others are not.
    const first = screen.getByText('d/a.mkv').closest('li')!;
    expect(within(first).getByText(/audio #2 · jpn/)).toHaveClass(
      'line-through',
    );
    expect(within(first).getByText(/audio #1 · eng/)).not.toHaveClass(
      'line-through',
    );
    expect(
      within(first).getByText(/subtitle #3 · eng · subrip · Full/),
    ).not.toHaveClass('line-through');
    const second = screen.getByText('d/b.mkv').closest('li')!;
    expect(
      within(second).queryByText(/jpn/, { selector: '.line-through' }),
    ).toBeNull();
    expect(within(second).getByText('Nothing to remove')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clean 2 files' }));
    await screen.findByText(/Queued/);
    expect(posts('/api/split/tracks/run')[0].body).toEqual({
      paths: ['d/a.mkv', 'd/c.mkv'],
      languages: 'eng, jpn',
      filterAudio: true,
      filterSubtitles: false,
      keepUntagged: true,
      replace: false,
    });
  });

  test('replacing the original is off until chosen, then sent', async () => {
    routes['/api/split/tracks/preview'] = () => ({
      files: [trackFile('a.mkv', 'clean')],
    });
    routes['/api/split/tracks/run'] = () => ({ queued: 1 });
    show();
    openTracks();
    const box = screen.getByLabelText(/Replace the original file/);
    expect(box).not.toBeChecked();
    type('Path', 'a.mkv');
    fireEvent.click(screen.getByRole('button', { name: /Check the tracks/ }));
    await screen.findByText('a.mkv');
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'Clean 1 file' }));
    await screen.findByText(/Queued/);
    expect(posts('/api/split/tracks/run')[0].body.replace).toBe(true);
  });

  test('a skipped file shows nothing struck out, since it will not be changed', async () => {
    routes['/api/split/tracks/preview'] = () => ({
      files: [
        {
          ...trackFile('j.mp4', 'skip-no-audio'),
          plan: {
            action: 'skip-no-audio',
            reason: 'No audio in the languages to keep',
            removeAudio: [1, 2],
            removeSubtitles: [3],
          },
        },
      ],
    });
    show();
    openTracks();
    type('Path', 'j.mp4');
    fireEvent.click(screen.getByRole('button', { name: /Check the tracks/ }));
    await screen.findByText('No audio in the languages to keep');
    const item = screen.getByText('j.mp4').closest('li')!;
    expect(item.querySelectorAll('.line-through')).toHaveLength(0);
  });

  test('when nothing needs cleaning, Clean is disabled', async () => {
    routes['/api/split/tracks/preview'] = () => ({
      files: [
        trackFile('a.mkv', 'already-clean'),
        trackFile('b.mkv', 'skip-no-audio'),
      ],
    });
    show();
    openTracks();
    type('Path', 'd');
    fireEvent.click(screen.getByRole('button', { name: /Check the tracks/ }));
    await screen.findByText('a.mkv');
    expect(screen.getByRole('button', { name: /^Clean/ })).toBeDisabled();
  });

  test('shows the server error', async () => {
    routes['/api/split/tracks/preview'] = () =>
      new Response(
        JSON.stringify({ error: 'That path is outside the home folder' }),
        { status: 400 },
      );
    show();
    openTracks();
    type('Path', '../x');
    fireEvent.click(screen.getByRole('button', { name: /Check the tracks/ }));
    expect(
      await screen.findByText('That path is outside the home folder'),
    ).toBeInTheDocument();
  });
});

const task = (over: Partial<SplitTask>): SplitTask => ({
  id: 't1',
  kind: 'split',
  label: 'a.mkv',
  status: 'queued',
  progress: 0,
  message: 'Waiting',
  createdAt: 1,
  ...over,
});

describe('Progress list', () => {
  test('shows nothing when there are no tasks', async () => {
    show();
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/split/tasks')).toBe(true),
    );
    expect(screen.queryByText('Progress')).toBeNull();
  });

  test('shows each task with its status, message and a progress bar while running', async () => {
    routes['/api/split/tasks'] = () => ({
      tasks: [
        task({
          id: 'a',
          label: 'first.mkv',
          status: 'done',
          progress: 1,
          message: 'Wrote 2 episodes',
        }),
        task({
          id: 'b',
          label: 'second.mkv',
          status: 'running',
          progress: 0.4,
          message: 'Episode 1 of 2',
        }),
        task({
          id: 'c',
          kind: 'tracks',
          label: 'third.mkv',
          status: 'skipped',
          message: 'Skipped: No audio in the languages to keep',
        }),
        task({
          id: 'd',
          label: 'fourth.mkv',
          status: 'failed',
          message: 'ffmpeg failed: boom',
        }),
      ],
    });
    show();
    await screen.findByText('Split: second.mkv');
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByText('Tracks: third.mkv')).toBeInTheDocument();
    expect(
      screen.getByText('Skipped: No audio in the languages to keep'),
    ).toBeInTheDocument();
    expect(screen.getByText('ffmpeg failed: boom')).toBeInTheDocument();
    expect(screen.getByText('Wrote 2 episodes')).toBeInTheDocument();
    // Newest at the top: the list is shown last-first.
    const order = screen
      .getAllByText(/^(Split|Tracks): /)
      .map((e) => e.textContent);
    expect(order).toEqual([
      'Split: fourth.mkv',
      'Tracks: third.mkv',
      'Split: second.mkv',
      'Split: first.mkv',
    ]);
    // Only the running one has a progress bar; only unfinished ones can be cancelled.
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1);
  });

  test('Cancel asks the server to cancel that task', async () => {
    routes['/api/split/tasks'] = () => ({
      tasks: [
        task({ id: 'q1', status: 'queued' }),
        task({ id: 'r1', label: 'b.mkv', status: 'running', progress: 0.1 }),
      ],
    });
    routes['/api/split/cancel'] = () => ({ cancelled: true });
    show();
    const buttons = await screen.findAllByRole('button', { name: 'Cancel' });
    expect(buttons).toHaveLength(2);
    // Newest first, so the second task in the data is the first row.
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(posts('/api/split/cancel')).toHaveLength(1));
    expect(posts('/api/split/cancel')[0].body).toEqual({ id: 'r1' });
  });

  test('Clear finished appears only when something is finished and asks to clear', async () => {
    routes['/api/split/tasks'] = () => ({
      tasks: [task({ status: 'running', progress: 0.5 })],
    });
    show();
    await screen.findByText('Split: a.mkv');
    expect(screen.queryByText('Clear finished')).toBeNull();
    cleanup();

    routes['/api/split/tasks'] = () => ({
      tasks: [task({ status: 'done', progress: 1 })],
    });
    routes['/api/split/clear'] = () => ({ cleared: 1 });
    show();
    fireEvent.click(await screen.findByText('Clear finished'));
    await waitFor(() => expect(posts('/api/split/clear')).toHaveLength(1));
  });

  test('refreshes by itself while open', async () => {
    let n = 0;
    routes['/api/split/tasks'] = () => ({
      tasks: [task({ message: `poll ${++n}` })],
    });
    show();
    await screen.findByText('poll 1');
    await screen.findByText(/poll [2-9]/, {}, { timeout: 4000 });
  });
});

describe('PathPicker', () => {
  function Harness({ start = '' }: { start?: string }) {
    const { useState } = require('react') as typeof import('react');
    const [value, setValue] = useState(start);
    return (
      <>
        <PathPicker value={value} onChange={setValue} />
        <output data-testid="value">{value}</output>
      </>
    );
  }
  const listing = (items: Array<[string, boolean]>, base = '') => ({
    items: items.map(([name, isDirectory]) => ({
      name,
      path: base ? `${base}/${name}` : name,
      isDirectory,
    })),
  });
  beforeEach(() => {
    routes['/api/files'] = (_b, url) => {
      const p = new URL(url, 'http://x').searchParams.get('path') ?? '';
      if (p === '')
        return listing([
          ['Shows', true],
          ['readme.txt', false],
        ]);
      if (p === 'Shows')
        return listing(
          [
            ['Mr. Show', true],
            ['ep.mkv', false],
          ],
          'Shows',
        );
      if (p === 'Shows/Mr. Show')
        return listing([['one.mkv', false]], 'Shows/Mr. Show');
      return new Response('{}', { status: 500 });
    };
  });
  const value = () => screen.getByTestId('value').textContent;
  const browse = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }));

  test('browses into folders, goes up, and uses a folder', async () => {
    show(<Harness />);
    browse();
    fireEvent.click(await screen.findByRole('button', { name: /Shows/ }));
    await screen.findByRole('button', { name: /Mr\. Show/ });
    expect(screen.getByText('/Shows')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Mr\. Show/ }));
    await screen.findByRole('button', { name: /one\.mkv/ });
    fireEvent.click(screen.getByRole('button', { name: /Up/ }));
    await screen.findByRole('button', { name: /Mr\. Show/ });
    expect(screen.getByText('/Shows')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use this folder' }));
    expect(value()).toBe('Shows');
    // Choosing closes the browser.
    expect(
      screen.queryByRole('button', { name: 'Use this folder' }),
    ).toBeNull();
  });

  test('Up is disabled at the top', async () => {
    show(<Harness />);
    browse();
    await screen.findByRole('button', { name: /Shows/ });
    expect(screen.getByRole('button', { name: /Up/ })).toBeDisabled();
  });

  test('lists only folders and video files', async () => {
    show(<Harness />);
    browse();
    await screen.findByRole('button', { name: /Shows/ });
    expect(screen.queryByRole('button', { name: /readme\.txt/ })).toBeNull();
  });

  test('clicking a file chooses it', async () => {
    show(<Harness />);
    browse();
    fireEvent.click(await screen.findByRole('button', { name: /Shows/ }));
    fireEvent.click(await screen.findByRole('button', { name: /ep\.mkv/ }));
    expect(value()).toBe('Shows/ep.mkv');
    expect(
      screen.queryByRole('button', { name: 'Use this folder' }),
    ).toBeNull();
  });

  test('opens at the typed folder, even when its name has a dot', async () => {
    show(<Harness start="Shows/Mr. Show" />);
    browse();
    await screen.findByRole('button', { name: /one\.mkv/ });
    expect(screen.getByText('/Shows/Mr. Show')).toBeInTheDocument();
  });

  test('opens at the folder of a typed video file', async () => {
    show(<Harness start="Shows/ep.mkv" />);
    browse();
    await screen.findByRole('button', { name: /Mr\. Show/ });
    expect(screen.getByText('/Shows')).toBeInTheDocument();
  });

  test('says so when a folder cannot be read, and Close hides the browser', async () => {
    show(<Harness start="Gone" />);
    browse();
    expect(
      await screen.findByText('Could not read this folder'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Could not read this folder')).toBeNull();
  });

  test('typing in the box changes the value', () => {
    show(<Harness />);
    type('Path', 'Some/Where');
    expect(value()).toBe('Some/Where');
  });
});
