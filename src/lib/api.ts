/**
 * API client functions for the Frame Shift Video app
 */

import { FileSystemItem, FilePickerState } from '@/types/files';
import { Job } from '@/types/database';
import type { ConversionOptions } from '@/types/conversion';
import type { HobworkChanges, HobworkState } from '@/types/hobwork';
import type {
  SubtitleCleanRequest,
  SubtitleDismiss,
  SubtitleRequest,
  SubtitlesState,
} from '@/types/subtitles';
import type {
  DiscCommand,
  DiscCommandResult,
  DiscNext,
  DiscsState,
  DiscPresetInput,
  ExtraMatch,
  NameSource,
  ExtraMovie,
  RemovedExtra,
  FandomHint,
} from '@/types/discs';

// Base API URL
const API_BASE = '/api';

/**
 * Fetch files in a directory
 */
export async function fetchFiles(
  path: string,
  searchQuery?: string,
): Promise<{
  items: FileSystemItem[];
  searchQuery?: string;
}> {
  const params = new URLSearchParams({ path });
  if (searchQuery) {
    params.append('search', searchQuery);
  }

  const response = await fetch(`${API_BASE}/files?${params.toString()}`);

  if (!response.ok) {
    throw new Error('Failed to load directory');
  }

  return response.json();
}

/**
 * Fetch all jobs (legacy - used for WebSocket updates)
 */
export async function fetchJobs(): Promise<{ jobs: Job[] }> {
  const response = await fetch(`${API_BASE}/jobs`);

  if (!response.ok) {
    throw new Error('Failed to fetch jobs');
  }

  return response.json();
}

/**
 * Fetch jobs with cursor-based pagination
 */
export async function fetchJobsPaginated(
  cursor?: string,
  limit: number = 100,
  includeCleared: boolean = false,
): Promise<{
  jobs: Job[];
  nextCursor?: string;
  hasMore: boolean;
  statusCounts: Record<string, number>;
  failedNotRetriedCount: number;
}> {
  const params = new URLSearchParams();
  if (cursor) {
    params.append('cursor', cursor);
  }
  params.append('limit', limit.toString());
  if (includeCleared) {
    params.append('includeCleared', 'true');
  }

  const response = await fetch(`${API_BASE}/jobs?${params.toString()}`);

  if (!response.ok) {
    throw new Error('Failed to fetch jobs');
  }

  return response.json();
}

/**
 * Fetch jobs by status (non-paginated)
 */
export async function fetchJobsByStatus(
  status: Job['status'],
): Promise<{ jobs: Job[] }> {
  const params = new URLSearchParams({ status });
  const response = await fetch(`${API_BASE}/jobs?${params.toString()}`);

  if (!response.ok) {
    throw new Error('Failed to fetch jobs by status');
  }

  return response.json();
}

/**
 * Create new jobs (legacy sync endpoint)
 */
export async function createJobs(
  options: ConversionOptions,
): Promise<{ jobs: Job[] }> {
  console.log('[API Client] Creating jobs with options:', options);

  const response = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options),
  });

  console.log('[API Client] Create jobs response status:', response.status);

  if (!response.ok) {
    const error = await response.json();
    console.error('[API Client] Create jobs error:', error);
    throw new Error(error.error || 'Failed to create jobs');
  }

  const result = await response.json();
  console.log('[API Client] Create jobs result:', result);
  return result;
}

/**
 * Response from async job creation endpoint
 */
export interface StartJobsResponse {
  success: boolean;
  batchId: number;
  totalFiles: number;
  message: string;
}

/**
 * Start async job creation
 * Returns immediately with batch ID - jobs are created in background
 */
