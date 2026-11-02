import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Job } from '@/types/database';
import { JobCard } from './job-card';
import { ConfirmationModal } from './confirmation-modal';
import {
  useJobsInfinite,
  useJobsByStatus,
  useMarkJobAsRetried,
  useCancelJob,
  useCancelAllJobs,
  useMarkAllFailedAsRetried,
  useClearFinishedJobs,
  useSaveFileSelections,
} from '@/lib/api-hooks';
import { useQueryClient } from '@tanstack/react-query';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useNavigate } from '@tanstack/react-router';
import { Menu } from '@ark-ui/react/menu';
import { useInPageSearch } from '@/hooks/use-in-page-search';
import { InPageSearch } from './in-page-search';
import {
  Trash,
  ArrowCounterClockwise,
  X,
  Check,
  Tray,
} from '@phosphor-icons/react';

export function JobList() {
  const [showCleared, setShowCleared] = useState(false);
  const {
    data,
    isLoading: loading,
    error: queryError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useJobsInfinite(100, showCleared);
  const { data: processingJobsData, isLoading: loadingProcessingJobs } =
    useJobsByStatus('processing');
  const navigate = useNavigate();
  const markJobAsRetriedMutation = useMarkJobAsRetried();
  const cancelJobMutation = useCancelJob();
  const cancelAllJobsMutation = useCancelAllJobs();
  const markAllFailedAsRetriedMutation = useMarkAllFailedAsRetried();
  const clearFinishedJobsMutation = useClearFinishedJobs();
  const queryClient = useQueryClient();
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // In-page search
  const search = useInPageSearch({ inputRef: searchInputRef });

  // Get processing jobs
  const processingJobs = useMemo(() => {
    return processingJobsData?.jobs || [];
  }, [processingJobsData]);

  // Get processing job IDs for filtering
  const processingJobIds = useMemo(() => {
    return new Set(processingJobs.map((job) => job.id));
  }, [processingJobs]);

  // Flatten all pages into a single array of jobs, excluding processing jobs
  const otherJobs = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages
      .flatMap((page) => page.jobs)
      .filter((job) => !processingJobIds.has(job.id));
  }, [data, processingJobIds]);

  // Combine processing jobs at the top with other jobs
  const allJobs = useMemo(() => {
    return [...processingJobs, ...otherJobs];
  }, [processingJobs, otherJobs]);

  // Find matched job indices based on search query
  const matchedIndices = useMemo(() => {
    if (!search.query.trim()) {
      return [];
    }

    const matched: number[] = [];
    allJobs.forEach((job, index) => {
      if (job.name.toLowerCase().includes(search.query.toLowerCase())) {
        matched.push(index);
      }
    });

    return matched;
  }, [allJobs, search.query]);

  // Don't filter jobs, just show all jobs with highlighting
  const jobs = allJobs;

  // Update total matches when filtered jobs change
  useEffect(() => {
    search.setTotalMatches(matchedIndices.length);
  }, [matchedIndices.length, search]);

  // Scroll to the current match when it changes
  useEffect(() => {
    if (
      search.isOpen &&
      search.query.trim() &&
      matchedIndices.length > 0 &&
      virtuosoRef.current
    ) {
      const actualIndex = matchedIndices[search.currentMatchIndex];
      if (actualIndex !== undefined) {
        virtuosoRef.current.scrollToIndex({
          index: actualIndex,
          align: 'center',
          behavior: 'smooth',
        });
      }
    }
  }, [search.currentMatchIndex, search.isOpen, search.query, matchedIndices]);

  // Extract status counts from the first page (they're the same for all pages)
  const statusCounts = useMemo(() => {
    return (
      data?.pages?.[0]?.statusCounts || {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      }
    );
  }, [data]);

  const failedNotRetriedCount = useMemo(() => {
    return data?.pages?.[0]?.failedNotRetriedCount || 0;
  }, [data]);

  const clearableJobsCount = useMemo(() => {
    return data?.pages?.[0]?.clearableJobsCount || 0;
  }, [data]);

  const error = queryError ? 'Failed to fetch jobs' : null;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const [wsConnected, setWsConnected] = useState(false);
  const [showCancelAllModal, setShowCancelAllModal] = useState(false);
  const [showRetryAllFailedModal, setShowRetryAllFailedModal] = useState(false);
  const [showClearFinishedModal, setShowClearFinishedModal] = useState(false);

  // Job creation batch progress tracking
  const [jobCreationProgress, setJobCreationProgress] = useState<{
    batchId: number;
    createdCount: number;
    totalCount: number;
  } | null>(null);

  const connectWebSocket = useCallback(() => {
    // Clear any existing reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/ws`;

    console.log('[WebSocket] Connecting to', wsUrl);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[WebSocket] Connected');
      setWsConnected(true);
      // Reset reconnect attempts on successful connection
      reconnectAttemptsRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('[WebSocket] Received message:', message);

        if (message.type === 'job:updated' || message.type === 'job:created') {
          // Update the job in the infinite query cache
          const job = message.data;

          // Check if this is a status transition to a finished state
          // In these cases, we need to refetch to get proper ordering
          const isFinishedTransition =
            job.status === 'completed' ||
            job.status === 'failed' ||
            job.status === 'cancelled';

          if (isFinishedTransition) {
            // Job moved to finished state - invalidate to trigger re-sort
            queryClient.invalidateQueries({
              queryKey: ['jobs', 'infinite', 100, showCleared],
            });
            queryClient.invalidateQueries({
              queryKey: ['jobs', 'status', 'processing'],
            });
            return; // Skip in-place update, let the refetch handle it
          }

          queryClient.setQueryData(
            ['jobs', 'infinite', 100, showCleared],
            (oldData: any) => {
              if (!oldData?.pages) return oldData;

              // Create a new pages array with the updated job
              const newPages = oldData.pages.map((page: any) => {
                const jobIndex = page.jobs.findIndex(
                  (j: Job) => j.id === job.id,
                );
                if (jobIndex >= 0) {
                  // Update existing job in this page
                  const newJobs = [...page.jobs];
                  newJobs[jobIndex] = job;
                  return { ...page, jobs: newJobs };
                }
                return page;
              });

              // If job not found in any page, add it to the first page
              const jobExists = newPages.some((page: any) =>
                page.jobs.some((j: Job) => j.id === job.id),
              );

              if (!jobExists && newPages.length > 0) {
                newPages[0] = {
                  ...newPages[0],
                  jobs: [job, ...newPages[0].jobs],
                };
              }

              return { ...oldData, pages: newPages };
            },
          );

          // Update the processing jobs cache
          queryClient.setQueryData(
            ['jobs', 'status', 'processing'],
            (oldData: any) => {
              if (!oldData?.jobs) return oldData;

              const jobIndex = oldData.jobs.findIndex(
                (j: Job) => j.id === job.id,
              );

              // If the job is processing, update it or add it
              if (job.status === 'processing') {
                if (jobIndex >= 0) {
                  // Update existing processing job
                  const newJobs = [...oldData.jobs];
                  newJobs[jobIndex] = job;
                  return { ...oldData, jobs: newJobs };
                } else {
                  // Add new processing job
                  return { ...oldData, jobs: [job, ...oldData.jobs] };
                }
              } else {
                // Job is no longer processing, remove it
                if (jobIndex >= 0) {
                  const newJobs = oldData.jobs.filter(
                    (j: Job) => j.id !== job.id,
                  );
                  return { ...oldData, jobs: newJobs };
                }
              }

              return oldData;
            },
          );
        } else if (message.type === 'job:progress') {
          // Update job progress in the infinite query cache
          const { jobId, progress, frame, fps } = message.data;
          queryClient.setQueryData(
            ['jobs', 'infinite', 100, showCleared],
            (oldData: any) => {
              if (!oldData?.pages) return oldData;

              const newPages = oldData.pages.map((page: any) => {
                const jobIndex = page.jobs.findIndex(
                  (j: Job) => j.id === jobId,
                );
                if (jobIndex >= 0) {
                  const newJobs = [...page.jobs];
                  newJobs[jobIndex] = {
                    ...newJobs[jobIndex],
                    progress,
                    // Store current frame and fps temporarily for UI display
                    currentFrame: frame,
                    currentFps: fps,
                  };
                  return { ...page, jobs: newJobs };
                }
                return page;
              });

              return { ...oldData, pages: newPages };
            },
          );

          // Update job progress in the processing jobs cache
          queryClient.setQueryData(
            ['jobs', 'status', 'processing'],
            (oldData: any) => {
              if (!oldData?.jobs) return oldData;

              const jobIndex = oldData.jobs.findIndex(
                (j: Job) => j.id === jobId,
              );
              if (jobIndex >= 0) {
                const newJobs = [...oldData.jobs];
                newJobs[jobIndex] = {
                  ...newJobs[jobIndex],
                  progress,
                  // Store current frame and fps temporarily for UI display
                  currentFrame: frame,
                  currentFps: fps,
                };
                return { ...oldData, jobs: newJobs };
              }

              return oldData;
            },
          );
        } else if (message.type === 'status-counts') {
          // Update status counts in all pages of the infinite query cache
          const statusCounts = message.data;
          queryClient.setQueryData(
            ['jobs', 'infinite', 100, showCleared],
            (oldData: any) => {
              if (!oldData?.pages) return oldData;

              // Update statusCounts in all pages
              const newPages = oldData.pages.map((page: any) => ({
                ...page,
                statusCounts,
              }));

              return { ...oldData, pages: newPages };
            },
          );
        } else if (message.type === 'jobs:cleared') {
          // Jobs were auto-cleared, invalidate the cache to refetch
          console.log('[WebSocket] Jobs cleared, invalidating cache');
          queryClient.invalidateQueries({ queryKey: ['jobs'] });
        } else if (message.type === 'job-creation:progress') {
          // Update job creation progress
          const { batchId, createdCount, totalCount } = message.data;
          console.log('[WebSocket] Job creation progress:', {
            batchId,
            createdCount,
            totalCount,
          });
          setJobCreationProgress({ batchId, createdCount, totalCount });
        } else if (message.type === 'job-creation:complete') {
          // Job creation batch completed
          const { batchId, totalCreated } = message.data;
          console.log('[WebSocket] Job creation complete:', {
            batchId,
            totalCreated,
          });
          setJobCreationProgress(null);
          // Invalidate jobs cache to show newly created jobs
          queryClient.invalidateQueries({ queryKey: ['jobs'] });
        } else if (message.type === 'job-creation:error') {
          // Job creation batch failed
          const { batchId, error: errorMsg } = message.data;
          console.error('[WebSocket] Job creation error:', {
            batchId,
            errorMsg,
          });
          setJobCreationProgress(null);
        }
      } catch (err) {
        console.error('[WebSocket] Error parsing message:', err);
      }
    };

    ws.onerror = (event) => {
      console.error('[WebSocket] Error:', event);
      setWsConnected(false);
    };

    ws.onclose = () => {
      console.log('[WebSocket] Disconnected');
      setWsConnected(false);
      wsRef.current = null;

      // Calculate exponential backoff delay: 1s, 2s, 4s, 8s, 16s, 32s, 60s, 60s...
      // Max out at 60 seconds (1 minute)
      reconnectAttemptsRef.current += 1;
      const baseDelay = 1000; // 1 second
      const maxDelay = 60000; // 1 minute
      const delay = Math.min(
        baseDelay * Math.pow(2, reconnectAttemptsRef.current - 1),
        maxDelay,
      );

      console.log(
        `[WebSocket] Will attempt to reconnect in ${delay / 1000}s (attempt ${reconnectAttemptsRef.current})`,
      );

      // Attempt to reconnect with exponential backoff
      reconnectTimeoutRef.current = setTimeout(() => {
        console.log('[WebSocket] Attempting to reconnect...');
        connectWebSocket();
      }, delay);
    };

    wsRef.current = ws;
  }, [queryClient, showCleared]);

  useEffect(() => {
    // Connect WebSocket
    connectWebSocket();

    // Cleanup on unmount
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connectWebSocket]);

  const handleRetry = async (jobId: number) => {
    try {
      // Mark job as retried and get config key
      const { configKey } = await markJobAsRetriedMutation.mutateAsync(jobId);

      // Navigate to configure page with the config key
      if (configKey) {
        navigate({ to: '/convert/configure', search: { key: configKey } });
      } else {
        alert('Failed to load job configuration');
      }
    } catch (err) {
      console.error('Error retrying job:', err);
      alert(err instanceof Error ? err.message : 'Failed to retry job');
    }
  };

  const handleCancel = async (jobId: number) => {
    try {
      await cancelJobMutation.mutateAsync(jobId);
      // Mutation will invalidate the cache and trigger refetch
    } catch (err) {
      console.error('Error cancelling job:', err);
      alert(err instanceof Error ? err.message : 'Failed to cancel job');
    }
  };

  const handleCancelAll = async () => {
    try {
      await cancelAllJobsMutation.mutateAsync();
      // Mutation will invalidate the cache and trigger refetch
    } catch (err) {
      console.error('Error cancelling all jobs:', err);
      alert(err instanceof Error ? err.message : 'Failed to cancel all jobs');
    }
  };

  // Calculate total cancellable jobs from status counts
  const cancellableJobsCount = statusCounts.pending + statusCounts.processing;

  const handleRetryAllFailed = async () => {
    try {
      // Mark all failed jobs as retried and get config key
      const { configKey, count } =
        await markAllFailedAsRetriedMutation.mutateAsync();

      if (count === 0) {
        return;
      }

      // Navigate to configure page with the config key
      if (configKey) {
        navigate({ to: '/convert/configure', search: { key: configKey } });
      } else {
        alert('Failed to load job configuration');
      }
    } catch (err) {
      console.error('Error retrying all failed jobs:', err);
      alert(
        err instanceof Error ? err.message : 'Failed to retry all failed jobs',
      );
    }
  };

  const handleClearFinished = async () => {
    try {
      await clearFinishedJobsMutation.mutateAsync();
      // Mutation will invalidate the cache and trigger refetch
    } catch (err) {
      console.error('Error clearing finished jobs:', err);
      alert(
        err instanceof Error ? err.message : 'Failed to clear finished jobs',
      );
    }
  };

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (loading || loadingProcessingJobs) {
    return (
      <div className="text-center py-12">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
        <p className="mt-4 text-gray-600 dark:text-gray-400">Loading jobs...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 dark:text-red-400 text-lg">
          Error loading jobs: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* In-page search */}
      {search.isOpen && (
        <InPageSearch
          query={search.query}
          onQueryChange={search.setQuery}
          currentMatchIndex={search.currentMatchIndex}
          totalMatches={search.totalMatches}
          onNext={search.nextMatch}
          onPrevious={search.previousMatch}
          onClose={search.closeSearch}
          showNativeWarning={search.showNativeWarning}
          inputRef={searchInputRef}
        />
      )}

      <ConfirmationModal
        isOpen={showCancelAllModal}
        onClose={() => setShowCancelAllModal(false)}
        onConfirm={handleCancelAll}
        title="Cancel All Jobs"
        message={`Are you sure you want to cancel ${cancellableJobsCount} ${cancellableJobsCount === 1 ? 'job' : 'jobs'}? This action cannot be undone.`}
        confirmText="Cancel All Jobs"
        cancelText="Keep Jobs"
      />
      <ConfirmationModal
        isOpen={showRetryAllFailedModal}
        onClose={() => setShowRetryAllFailedModal(false)}
        onConfirm={handleRetryAllFailed}
        title="Retry All Failed Jobs"
        message={`Are you sure you want to retry ${failedNotRetriedCount} failed ${failedNotRetriedCount === 1 ? 'job' : 'jobs'}?`}
        confirmText="Retry All"
        cancelText="Cancel"
        confirmClassName="bg-blue-600 hover:bg-blue-700"
      />
      <ConfirmationModal
        isOpen={showClearFinishedModal}
        onClose={() => setShowClearFinishedModal(false)}
        onConfirm={handleClearFinished}
        title="Clear Finished Jobs"
        message={`Are you sure you want to clear ${clearableJobsCount} finished ${clearableJobsCount === 1 ? 'job' : 'jobs'}? They will be hidden from the job list.`}
        confirmText="Clear Finished Jobs"
        cancelText="Cancel"
        confirmClassName="bg-orange-600 hover:bg-orange-700"
      />
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
          Video Jobs
        </h2>
        <div className="flex items-center gap-6">
          <div
            className="flex items-center gap-2 text-sm"
            title={
              wsConnected
                ? 'Connected - live updates enabled'
                : 'Disconnected - attempting to reconnect'
            }
          >
            <span
              className={`inline-block w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}
            ></span>
            <span className="text-gray-600 dark:text-gray-400">
              {wsConnected ? 'Live' : 'Connecting...'}
            </span>
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {statusCounts.processing > 0 && (
              <span>
                processing {statusCounts.processing}{' '}
                {statusCounts.processing === 1 ? 'job' : 'jobs'}
                {(statusCounts.pending > 0 || statusCounts.failed > 0) && ', '}
              </span>
            )}
            {statusCounts.pending > 0 && (
              <span>
                {statusCounts.pending}{' '}
                {statusCounts.pending === 1 ? 'job' : 'jobs'} pending
                {statusCounts.failed > 0 && ', '}
              </span>
            )}
            {statusCounts.failed > 0 && (
              <span className="text-red-600 dark:text-red-400">
                {statusCounts.failed} failed
              </span>
            )}
            {statusCounts.processing === 0 &&
              statusCounts.pending === 0 &&
              statusCounts.failed === 0 && <span>no active jobs</span>}
          </div>
          <Menu.Root>
            <Menu.Trigger className="min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center gap-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500">
              Actions
              <span className="text-xs">▼</span>
            </Menu.Trigger>
            <Menu.Positioner>
              <Menu.Content className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl p-1 min-w-[240px] z-50">
                {/* Show Cleared Jobs Checkbox */}
                <button
                  type="button"
                  onClick={() => setShowCleared(!showCleared)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setShowCleared(!showCleared);
                    }
                  }}
                  className="w-full px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer flex items-center gap-3 focus:outline-none focus:ring-2 focus:ring-blue-500 text-left"
                >
                  <div
                    className={`w-4 h-4 flex items-center justify-center border-2 rounded ${
                      showCleared
                        ? 'bg-blue-600 border-blue-600'
                        : 'border-gray-300 dark:border-gray-600'
                    }`}
                  >
                    {showCleared && (
                      <Check size={12} weight="bold" className="text-white" />
                    )}
                  </div>
                  <span className="text-sm text-gray-900 dark:text-white">
                    Show Cleared Jobs
                  </span>
                </button>

                <div className="my-1 border-t border-gray-200 dark:border-gray-600" />

                {/* Clear Queue */}
                <button
                  type="button"
                  disabled={
                    clearFinishedJobsMutation.isPending ||
                    clearableJobsCount === 0
                  }
                  onClick={() => {
                    if (
                      !clearFinishedJobsMutation.isPending &&
                      clearableJobsCount > 0
                    ) {
                      setShowClearFinishedModal(true);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (
                        !clearFinishedJobsMutation.isPending &&
                        clearableJobsCount > 0
                      ) {
                        setShowClearFinishedModal(true);
                      }
                    }
                  }}
                  className={`w-full px-3 py-2 rounded cursor-pointer flex items-center gap-3 focus:outline-none focus:ring-2 focus:ring-orange-500 text-left ${
                    clearFinishedJobsMutation.isPending ||
                    clearableJobsCount === 0
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-orange-50 dark:hover:bg-orange-900/20'
                  }`}
                >
                  <Trash
                    size={16}
                    className="text-orange-600 dark:text-orange-400"
                  />
                  <span
                    className={`text-sm ${
                      clearFinishedJobsMutation.isPending ||
                      clearableJobsCount === 0
                        ? 'text-gray-400 dark:text-gray-600'
                        : 'text-gray-900 dark:text-white'
                    }`}
                  >
                    {clearFinishedJobsMutation.isPending
                      ? 'Clearing...'
                      : 'Clear Queue'}
                  </span>
                </button>

                {/* Retry All Failed */}
                <button
                  type="button"
                  disabled={
                    markAllFailedAsRetriedMutation.isPending ||
                    failedNotRetriedCount === 0
                  }
                  onClick={() => {
                    if (
                      !markAllFailedAsRetriedMutation.isPending &&
                      failedNotRetriedCount > 0
                    ) {
                      setShowRetryAllFailedModal(true);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (
                        !markAllFailedAsRetriedMutation.isPending &&
                        failedNotRetriedCount > 0
                      ) {
                        setShowRetryAllFailedModal(true);
                      }
                    }
                  }}
                  className={`w-full px-3 py-2 rounded cursor-pointer flex items-center gap-3 focus:outline-none focus:ring-2 focus:ring-blue-500 text-left ${
                    markAllFailedAsRetriedMutation.isPending ||
                    failedNotRetriedCount === 0
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-blue-50 dark:hover:bg-blue-900/20'
                  }`}
                >
                  <ArrowCounterClockwise
                    size={16}
                    className="text-blue-600 dark:text-blue-400"
                  />
                  <span
                    className={`text-sm ${
                      markAllFailedAsRetriedMutation.isPending ||
                      failedNotRetriedCount === 0
                        ? 'text-gray-400 dark:text-gray-600'
                        : 'text-gray-900 dark:text-white'
                    }`}
                  >
                    {markAllFailedAsRetriedMutation.isPending
                      ? 'Retrying...'
                      : 'Retry All Failed'}
                  </span>
                </button>

                {/* Cancel All */}
                <button
                  type="button"
                  disabled={
                    cancelAllJobsMutation.isPending ||
                    cancellableJobsCount === 0
                  }
                  onClick={() => {
                    if (
                      !cancelAllJobsMutation.isPending &&
                      cancellableJobsCount > 0
                    ) {
                      setShowCancelAllModal(true);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (
                        !cancelAllJobsMutation.isPending &&
                        cancellableJobsCount > 0
                      ) {
                        setShowCancelAllModal(true);
                      }
                    }
                  }}
                  className={`w-full px-3 py-2 rounded cursor-pointer flex items-center gap-3 focus:outline-none focus:ring-2 focus:ring-red-500 text-left ${
                    cancelAllJobsMutation.isPending ||
                    cancellableJobsCount === 0
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-red-50 dark:hover:bg-red-900/20'
                  }`}
                >
                  <X size={16} className="text-red-600 dark:text-red-400" />
                  <span
                    className={`text-sm ${
                      cancelAllJobsMutation.isPending ||
                      cancellableJobsCount === 0
                        ? 'text-gray-400 dark:text-gray-600'
                        : 'text-gray-900 dark:text-white'
                    }`}
                  >
                    {cancelAllJobsMutation.isPending
                      ? 'Cancelling...'
                      : 'Cancel All'}
                  </span>
                </button>
              </Menu.Content>
            </Menu.Positioner>
          </Menu.Root>
        </div>
      </div>

      {/* Job creation progress indicator */}
      {jobCreationProgress && (
        <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <div className="flex-1">
              <p className="text-blue-800 dark:text-blue-200 font-medium">
                Creating conversion jobs...
              </p>
              <p className="text-sm text-blue-600 dark:text-blue-400">
                {jobCreationProgress.createdCount} of{' '}
                {jobCreationProgress.totalCount} jobs created
              </p>
            </div>
          </div>
          {jobCreationProgress.totalCount > 0 && (
            <div className="mt-3 h-2 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{
                  width: `${Math.round((jobCreationProgress.createdCount / jobCreationProgress.totalCount) * 100)}%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      <div
        className="bg-slate-100 dark:bg-slate-900 rounded-xl py-6 border-2 border-slate-300 dark:border-slate-700"
        style={{ height: 'calc(100vh - 200px)' }}
      >
        {jobs.length === 0 ? (
          <div className="text-center py-12">
            <Tray
              size={64}
              weight="duotone"
              className="neon-icon mx-auto mb-4"
            />
            <p className="text-gray-600 dark:text-gray-400 text-lg">
              {showCleared
                ? 'No jobs found.'
                : 'No jobs yet. Start a conversion to see jobs here.'}
            </p>
            {!showCleared && (
              <p className="text-gray-600 dark:text-gray-400 text-sm mt-2">
                (Toggle "Show cleared jobs" to see cleared jobs)
              </p>
            )}
          </div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            data={jobs}
            endReached={loadMore}
            itemContent={(index, job) => {
              const isActiveMatch =
                search.isOpen &&
                search.query.trim() &&
                matchedIndices.length > 0 &&
                index === matchedIndices[search.currentMatchIndex];

              return (
                <div className="mb-6 mx-6">
                  <JobCard
                    key={job.id}
                    job={job}
                    onRetry={handleRetry}
                    onCancel={handleCancel}
                    searchWords={search.query.trim() ? [search.query] : []}
                    isActiveMatch={isActiveMatch}
                  />
                </div>
              );
            }}
            components={{
              Footer: () => {
                if (isFetchingNextPage) {
                  return (
                    <div className="text-center py-8">
                      <div className="inline-block h-6 w-6 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
                      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                        Loading more jobs...
                      </p>
                    </div>
                  );
                }
                if (!hasNextPage && jobs.length > 0) {
                  return (
                    <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
                      That's all!
                    </div>
                  );
                }
                return null;
              },
            }}
          />
        )}
      </div>
    </div>
  );
}
