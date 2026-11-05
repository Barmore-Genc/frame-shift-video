import { Server } from 'bun';

// Initialize Sentry as early as possible
import { initializeServerMonitoring, logger } from '../src/lib/sentry';
await initializeServerMonitoring();

// Import routes
import { setupRoutes } from './routes';
import { setupWebSocket, WSBroadcaster } from './websocket';
import { JobProcessor } from './job-processor';
import { attachConvertActivity } from './convert-activity';
import { startDiscActivityWatcher } from './disc-activity';
import { LeaderDistributor } from './leader-distributor';
import { FollowerExecutor } from './follower-executor';
import { Job } from '../src/types/database';
import { serveStatic } from './static';
import { FileSelectionService, JobService } from './db-service';
import { cleanupAllTempFiles } from './temp-file-service';
import { captureException } from '../src/lib/sentry';
import { collectSystemStatus, type NodeSystemStatus } from './system-status';
import { updateFollowerSystemStatus } from './handlers/settings';
import { detectFFmpegCapabilities } from './ffmpeg-capabilities';
import { resumeInProgressBatches } from './job-creation-service';
import { discsDir } from './disc-state';
import { startWarming } from './extras-warm';

const PORT = parseInt(process.env.PORT || '3001', 10);
const DIST_DIR = process.env.DIST_DIR || './dist';

// Instance type configuration
type InstanceType = 'standalone' | 'leader' | 'follower';
const INSTANCE_TYPE = (process.env.INSTANCE_TYPE ||
  'standalone') as InstanceType;
const SHARED_TOKEN = process.env.SHARED_TOKEN;
const FOLLOWER_URLS = process.env.FOLLOWER_URLS;
const LEADER_URL = process.env.LEADER_URL;

// Validate instance type configuration
if (!['standalone', 'leader', 'follower'].includes(INSTANCE_TYPE)) {
  logger.fatal('[Config] Invalid INSTANCE_TYPE', { value: INSTANCE_TYPE });
  process.exit(1);
}

if (INSTANCE_TYPE !== 'standalone') {
  if (!SHARED_TOKEN) {
    logger.fatal(
      '[Config] SHARED_TOKEN is required for leader/follower instances',
    );
    process.exit(1);
  }

  if (INSTANCE_TYPE === 'leader' && !FOLLOWER_URLS) {
    logger.fatal('[Config] FOLLOWER_URLS is required for leader instances');
    process.exit(1);
  }

  if (INSTANCE_TYPE === 'follower' && !LEADER_URL) {
    logger.fatal('[Config] LEADER_URL is required for follower instances');
    process.exit(1);
  }
}

logger.info('[Config] Instance configuration', {
  instanceType: INSTANCE_TYPE,
  hasSharedToken: !!SHARED_TOKEN,
  followerCount:
    INSTANCE_TYPE === 'leader' && FOLLOWER_URLS
      ? FOLLOWER_URLS.split(',').length
      : 0,
});

// Validate FFmpeg thread environment variables if set
function validateThreadEnv(name: string): number | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const threads = parseInt(value, 10);
  if (isNaN(threads) || threads <= 0) {
    logger.error(`[Config] Invalid ${name} value`, { value });
    process.exit(1);
  }
  return threads;
}

const decoderThreads = validateThreadEnv('FFMPEG_DECODER_THREADS');
const encoderThreads = validateThreadEnv('FFMPEG_ENCODER_THREADS');
if (decoderThreads || encoderThreads) {
  logger.info('[Config] FFmpeg threads configured', {
    decoderThreads,
    encoderThreads,
  });
}

// Clean up temporary files from previous runs BEFORE starting job processor
// This must happen before the processor starts to avoid deleting files from new conversions
// Only run on leader/standalone - followers should not run cleanup to avoid race conditions
if (INSTANCE_TYPE !== 'follower') {
  const baseDir = process.env.FRAME_SHIFT_HOME || process.env.HOME || '/';
  try {
    const deletedCount = await cleanupAllTempFiles(baseDir);
    logger.info('[Startup] Temporary file cleanup complete', { deletedCount });
  } catch (error) {
    logger.error('[Startup] Failed to clean up temporary files', {
      error: error instanceof Error ? error.message : String(error),
    });
    captureException(error);
    // Don't exit - continue with startup even if cleanup fails
  }
}

// Detect FFmpeg capabilities at startup (cache for settings endpoint)
try {
  await detectFFmpegCapabilities();
} catch (error) {
  logger.error('[Startup] Failed to detect FFmpeg capabilities', {
    error: error instanceof Error ? error.message : String(error),
  });
  // Don't exit - continue with defaults if detection fails
}

// Initialize job processor (for standalone and leader instances)
// Follower instances don't run the job processor
let processor: JobProcessor | null = null;
export let followerExecutor: FollowerExecutor | null = null;
export let leaderDistributor: LeaderDistributor | null = null;