export async function startJobs(
  options: ConversionOptions,
): Promise<StartJobsResponse> {
  console.log(
    '[API Client] Starting async job creation with options:',
    options,
  );

  const response = await fetch(`${API_BASE}/jobs/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options),
  });

  console.log('[API Client] Start jobs response status:', response.status);

  if (!response.ok) {
    const error = await response.json();
    console.error('[API Client] Start jobs error:', error);
    throw new Error(error.error || 'Failed to start job creation');
  }

  const result = await response.json();
  console.log('[API Client] Start jobs result:', result);
  return result;
}

/**
 * Job creation batch status
 */
export interface JobCreationBatchStatus {
  id: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  totalFiles: number;
  createdCount: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

/**
 * Get job creation batch status
 */
export async function getJobBatchStatus(
  batchId: number,
): Promise<JobCreationBatchStatus> {
  const response = await fetch(`${API_BASE}/jobs/batch/${batchId}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch batch status');
  }

  return response.json();
}

/**
 * Mark a failed or cancelled job as retried (returns config key for navigation)
 */
export async function markJobAsRetried(
  jobId: number,
): Promise<{ configKey: string | null }> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'retry' }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to mark job as retried');
  }

  return response.json();
}

/**
 * Cancel a job
 */
export async function cancelJob(jobId: number): Promise<void> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'cancel' }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to cancel job');
  }
}

/**
 * Cancel all pending and processing jobs
 */
export async function cancelAllJobs(): Promise<{ count: number }> {
  const response = await fetch(`${API_BASE}/jobs`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to cancel all jobs');
  }

  return response.json();
}

/**
 * Mark all failed jobs as retried and return config key
 */
export async function markAllFailedAsRetried(): Promise<{
  count: number;
  configKey: string | null;
}> {
  const response = await fetch(`${API_BASE}/jobs`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'retry-all-failed' }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to mark all failed jobs as retried');
  }

  return response.json();
}

/**
 * Clear all finished jobs (completed, failed, cancelled)
 */
export async function clearFinishedJobs(): Promise<{ count: number }> {
  const response = await fetch(`${API_BASE}/jobs`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'clear-finished' }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to clear finished jobs');
  }

  return response.json();
}

/**
 * Save file selections with optional config
 */
export async function saveFileSelections(
  files: string[],
  config?: ConversionOptions,
): Promise<{
  key: string;
}> {
  const response = await fetch(`${API_BASE}/file-selections`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ files, config }),
  });

  if (!response.ok) {
    throw new Error('Failed to save file selections');
  }

  return response.json();
}

/**
 * Load file selections and config by key
 */
export async function loadFileSelections(key: string): Promise<{
  files: string[];
  config?: ConversionOptions;
}> {
  const response = await fetch(`${API_BASE}/file-selections/${key}`);

  if (!response.ok) {
    throw new Error('Failed to load file selections');
  }

  return response.json();
}

/**
 * Picker action types
 */
export type PickerAction =
  | { type: 'toggle-folder'; path: string }
  | { type: 'toggle-file'; path: string }
  | { type: 'toggle-folder-selection'; path: string }
  | { type: 'navigate'; path: string }
  | { type: 'update-config'; config: any }
  | { type: 'search'; query: string }
  | { type: 'update-show-hidden'; showHidden: boolean };

/**
 * Get picker state by key (creates new empty state if no key provided)
 */
export async function getPickerState(key?: string): Promise<FilePickerState> {
  const url = key
    ? `${API_BASE}/picker-state?key=${encodeURIComponent(key)}`
    : `${API_BASE}/picker-state`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error('Failed to get picker state');
  }

  return response.json();
}

/**
 * Perform an action on picker state and get new state
 */
