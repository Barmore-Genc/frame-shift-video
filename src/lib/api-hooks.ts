/**
 * TanStack Query hooks for API operations
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from '@tanstack/react-query';
import {
  fetchFiles,
  fetchJobs,
  fetchJobsPaginated,
  fetchJobsByStatus,
  createJobs,
  startJobs,
  getJobBatchStatus,
  markJobAsRetried,
  cancelJob,
  cancelAllJobs,
  markAllFailedAsRetried,
  clearFinishedJobs,
  saveFileSelections,
  loadFileSelections,
  getPickerState,
  performPickerAction,
  fetchFollowersStatus,
  retryFollowers,
  fetchNotificationStatus,
  fetchSystemStatus,
  fetchSettings,
  fetchDiscs,
  fetchDiscExtras,
  fetchExtraDuplicates,
  fetchExtraMatch,
  fetchExtraSources,
  fetchExtraPreview,
  fetchFandomHint,
  removeDiscExtras,
  fetchRemovedExtras,
  restoreDiscExtras,
  startExtraMatch,
  renameDiscExtra,
  setDiscEject,
  setDiscAutoScan,
  fetchHobwork,
  saveHobwork,
  fetchSubtitles,
  convertSubtitles,
  setSubtitlesAuto,
  restoreSubtitles,
  removeSubtitleTrack,
  removeSubtitlePictures,
  dismissSubtitles,
  cleanSubtitles,
  clearOldCopies,
  setDiscMovieOnly,
  setDiscPreset,
  saveDiscPreset,
  deleteDiscPreset,
  setDiscNext,
  dismissDiscAttention,
  sendDiscCommand,
  fetchDiscCommandResult,
  type PickerAction,
  type StartJobsResponse,
} from './api';
import { ConversionOptions } from '@/types/conversion';
import { Job } from '@/types/database';
import type { DiscCommand, DiscCommandResult, DiscNext } from '@/types/discs';

/**
 * Query keys for caching
 */
export const queryKeys = {
  jobs: ['jobs'] as const,
  files: (path: string) => ['files', path] as const,
  fileSelections: (key: string) => ['file-selections', key] as const,
  pickerState: (key: string) => ['picker-state', key] as const,
  followersStatus: ['followers-status'] as const,
  notificationStatus: ['notification-status'] as const,
  systemStatus: ['system-status'] as const,
  settings: ['settings'] as const,
  discs: ['discs'] as const,
  discExtras: ['disc-extras'] as const,
  removedExtras: ['removed-extras'] as const,
  hobwork: ['hobwork'] as const,
  subtitles: ['subtitles'] as const,
};

/**
 * Hook to fetch files in a directory
 */
export function useFiles(path: string) {
  return useQuery({
    queryKey: queryKeys.files(path),
    queryFn: () => fetchFiles(path),
  });
}

/**
 * Hook to fetch all jobs (legacy)
 */
export function useJobs() {
  return useQuery({
    queryKey: queryKeys.jobs,
    queryFn: fetchJobs,
  });
}

/**
 * Hook to fetch jobs with infinite scroll pagination
 */
export function useJobsInfinite(
  limit: number = 100,
  includeCleared: boolean = false,
) {
  return useInfiniteQuery({
    queryKey: ['jobs', 'infinite', limit, includeCleared],
    queryFn: ({ pageParam }) =>
      fetchJobsPaginated(pageParam, limit, includeCleared),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.nextCursor : undefined,
    initialPageParam: undefined as string | undefined,
  });
}

/**
 * Hook to fetch jobs by status
 */
export function useJobsByStatus(status: Job['status']) {
  return useQuery({
    queryKey: ['jobs', 'status', status],
    queryFn: () => fetchJobsByStatus(status),
  });
}

/**
 * Hook to create new jobs (legacy sync)
 */
export function useCreateJobs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (options: ConversionOptions) => {
      console.log('[API Hook] Creating jobs mutation started');
      return createJobs(options);
    },
    onSuccess: (data) => {
      console.log('[API Hook] Creating jobs mutation succeeded:', data);
      // Invalidate and refetch jobs
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs });
    },
    onError: (error) => {
      console.error('[API Hook] Creating jobs mutation failed:', error);
    },
  });
}

/**
 * Hook to start async job creation
 * Returns immediately - progress is tracked via WebSocket
 */
