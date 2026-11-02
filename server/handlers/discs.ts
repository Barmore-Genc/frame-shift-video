/**
 * Handlers for the Discs page: the DVD ripper that runs on the server host.
 * See ../disc-state.ts for how the page and the ripper trade files.
 */

import {
  commandResult,
  discsDir,
  dismissAttention,
  readDiscsState,
  sendCommand,
  setEject,
  setAutoScan,
  setMovieOnly,
  setPreset,
  savePreset,
  deletePreset,
  setNext,
} from '../disc-state';
import {
  extraFilePath,
  readExtras,
  readRemoved,
  removeExtras,
  renameExtra,
  restoreExtras,
} from '../extras-state';
import { findDuplicates } from '../extras-duplicates';
import { frameJpeg, previewTimes, videoSeconds } from '../extras-preview';
import { fandomHint } from '../fandom-hints';
import { matchState, startMatch } from '../extras-match-job';
import { nameSources } from '../extras-sources';
import type { DiscCommand, DiscNext } from '../../src/types/discs';

function json(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

/** A body that is a JSON object, or null. */
async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Runs something that throws on a bad value, and answers 400 with the reason. */
async function asBadRequest(
  corsHeaders: Record<string, string>,
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      400,
      corsHeaders,
    );
  }
}

/**
 * GET /api/discs
 * Everything the Discs page shows.
 */
export async function discsStateHandler(
  _req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  return json(await readDiscsState(), 200, corsHeaders);
}

/**
 * PUT /api/discs/eject
 * Body: { enabled: boolean }. Whether the ripper ejects a disc when it is done.
 */
export async function discsEjectHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body || typeof body.enabled !== 'boolean') {
    return json({ error: 'enabled must be true or false' }, 400, corsHeaders);
  }
  await setEject(discsDir(), body.enabled);
  return json({ eject: body.enabled }, 200, corsHeaders);
}

/**
 * PUT /api/discs/auto-scan
 * Body: { enabled: boolean }. Whether a disc that goes in is scanned and ripped by itself.
 */
export async function discsAutoScanHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body || typeof body.enabled !== 'boolean') {
    return json({ error: 'enabled must be true or false' }, 400, corsHeaders);
  }
  await setAutoScan(discsDir(), body.enabled);
  return json({ autoScan: body.enabled }, 200, corsHeaders);
}

/**
 * PUT /api/discs/movie-only
 * Body: { enabled: boolean }. Whether only the movie is made from a disc, without its extras.
 */
export async function discsMovieOnlyHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body || typeof body.enabled !== 'boolean') {
    return json({ error: 'enabled must be true or false' }, 400, corsHeaders);
  }
  await setMovieOnly(discsDir(), body.enabled);
  return json({ movieOnly: body.enabled }, 200, corsHeaders);
}

/**
 * PUT /api/discs/preset
 * Body: { id: string }. How discs queued from now on are converted: one of the presets the
 * ripper lists in its settings file.
 */
export async function discsPresetHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body || typeof body.id !== 'string') {
    return json({ error: 'id must be the name of a choice' }, 400, corsHeaders);
  }
  const id = body.id;
  return asBadRequest(corsHeaders, async () => {
    await setPreset(discsDir(), id);
    return json({ chosen: id }, 200, corsHeaders);
  });
}

/**
 * POST /api/discs/presets, DELETE /api/discs/presets
 * POST: a preset of the person's own (name, container, video, quality, speed, tenBit, audio,
 * deinterlace, subtitles), changing the one with the same id when there is an id.
 * DELETE: body { id }, a preset the person made.
 */
export async function discsPresetsHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body) {
    return json({ error: 'Send the details of the preset' }, 400, corsHeaders);
  }
  if (req.method === 'DELETE') {
    const id = body.id;
    if (typeof id !== 'string') {
      return json(
        { error: 'id must be the name of a preset' },
        400,
        corsHeaders,
      );
    }
    return asBadRequest(corsHeaders, async () => {
      await deletePreset(discsDir(), id);
      return json({ deleted: id }, 200, corsHeaders);
    });
  }
  return asBadRequest(corsHeaders, async () => {
    const preset = await savePreset(discsDir(), body);
    return json({ preset }, 200, corsHeaders);
  });
}

/**
 * PUT /api/discs/next, DELETE /api/discs/next
 * A note for the next disc that goes in, or taking it back.
 */