export async function performPickerAction(
  action: PickerAction,
  key?: string,
): Promise<FilePickerState> {
  console.log('[API] performPickerAction called:', { action, key });

  const response = await fetch(`${API_BASE}/picker-action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ key, action }),
  });

  console.log('[API] performPickerAction response status:', response.status);

  if (!response.ok) {
    const error = await response.json();
    console.error('[API] performPickerAction error:', error);
    throw new Error(error.error || 'Failed to perform picker action');
  }

  const result = await response.json();
  console.log('[API] performPickerAction result:', result);
  return result;
}

/**
 * Fetch server version
 */
export async function fetchServerVersion(): Promise<{
  version: string | null;
}> {
  const response = await fetch(`${API_BASE}/version`);

  if (!response.ok) {
    throw new Error('Failed to fetch server version');
  }

  return response.json();
}

/**
 * FFmpeg capabilities from the server
 */
export interface FFmpegCapabilities {
  /** Whether libx264 supports 10-bit encoding (yuv420p10le) */
  x264_10bit: boolean;
}

/**
 * Settings response with FFmpeg capabilities
 */
export interface SettingsResponse {
  version: string | null;
  ffmpeg?: FFmpegCapabilities;
}

/**
 * Fetch server settings including FFmpeg capabilities
 */
export async function fetchSettings(): Promise<SettingsResponse> {
  const response = await fetch(`${API_BASE}/settings`);

  if (!response.ok) {
    throw new Error('Failed to fetch settings');
  }

  return response.json();
}

/**
 * Response for notification status endpoint
 */
export interface NotificationStatusResponse {
  enabled: boolean;
  methods: string[];
}

/**
 * Get notification configuration status
 */
export async function fetchNotificationStatus(): Promise<NotificationStatusResponse> {
  const response = await fetch(`${API_BASE}/notifications/status`);

  if (!response.ok) {
    throw new Error('Failed to fetch notification status');
  }

  return response.json();
}

/**
 * Send a test notification
 */
export async function sendTestNotification(): Promise<{
  success: boolean;
  message: string;
  completedCount: number;
  failedCount: number;
}> {
  const response = await fetch(`${API_BASE}/notifications/test`, {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to send test notification');
  }

  return response.json();
}

/**
 * The movie files, their subtitle tracks and what the converter is doing
 */
export async function fetchSubtitles(): Promise<SubtitlesState> {
  const response = await fetch(`${API_BASE}/subtitles`);
  if (!response.ok) throw new Error('Failed to read the subtitles');
  return response.json();
}

/**
 * Ask for one file, or all of them, to have their picture subtitles converted
 */
export async function convertSubtitles(
  request: SubtitleRequest,
): Promise<{ queued: number }> {
  const response = await fetch(`${API_BASE}/subtitles/convert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || 'Failed to ask for the conversion');
  }
  return body;
}

/**
 * Ask for the text subtitles already in a file, or in all files that need it, to be cleaned
 */
