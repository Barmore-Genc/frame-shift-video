/**
 * FFmpeg command execution with progress tracking and error handling
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs/promises';
import { FFmpegCommand, validateFFmpegCommand } from './ffmpeg-command';
import { getTempFilePath } from '../../server/temp-file-service';

/**
 * Get the ffmpeg binary path
 * Can be overridden with FFMPEG_BIN_PATH environment variable
 */
function getFfmpeg(): string {
  return process.env.FFMPEG_BIN_PATH || 'ffmpeg';
}

/**
 * Get the ffprobe binary path
 * Can be overridden with FFPROBE_BIN_PATH environment variable
 */
function getFfprobe(): string {
  return process.env.FFPROBE_BIN_PATH || 'ffprobe';
}

/**
 * Quote a command argument if it contains spaces or special shell characters
 * This is for display purposes to avoid confusing users/AI, even though we don't use shell execution
 */
function quoteArgIfNeeded(arg: string): string {
  // Check if argument contains spaces or special shell characters
  const needsQuoting = /[ \t\n*?[\]{}$&|;<>()\\"`!]/.test(arg);

  if (needsQuoting) {
    // Escape single quotes by replacing ' with '\''
    const escaped = arg.replace(/'/g, "'\\''");
    return `'${escaped}'`;
  }

  return arg;
}

/**
 * Progress information parsed from FFmpeg output
 */
export interface FFmpegProgress {
  /** Current frame being processed */
  frame: number;
  /** Frames per second during processing */
  fps: number;
  /** Quality metric (if available) */
  q: number;
  /** Output file size in bytes */
  size: number;
  /** Processing time elapsed */
  time: string;
  /** Bitrate of output */
  bitrate: string;
  /** Processing speed relative to realtime */
  speed: string;
  /** Progress percentage (0-100) */
  progress: number;
}

/**
 * Successful FFmpeg execution result
 */
export interface FFmpegSuccess {
  success: true;
  /** Output file path (temporary file path that needs to be renamed) */
  outputPath: string;
  /** Temporary file path (same as outputPath for now, kept for clarity) */
  tempPath: string;
  /** Final target path where file should be renamed to */
  finalPath: string;
  /** Final progress information */
  finalProgress?: FFmpegProgress;
  /** Full stderr output for debugging */
  stderr: string;
  /** Exit code */
  exitCode: number;
  /** Full ffprobe output for debugging */
  ffprobeOutput: string;
  /** The FFmpeg command that was executed */
  command: string;
}

/**
 * Failed FFmpeg execution result
 */
export interface FFmpegFailure {
  success: false;
  /** Error message */
  error: string;
  /** Temporary file path that needs to be cleaned up (if it exists) */
  tempPath: string;
  /** Full stderr output for debugging */
  stderr: string;
  /** Exit code (null if process failed to start) */
  exitCode: number | null;
  /** Signal that killed ffmpeg (for example SIGSEGV), if any */
  exitSignal?: string | null;
  /** Partial progress information if available */
  finalProgress?: FFmpegProgress;
  /** Full ffprobe output for debugging */
  ffprobeOutput: string;
  /** The FFmpeg command that was executed */
  command: string;
}

/** Signals that mean ffmpeg itself crashed, as opposed to being cancelled */
const CRASH_SIGNALS = new Set([
  'SIGSEGV',
  'SIGILL',
  'SIGBUS',
  'SIGABRT',
  'SIGFPE',
]);

/**
 * FFmpeg execution result as discriminated union
 */
export type FFmpegResult = FFmpegSuccess | FFmpegFailure;

/**
 * FFmpeg execution options
 */
export interface FFmpegExecutionOptions {
  /**
   * Base directory for uploads (legacy, not used)
   * @deprecated No longer used - file paths are absolute
   */
  uploadsDir?: string;
  /**
   * Base directory for outputs (legacy, not used)
   * @deprecated No longer used - output paths are absolute
   */
  outputsDir?: string;
  /** Enable dry run mode (for testing) */
  dryRun?: boolean;
  /** Timeout in milliseconds (optional, no timeout if not specified) */
  timeout?: number;
}

/**
 * FFmpeg executor with progress tracking
 */
export class FFmpegExecutor extends EventEmitter {
  private process: ChildProcess | null = null;
  private killed = false;
  private options: FFmpegExecutionOptions;
  private inputDuration: number | null = null; // Duration in seconds
  private ffprobeOutput = ''; // Store comprehensive ffprobe output

  constructor(options: FFmpegExecutionOptions) {
    super();
    this.options = options;
  }

  /**
   * Execute an FFmpeg command with progress tracking
   */
  async execute(command: FFmpegCommand): Promise<FFmpegResult> {
    const result = await this.executeOnce(command, false);
    if (
      result.success ||
      this.killed ||
      !result.exitSignal ||
      !CRASH_SIGNALS.has(result.exitSignal)
    ) {
      return result;
    }

    // ffmpeg itself crashed (not an ordinary error exit). Encoder crashes can
    // depend on threading, so try once more with conservative threading
    // before giving up.
    console.warn(
      `FFmpeg crashed (${result.exitSignal}); retrying once with reduced threading`,
    );
    await fs.rm(result.tempPath, { force: true });
    const retry = await this.executeOnce(command, true);
    if (retry.success) return retry;
    return {
      ...retry,
      error: `${retry.error} (first attempt: ${result.exitSignal}; retried with reduced threading)`,
    };
  }

  private async executeOnce(
    command: FFmpegCommand,
    safeMode: boolean,
  ): Promise<FFmpegResult> {
    // Validate command for security
    validateFFmpegCommand(command);

    // Input and output paths should already be absolute
    const inputPath = command.inputPath;
    const finalOutputPath = command.outputPath;

    // Generate temporary file path for the conversion
    const tempOutputPath = getTempFilePath(finalOutputPath);

    // Get comprehensive ffprobe output for debugging
    this.ffprobeOutput = await this.getComprehensiveFfprobeOutput(inputPath);

    // Get input video duration for accurate progress calculation
    this.inputDuration = await this.getVideoDuration(inputPath);

    // Ensure output directory exists
    const outputDir = path.dirname(finalOutputPath);
    await fs.mkdir(outputDir, { recursive: true });

    // Prepare command arguments
    const args = [...command.args.slice(1)]; // Remove 'ffmpeg' from start

    // Replace relative paths with absolute paths in args
    // Use tempOutputPath instead of final outputPath
    const processedArgs = args.map((arg, index) => {
      if (args[index - 1] === '-i') {
        return inputPath;
      }
      if (index === args.length - 1 && !arg.startsWith('-')) {
        return tempOutputPath; // Write to temp file
      }
      return arg;
    });

    // Apply thread limiting if configured
    // FFmpeg requires -threads in two places for full control:
    // - Before -i: limits decoder threads
    // - After -i: limits encoder threads
    const decoderThreads = process.env.FFMPEG_DECODER_THREADS;
    const encoderThreads = process.env.FFMPEG_ENCODER_THREADS;

    if (decoderThreads || encoderThreads) {
      const inputFlagIndex = processedArgs.indexOf('-i');

      // Insert encoder threads AFTER the input file
      if (
        encoderThreads &&
        inputFlagIndex !== -1 &&
        inputFlagIndex + 1 < processedArgs.length
      ) {
        const threads = parseInt(encoderThreads, 10);
        processedArgs.splice(
          inputFlagIndex + 2,
          0,
          '-threads',
          threads.toString(),
        );
      }

      // Insert decoder threads BEFORE -i (at the beginning)
      if (decoderThreads) {
        const threads = parseInt(decoderThreads, 10);
        processedArgs.unshift('-threads', threads.toString());
      }
    }

    // Crash retry: limit threads, and for x265 also limit its worker pool and
    // frames in flight. Inserted right after the input file.
    if (safeMode) {
      const inputFlagIndex = processedArgs.lastIndexOf('-i');
      if (inputFlagIndex !== -1) {
        const extra = ['-threads', '2'];
        if (processedArgs.includes('libx265')) {
          extra.push('-x265-params', 'pools=2:frame-threads=1');
        }
        processedArgs.splice(inputFlagIndex + 2, 0, ...extra);
      }
    }

    // Add dry run flag for testing
    if (this.options.dryRun) {
      processedArgs.unshift('-f', 'null');
      // Replace output with null device for dry run
      const lastArgIndex = processedArgs.length - 1;
      processedArgs[lastArgIndex] = '-';
    }

    // Store the full command that will be executed for error reporting
    // Quote arguments that contain spaces or special characters for clarity
    const quotedArgs = processedArgs.map(quoteArgIfNeeded);
    const fullCommand = `${getFfmpeg()} ${quotedArgs.join(' ')}`;

    this.emit('start', { command: command.displayCommand });

    return new Promise((resolve) => {
      let stderr = '';
      let lastProgress: FFmpegProgress | undefined;
      let progressBuffer = ''; // Accumulate progress data across chunks
      let stdoutEnded = false;
      let stderrEnded = false;
      let processExited = false;
      let exitCode: number | null = null;
      let exitSignal: NodeJS.Signals | null = null;

      // Spawn FFmpeg process
      this.process = spawn(getFfmpeg(), processedArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });

      // Helper to check if we can resolve
      const tryResolve = () => {
        // Only resolve when process has exited AND both streams have ended
        if (!processExited || !stdoutEnded || !stderrEnded) {
          return;
        }

        if (timeoutId) clearTimeout(timeoutId);
        this.process = null;

        if (this.killed) {
          resolve({
            success: false,
            error: 'FFmpeg execution was cancelled',
            tempPath: tempOutputPath,
            stderr,
            exitCode: exitCode,
            finalProgress: lastProgress,
            ffprobeOutput: this.ffprobeOutput,
            command: fullCommand,
          });
          return;
        }

        if (exitCode === 0) {
          resolve({
            success: true,
            outputPath: this.options.dryRun ? 'dry-run-output' : tempOutputPath,
            tempPath: tempOutputPath,
            finalPath: finalOutputPath,
            finalProgress: lastProgress,
            stderr,
            exitCode: exitCode,
            ffprobeOutput: this.ffprobeOutput,
            command: fullCommand,
          });
        } else {
          resolve({
            success: false,
            error: exitSignal
              ? `FFmpeg failed with exit code ${exitCode} (killed by signal ${exitSignal})`
              : `FFmpeg failed with exit code ${exitCode}`,
            tempPath: tempOutputPath,
            stderr,
            exitCode: exitCode,
            exitSignal,
            finalProgress: lastProgress,
            ffprobeOutput: this.ffprobeOutput,
            command: fullCommand,
          });
        }

        this.emit('complete', { success: exitCode === 0, exitCode: exitCode });
      };

      // Set up timeout (only if specified)
      const timeoutId = this.options.timeout
        ? setTimeout(() => {
            this.kill();
            resolve({
              success: false,
              error: 'FFmpeg execution timed out',
              tempPath: tempOutputPath,
              stderr,
              exitCode: null,
              finalProgress: lastProgress,
              ffprobeOutput: this.ffprobeOutput,
              command: fullCommand,
            });
          }, this.options.timeout)
        : null;

      // Parse progress from stdout
      this.process.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        progressBuffer += output;
        const progress = this.parseProgress(progressBuffer);
        if (progress) {
          lastProgress = progress;
          this.emit('progress', progress);
          // Clear the buffer after successful parsing to avoid duplicate progress
          progressBuffer = '';
        }
      });

      // Track when stdout ends
      this.process.stdout?.on('end', () => {
        stdoutEnded = true;
        tryResolve();
      });

      // Capture stderr for error reporting
      this.process.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Track when stderr ends
      this.process.stderr?.on('end', () => {
        stderrEnded = true;
        tryResolve();
      });

      // Handle process completion
      this.process.on('close', (code, signal) => {
        processExited = true;
        exitCode = code;
        exitSignal = signal;
        tryResolve();
      });

      // Handle process errors
      this.process.on('error', (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        this.process = null;
        resolve({
          success: false,
          error: `Failed to start FFmpeg: ${error.message}`,
          tempPath: tempOutputPath,
          stderr,
          exitCode: null,
          finalProgress: lastProgress,
          ffprobeOutput: this.ffprobeOutput,
          command: fullCommand,
        });
      });
    });
  }

  /**
   * Kill the running FFmpeg process
   */
  kill(): void {
    if (this.process && !this.killed) {
      this.killed = true;
      this.process.kill('SIGTERM');

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 5000);
    }
  }

  /**
   * Get comprehensive ffprobe output for debugging and error reporting
   */
  private async getComprehensiveFfprobeOutput(
    inputPath: string,
  ): Promise<string> {
    return new Promise((resolve) => {
      const ffprobe = spawn(
        getFfprobe(),
        [
          '-v',
          'quiet',
          '-print_format',
          'json',
          '-show_format',
          '-show_streams',
          '-show_error',
          inputPath,
        ],
        {
          env: process.env,
        },
      );

      let output = '';
      let errorOutput = '';

      ffprobe.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      ffprobe.stderr?.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code === 0 && output.trim()) {
          resolve(output);
        } else {
          resolve(
            `FFprobe failed with exit code ${code}\nStderr: ${errorOutput}\nStdout: ${output}`,
          );
        }
      });

      ffprobe.on('error', (error) =>
        resolve(`FFprobe error: ${error.message}`),
      );
    });
  }

  /**
   * Get video duration in seconds using ffprobe
   */
  private async getVideoDuration(inputPath: string): Promise<number | null> {
    return new Promise((resolve) => {
      const ffprobe = spawn(
        getFfprobe(),
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          inputPath,
        ],
        {
          env: process.env,
        },
      );

      let output = '';
      ffprobe.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code === 0 && output.trim()) {
          const duration = parseFloat(output.trim());
          resolve(isNaN(duration) ? null : duration);
        } else {
          resolve(null);
        }
      });

      ffprobe.on('error', () => resolve(null));
    });
  }

  /**
   * Get subtitle codec formats from the input file using ffprobe
   * Returns array of codec names for all subtitle streams (e.g., ['ass', 'srt', 'subrip'])
   */
  private async getSubtitleFormats(inputPath: string): Promise<string[]> {
    return new Promise((resolve) => {
      const ffprobe = spawn(
        getFfprobe(),
        [
          '-v',
          'error',
          '-select_streams',
          's',
          '-show_entries',
          'stream=codec_name',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          inputPath,
        ],
        {
          env: process.env,
        },
      );

      let output = '';
      ffprobe.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code === 0 && output.trim()) {
          // Parse codec names from output (one per line)
          const codecs = output
            .trim()
            .split('\n')
            .map((line) => line.trim().toLowerCase())
            .filter((line) => line.length > 0);
          resolve(codecs);
        } else {
          // No subtitle streams or error - return empty array
          resolve([]);
        }
      });

      ffprobe.on('error', () => resolve([]));
    });
  }

  /**
   * Convert time string (HH:MM:SS.ms or MM:SS.ms) to seconds
   */
  private timeToSeconds(timeStr: string): number {
    const parts = timeStr.split(':');
    if (parts.length === 3) {
      // HH:MM:SS.ms
      const [hours, minutes, seconds] = parts;
      return (
        parseInt(hours, 10) * 3600 +
        parseInt(minutes, 10) * 60 +
        parseFloat(seconds)
      );
    } else if (parts.length === 2) {
      // MM:SS.ms
      const [minutes, seconds] = parts;
      return parseInt(minutes, 10) * 60 + parseFloat(seconds);
    } else {
      // Just seconds
      return parseFloat(timeStr);
    }
  }

  /**
   * Parse progress information from FFmpeg output
   * Handles both stderr format (time=, size=, q=) and progress pipe format (out_time=, total_size=, stream_0_0_q=)
   */
  private parseProgress(output: string): FFmpegProgress | null {
    const lines = output.split('\n');
    const progressData: Partial<FFmpegProgress> = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('frame=')) {
        const match = trimmed.match(/frame=\s*(\d+)/);
        if (match) progressData.frame = parseInt(match[1], 10);
      } else if (trimmed.startsWith('fps=')) {
        const match = trimmed.match(/fps=\s*([\d.]+)/);
        if (match) progressData.fps = parseFloat(match[1]);
      } else if (trimmed.startsWith('q=')) {
        // stderr format: q=28.0
        const match = trimmed.match(/q=\s*([\d.-]+)/);
        if (match) progressData.q = parseFloat(match[1]);
      } else if (trimmed.startsWith('stream_0_0_q=')) {
        // progress pipe format: stream_0_0_q=34.2
        const match = trimmed.match(/stream_0_0_q=\s*([\d.-]+)/);
        if (match) progressData.q = parseFloat(match[1]);
      } else if (trimmed.startsWith('size=')) {
        // stderr format: size=1024kB
        const match = trimmed.match(/size=\s*(\d+)kB/);
        if (match) progressData.size = parseInt(match[1], 10) * 1024;
      } else if (trimmed.startsWith('total_size=')) {
        // progress pipe format: total_size=262144
        const match = trimmed.match(/total_size=\s*(\d+)/);
        if (match) progressData.size = parseInt(match[1], 10);
      } else if (trimmed.startsWith('time=')) {
        // stderr format: time=00:00:04.00
        const match = trimmed.match(/time=\s*([\d:.]+)/);
        if (match) progressData.time = match[1];
      } else if (trimmed.startsWith('out_time=')) {
        // progress pipe format: out_time=00:00:04.170833
        const match = trimmed.match(/out_time=\s*([\d:.]+)/);
        if (match) progressData.time = match[1];
      } else if (trimmed.startsWith('bitrate=')) {
        // Both formats: bitrate=502.8kbits/s or bitrate=N/A
        const match = trimmed.match(/bitrate=\s*([\d.]+kbits\/s|N\/A)/);
        if (match) progressData.bitrate = match[1];
      } else if (trimmed.startsWith('speed=')) {
        // Both formats: speed=4.13x or speed=N/A
        const match = trimmed.match(/speed=\s*([\d.]+x|N\/A)/);
        if (match) progressData.speed = match[1];
      }
    }

    // Only return progress if we have essential fields
    if (
      progressData.frame !== undefined &&
      progressData.time &&
      progressData.time !== 'N/A'
    ) {
      // Calculate accurate progress percentage using duration
      let progress = -1; // Indicate unknown progress if duration unavailable
      if (this.inputDuration && this.inputDuration > 0) {
        const currentSeconds = this.timeToSeconds(progressData.time);
        progress = Math.min((currentSeconds / this.inputDuration) * 100, 100);
        progress = Math.round(progress * 10) / 10; // Round to 1 decimal place
      }

      return {
        frame: progressData.frame,
        fps: progressData.fps || 0,
        q: progressData.q || 0,
        size: progressData.size || 0,
        time: progressData.time,
        bitrate: progressData.bitrate || '0kbits/s',
        speed: progressData.speed || '0x',
        progress,
      };
    }

    return null;
  }
}