export function useStartJobs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (options: ConversionOptions) => {
      console.log('[API Hook] Starting async job creation');
      return startJobs(options);
    },
    onSuccess: (data: StartJobsResponse) => {
      console.log('[API Hook] Async job creation started:', data);
      // Jobs will be created in background, query will be invalidated
      // when job-creation:complete event is received
    },
    onError: (error) => {
      console.error('[API Hook] Starting async job creation failed:', error);
    },
  });
}

/**
 * Hook to fetch job creation batch status
 */
export function useJobBatchStatus(batchId: number | null) {
  return useQuery({
    queryKey: ['job-batch', batchId],
    queryFn: () => getJobBatchStatus(batchId!),
    enabled: batchId !== null,
    refetchInterval: (query) => {
      // Poll while in progress
      const status = query.state.data?.status;
      if (status === 'pending' || status === 'in_progress') {
        return 2000; // Poll every 2 seconds
      }
      return false; // Stop polling when complete
    },
  });
}

/**
 * Hook to mark a job as retried and get its input file
 */
export function useMarkJobAsRetried() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: number) => markJobAsRetried(jobId),
    onSuccess: () => {
      // Invalidate and refetch jobs
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs });
    },
  });
}

/**
 * Hook to cancel a job
 */
export function useCancelJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: number) => cancelJob(jobId),
    onSuccess: () => {
      // Invalidate and refetch jobs
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs });
    },
  });
}

/**
 * Hook to cancel all jobs
 */
export function useCancelAllJobs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => cancelAllJobs(),
    onSuccess: () => {
      // Invalidate and refetch jobs
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs });
    },
  });
}

/**
 * Hook to mark all failed jobs as retried and get their input files
 */
export function useMarkAllFailedAsRetried() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => markAllFailedAsRetried(),
    onSuccess: () => {
      // Invalidate and refetch jobs
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs });
    },
  });
}

/**
 * Hook to clear all finished jobs
 */
export function useClearFinishedJobs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => clearFinishedJobs(),
    onSuccess: () => {
      // Invalidate and refetch jobs
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs });
    },
  });
}

/**
 * Hook to save file selections with optional config
 */
export function useSaveFileSelections() {
  return useMutation({
    mutationFn: ({
      files,
      config,
    }: {
      files: string[];
      config?: ConversionOptions;
    }) => saveFileSelections(files, config),
  });
}

/**
 * Hook to load file selections
 */
export function useFileSelections(key: string | undefined) {
  return useQuery({
    queryKey: queryKeys.fileSelections(key || ''),
    queryFn: () => loadFileSelections(key!),
    enabled: !!key, // Only fetch if key is provided
  });
}

/**
 * Hook to get picker state
 * Automatically creates new empty state if no key is provided
 */
export function usePickerState(key: string | undefined) {
  return useQuery({
    queryKey: queryKeys.pickerState(key || 'new'),
    queryFn: () => getPickerState(key),
    staleTime: 0, // Always fetch fresh state
    gcTime: 0, // Don't cache old states
  });
}

/**
 * Hook to perform picker actions
 * Returns a mutation that updates the picker state
 */
export function usePickerAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ action, key }: { action: PickerAction; key?: string }) =>
      performPickerAction(action, key),
    onSuccess: (newState, variables) => {
      // Set the new state in cache for the new key
      queryClient.setQueryData(queryKeys.pickerState(newState.key), newState);
      // Also update the query for the old key to prevent refetching
      if (variables.key) {
        queryClient.setQueryData(
          queryKeys.pickerState(variables.key),
          newState,
        );
      }
      // Update the 'new' key as well (for when there's no key)
      queryClient.setQueryData(queryKeys.pickerState('new'), newState);
    },
  });
}

/**
 * Hook to clear all picker state from cache
 */
export function useClearPickerState() {
  const queryClient = useQueryClient();

  return () => {
    // Remove all picker-state queries from cache
    queryClient.removeQueries({ queryKey: ['picker-state'] });
  };
}

/**
 * Hook to fetch followers status
 */
export function useFollowersStatus() {
  return useQuery({
    queryKey: queryKeys.followersStatus,
    queryFn: fetchFollowersStatus,
    // Fallback polling every 30 seconds (WebSocket provides real-time updates)
    refetchInterval: 30000,
  });
}

/**
 * Hook to retry syncing with dead followers
 */
export function useRetryFollowers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: retryFollowers,
    onSuccess: () => {
      // Invalidate followers status to refetch
      queryClient.invalidateQueries({ queryKey: queryKeys.followersStatus });
    },
  });
}

/**
 * Hook to read the subtitles of the movie files. It looks again every few seconds, because the
 * converter works in the background.
 */