export async function cleanSubtitles(
  request: SubtitleCleanRequest,
): Promise<{ queued: number }> {
  const response = await fetch(`${API_BASE}/subtitles/clean`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Failed to ask');
  return body;
}

/**
 * Take a waiting file, the whole waiting list, or finished entries off the subtitles box
 */
export async function dismissSubtitles(what: SubtitleDismiss): Promise<void> {
  const response = await fetch(`${API_BASE}/subtitles/dismiss`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(what),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Failed to remove');
}

/**
 * Ask for one subtitle track to be taken out of a file (the old file is kept first)
 */
export async function removeSubtitleTrack(
  path: string,
  track: number,
): Promise<void> {
  const response = await fetch(`${API_BASE}/subtitles/remove-track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, track }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Failed to ask');
}

/**
 * Ask for the old copy of a file to be put back (the converted file is kept in its place)
 */
export async function restoreSubtitles(path: string): Promise<void> {
  const response = await fetch(`${API_BASE}/subtitles/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Failed to put it back');
}

/**
 * Delete every old copy for good. The page asks the person to confirm first.
 */
export async function clearOldCopies(): Promise<void> {
  const response = await fetch(`${API_BASE}/subtitles/clear-old`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: true }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Failed to delete');
}

/**
 * Turn converting the subtitles of new discs on or off
 */
export async function setSubtitlesAuto(enabled: boolean): Promise<void> {
  const response = await fetch(`${API_BASE}/subtitles/auto`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) throw new Error('Failed to change the setting');
}

/**
 * Whether Frame Shift is connected to Hobwork, and its switches
 */
export async function fetchHobwork(): Promise<HobworkState> {
  const response = await fetch(`${API_BASE}/hobwork`);
  if (!response.ok) throw new Error('Failed to read the Hobwork connection');
  return response.json();
}

/**
 * Change the connection to Hobwork or its switches
 */
export async function saveHobwork(
  changes: HobworkChanges,
): Promise<HobworkState> {
  const response = await fetch(`${API_BASE}/hobwork`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || 'Failed to save the Hobwork connection');
  }
  return body;
}

/**
 * Send a test notification through Hobwork
 */
export async function testHobwork(): Promise<{ ok: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/hobwork/test`, { method: 'POST' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || 'Hobwork did not take the test');
  }
  return body;
}

/**
 * Follower status with job info
 */
export interface FollowerStatus {
  id: string;
  url: string;
  busy: boolean;
  dead: boolean;
  currentJob: {
    id: number;
    name: string;
    progress: number;
  } | null;
}

/**
 * Response for followers status endpoint
 */
export interface FollowersStatusResponse {
  enabled: boolean;
  followers: FollowerStatus[];
  hasDeadFollowers: boolean;
}

/**
 * Fetch followers status (leader mode only)
 */
export async function fetchFollowersStatus(): Promise<FollowersStatusResponse> {
  const response = await fetch(`${API_BASE}/settings/followers`);

  if (!response.ok) {
    throw new Error('Failed to fetch followers status');
  }

  return response.json();
}

/**
 * Trigger retry sync for dead followers
 */
export async function retryFollowers(): Promise<{
  success: boolean;
  message: string;
  hasDeadFollowers: boolean;
}> {
  const response = await fetch(`${API_BASE}/settings/followers/retry`, {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to retry followers');
  }

  return response.json();
}

/**
 * System status for a single node
 */
export interface NodeSystemStatus {
  /** Node identifier (e.g., "standalone", "leader", "follower-0") */
  nodeId: string;
  /** CPU usage percentage (0-100) */
  cpuUsagePercent: number;
  /** Number of CPU cores */
  cpuCores: number;
  /** Memory used in bytes */
  memoryUsedBytes: number;
  /** Total memory in bytes */
  memoryTotalBytes: number;
  /** Memory usage percentage (0-100) */
  memoryUsagePercent: number;
  /** Timestamp when this status was collected */
  timestamp: number;
}

/**
 * System status response
 */
export interface SystemStatusResponse {
  /** Instance type: standalone, leader, or follower */
  instanceType: 'standalone' | 'leader' | 'follower';
  /** Status of all nodes */
  nodes: NodeSystemStatus[];
}

/**
 * Fetch system status for all nodes
 */
export async function fetchSystemStatus(): Promise<SystemStatusResponse> {
  const response = await fetch(`${API_BASE}/settings/system-status`);

  if (!response.ok) {
    throw new Error('Failed to fetch system status');
  }

  return response.json();
}

/**
 * Reads the reason out of a failed response, so the page can show it
 */
async function discError(response: Response, fallback: string): Promise<Error> {
  try {
    const body = await response.json();
    if (body && typeof body.error === 'string') return new Error(body.error);
  } catch {
    // not JSON; use the fallback
  }
  return new Error(fallback);
}

/**
 * Fetch everything the Discs page shows (the DVD ripper on the server)
 */
export async function fetchDiscs(): Promise<DiscsState> {
  const response = await fetch(`${API_BASE}/discs`);

  if (!response.ok) {
    throw await discError(response, 'Failed to load the discs');
  }

  return response.json();
}

/**
 * Turn ejecting on or off for the ripper
 */
export async function setDiscEject(enabled: boolean): Promise<void> {
  const response = await fetch(`${API_BASE}/discs/eject`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });

  if (!response.ok) {
    throw await discError(response, 'Failed to change the eject setting');
  }
}

/**
 * Turn leaving out a movie's extras on or off
 */
export async function setDiscMovieOnly(enabled: boolean): Promise<void> {
  const response = await fetch(`${API_BASE}/discs/movie-only`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });

  if (!response.ok) {
    throw await discError(response, 'Failed to change the movie-only setting');
  }
}

/**
 * Choose how discs queued from now on are converted
 */
export async function setDiscPreset(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/discs/preset`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });

  if (!response.ok) {
    throw await discError(response, 'Failed to change how discs are converted');
  }
}