/**
 * Get subtitle codec formats from a video file using ffprobe
 * Returns array of codec names for all subtitle streams (e.g., ['ass', 'srt', 'subrip'])
 */
export async function getSubtitleFormats(inputPath: string): Promise<string[]> {
  return new Promise((resolve) => {
    const ffprobe = spawn(
      getFfprobe(),
      [
        '-v',
        'error',
        '-select_streams',
        's',
        '-show_entries',
        'stream=codec_name',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        inputPath,
      ],
      {
        env: process.env,
      },
    );

    let output = '';
    ffprobe.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code === 0 && output.trim()) {
        // Parse codec names from output (one per line)
        const codecs = output
          .trim()
          .split('\n')
          .map((line) => line.trim().toLowerCase())
          .filter((line) => line.length > 0);
        resolve(codecs);
      } else {
        // No subtitle streams or error - return empty array
        resolve([]);
      }
    });

    ffprobe.on('error', () => resolve([]));
  });
}

/**
 * Video stream info for determining which streams are attached pictures
 */
export interface VideoStreamInfo {
  /** Index within video streams only (0 = first video, 1 = second video, etc.) */
  videoIndex: number;
  /** Whether this stream is an attached picture (cover art, thumbnail) */
  isAttachedPic: boolean;
}

/**
 * Get information about all video streams in a file
 * Returns array of video stream info, ordered by their appearance in the file
 * The videoIndex corresponds to FFmpeg's -c:v:N stream specifier
 */
