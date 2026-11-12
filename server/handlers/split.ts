import {
  DEFAULT_TRACK_OPTIONS,
  episodeName,
  normalizeLanguage,
  parseLanguageList,
  parseTitles,
  resolveInHome,
  type TrackOptions,
} from '../split-tools';
import {
  cancelTask,
  clearFinished,
  listTasks,
  listVideos,
  previewSplit,
  previewTracks,
  queueSplit,
  queueTrackCleanup,
  type SplitJobInput,
} from '../split-runner';

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

/** A whole number from the body, or the fallback when it is missing or not a number. */
function whole(
  value: unknown,
  fallback: number,
  min: number,
  max = 1e6,
): number {
  const n = Number(value);
  if (
    value === undefined ||
    value === null ||
    value === '' ||
    !Number.isFinite(n)
  ) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function trackOptions(body: Record<string, unknown>): TrackOptions {
  // "languages" is the older single list, used for both kinds when the new ones are not sent.
  const list = (value: unknown, fallback: string[]) => {
    const parsed = parseLanguageList(String(value ?? ''));
    return parsed.length ? parsed : fallback;
  };
  const shared = list(body.languages, DEFAULT_TRACK_OPTIONS.audioLanguages);
  return {
    audioLanguages: list(body.audioLanguages, shared),
    subtitleLanguages: list(body.subtitleLanguages, shared),
    filterAudio: body.filterAudio !== false,
    filterSubtitles: body.filterSubtitles !== false,
    keepUntagged: body.keepUntagged === true,
    orderByLanguage: body.orderByLanguage === true,
    defaultAudio: normalizeLanguage(String(body.defaultAudio ?? '')),
    defaultSubtitle: normalizeLanguage(String(body.defaultSubtitle ?? '')),
  };
}

/** GET /api/split/tasks: everything queued, running and finished. */
export async function splitTasksHandler(
  _req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  return json({ tasks: listTasks() }, 200, corsHeaders);
}

/**
 * POST /api/split/preview
 * Body: { path, episodesPerFile, frameOffset, season, startEpisode, show?, titles? }
 * Finds the episode breaks in each video under `path` and names the pieces. Does not write files.
 */
export async function splitPreviewHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body || typeof body.path !== 'string') {
    return json({ error: 'Send JSON with a path' }, 400, corsHeaders);
  }
  try {
    const files = await listVideos(resolveInHome(body.path));
    if (files.length === 0) {
      return json({ error: 'No video files there' }, 400, corsHeaders);
    }
    const episodesPerFile = Math.min(
      Math.max(Number(body.episodesPerFile) || 2, 2),
      12,
    );
    const frameOffset = whole(body.frameOffset, 6, 0, 100);
    const naming = {
      show: typeof body.show === 'string' ? body.show : undefined,
      season: whole(body.season, 1, 0),
      startEpisode: whole(body.startEpisode, 1, 0),
      titles: parseTitles(String(body.titles ?? '')),
    };
    const results = [];
    let next = 0;
    for (const file of files) {
      const preview = await previewSplit(file, episodesPerFile, frameOffset);
      // A file left alone still uses up its episode numbers, so the files after it keep theirs.
      const first = next;
      next += episodesPerFile;
      const episodes = preview.plan.complete
        ? preview.plan.segments.map((segment, i) => ({
            name: episodeName(naming, first + i),
            start: segment.start,
            end: segment.end,
          }))
        : [];
      results.push({ ...preview, episodes });
    }
    return json({ files: results }, 200, corsHeaders);
  } catch (error) {
    return json({ error: message(error) }, 400, corsHeaders);
  }
}

/**
 * POST /api/split/run
 * Body: { files: SplitJobInput[], mode, outputDir?, overwrite? } with files taken from a preview.
 */
export async function splitRunHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body || !Array.isArray(body.files)) {
    return json({ error: 'Send JSON with files' }, 400, corsHeaders);
  }
  try {
    const queued = queueSplit(body.files as SplitJobInput[], {
      mode: body.mode === 'copy' ? 'copy' : 'reencode',
      outputDir:
        typeof body.outputDir === 'string' && body.outputDir
          ? body.outputDir
          : undefined,
      overwrite: body.overwrite === true,
    });
    return json({ queued }, 200, corsHeaders);
  } catch (error) {
    return json({ error: message(error) }, 400, corsHeaders);
  }
}

/**
 * POST /api/split/tracks/preview
 * Body: { path, languages?, filterAudio?, filterSubtitles?, keepUntagged? }
 */
export async function tracksPreviewHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body || typeof body.path !== 'string') {
    return json({ error: 'Send JSON with a path' }, 400, corsHeaders);
  }
  try {
    const options = trackOptions(body);
    const files = await listVideos(resolveInHome(body.path));
    const results = [];
    for (const file of files) results.push(await previewTracks(file, options));
    return json({ files: results }, 200, corsHeaders);
  } catch (error) {
    return json({ error: message(error) }, 400, corsHeaders);
  }
}

/**
 * POST /api/split/tracks/run
 * Body: { paths: string[], languages?, filterAudio?, filterSubtitles?, keepUntagged?, replace? }
 */
export async function tracksRunHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body || !Array.isArray(body.paths)) {
    return json({ error: 'Send JSON with paths' }, 400, corsHeaders);
  }
  try {
    const queued = queueTrackCleanup(body.paths.map(String), {
      ...trackOptions(body),
      replace: body.replace === true,
    });
    return json({ queued }, 200, corsHeaders);
  } catch (error) {
    return json({ error: message(error) }, 400, corsHeaders);
  }
}

/** POST /api/split/cancel { id } */
export async function splitCancelHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  const ok = typeof body?.id === 'string' && cancelTask(body.id);
  return json({ cancelled: ok }, ok ? 200 : 404, corsHeaders);
}

/** POST /api/split/clear: forget finished tasks. */
export async function splitClearHandler(
  _req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  return json({ cleared: clearFinished() }, 200, corsHeaders);
}