/**
 * Make a conversion preset of your own, or change one you made
 */
export async function saveDiscPreset(preset: DiscPresetInput): Promise<void> {
  const response = await fetch(`${API_BASE}/discs/presets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preset),
  });

  if (!response.ok) {
    throw await discError(response, 'Failed to save the preset');
  }
}

/**
 * Delete a conversion preset you made
 */
export async function deleteDiscPreset(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/discs/presets`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });

  if (!response.ok) {
    throw await discError(response, 'Failed to delete the preset');
  }
}

/**
 * Turn scanning and ripping a disc as it goes in on or off
 */
export async function setDiscAutoScan(enabled: boolean): Promise<void> {
  const response = await fetch(`${API_BASE}/discs/auto-scan`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });

  if (!response.ok) {
    throw await discError(response, 'Failed to change the auto-scan setting');
  }
}

/**
 * Leave a note for the next disc, or take it back with null
 */
export async function setDiscNext(note: DiscNext | null): Promise<void> {
  const response = await fetch(`${API_BASE}/discs/next`, {
    method: note ? 'PUT' : 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: note ? JSON.stringify(note) : undefined,
  });

  if (!response.ok) {
    throw await discError(response, 'Failed to save the note');
  }
}

/**
 * The extras of ripped movies, for naming them
 */
export async function fetchDiscExtras(): Promise<ExtraMovie[]> {
  const response = await fetch(`${API_BASE}/discs/extras`);
  if (!response.ok) {
    throw await discError(response, 'Failed to load the extras');
  }
  const body = (await response.json()) as { movies: ExtraMovie[] };
  return body.movies;
}

/**
 * What every database lists as the bonus features of a movie's disc, with the lengths they give
 */
export async function fetchExtraSources(movie: string): Promise<NameSource[]> {
  const response = await fetch(
    `${API_BASE}/discs/extras/sources?${new URLSearchParams({ movie })}`,
  );
  if (!response.ok) {
    throw await discError(response, 'Failed to look the movie up');
  }
  return ((await response.json()) as { sources: NameSource[] }).sources;
}

/**
 * Groups of a movie's extras that are the same video (same length and same pictures)
 */
export async function fetchExtraDuplicates(movie: string): Promise<string[][]> {
  const response = await fetch(
    `${API_BASE}/discs/extras/duplicates?${new URLSearchParams({ movie })}`,
  );
  if (!response.ok) {
    throw await discError(response, 'Failed to look for copies');
  }
  return ((await response.json()) as { groups: string[][] }).groups;
}

/**
 * Take extras out of their movie (they are moved to the _removed folder, not deleted)
 */
export async function removeDiscExtras(paths: string[]): Promise<{
  removed: string[];
  failed: { path: string; error: string }[];
}> {
  const response = await fetch(`${API_BASE}/discs/extras/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  });
  if (!response.ok) {
    throw await discError(response, 'Failed to remove the extras');
  }
  return (await response.json()) as {
    removed: string[];
    failed: { path: string; error: string }[];
  };
}

/**
 * The extras that were taken out of movies
 */
export async function fetchRemovedExtras(): Promise<RemovedExtra[]> {
  const response = await fetch(`${API_BASE}/discs/extras/removed`);
  if (!response.ok) {
    throw await discError(response, 'Failed to load the removed extras');
  }
  return ((await response.json()) as { extras: RemovedExtra[] }).extras;
}

/**
 * Put removed extras back in their movie
 */
export async function restoreDiscExtras(paths: string[]): Promise<{
  restored: string[];
  failed: { path: string; error: string }[];
}> {
  const response = await fetch(`${API_BASE}/discs/extras/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  });
  if (!response.ok) {
    throw await discError(response, 'Failed to put the extras back');
  }
  return (await response.json()) as {
    restored: string[];
    failed: { path: string; error: string }[];
  };
}

