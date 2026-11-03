import {
  dismissSubtitles,
  readSubtitlesState,
  requestClean,
  requestClearOldCopies,
  requestDropPictures,
  requestDropTrack,
  requestRestore,
  requestSubtitles,
  setSubtitlesAuto,
} from '../subtitles-state';
import { discsDir } from '../disc-state';

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

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object'
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** GET /api/subtitles: the movie files, their subtitle tracks and what the converter is doing. */
export async function subtitlesStateHandler(
  _req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  return json(await readSubtitlesState(discsDir()), 200, corsHeaders);
}

/**
 * POST /api/subtitles/convert
 * Body: { path } for one file, or { all: true } for every file with picture subtitles.
 */
export async function subtitlesConvertHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body) return json({ error: 'Send JSON' }, 400, corsHeaders);
  try {
    const count = await requestSubtitles(
      discsDir(),
      body.all === true ? { all: true } : { path: body.path as string },
    );
    return json({ queued: count }, 200, corsHeaders);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Could not ask' },
      400,
      corsHeaders,
    );
  }
}

/** POST /api/subtitles/clean, body { path } or { all: true }: clean the text already in files. */
export async function subtitlesCleanHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body) return json({ error: 'Send JSON' }, 400, corsHeaders);
  try {
    const count = await requestClean(
      discsDir(),
      body.all === true ? { all: true } : { path: body.path as string },
    );
    return json({ queued: count }, 200, corsHeaders);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Could not ask' },
      400,
      corsHeaders,
    );
  }
}

/** POST /api/subtitles/remove-track, body { path, track }: take one subtitle track out of a file. */
export async function subtitlesRemoveTrackHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body) return json({ error: 'Send JSON' }, 400, corsHeaders);
  try {
    const path = await requestDropTrack(discsDir(), body.path, body.track);
    return json({ removing: path }, 200, corsHeaders);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Could not ask' },
      400,
      corsHeaders,
    );
  }
}

/**
 * POST /api/subtitles/remove-pictures, body { path } or { all: true }: take every picture subtitle
 * track out of a file, or out of every file whose pictures could not be read.
 */
export async function subtitlesRemovePicturesHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body) return json({ error: 'Send JSON' }, 400, corsHeaders);
  try {
    const count = await requestDropPictures(
      discsDir(),
      body.all === true ? { all: true } : { path: body.path },
    );
    return json({ queued: count }, 200, corsHeaders);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Could not ask' },
      400,
      corsHeaders,
    );
  }
}

/** POST /api/subtitles/restore, body { path }: put the old copy of a file back. */
export async function subtitlesRestoreHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body) return json({ error: 'Send JSON' }, 400, corsHeaders);
  try {
    const path = await requestRestore(discsDir(), body.path);
    return json({ restoring: path }, 200, corsHeaders);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Could not ask' },
      400,
      corsHeaders,
    );
  }
}

/** POST /api/subtitles/clear-old, body { confirm: true }: delete every old copy for good. */
export async function subtitlesClearOldHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body || body.confirm !== true) {
    return json({ error: 'Deleting needs confirm: true' }, 400, corsHeaders);
  }
  try {
    const count = await requestClearOldCopies(discsDir());
    return json({ deleting: count }, 200, corsHeaders);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Could not ask' },
      400,
      corsHeaders,
    );
  }
}

/**
 * POST /api/subtitles/dismiss
 * Body: { queued: path } | { queue: "all" } | { result: id } | { results: "all" }
 */
export async function subtitlesDismissHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body) return json({ error: 'Send JSON' }, 400, corsHeaders);
  try {
    const removed = await dismissSubtitles(discsDir(), body);
    return json({ removed }, 200, corsHeaders);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Could not remove' },
      400,
      corsHeaders,
    );
  }
}

/** PUT /api/subtitles/auto, body { enabled }: convert the subtitles of new discs by itself. */
export async function subtitlesAutoHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body || typeof body.enabled !== 'boolean') {
    return json({ error: 'enabled must be true or false' }, 400, corsHeaders);
  }
  await setSubtitlesAuto(discsDir(), body.enabled);
  return json({ auto: body.enabled }, 200, corsHeaders);
}
