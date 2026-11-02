import { filesHandler } from './handlers/files';
import {
  jobsHandler,
  jobByIdHandler,
  startJobsHandler,
  getJobBatchHandler,
} from './handlers/jobs';
import {
  fileSelectionsHandler,
  fileSelectionByKeyHandler,
} from './handlers/file-selections';
import {
  getPickerStateHandler,
  pickerActionHandler,
} from './handlers/file-picker';
import {
  testNotificationHandler,
  notificationStatusHandler,
} from './handlers/notifications';
import {
  executeJobHandler,
  receiveProgressHandler,
  getWorkerStatusHandler,
  cancelJobOnWorkerHandler,
  getWorkerSystemStatusHandler,
} from './handlers/worker';
import {
  getFollowersStatusHandler,
  retryFollowersHandler,
  getSystemStatusHandler,
} from './handlers/settings';
import {
  discsStateHandler,
  discsEjectHandler,
  discsAutoScanHandler,
  discsMovieOnlyHandler,
  discsPresetHandler,
  discsPresetsHandler,
  discsNextHandler,
  discsAttentionHandler,
  discsExtrasHandler,
  discsExtrasHintHandler,
  discsExtrasFileHandler,
  discsExtrasMatchHandler,
  discsExtrasDuplicatesHandler,
  discsExtrasRemoveHandler,
  discsExtrasRemovedHandler,
  discsExtrasRestoreHandler,
  discsExtrasSourcesHandler,
  discsExtrasMatchStartHandler,
  discsExtrasPreviewHandler,
  discsExtrasFrameHandler,
  discsExtrasRenameHandler,
  discsCommandsHandler,
  discsCommandResultHandler,
} from './handlers/discs';
import { logger, captureException } from '../src/lib/sentry';
import { withErrorHandler } from './handler-wrapper';
import { getCachedCapabilities } from './ffmpeg-capabilities';
import {
  hobworkStateHandler,
  hobworkSaveHandler,
  hobworkTestHandler,
  discNoticeHandler,
} from './handlers/hobwork';
import {
  subtitlesStateHandler,
  subtitlesConvertHandler,
  subtitlesAutoHandler,
  subtitlesCleanHandler,
  subtitlesDismissHandler,
  subtitlesRestoreHandler,
  subtitlesClearOldHandler,
  subtitlesRemoveTrackHandler,
} from './handlers/subtitles';