if (INSTANCE_TYPE === 'follower') {
  // Follower mode: Initialize follower executor
  try {
    followerExecutor = FollowerExecutor.getInstance({
      leaderUrl: LEADER_URL!,
      sharedToken: SHARED_TOKEN!,
      workerId: `follower-${PORT}`,
    });
    logger.info('[FollowerExecutor] Initialized', {
      workerId: `follower-${PORT}`,
      leaderUrl: LEADER_URL,
    });
  } catch (error) {
    logger.fatal('[FollowerExecutor] Failed to initialize', {
      error: error instanceof Error ? error.message : String(error),
    });
    captureException(error);
    process.exit(1);
  }
} else {
  // Standalone or Leader mode: Initialize job processor
  try {
    // If leader mode, create distributor and sync with followers
    if (INSTANCE_TYPE === 'leader') {
      leaderDistributor = new LeaderDistributor({
        followerUrls: FOLLOWER_URLS!.split(',').map((url) => url.trim()),
        sharedToken: SHARED_TOKEN!,
      });
      logger.info('[LeaderDistributor] Initialized', {
        followerCount: FOLLOWER_URLS!.split(',').length,
      });

      // Sync with followers before starting - this blocks until complete
      // so we know follower state before scheduling any jobs
      let activeJobIds: number[] = [];
      try {
        activeJobIds = await leaderDistributor.syncWithFollowers();
      } catch (error) {
        logger.error('[LeaderDistributor] Failed to sync with followers', {
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue anyway - some followers may still be reachable
      }

      // Create processor first
      processor = JobProcessor.getInstance({
        checkInterval: 60000, // Check every minute
        leaderDistributor: leaderDistributor ?? undefined,
      });

      // Sync active jobs from followers to processor
      if (activeJobIds.length > 0) {
        processor.syncActiveJobs(activeJobIds);
      }

      // Start periodic sync (every 4 hours) to detect recovered followers
      leaderDistributor.startPeriodicSync();
    } else {
      // Standalone mode
      processor = JobProcessor.getInstance({
        checkInterval: 60000, // Check every minute
        leaderDistributor: leaderDistributor ?? undefined,
      });
    }

    // Helper to broadcast follower status (leader mode only)
    const broadcastFollowerStatusIfLeader = () => {
      if (!leaderDistributor) return;

      const followerStatus = leaderDistributor.getFollowerStatus();
      const enrichedStatus = followerStatus.map((follower) => {
        let currentJob: { id: number; name: string; progress: number } | null =
          null;
        if (follower.currentJobId !== null) {
          const job = JobService.getById(follower.currentJobId);
          if (job) {
            currentJob = {
              id: job.id,
              name: job.name,
              progress: job.progress ?? 0,
            };
          }
        }
        return {
          id: follower.id,
          url: follower.url,
          busy: follower.busy,
          dead: follower.dead,
          currentJob,
        };
      });

      WSBroadcaster.broadcastFollowerStatus(enrichedStatus);
    };

    // Set up event listeners for job processor to broadcast via WebSocket
    processor.on('job:start', (job: Job) => {
      logger.info('[JobProcessor] Job started', { jobId: job.id });
      WSBroadcaster.broadcastJobUpdate(job);
      WSBroadcaster.broadcastStatusCounts(JobService.getStatusCounts());
      broadcastFollowerStatusIfLeader();
    });

    processor.on('job:progress', (job: Job, progress: any) => {
      logger.debug`[JobProcessor] Job ${job.id} progress: ${progress.progress}%`;
      WSBroadcaster.broadcastJobProgress(job.id, progress.progress, {
        frame: progress.frame,
        fps: progress.fps,
      });
      // Also broadcast follower status since job progress changed
      broadcastFollowerStatusIfLeader();
    });

    processor.on('job:complete', (job: Job) => {
      logger.info('[JobProcessor] Job completed', { jobId: job.id });
      WSBroadcaster.broadcastJobUpdate(job);
      WSBroadcaster.broadcastStatusCounts(JobService.getStatusCounts());
      broadcastFollowerStatusIfLeader();
    });

    processor.on('job:fail', (job: Job) => {
      logger.error('[JobProcessor] Job failed', {
        jobId: job.id,
        error: job.error,
      });
      WSBroadcaster.broadcastJobUpdate(job);
      WSBroadcaster.broadcastStatusCounts(JobService.getStatusCounts());
      broadcastFollowerStatusIfLeader();
    });

    // A Live Activity for the conversions and one for the disc ripper, when Hobwork is connected
    attachConvertActivity(processor, () => ({
      pending: JobService.getByStatus('pending').length,
      processing: JobService.getByStatus('processing').length,
    }));
    startDiscActivityWatcher();

    // Start the processor
    await processor.start();
    logger.info('[JobProcessor] Initialized and started', {
      mode: INSTANCE_TYPE,
    });
  } catch (error) {
    logger.fatal('[JobProcessor] Failed to initialize', {
      error: error instanceof Error ? error.message : String(error),
    });
    captureException(error);
    process.exit(1);
  }
}

// Run file selections cleanup on startup and schedule daily cleanup
// Only run on leader/standalone - followers don't manage file selections
if (INSTANCE_TYPE !== 'follower') {
  try {
    const deletedCount = FileSelectionService.cleanup();
    logger.info('[FileSelections] Cleanup complete', { deletedCount });

    // Run cleanup daily (every 24 hours)
    setInterval(
      () => {
        try {
          const count = FileSelectionService.cleanup();
          logger.info('[FileSelections] Daily cleanup', {
            deletedCount: count,
          });
        } catch (error) {
          logger.error('[FileSelections] Daily cleanup failed', {
            error: error instanceof Error ? error.message : String(error),
          });
          captureException(error);
        }
      },
      24 * 60 * 60 * 1000,
    );
  } catch (error) {
    logger.error('[FileSelections] Cleanup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    captureException(error);
  }

  // Handle any in-progress job creation batches that were interrupted
  try {
    await resumeInProgressBatches();
    logger.info('[JobCreation] In-progress batches handled');
  } catch (error) {
    logger.error('[JobCreation] Failed to handle in-progress batches', {
      error: error instanceof Error ? error.message : String(error),
    });
    captureException(error);
  }
}

// Create the HTTP server
const server = Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    // Looking for copies and reels compares the pictures of every extra, which takes longer than
    // the 10 seconds Bun waits for a reply by default.
    if (url.pathname === '/api/discs/extras/duplicates')
      server.timeout(req, 240);

    // Handle WebSocket upgrade
    if (url.pathname === '/api/ws') {
      const upgraded = server.upgrade(req);
      if (!upgraded) {
        logger.error('[WebSocket] Upgrade failed');
        return new Response('WebSocket upgrade failed', { status: 500 });
      }
      return undefined;
    }

    // Handle API routes and worker endpoints
    if (url.pathname.startsWith('/api') || url.pathname.startsWith('/worker')) {
      return setupRoutes(req);
    }

    // Serve static files for non-API routes
    return serveStatic(req, DIST_DIR);
  },
  websocket: setupWebSocket(),
});

