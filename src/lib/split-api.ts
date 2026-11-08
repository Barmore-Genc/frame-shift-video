/**
 * Client for the Split page: separating combined episodes and removing extra audio/subtitle
 * tracks. The server queues the work; the page polls the task list for progress.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const API_BASE = '/api/split';

export interface SplitTask {
  id: string;
  kind: 'split' | 'tracks';
  label: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'skipped';
  progress: number;
  message: string;
  createdAt: number;
}

export interface SplitEpisode {
  name: string;
  start: number;
  end: number;
}

export interface SplitPreviewFile {
  path: string;
  duration: number;
  plan: {
    complete: boolean;
    warning?: string;
    boundaries: Array<{ start: number; end: number }>;
  };
  episodes: SplitEpisode[];
}

export interface SplitPreviewRequest {
  path: string;
  episodesPerFile: number;
  frameOffset: number;
  season: number;
  startEpisode: number;
  show: string;
  titles: string;
}

export interface TrackOptionsRequest {
  languages: string;
  filterAudio: boolean;
  filterSubtitles: boolean;
  keepUntagged: boolean;
}

export interface StreamInfo {
  index: number;
  type: 'video' | 'audio' | 'subtitle' | 'other';
  codec?: string;
  language?: string;
  title?: string;
}

export interface TrackPreviewFile {
  path: string;
  streams: StreamInfo[];
  plan: {
    action: 'clean' | 'already-clean' | 'skip-no-audio';
    reason: string;
    removeAudio: number[];
    removeSubtitles: number[];
  };
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data as T;
}

export function useSplitTasks() {
  return useQuery({
    queryKey: ['split-tasks'],
    queryFn: async (): Promise<SplitTask[]> => {
      const response = await fetch(`${API_BASE}/tasks`);
      if (!response.ok) throw new Error('Failed to read the task list');
      return ((await response.json()) as { tasks: SplitTask[] }).tasks;
    },
    refetchInterval: 1500,
  });
}

function useTaskMutation<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['split-tasks'] }),
  });
}

export function useSplitPreview() {
  return useMutation({
    mutationFn: (request: SplitPreviewRequest) =>
      post<{ files: SplitPreviewFile[] }>('/preview', request),
  });
}

export function useSplitRun() {
  return useTaskMutation(
    (request: {
      files: Array<{ path: string; episodes: SplitEpisode[] }>;
      mode: 'reencode' | 'copy';
      outputDir: string;
      overwrite: boolean;
    }) => post<{ queued: number }>('/run', request),
  );
}

export function useTracksPreview() {
  return useMutation({
    mutationFn: (request: TrackOptionsRequest & { path: string }) =>
      post<{ files: TrackPreviewFile[] }>('/tracks/preview', request),
  });
}

export function useTracksRun() {
  return useTaskMutation(
    (request: TrackOptionsRequest & { paths: string[]; replace: boolean }) =>
      post<{ queued: number }>('/tracks/run', request),
  );
}

export function useCancelSplitTask() {
  return useTaskMutation((id: string) =>
    post<{ cancelled: boolean }>('/cancel', { id }),
  );
}

export function useClearSplitTasks() {
  return useTaskMutation(() => post<{ cleared: number }>('/clear', {}));
}
