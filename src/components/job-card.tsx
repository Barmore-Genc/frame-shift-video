import { useState, useEffect } from 'react';
import { Job } from '@/types/database';
import { ConversionOptions } from '@/types/conversion';
import { formatDistanceToNow } from 'date-fns';
import Highlighter from 'react-highlight-words';
import {
  Circle,
  CircleDashed,
  CheckCircle,
  XCircle,
  Prohibit,
} from '@phosphor-icons/react';

interface JobCardProps {
  job: Job & { currentFrame?: number; currentFps?: number };
  onRetry?: (jobId: number) => void;
  onCancel?: (jobId: number) => void;
  /** Search words to highlight */
  searchWords?: string[];
  /** Whether this job is the active search match */
  isActiveMatch?: boolean;
}

const statusColors = {
  pending:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  completed:
    'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
};

const statusIcons: Record<Job['status'], React.ReactNode> = {
  pending: <Circle size={14} />,
  processing: <CircleDashed size={14} className="animate-spin-slow" />,
  completed: <CheckCircle size={14} />,
  failed: <XCircle size={14} />,
  cancelled: <Prohibit size={14} />,
};

export function JobCard({
  job,
  onRetry,
  onCancel,
  searchWords = [],
  isActiveMatch = false,
}: JobCardProps) {
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [showStats, setShowStats] = useState(false);
  const [showError, setShowError] = useState(false);
  const [showFullLog, setShowFullLog] = useState(false);
  const [copied, setCopied] = useState(false);

  // Parse config if available
  const config: ConversionOptions | null = job.config_json
    ? (() => {
        try {
          return JSON.parse(job.config_json);
        } catch {
          return null;
        }
      })()
    : null;

  // Update current time every second for ETA calculation
  useEffect(() => {
    if (job.status === 'processing' && job.start_time) {
      const interval = setInterval(() => {
        setCurrentTime(Date.now());
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [job.status, job.start_time]);

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return 'Unknown time';
    }
  };

  const formatDuration = (milliseconds: number) => {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours} h ${minutes % 60} m`;
    } else if (minutes > 0) {
      return `${minutes} m ${seconds % 60} s`;
    } else {
      return `${seconds} s`;
    }
  };

  const calculateETA = () => {
    if (!job.start_time || job.progress <= 0 || job.progress >= 100) {
      return null;
    }

    const startTime = new Date(job.start_time).getTime();
    const elapsed = currentTime - startTime;
    const estimatedTotal = (elapsed / job.progress) * 100;
    const remaining = estimatedTotal - elapsed;

    return remaining > 0 ? remaining : 0;
  };

  const getElapsedTime = () => {
    if (!job.start_time) return null;
    const startTime = new Date(job.start_time).getTime();
    const endTime = job.end_time
      ? new Date(job.end_time).getTime()
      : currentTime;
    return endTime - startTime;
  };

  const getAverageFps = () => {
    if (!job.total_frames || !job.start_time || !job.end_time) return null;
    const startTime = new Date(job.start_time).getTime();
    const endTime = new Date(job.end_time).getTime();
    const durationSeconds = (endTime - startTime) / 1000;
    return durationSeconds > 0 ? job.total_frames / durationSeconds : 0;
  };

  const getFFmpegCommand = (): string | null => {
    if (!job.ffmpeg_command_json) return null;
    try {
      const parsed = JSON.parse(job.ffmpeg_command_json) as {
        args: string[];
        inputPath: string;
        outputPath: string;
      };
      // Reconstruct the command from args, properly quoting args with spaces
      const quotedArgs = parsed.args.map((arg) =>
        arg.includes(' ') ? `"${arg}"` : arg,
      );
      return `ffmpeg ${quotedArgs.join(' ')}`;
    } catch {
      return null;
    }
  };

  const getDisplayStatus = () => {
    if (job.status === 'failed' && job.retried) {
      return 'Failed, Retried';
    }
    return job.status.charAt(0).toUpperCase() + job.status.slice(1);
  };

  const handleRetry = async () => {
    if (!onRetry) return;
    setRetrying(true);
    try {
      await onRetry(job.id);
    } finally {
      setRetrying(false);
    }
  };

  const handleCancel = async () => {
    if (!onCancel) return;
    setCancelling(true);
    try {
      await onCancel(job.id);
    } finally {
      setCancelling(false);
    }
  };

  const handleCopyForAI = async () => {
    const prompt = `The following error happened when using Frame Shift Video, an app that runs ffmpeg to convert video files. Please look at the error, and explain briefly why the error happened, and what could be changed to fix the error. You can tell me to retry the conversion. If I need to add custom ffmpeg command line options, please tell me to open "Custom FFmpeg Options" in the "Configure Conversion" page and paste the options you suggest. These options will get appended to the end during the retry. If you suspect there may be an issue with the video file itself, then explain your reasoning why. If you believe the video file is okay, do not reference this at all.

\`\`\`
${job.error_message}
\`\`\``;

    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-lg border ${
        isActiveMatch
          ? 'border-blue-500 dark:border-blue-400 ring-2 ring-blue-200 dark:ring-blue-900/50'
          : 'border-gray-200 dark:border-gray-700'
      } p-4 shadow hover:shadow-md transition-all duration-200`}
    >
      {/* Header: Status, File Path, and Config */}
      <div className="flex items-start gap-3 mb-2">
        <span
          className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${statusColors[job.status]} flex-shrink-0`}
        >
          <span className="mr-1">{statusIcons[job.status]}</span>
          {getDisplayStatus()}
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-mono text-gray-900 dark:text-white break-all">
            {searchWords.length > 0 ? (
              <Highlighter
                searchWords={searchWords}
                autoEscape={true}
                textToHighlight={job.input_file}
                highlightClassName={
                  isActiveMatch
                    ? 'bg-blue-400 dark:bg-blue-600 text-white'
                    : 'bg-yellow-200 dark:bg-yellow-700'
                }
              />
            ) : (
              job.input_file
            )}
          </p>

          {/* Configuration display */}
          {config && (
            <div className="flex flex-wrap gap-2 mt-1 text-xs text-gray-600 dark:text-gray-400">
              <span className="inline-flex items-center gap-1">
                <span className="font-medium">Codec:</span>
                {config.basic.videoCodec}
                {config.advanced.bitDepth === '10bit' &&
                  config.basic.videoCodec !== 'copy' &&
                  ' (10-bit)'}
              </span>
              <span className="text-gray-400 dark:text-gray-600">•</span>
              <span className="inline-flex items-center gap-1">
                <span className="font-medium">Quality:</span>
                {config.basic.quality}
              </span>
              <span className="text-gray-400 dark:text-gray-600">•</span>
              <span className="inline-flex items-center gap-1">
                <span className="font-medium">Format:</span>
                {config.basic.outputFormat}
              </span>
              <span className="text-gray-400 dark:text-gray-600">•</span>
              <span className="inline-flex items-center gap-1">
                <span className="font-medium">Preset:</span>
                {config.advanced.preset}
              </span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {job.queue_position !== null && job.status === 'pending' && (
            <span className="text-xs text-gray-500 dark:text-gray-400 px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded">
              #{job.queue_position}
            </span>
          )}
          {(job.status === 'failed' || job.status === 'cancelled') &&
            !job.retried &&
            onRetry && (
              <button
                onClick={handleRetry}
                disabled={retrying}
                className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-xs font-medium transition-colors"
              >
                {retrying ? 'Retrying...' : 'Retry'}
              </button>
            )}
          {(job.status === 'pending' || job.status === 'processing') &&
            onCancel && (
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-xs font-medium transition-colors"
              >
                {cancelling ? 'Cancelling...' : 'Cancel'}
              </button>
            )}
        </div>
      </div>

      {/* Progress bar for processing jobs */}
      {job.status === 'processing' && (
        <div className="mb-2">
          {job.progress < 0 ? (
            <div className="text-xs text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 p-2 rounded">
              Unable to calculate progress
            </div>
          ) : (
            <div>
              <div className="flex gap-3 mb-1 text-xs text-gray-600 dark:text-gray-400">
                <span>{job.progress.toFixed(1)}%</span>
                {calculateETA() !== null && (
                  <span>ETA: {formatDuration(calculateETA()!)}</span>
                )}
                {job.currentFps !== undefined && job.currentFps > 0 && (
                  <span>{job.currentFps.toFixed(1)} fps</span>
                )}
              </div>
              <div className="bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${job.progress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Collapsible stats for completed jobs */}
      {job.status === 'completed' && job.progress >= 0 && (
        <div className="mb-2">
          <button
            type="button"
            onClick={() => setShowStats(!showStats)}
            className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 flex items-center gap-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded px-1"
          >
            <span>{showStats ? '▼' : '▶'}</span>
            <span>Conversion Details</span>
          </button>
          {showStats && (
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-400 pl-4">
              <div className="flex gap-3">
                {getElapsedTime() !== null && (
                  <span>
                    <span className="font-medium">Time:</span>{' '}
                    {formatDuration(getElapsedTime()!)}
                  </span>
                )}
                {getAverageFps() !== null && (
                  <span>
                    <span className="font-medium">Avg:</span>{' '}
                    {getAverageFps()!.toFixed(1)} fps
                  </span>
                )}
              </div>
              {getFFmpegCommand() && (
                <div className="mt-2">
                  <span className="font-medium">FFmpeg Command:</span>
                  <pre className="mt-1 text-xs text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-900 p-2 rounded overflow-x-auto whitespace-pre-wrap break-all font-mono">
                    {getFFmpegCommand()}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Collapsible error for failed jobs */}
      {job.error_message && (
        <div className="mb-2">
          <button
            type="button"
            onClick={() => setShowError(!showError)}
            className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 flex items-center gap-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 rounded px-1"
          >
            <span>{showError ? '▼' : '▶'}</span>
            <span>Error Details</span>
          </button>
          {showError && (
            <div className="mt-1">
              <div className="mb-2">
                <button
                  type="button"
                  onClick={handleCopyForAI}
                  title="If you need help, click this button and paste the output to an AI agent to get suggestions on how to fix the issue"
                  className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 text-xs font-medium transition-colors"
                >
                  {copied ? 'Copied!' : 'Copy for AI'}
                </button>
              </div>
              <pre className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 p-2 rounded font-mono whitespace-pre overflow-x-auto">
                {job.error_message}
              </pre>
              {getFFmpegCommand() && (
                <div className="mt-2">
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                    FFmpeg Command:
                  </span>
                  <pre className="mt-1 text-xs text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-900 p-2 rounded overflow-x-auto whitespace-pre-wrap break-all font-mono">
                    {getFFmpegCommand()}
                  </pre>
                </div>
              )}
              {job.ffmpeg_stderr && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setShowFullLog(!showFullLog)}
                    className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 flex items-center gap-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-1 rounded px-1"
                  >
                    <span>{showFullLog ? '▼' : '▶'}</span>
                    <span>Full FFmpeg Log</span>
                  </button>
                  {showFullLog && (
                    <pre className="text-xs text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-900 p-2 rounded mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono">
                      {job.ffmpeg_stderr}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer: timestamps */}
      <div className="flex justify-between items-center text-xs text-gray-500 dark:text-gray-500 pt-2 border-t border-gray-200 dark:border-gray-700">
        <span>{formatDate(job.created_at)}</span>
        <span>{formatDate(job.updated_at)}</span>
      </div>
    </div>
  );
}