export async function getVideoStreamInfo(
  inputPath: string,
): Promise<VideoStreamInfo[]> {
  return new Promise((resolve) => {
    const ffprobe = spawn(
      getFfprobe(),
      [
        '-v',
        'error',
        '-select_streams',
        'v',
        '-show_entries',
        'stream=index:stream_disposition=attached_pic',
        '-of',
        'json',
        inputPath,
      ],
      {
        env: process.env,
      },
    );

    let output = '';
    ffprobe.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code === 0 && output.trim()) {
        try {
          const data = JSON.parse(output);
          const streams = data.streams || [];
          // Map each video stream to its info
          // The order from ffprobe with -select_streams v gives us the video stream order
          const videoStreams: VideoStreamInfo[] = streams.map(
            (
              stream: { disposition?: { attached_pic?: number } },
              idx: number,
            ) => ({
              videoIndex: idx,
              isAttachedPic: stream.disposition?.attached_pic === 1,
            }),
          );
          resolve(videoStreams);
        } catch {
          resolve([]);
        }
      } else {
        resolve([]);
      }
    });

    ffprobe.on('error', () => resolve([]));
  });
}

/**
 * Utility function to execute a single FFmpeg command
 */
export async function executeFFmpegCommand(
  command: FFmpegCommand,
  options: FFmpegExecutionOptions,
): Promise<FFmpegResult> {
  const executor = new FFmpegExecutor(options);
  return executor.execute(command);
}

/**
 * Execute multiple FFmpeg commands sequentially
 */
export async function executeFFmpegCommands(
  commands: FFmpegCommand[],
  options: FFmpegExecutionOptions,
  onProgress?: (commandIndex: number, progress: FFmpegProgress) => void,
): Promise<FFmpegResult[]> {
  const results: FFmpegResult[] = [];

  for (let i = 0; i < commands.length; i++) {
    const command = commands[i];
    const executor = new FFmpegExecutor(options);

    if (onProgress) {
      executor.on('progress', (progress) => onProgress(i, progress));
    }

    const result = await executor.execute(command);
    results.push(result);

    // Stop on first failure unless in dry run mode
    if (!result.success && !options.dryRun) {
      break;
    }
  }

  return results;
}
