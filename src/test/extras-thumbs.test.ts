import { describe, expect, test } from 'bun:test';
import { ListenerUnavailable, thumbsOf } from '../../server/extras-eyes';

const reply = (body: unknown, status = 200) =>
  (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('asking the listener for small pictures', () => {
  test('sends what is wanted to /thumbs and decodes the pictures', async () => {
    let sent: { url: string; body: string } | null = null;
    const fetcher = (async (url: string, init?: RequestInit) => {
      sent = { url, body: String(init?.body) };
      return new Response(
        JSON.stringify({
          frames: [
            Buffer.from([1, 2, 3, 4]).toString('base64'),
            Buffer.from([5, 6, 7, 8]).toString('base64'),
          ],
        }),
      );
    }) as unknown as typeof fetch;
    const frames = await thumbsOf(
      '_converted/Duma (2005)/Other/Extra 01.mkv',
      12.5,
      2,
      2,
      2,
      fetcher,
      'http://eyes:3002/',
    );
    expect(sent!.url).toBe('http://eyes:3002/thumbs');
    expect(JSON.parse(sent!.body)).toEqual({
      path: '_converted/Duma (2005)/Other/Extra 01.mkv',
      start: 12.5,
      count: 2,
      width: 2,
      height: 2,
    });
    expect(frames.map((f) => [...f])).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);
  });

  test('not set up and unreachable are the listener being unavailable', async () => {
    await expect(
      thumbsOf('a.mkv', 0, 1, 2, 2, reply({ frames: [] }), undefined),
    ).rejects.toThrow(ListenerUnavailable);
    const down = (async () => {
      throw new Error('refused');
    }) as unknown as typeof fetch;
    await expect(
      thumbsOf('a.mkv', 0, 1, 2, 2, down, 'http://x'),
    ).rejects.toThrow(ListenerUnavailable);
  });

  test('a refusal says why, and an answer with no pictures list is an error', async () => {
    await expect(
      thumbsOf(
        'a.mkv',
        0,
        1,
        2,
        2,
        reply({ error: 'That is outside the library' }, 400),
        'http://x',
      ),
    ).rejects.toThrow('outside the library');
    await expect(
      thumbsOf('a.mkv', 0, 1, 2, 2, reply({}), 'http://x'),
    ).rejects.toThrow('could not make pictures');
  });
});