export async function discsNextHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  if (req.method === 'DELETE') {
    await setNext(discsDir(), null);
    return json({ next: null }, 200, corsHeaders);
  }
  const body = await readBody(req);
  if (!body) return json({ error: 'A JSON body is needed' }, 400, corsHeaders);
  return asBadRequest(corsHeaders, async () => {
    await setNext(discsDir(), body as unknown as DiscNext);
    return json({ ok: true }, 200, corsHeaders);
  });
}

/**
 * DELETE /api/discs/attention
 * Body: { file: string }. Removes a note the ripper left.
 */
export async function discsAttentionHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body || typeof body.file !== 'string') {
    return json({ error: 'file is needed' }, 400, corsHeaders);
  }
  const file = body.file;
  return asBadRequest(corsHeaders, async () => {
    await dismissAttention(discsDir(), file);
    return json({ ok: true }, 200, corsHeaders);
  });
}

/**
 * POST /api/discs/commands
 * Body: a DiscCommand. Hands it to the host and answers with the id to ask about.
 */
export async function discsCommandsHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body) return json({ error: 'A JSON body is needed' }, 400, corsHeaders);
  return asBadRequest(corsHeaders, async () => {
    const id = await sendCommand(discsDir(), body as unknown as DiscCommand);
    return json({ id }, 202, corsHeaders);
  });
}

/**
 * GET /api/discs/commands/:id
 * The host's answer to a request, once it has one.
 */
export async function discsCommandResultHandler(
  _req: Request,
  id: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  return asBadRequest(corsHeaders, async () =>
    json(await commandResult(discsDir(), id), 200, corsHeaders),
  );
}

/**
 * GET /api/discs/extras
 * The extras of ripped movies, for naming them.
 */
export async function discsExtrasHandler(
  _req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  return json({ movies: await readExtras(discsDir()) }, 200, corsHeaders);
}

/**
 * GET /api/discs/extras/hint?movie=Name (Year)
 * What DVD Fandom lists as the bonus features of that movie's disc, to read while naming its extras.
 */
export async function discsExtrasHintHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const movie = new URL(req.url).searchParams.get('movie');
  if (!movie) return json({ error: 'movie is needed' }, 400, corsHeaders);
  return json({ hint: await fandomHint(movie) }, 200, corsHeaders);
}

const VIDEO_TYPES: Record<string, string> = {
  '.mkv': 'video/x-matroska',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
};

/** The byte range a Range header asks for, or null for the whole file; 'bad' if it cannot be met. */
export function byteRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null | 'bad' {
  if (!header) return null;
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (match[1] === '' && match[2] === '')) return 'bad';
  let start: number;
  let end: number;
  if (match[1] === '') {
    // The last N bytes.
    const last = Number(match[2]);
    if (last === 0) return 'bad';
    start = Math.max(size - last, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start >= size || start > end) return 'bad';
  return { start, end };
}

/**
 * GET /api/discs/extras/file?path=...[&download=1]
 * The video of an extra, so a person can watch it to tell what it is. It can be played from any
 * point (a Range request). Only the files "Name the extras" lists can be asked for.
 */
export async function discsExtrasFileHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const url = new URL(req.url);
  const file = url.searchParams.get('path');
  if (!file) return json({ error: 'path is needed' }, 400, corsHeaders);
  let real: string;
  try {
    real = await extraFilePath(discsDir(), file);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      404,
      corsHeaders,
    );
  }
  const video = Bun.file(real);
  const size = video.size;
  const name = real.split('/').pop() ?? 'extra';
  const headers: Record<string, string> = {
    ...corsHeaders,
    'Content-Type':
      VIDEO_TYPES[name.slice(name.lastIndexOf('.')).toLowerCase()] ??
      'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `${
      url.searchParams.get('download') ? 'attachment' : 'inline'
    }; filename*=UTF-8''${encodeURIComponent(name)}`,
  };
  const range = byteRange(req.headers.get('range'), size);
  if (range === 'bad') {
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${size}` },
    });
  }
  if (range) {
    return new Response(video.slice(range.start, range.end + 1).stream(), {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        'Content-Length': String(range.end - range.start + 1),
      },
    });
  }
  return new Response(video.stream(), {
    headers: { ...headers, 'Content-Length': String(size) },
  });
}

/**
 * GET /api/discs/extras/preview?path=...
 * An extra's length and the moments a strip of pictures should show, to tell what it is without
 * playing it. Each picture is fetched from /api/discs/extras/frame.
 */
export async function discsExtrasPreviewHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const file = new URL(req.url).searchParams.get('path');
  if (!file) return json({ error: 'path is needed' }, 400, corsHeaders);
  try {
    const real = await extraFilePath(discsDir(), file);
    const seconds = await videoSeconds(real);
    return json({ seconds, times: previewTimes(seconds) }, 200, corsHeaders);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      404,
      corsHeaders,
    );
  }
}