/**
 * How the matching of a movie's extras is going, with the suggestions so far (null: not started)
 */
export async function fetchExtraMatch(
  movie: string,
): Promise<ExtraMatch | null> {
  const response = await fetch(
    `${API_BASE}/discs/extras/match?${new URLSearchParams({ movie })}`,
  );
  if (!response.ok) {
    throw await discError(response, 'Failed to read how the matching is going');
  }
  return ((await response.json()) as { match: ExtraMatch | null }).match;
}

/**
 * Start listening to a movie's unnamed extras and matching them with DVD Fandom's names
 */
export async function startExtraMatch(movie: string): Promise<ExtraMatch> {
  const response = await fetch(`${API_BASE}/discs/extras/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ movie }),
  });
  if (!response.ok) {
    throw await discError(response, 'Failed to start matching');
  }
  return ((await response.json()) as { match: ExtraMatch }).match;
}

/**
 * Where to watch (or, with `download`, save) an extra, to tell what it is
 */
export function discExtraFileUrl(
  path: string,
  download = false,
  at?: number,
): string {
  const query = new URLSearchParams({ path });
  if (download) query.set('download', '1');
  // A media fragment: the player starts at that moment.
  return `${API_BASE}/discs/extras/file?${query}${at !== undefined ? `#t=${Math.floor(at)}` : ''}`;
}

/**
 * Where a still picture from an extra is, at a moment in it
 */
export function discExtraFrameUrl(path: string, at: number): string {
  return `${API_BASE}/discs/extras/frame?${new URLSearchParams({ path, t: String(at) })}`;
}

/**
 * An extra's length and the moments to show pictures of
 */
export async function fetchExtraPreview(
  path: string,
): Promise<{ seconds: number; times: number[] }> {
  const response = await fetch(
    `${API_BASE}/discs/extras/preview?${new URLSearchParams({ path })}`,
  );
  if (!response.ok) {
    throw await discError(response, 'Failed to look inside the video');
  }
  return (await response.json()) as { seconds: number; times: number[] };
}

/**
 * What DVD Fandom lists as the bonus features of a movie's disc
 */
export async function fetchFandomHint(movie: string): Promise<FandomHint> {
  const response = await fetch(
    `${API_BASE}/discs/extras/hint?${new URLSearchParams({ movie })}`,
  );
  if (!response.ok) {
    throw await discError(response, 'Failed to look the movie up');
  }
  return ((await response.json()) as { hint: FandomHint }).hint;
}

/**
 * Give an extra its name, and optionally move it to another extras folder
 */
export async function renameDiscExtra(change: {
  path: string;
  name: string;
  folder?: string;
}): Promise<{ path: string }> {
  const response = await fetch(`${API_BASE}/discs/extras/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(change),
  });
  if (!response.ok) {
    throw await discError(response, 'Failed to rename the extra');
  }
  return (await response.json()) as { path: string };
}

/**
 * Remove a note the ripper left
 */
export async function dismissDiscAttention(file: string): Promise<void> {
  const response = await fetch(`${API_BASE}/discs/attention`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file }),
  });

  if (!response.ok) {
    throw await discError(response, 'Failed to remove the note');
  }
}

/**
 * Ask the host to eject, rip or rename. Returns the id to ask the answer by.
 */
export async function sendDiscCommand(
  command: DiscCommand,
): Promise<{ id: string }> {
  const response = await fetch(`${API_BASE}/discs/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    throw await discError(response, 'Failed to send the request');
  }

  return response.json();
}

/**
 * The host's answer to a request, once it has one
 */
export async function fetchDiscCommandResult(
  id: string,
): Promise<DiscCommandResult> {
  const response = await fetch(
    `${API_BASE}/discs/commands/${encodeURIComponent(id)}`,
  );

  if (!response.ok) {
    throw await discError(response, 'Failed to read the answer');
  }

  return response.json();
}
