import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SubtitlesSection } from '@/components/subtitles-section';
import type { SubtitlesState } from '@/types/subtitles';

const base: SubtitlesState = {
  available: true,
  auto: false,
  updated: 1,
  files: [],
  held: [],
  current: null,
  batch: null,
  recent: [],
};

let state: SubtitlesState;
const realFetch = globalThis.fetch;

beforeEach(() => {
  state = base;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(state), {
      status: 200,
    })) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SubtitlesSection />
    </QueryClientProvider>,
  );
}

const bar = () => screen.findByRole('progressbar');

describe('picture subtitles that could not be read', () => {
  const picture = {
    language: 'spa',
    codec: 'picture',
    name: '',
    default: false,
    forced: false,
  };
  const file = (path: string, unreadable: boolean) => ({
    path,
    tracks: [picture],
    pictures: unreadable ? 0 : 1,
    unreadable,
    needsClean: false,
    status: null,
  });

  test('the page says so, and there is nothing left to convert', async () => {
    state = {
      ...base,
      files: [file('Rebound (2005)/Rebound (2005).mkv', true)],
    };
    show();
    expect(
      (await screen.findByText(/could not be read.*Rebound \(2005\)/))
        .textContent,
    ).toContain('stay as pictures');
    expect(
      screen.getByRole('button', { name: 'Nothing left to convert' }) !== null,
    ).toBe(true);
    expect(
      screen.queryAllByRole('button', { name: /^Convert \d/ }),
    ).toHaveLength(0);
  });

  test('the full list says it on the file, instead of a tick', async () => {
    state = {
      ...base,
      files: [file('Rebound (2005)/Rebound (2005).mkv', true)],
    };
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Show all/ }));
    expect(
      (await screen.findByText(/Some picture subtitles could not be read, so/))
        .textContent,
    ).toContain('stay as pictures');
    expect(screen.queryAllByText('Text')).toHaveLength(0);
  });

  test('a movie that can still be converted is offered, next to one that cannot', async () => {
    state = {
      ...base,
      files: [
        file('Rebound (2005)/Rebound (2005).mkv', true),
        file('Duma (2005)/Duma (2005).mkv', false),
      ],
    };
    show();
    expect(
      (await screen.findByRole('button', { name: 'Convert 1 movie' })) !== null,
    ).toBe(true);
  });
});

describe('the progress of a run of subtitle requests', () => {
  test('a run of typo fixes says how far along it is, and the bar matches', async () => {
    state = { ...base, batch: { kind: 'recheck', total: 14, done: 3 } };
    show();
    const progress = await bar();
    expect(progress.getAttribute('aria-valuenow')).toBe('3');
    expect(progress.getAttribute('aria-valuemax')).toBe('14');
    expect(progress.getAttribute('aria-label')).toBe('Fixing typing mistakes');
    expect(
      (await screen.findByText(/3 of\s+14 movies done/)).textContent,
    ).toContain('Fixing typing mistakes');
    const fill = progress.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe('21%');
  });

  test('a run of picture conversions is named for what it does', async () => {
    state = { ...base, batch: { kind: 'convert', total: 2, done: 1 } };
    show();
    expect(
      (await screen.findByText(/1 of\s+2 movies done/)).textContent,
    ).toContain('Converting subtitles');
    expect(((await bar()).firstElementChild as HTMLElement).style.width).toBe(
      '50%',
    );
  });

  test('the file being converted is shown under the run', async () => {
    state = {
      ...base,
      batch: { kind: 'convert', total: 2, done: 0 },
      current: { path: 'A/A (2001).mkv', step: 'Reading', done: 1, total: 4 },
    };
    show();
    expect((await screen.findByText(/A \(2001\)\.mkv/)).textContent).toContain(
      'Converting',
    );
    expect(await screen.findAllByText(/Reading/)).toHaveLength(1);
  });

  test('nothing is shown when nothing is running', async () => {
    show();
    await screen.findByText(/Convert the subtitles of new discs/);
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
  });
});