/**
 * GET /api/discs/extras/frame?path=...&t=SECONDS
 * One picture from an extra, as a small JPEG.
 */
export async function discsExtrasFrameHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const file = params.get('path');
  const at = Number(params.get('t'));
  if (!file || params.get('t') === null || !Number.isFinite(at) || at < 0) {
    return json({ error: 'path and t are needed' }, 400, corsHeaders);
  }
  try {
    const real = await extraFilePath(discsDir(), file);
    const picture = await frameJpeg(real, at);
    if (picture.length === 0) throw new Error('There is no picture there');
    return new Response(new Uint8Array(picture), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      404,
      corsHeaders,
    );
  }
}

/**
 * GET /api/discs/extras/sources?movie=Name (Year)
 * What every database lists as the bonus features of that movie's disc, with the lengths they give:
 * DVD Compare and TheDiscDB (Region 1) and DVD Fandom.
 */
export async function discsExtrasSourcesHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const movie = new URL(req.url).searchParams.get('movie');
  if (!movie || movie.length > 150) {
    return json({ error: 'movie is needed' }, 400, corsHeaders);
  }
  return json({ sources: await nameSources(movie) }, 200, corsHeaders);
}

/**
 * GET /api/discs/extras/duplicates?movie=Name (Year)
 * Groups of that movie's extras that are the same video (same length and same pictures).
 */
export async function discsExtrasDuplicatesHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const movie = new URL(req.url).searchParams.get('movie');
  if (!movie || movie.length > 150) {
    return json({ error: 'movie is needed' }, 400, corsHeaders);
  }
  return asBadRequest(corsHeaders, async () =>
    json({ groups: await findDuplicates(discsDir(), movie) }, 200, corsHeaders),
  );
}

/**
 * POST /api/discs/extras/remove
 * Body: { paths: string[] }. Moves extras out of the movie into the _removed folder (nothing is
 * deleted). Answers which were moved and which could not be, and why.
 */
export async function discsExtrasRemoveHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body) return json({ error: 'paths are needed' }, 400, corsHeaders);
  return asBadRequest(corsHeaders, async () =>
    json(await removeExtras(discsDir(), body.paths), 200, corsHeaders),
  );
}

/**
 * GET /api/discs/extras/removed
 * The extras that were taken out of movies, so they can be seen and put back.
 */
export async function discsExtrasRemovedHandler(
  _req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  return json({ extras: await readRemoved(discsDir()) }, 200, corsHeaders);
}

/**
 * POST /api/discs/extras/restore
 * Body: { paths: string[] }. Puts removed extras back in their movie. Answers which were put back
 * and which could not be, and why.
 */
export async function discsExtrasRestoreHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body) return json({ error: 'paths are needed' }, 400, corsHeaders);
  return asBadRequest(corsHeaders, async () =>
    json(await restoreExtras(discsDir(), body.paths), 200, corsHeaders),
  );
}

/**
 * POST /api/discs/extras/match
 * Body: { movie: string }. Starts listening to the movie's unnamed extras and matching what is
 * heard with DVD Fandom's names (slow: the page polls GET for the answers as they come).
 */
export async function discsExtrasMatchStartHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body || typeof body.movie !== 'string' || !body.movie) {
    return json({ error: 'movie is needed' }, 400, corsHeaders);
  }
  const movie = body.movie;
  return asBadRequest(corsHeaders, async () => {
    const { state } = await startMatch(discsDir(), movie);
    return json({ match: state }, 200, corsHeaders);
  });
}

/**
 * GET /api/discs/extras/match?movie=Name (Year)
 * How the matching of that movie's extras is going, with the answers so far; null if not started.
 */
export async function discsExtrasMatchHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const movie = new URL(req.url).searchParams.get('movie');
  if (!movie) return json({ error: 'movie is needed' }, 400, corsHeaders);
  return json({ match: matchState(movie) }, 200, corsHeaders);
}

/**
 * POST /api/discs/extras/rename
 * Body: { path: string, name: string, folder?: string }. Names an extra, and moves it to another
 * extras folder if asked.
 */
export async function discsExtrasRenameHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body || typeof body.path !== 'string') {
    return json({ error: 'path is needed' }, 400, corsHeaders);
  }
  const { path, name, folder } = body;
  return asBadRequest(corsHeaders, async () => {
    const now = await renameExtra(discsDir(), path, name, folder);
    return json({ path: now }, 200, corsHeaders);
  });
}