function getSettingsResponse(corsHeaders: Record<string, string>): Response {
  const version = process.env.APP_VERSION || null;
  const sentryClientDsn = process.env.SENTRY_CLIENT_DSN || null;
  const sentryEnvironment = process.env.SENTRY_ENVIRONMENT || 'production';
  const sentrySendDefaultPii = process.env.SENTRY_SEND_DEFAULT_PII === 'true';

  const response: any = { version };

  // Include Sentry config for the client if DSN is set
  if (sentryClientDsn) {
    response.sentry = {
      dsn: sentryClientDsn,
      environment: sentryEnvironment,
      sendDefaultPii: sentrySendDefaultPii,
      enableLogs: true,
    };
  }

  // Include FFmpeg capabilities (cached)
  const ffmpegCapabilities = getCachedCapabilities();
  if (ffmpegCapabilities) {
    response.ffmpeg = ffmpegCapabilities;
  }

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

// Wrap all handlers with error handling for defense in depth
// This catches any errors that slip through the handlers' internal error handling
const wrappedFilesHandler = withErrorHandler(filesHandler, 'FilesHandler');
const wrappedJobsHandler = withErrorHandler(jobsHandler, 'JobsHandler');
const wrappedJobByIdHandler = withErrorHandler(
  jobByIdHandler,
  'JobByIdHandler',
);
const wrappedStartJobsHandler = withErrorHandler(
  startJobsHandler,
  'StartJobsHandler',
);
const wrappedGetJobBatchHandler = withErrorHandler(
  getJobBatchHandler,
  'GetJobBatchHandler',
);
const wrappedFileSelectionsHandler = withErrorHandler(
  fileSelectionsHandler,
  'FileSelectionsHandler',
);
const wrappedFileSelectionByKeyHandler = withErrorHandler(
  fileSelectionByKeyHandler,
  'FileSelectionByKeyHandler',
);
const wrappedGetPickerStateHandler = withErrorHandler(
  getPickerStateHandler,
  'GetPickerStateHandler',
);
const wrappedPickerActionHandler = withErrorHandler(
  pickerActionHandler,
  'PickerActionHandler',
);
const wrappedTestNotificationHandler = withErrorHandler(
  testNotificationHandler,
  'TestNotificationHandler',
);
const wrappedNotificationStatusHandler = withErrorHandler(
  notificationStatusHandler,
  'NotificationStatusHandler',
);
const wrappedExecuteJobHandler = withErrorHandler(
  executeJobHandler,
  'ExecuteJobHandler',
);
const wrappedReceiveProgressHandler = withErrorHandler(
  receiveProgressHandler,
  'ReceiveProgressHandler',
);
const wrappedGetWorkerStatusHandler = withErrorHandler(
  getWorkerStatusHandler,
  'GetWorkerStatusHandler',
);
const wrappedCancelJobOnWorkerHandler = withErrorHandler(
  cancelJobOnWorkerHandler,
  'CancelJobOnWorkerHandler',
);
const wrappedGetWorkerSystemStatusHandler = withErrorHandler(
  getWorkerSystemStatusHandler,
  'GetWorkerSystemStatusHandler',
);
const wrappedGetFollowersStatusHandler = withErrorHandler(
  getFollowersStatusHandler,
  'GetFollowersStatusHandler',
);
const wrappedRetryFollowersHandler = withErrorHandler(
  retryFollowersHandler,
  'RetryFollowersHandler',
);
const wrappedGetSystemStatusHandler = withErrorHandler(
  getSystemStatusHandler,
  'GetSystemStatusHandler',
);

const wrappedDiscsStateHandler = withErrorHandler(
  discsStateHandler,
  'DiscsStateHandler',
);
const wrappedDiscsEjectHandler = withErrorHandler(
  discsEjectHandler,
  'DiscsEjectHandler',
);
const wrappedDiscsAutoScanHandler = withErrorHandler(
  discsAutoScanHandler,
  'DiscsAutoScanHandler',
);
const wrappedDiscsMovieOnlyHandler = withErrorHandler(
  discsMovieOnlyHandler,
  'DiscsMovieOnlyHandler',
);
const wrappedDiscsPresetHandler = withErrorHandler(
  discsPresetHandler,
  'DiscsPresetHandler',
);
const wrappedDiscsPresetsHandler = withErrorHandler(
  discsPresetsHandler,
  'DiscsPresetsHandler',
);
const wrappedHobworkStateHandler = withErrorHandler(
  hobworkStateHandler,
  'HobworkStateHandler',
);
const wrappedHobworkSaveHandler = withErrorHandler(
  hobworkSaveHandler,
  'HobworkSaveHandler',
);
const wrappedHobworkTestHandler = withErrorHandler(
  hobworkTestHandler,
  'HobworkTestHandler',
);
const wrappedDiscNoticeHandler = withErrorHandler(
  discNoticeHandler,
  'DiscNoticeHandler',
);
const wrappedSubtitlesStateHandler = withErrorHandler(
  subtitlesStateHandler,
  'SubtitlesStateHandler',
);
const wrappedSubtitlesConvertHandler = withErrorHandler(
  subtitlesConvertHandler,
  'SubtitlesConvertHandler',
);
const wrappedSubtitlesCleanHandler = withErrorHandler(
  subtitlesCleanHandler,
  'SubtitlesCleanHandler',
);
const wrappedSubtitlesDismissHandler = withErrorHandler(
  subtitlesDismissHandler,
  'SubtitlesDismissHandler',
);
const wrappedSubtitlesRemoveTrackHandler = withErrorHandler(
  subtitlesRemoveTrackHandler,
  'SubtitlesRemoveTrackHandler',
);
const wrappedSubtitlesRestoreHandler = withErrorHandler(
  subtitlesRestoreHandler,
  'SubtitlesRestoreHandler',
);
const wrappedSubtitlesClearOldHandler = withErrorHandler(
  subtitlesClearOldHandler,
  'SubtitlesClearOldHandler',
);
const wrappedSubtitlesAutoHandler = withErrorHandler(
  subtitlesAutoHandler,
  'SubtitlesAutoHandler',
);
const wrappedDiscsNextHandler = withErrorHandler(
  discsNextHandler,
  'DiscsNextHandler',
);
const wrappedDiscsExtrasPreviewHandler = withErrorHandler(
  discsExtrasPreviewHandler,
  'DiscsExtrasPreviewHandler',
);
const wrappedDiscsExtrasFrameHandler = withErrorHandler(
  discsExtrasFrameHandler,
  'DiscsExtrasFrameHandler',
);
const wrappedDiscsExtrasSourcesHandler = withErrorHandler(
  discsExtrasSourcesHandler,
  'DiscsExtrasSourcesHandler',
);
const wrappedDiscsExtrasDuplicatesHandler = withErrorHandler(
  discsExtrasDuplicatesHandler,
  'DiscsExtrasDuplicatesHandler',
);
const wrappedDiscsExtrasRemoveHandler = withErrorHandler(
  discsExtrasRemoveHandler,
  'DiscsExtrasRemoveHandler',
);
const wrappedDiscsExtrasRemovedHandler = withErrorHandler(
  discsExtrasRemovedHandler,
  'DiscsExtrasRemovedHandler',
);
const wrappedDiscsExtrasRestoreHandler = withErrorHandler(
  discsExtrasRestoreHandler,
  'DiscsExtrasRestoreHandler',
);
const wrappedDiscsExtrasMatchHandler = withErrorHandler(
  discsExtrasMatchHandler,
  'DiscsExtrasMatchHandler',
);
const wrappedDiscsExtrasMatchStartHandler = withErrorHandler(
  discsExtrasMatchStartHandler,
  'DiscsExtrasMatchStartHandler',
);
const wrappedDiscsExtrasFileHandler = withErrorHandler(
  discsExtrasFileHandler,
  'DiscsExtrasFileHandler',
);
const wrappedDiscsExtrasHintHandler = withErrorHandler(
  discsExtrasHintHandler,
  'DiscsExtrasHintHandler',
);
const wrappedDiscsExtrasHandler = withErrorHandler(
  discsExtrasHandler,
  'DiscsExtrasHandler',
);
const wrappedDiscsExtrasRenameHandler = withErrorHandler(
  discsExtrasRenameHandler,
  'DiscsExtrasRenameHandler',
);
const wrappedDiscsAttentionHandler = withErrorHandler(
  discsAttentionHandler,
  'DiscsAttentionHandler',
);
const wrappedDiscsCommandsHandler = withErrorHandler(
  discsCommandsHandler,
  'DiscsCommandsHandler',
);
const wrappedDiscsCommandResultHandler = withErrorHandler(
  discsCommandResultHandler,
  'DiscsCommandResultHandler',
);

export async function setupRoutes(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;

  // Enable CORS
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Route: GET /api/files
    if (pathname === '/api/files' && req.method === 'GET') {
      return await wrappedFilesHandler(req, corsHeaders);
    }

    // Route: GET /api/jobs
    if (pathname === '/api/jobs' && req.method === 'GET') {
      return await wrappedJobsHandler(req, corsHeaders);
    }

    // Route: POST /api/jobs
    if (pathname === '/api/jobs' && req.method === 'POST') {
      return await wrappedJobsHandler(req, corsHeaders);
    }

    // Route: PUT /api/jobs
    if (pathname === '/api/jobs' && req.method === 'PUT') {
      return await wrappedJobsHandler(req, corsHeaders);
    }

    // Route: DELETE /api/jobs
    if (pathname === '/api/jobs' && req.method === 'DELETE') {
      return await wrappedJobsHandler(req, corsHeaders);
    }

    // Route: GET /api/jobs/:id
    const jobIdMatch = pathname.match(/^\/api\/jobs\/(\d+)$/);
    if (jobIdMatch && req.method === 'GET') {
      const jobId = parseInt(jobIdMatch[1], 10);
      return await wrappedJobByIdHandler(req, jobId, corsHeaders);
    }

    // Route: PATCH /api/jobs/:id
    if (jobIdMatch && req.method === 'PATCH') {
      const jobId = parseInt(jobIdMatch[1], 10);
      return await wrappedJobByIdHandler(req, jobId, corsHeaders);
    }

    // Route: POST /api/jobs/start (async job creation)
    if (pathname === '/api/jobs/start' && req.method === 'POST') {
      return await wrappedStartJobsHandler(req, corsHeaders);
    }

    // Route: GET /api/jobs/batch/:id (get batch status)
    const jobBatchMatch = pathname.match(/^\/api\/jobs\/batch\/(\d+)$/);
    if (jobBatchMatch && req.method === 'GET') {
      const batchId = parseInt(jobBatchMatch[1], 10);
      return await wrappedGetJobBatchHandler(req, batchId, corsHeaders);
    }

    // Route: POST /api/file-selections
    if (pathname === '/api/file-selections' && req.method === 'POST') {
      return await wrappedFileSelectionsHandler(req, corsHeaders);
    }

    // Route: GET /api/file-selections/:key
    const fileSelectionMatch = pathname.match(/^\/api\/file-selections\/(.+)$/);
    if (fileSelectionMatch && req.method === 'GET') {
      const key = fileSelectionMatch[1];
      return await wrappedFileSelectionByKeyHandler(req, key, corsHeaders);
    }

    // Route: GET /api/picker-state
    if (pathname === '/api/picker-state' && req.method === 'GET') {
      return await wrappedGetPickerStateHandler(req, corsHeaders);
    }

    // Route: POST /api/picker-action
    if (pathname === '/api/picker-action' && req.method === 'POST') {
      return await wrappedPickerActionHandler(req, corsHeaders);
    }

    // Route: GET /api/settings
    if (pathname === '/api/settings' && req.method === 'GET') {
      return getSettingsResponse(corsHeaders);
    }

    // Route: GET /api/version (kept for backwards compatibility)
    if (pathname === '/api/version' && req.method === 'GET') {
      return getSettingsResponse(corsHeaders);
    }

    // Route: GET /api/notifications/status
    if (pathname === '/api/notifications/status' && req.method === 'GET') {
      return await wrappedNotificationStatusHandler(req, corsHeaders);
    }

    // Route: POST /api/notifications/test
    if (pathname === '/api/notifications/test' && req.method === 'POST') {
      return await wrappedTestNotificationHandler(req, corsHeaders);
    }

    // Route: GET /api/settings/followers
    if (pathname === '/api/settings/followers' && req.method === 'GET') {
      return await wrappedGetFollowersStatusHandler(req, corsHeaders);
    }

    // Route: POST /api/settings/followers/retry
    if (pathname === '/api/settings/followers/retry' && req.method === 'POST') {
      return await wrappedRetryFollowersHandler(req, corsHeaders);
    }

    // Route: GET /api/settings/system-status
    if (pathname === '/api/settings/system-status' && req.method === 'GET') {
      return await wrappedGetSystemStatusHandler(req, corsHeaders);
    }

    // Routes for the connection to Hobwork (notifications and Live Activities)
    if (pathname === '/api/hobwork' && req.method === 'GET') {
      return await wrappedHobworkStateHandler(req, corsHeaders);
    }
    if (pathname === '/api/hobwork' && req.method === 'PUT') {
      return await wrappedHobworkSaveHandler(req, corsHeaders);
    }
    if (pathname === '/api/hobwork/test' && req.method === 'POST') {
      return await wrappedHobworkTestHandler(req, corsHeaders);
    }
    // From the disc ripper on the same host
    if (pathname === '/api/disc-notice' && req.method === 'POST') {
      return await wrappedDiscNoticeHandler(req, corsHeaders);
    }

    // Routes for the subtitle converter (picture subtitles to text)
    if (pathname === '/api/subtitles' && req.method === 'GET') {
      return await wrappedSubtitlesStateHandler(req, corsHeaders);
    }
    if (pathname === '/api/subtitles/convert' && req.method === 'POST') {
      return await wrappedSubtitlesConvertHandler(req, corsHeaders);
    }
    if (pathname === '/api/subtitles/clean' && req.method === 'POST') {
      return await wrappedSubtitlesCleanHandler(req, corsHeaders);
    }
    if (pathname === '/api/subtitles/remove-track' && req.method === 'POST') {
      return await wrappedSubtitlesRemoveTrackHandler(req, corsHeaders);
    }
    if (pathname === '/api/subtitles/dismiss' && req.method === 'POST') {
      return await wrappedSubtitlesDismissHandler(req, corsHeaders);
    }
    if (pathname === '/api/subtitles/restore' && req.method === 'POST') {
      return await wrappedSubtitlesRestoreHandler(req, corsHeaders);
    }
    if (pathname === '/api/subtitles/clear-old' && req.method === 'POST') {
      return await wrappedSubtitlesClearOldHandler(req, corsHeaders);
    }
    if (pathname === '/api/subtitles/auto' && req.method === 'PUT') {
      return await wrappedSubtitlesAutoHandler(req, corsHeaders);
    }

    // Routes for the Discs page (the DVD ripper on the server host)
    if (pathname === '/api/discs' && req.method === 'GET') {
      return await wrappedDiscsStateHandler(req, corsHeaders);
    }
    if (pathname === '/api/discs/eject' && req.method === 'PUT') {
      return await wrappedDiscsEjectHandler(req, corsHeaders);
    }
    if (pathname === '/api/discs/movie-only' && req.method === 'PUT') {
      return await wrappedDiscsMovieOnlyHandler(req, corsHeaders);
    }
    if (pathname === '/api/discs/preset' && req.method === 'PUT') {
      return await wrappedDiscsPresetHandler(req, corsHeaders);
    }
    if (
      pathname === '/api/discs/presets' &&
      (req.method === 'POST' || req.method === 'DELETE')
    ) {
      return await wrappedDiscsPresetsHandler(req, corsHeaders);
    }
    if (pathname === '/api/discs/auto-scan' && req.method === 'PUT') {
      return await wrappedDiscsAutoScanHandler(req, corsHeaders);
    }
    if (
      pathname === '/api/discs/next' &&
      (req.method === 'PUT' || req.method === 'DELETE')
    ) {
      return await wrappedDiscsNextHandler(req, corsHeaders);
    }
    if (pathname === '/api/discs/extras' && req.method === 'GET') {
      return await wrappedDiscsExtrasHandler(req, corsHeaders);
    }
    if (pathname === '/api/discs/extras/preview' && req.method === 'GET') {
      return await wrappedDiscsExtrasPreviewHandler(req, corsHeaders);
    }
    if (pathname === '/api/discs/extras/frame' && req.method === 'GET') {
      return await wrappedDiscsExtrasFrameHandler(req, corsHeaders);
    }
    if (pathname === '/api/discs/extras/sources' && req.method === 'GET') {
      return await wrappedDiscsExtrasSourcesHandler(req, corsHeaders);
    }
    if (pathname === '/api/discs/extras/duplicates' && req.method === 'GET') {
      return await wrappedDiscsExtrasDuplicatesHandler(req, corsHeaders);
    }
    if (pathname === '/api/discs/extras/remove' && req.method === 'POST') {
      return await wrappedDiscsExtrasRemoveHandler(req, corsHeaders);
    }
    if (pathname === '/api/discs/extras/removed' && req.method === 'GET') {
      return await wrappedDiscsExtrasRemovedHandler(req, corsHeaders);
    }
    if (pathname === '/api/discs/extras/restore' && req.method === 'POST') {
      return await wrappedDiscsExtrasRestoreHandler(req, corsHeaders);
    }
    if (pathname === '/api/discs/extras/match' && req.method === 'GET') {
      return await wrappedDiscsExtrasMatchHandler(req, corsHeaders);
    }
    if (pathname === '/api/discs/extras/match' && req.method === 'POST') {
      return await wrappedDiscsExtrasMatchStartHandler(req, corsHeaders);
    }
    if (pathname === '/api/discs/extras/file' && req.method === 'GET') {
      return await wrappedDiscsExtrasFileHandler(req, corsHeaders);
    }
    if (pathname === '/api/discs/extras/hint' && req.method === 'GET') {
      return await wrappedDiscsExtrasHintHandler(req, corsHeaders);
    }
    if (pathname === '/api/discs/extras/rename' && req.method === 'POST') {
      return await wrappedDiscsExtrasRenameHandler(req, corsHeaders);
    }
    if (pathname === '/api/discs/attention' && req.method === 'DELETE') {
      return await wrappedDiscsAttentionHandler(req, corsHeaders);
    }
    if (pathname === '/api/discs/commands' && req.method === 'POST') {
      return await wrappedDiscsCommandsHandler(req, corsHeaders);
    }
    const discCommandMatch = pathname.match(
      /^\/api\/discs\/commands\/([^/]+)$/,
    );
    if (discCommandMatch && req.method === 'GET') {
      return await wrappedDiscsCommandResultHandler(
        req,
        decodeURIComponent(discCommandMatch[1]),
        corsHeaders,
      );
    }

    // Route: POST /worker/execute (follower endpoint)
    if (pathname === '/worker/execute' && req.method === 'POST') {
      return await wrappedExecuteJobHandler(req, corsHeaders);
    }

    // Route: GET /worker/status (follower endpoint)
    if (pathname === '/worker/status' && req.method === 'GET') {
      return await wrappedGetWorkerStatusHandler(req, corsHeaders);
    }

    // Route: GET /worker/system-status (follower endpoint)
    if (pathname === '/worker/system-status' && req.method === 'GET') {
      return await wrappedGetWorkerSystemStatusHandler(req, corsHeaders);
    }

    // Route: POST /worker/cancel/:jobId (follower endpoint)
    const workerCancelMatch = pathname.match(/^\/worker\/cancel\/(\d+)$/);
    if (workerCancelMatch && req.method === 'POST') {
      const jobId = parseInt(workerCancelMatch[1], 10);
      return await wrappedCancelJobOnWorkerHandler(req, jobId, corsHeaders);
    }

    // Route: POST /api/jobs/:id/progress (leader endpoint to receive progress from followers)
    const jobProgressMatch = pathname.match(/^\/api\/jobs\/(\d+)\/progress$/);
    if (jobProgressMatch && req.method === 'POST') {
      const jobId = parseInt(jobProgressMatch[1], 10);
      return await wrappedReceiveProgressHandler(req, jobId, corsHeaders);
    }

    // 404 Not Found
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error) {
    // This is a final safety net - should rarely be hit since handlers are wrapped
    logger.error('[API] Error handling request', {
      error: error instanceof Error ? error.message : String(error),
      path: pathname,
      method: req.method,
    });
    captureException(error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      },
    );
  }
}