export function useSubtitles() {
  return useQuery({
    queryKey: queryKeys.subtitles,
    queryFn: fetchSubtitles,
    refetchInterval: 3000,
  });
}

/**
 * Hook to ask for subtitles to be converted
 */
export function useConvertSubtitles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: convertSubtitles,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.subtitles }),
  });
}

/**
 * Hook to ask for the text already in converted files to be cleaned
 */
export function useCleanSubtitles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cleanSubtitles,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.subtitles }),
  });
}

/**
 * Hook to take things off the subtitles box
 */
export function useDismissSubtitles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: dismissSubtitles,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.subtitles }),
  });
}

/**
 * Hook to take one subtitle track out of a file
 */
export function useRemoveSubtitleTrack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, track }: { path: string; track: number }) =>
      removeSubtitleTrack(path, track),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.subtitles }),
  });
}

/**
 * Hook to take the picture subtitles that could not be read out of a file, or out of every file
 */
export function useRemoveSubtitlePictures() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeSubtitlePictures,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.subtitles }),
  });
}

/**
 * Hook to put the old copy of a converted file back
 */
export function useRestoreSubtitles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: restoreSubtitles,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.subtitles }),
  });
}

/**
 * Hook to delete every old copy for good
 */
export function useClearOldCopies() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clearOldCopies,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.subtitles }),
  });
}

/**
 * Hook to turn converting the subtitles of new discs on or off
 */
export function useSetSubtitlesAuto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setSubtitlesAuto,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.subtitles }),
  });
}

/**
 * Hook to read the connection to Hobwork
 */
export function useHobwork() {
  return useQuery({
    queryKey: queryKeys.hobwork,
    queryFn: fetchHobwork,
  });
}

/**
 * Hook to change the connection to Hobwork, or send it a test
 */
export function useSaveHobwork() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveHobwork,
    onSuccess: (state) => queryClient.setQueryData(queryKeys.hobwork, state),
  });
}

/**
 * Hook to fetch notification status
 */
export function useNotificationStatus() {
  return useQuery({
    queryKey: queryKeys.notificationStatus,
    queryFn: fetchNotificationStatus,
  });
}

/**
 * Hook to fetch system status
 */
export function useSystemStatus() {
  return useQuery({
    queryKey: queryKeys.systemStatus,
    queryFn: fetchSystemStatus,
    // Fallback polling every 30 seconds (WebSocket provides real-time updates)
    refetchInterval: 30000,
  });
}

/**
 * Hook to fetch server settings including FFmpeg capabilities
 * This is cached indefinitely since capabilities don't change at runtime
 */
export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: fetchSettings,
    staleTime: Infinity, // Never refetch - capabilities don't change at runtime
    gcTime: Infinity, // Keep in cache forever
  });
}

/**
 * Hook to fetch the Discs page's state. The ripper changes it as it works, so poll.
 */
export function useDiscs() {
  return useQuery({
    queryKey: queryKeys.discs,
    queryFn: fetchDiscs,
    refetchInterval: 3000,
  });
}

/**
 * Hook to read the extras of ripped movies, for naming them
 */
export function useDiscExtras() {
  return useQuery({
    queryKey: queryKeys.discExtras,
    queryFn: fetchDiscExtras,
    refetchInterval: 15000,
  });
}

/**
 * Hook to read what DVD Fandom lists for a movie's disc. One try, kept for the session: the wiki is
 * slow and rarely changes.
 */
export function useFandomHint(movie: string, enabled: boolean) {
  return useQuery({
    queryKey: ['fandom-hint', movie] as const,
    queryFn: () => fetchFandomHint(movie),
    enabled,
    retry: false,
    staleTime: 60 * 60 * 1000,
  });
}

/**
 * Hook to read what every database lists for a movie's disc. Asked once for the session: the
 * databases are slow and rarely change.
 */
export function useExtraSources(movie: string, enabled: boolean) {
  return useQuery({
    queryKey: ['extra-sources', movie] as const,
    queryFn: () => fetchExtraSources(movie),
    enabled,
    retry: false,
    staleTime: 60 * 60 * 1000,
  });
}

/**
 * Hook to ask the databases for a movie's disc again, now (the server keeps what it found for an
 * hour, and so does the page). What it finds replaces what the page has.
 */
export function useRefreshExtraSources(movie: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchExtraSources(movie, true),
    onSuccess: (sources) =>
      queryClient.setQueryData(['extra-sources', movie], sources),
  });
}