logger.info('[Server] Started successfully', { port: PORT });

// Have the copies and reels of each movie's extras ready before the Discs page asks.
if (INSTANCE_TYPE !== 'follower') startWarming(discsDir());

// System status monitoring interval (10 seconds)
const SYSTEM_STATUS_INTERVAL = 10000;
let systemStatusIntervalId: NodeJS.Timeout | null = null;

// Start system status broadcasting (only on standalone/leader instances)
if (INSTANCE_TYPE !== 'follower') {
  // Determine node ID for local instance
  const localNodeId = INSTANCE_TYPE === 'leader' ? 'leader' : 'standalone';

  // Initial CPU sample (first call returns 0, this primes the calculation)
  collectSystemStatus(localNodeId);

  systemStatusIntervalId = setInterval(async () => {
    try {
      // Collect local system status
      const localStatus = collectSystemStatus(localNodeId);
      const nodes: NodeSystemStatus[] = [localStatus];

      // For leader mode, fetch follower statuses
      if (INSTANCE_TYPE === 'leader' && leaderDistributor) {
        const followerStatuses =
          await leaderDistributor.fetchFollowerSystemStatuses();

        // Store the follower statuses for the API endpoint
        for (const [followerId, status] of followerStatuses) {
          updateFollowerSystemStatus(followerId, status);
          nodes.push(status);
        }
      }

      // Broadcast system status via WebSocket
      WSBroadcaster.broadcastSystemStatus(INSTANCE_TYPE, nodes);

      logger.debug('[SystemStatus] Broadcasted status update', {
        instanceType: INSTANCE_TYPE,
        nodeCount: nodes.length,
      });
    } catch (error) {
      logger.error('[SystemStatus] Error collecting/broadcasting status', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, SYSTEM_STATUS_INTERVAL);

  logger.info('[SystemStatus] Monitoring started', {
    intervalMs: SYSTEM_STATUS_INTERVAL,
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('[Server] Shutting down (SIGINT)');
  if (systemStatusIntervalId) {
    clearInterval(systemStatusIntervalId);
  }
  if (processor) {
    processor.stop();
  }
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('[Server] Shutting down (SIGTERM)');
  if (systemStatusIntervalId) {
    clearInterval(systemStatusIntervalId);
  }
  if (processor) {
    processor.stop();
  }
  server.stop();
  process.exit(0);
});

// Catch unhandled errors
process.on('uncaughtException', (error) => {
  logger.fatal('[Process] Uncaught exception', {
    error: error.message,
    stack: error.stack,
  });
  captureException(error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal('[Process] Unhandled rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
  captureException(reason);
  process.exit(1);
});