/**
 * Hook to find the extras of a movie that are the same video twice. Asked once for the session
 * (it looks at the pictures), and again after extras are removed.
 */
export function useExtraDuplicates(movie: string, enabled: boolean) {
  return useQuery({
    queryKey: ['extra-duplicates', movie] as const,
    queryFn: () => fetchExtraDuplicates(movie),
    enabled,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Hook to take extras out of their movie
 */
export function useRemoveExtras() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeDiscExtras,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.discExtras });
      queryClient.invalidateQueries({ queryKey: queryKeys.removedExtras });
      queryClient.invalidateQueries({ queryKey: ['extra-duplicates'] });
      queryClient.invalidateQueries({ queryKey: ['extra-match'] });
    },
  });
}

/**
 * Hook to read the extras that were taken out of movies
 */
export function useRemovedExtras() {
  return useQuery({
    queryKey: queryKeys.removedExtras,
    queryFn: fetchRemovedExtras,
    refetchInterval: 15000,
  });
}

/**
 * Hook to put removed extras back in their movie
 */
export function useRestoreExtras() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: restoreDiscExtras,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.discExtras });
      queryClient.invalidateQueries({ queryKey: queryKeys.removedExtras });
      queryClient.invalidateQueries({ queryKey: ['extra-duplicates'] });
      queryClient.invalidateQueries({ queryKey: ['extra-match'] });
    },
  });
}

/**
 * Hook to read how the matching of a movie's extras is going: asked again every couple of seconds
 * while it runs (listening is slow), and left alone otherwise.
 */
export function useExtraMatch(movie: string) {
  return useQuery({
    queryKey: ['extra-match', movie] as const,
    queryFn: () => fetchExtraMatch(movie),
    refetchInterval: (query) =>
      query.state.data?.status === 'running' ? 2000 : false,
  });
}

/**
 * Hook to start matching a movie's unnamed extras
 */
export function useStartExtraMatch(movie: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => startExtraMatch(movie),
    onSuccess: (match) =>
      queryClient.setQueryData(['extra-match', movie], match),
  });
}

/**
 * Hook to read an extra's length and the moments to preview, once it is asked for
 */
export function useExtraPreview(path: string, enabled: boolean) {
  return useQuery({
    queryKey: ['extra-preview', path] as const,
    queryFn: () => fetchExtraPreview(path),
    enabled,
    retry: false,
    staleTime: Infinity,
  });
}

/**
 * Hook to give an extra its name
 */
export function useRenameDiscExtra() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: renameDiscExtra,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.discExtras }),
  });
}

/**
 * Hook to turn ejecting on or off
 */
export function useSetDiscEject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setDiscEject,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.discs }),
  });
}

/**
 * Hook to turn leaving out a movie's extras on or off
 */
export function useSetDiscMovieOnly() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setDiscMovieOnly,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.discs }),
  });
}

/**
 * Hook to choose how discs queued from now on are converted
 */
export function useSetDiscPreset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setDiscPreset,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.discs }),
  });
}

/**
 * Hook to make a conversion preset of your own, or change one
 */
export function useSaveDiscPreset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveDiscPreset,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.discs }),
  });
}

/**
 * Hook to delete a conversion preset you made
 */
export function useDeleteDiscPreset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteDiscPreset,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.discs }),
  });
}

/**
 * Hook to turn scanning and ripping a disc as it goes in on or off
 */
export function useSetDiscAutoScan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setDiscAutoScan,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.discs }),
  });
}

/**
 * Hook to leave a note for the next disc, or take it back with null
 */
export function useSetDiscNext() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note: DiscNext | null) => setDiscNext(note),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.discs }),
  });
}

/**
 * Hook to remove a note the ripper left
 */
export function useDismissDiscAttention() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: dismissDiscAttention,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.discs }),
  });
}

/**
 * Hook to ask the host to eject, rip or rename. The host answers within a few
 * seconds, so this waits for the answer and returns it.
 */
/**
 * Sends a request to the host and waits for its answer: up to 15 seconds, then a "did not
 * answer" result. Not a hook, so a component can start one on its own, such as when a disc
 * goes in.
 */
export async function runDiscCommand(
  command: DiscCommand,
): Promise<DiscCommandResult> {
  const { id } = await sendDiscCommand(command);
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const result = await fetchDiscCommandResult(id);
    if (result.done) return result;
  }
  return {
    done: false,
    message:
      'The server did not answer. Is the disc helper running on the host?',
  };
}

export function useDiscCommand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: runDiscCommand,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.discs }),
  });
}
