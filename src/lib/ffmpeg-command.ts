/**
 * FFmpeg command generation utility with secure argument handling
 */

import path from 'path';
import {
  ConversionOptions,
  AudioCodec,
  AudioQuality,
  VideoCodec,
  BitDepth,
} from '@/types/conversion';

/**
 * Get FFmpeg audio encoding arguments based on codec and quality preset
 *
 * VBR support by codec:
 * - AAC: Full VBR support using -q:a (0.1-2 scale, lower = better)
 * - Opus: VBR by default, uses -compression_level (0-10, 0 = best quality)
 * - AC3: CBR only, uses specific bitrates
 * - FLAC: Lossless, no bitrate/quality settings needed
 */
function getAudioQualityArgs(
  codec: AudioCodec,
  quality: AudioQuality,
): string[] {
  switch (codec) {
    case 'aac':
      // AAC VBR quality scale: 0.1-2 (lower = higher quality)
      const aacQuality = { low: '2', medium: '1.5', high: '1' }[quality];
      return ['-q:a', aacQuality];

    case 'libopus':
      // Opus: VBR is default, compression_level 0-10 (0 = best quality, slowest)
      const opusLevel = { low: '10', medium: '5', high: '0' }[quality];
      return ['-compression_level', opusLevel];

    case 'ac3':
      // AC3: CBR only, use standard bitrates
      // These work well for both stereo and 5.1 content
      const ac3Bitrate = { low: '384k', medium: '448k', high: '640k' }[quality];
      return ['-b:a', ac3Bitrate];

    case 'flac':
      // FLAC: Lossless, no bitrate settings - just use default compression
      return [];

    case 'copy':
      // Copy mode: no additional settings
      return [];

    default:
      return [];
  }
}

/**
 * Pixel format mapping for bit depth and codec combinations
 * Maps codec and bit depth to the appropriate FFmpeg pixel format
 */
const pixelFormats: Record<VideoCodec, Record<BitDepth, string>> = {
  libx265: { '8bit': 'yuv420p', '10bit': 'yuv420p10le' },
  libx264: { '8bit': 'yuv420p', '10bit': 'yuv420p10le' }, // Note: requires 10-bit libx264 build
  libsvtav1: { '8bit': 'yuv420p', '10bit': 'yuv420p10le' },
  copy: { '8bit': '', '10bit': '' }, // No pixel format for copy
};

/**
 * Video stream info for codec assignment
 */
export interface VideoStreamInfo {
  /** Index within video streams only (0 = first video, 1 = second video, etc.) */
  videoIndex: number;
  /** Whether this stream is an attached picture (cover art, thumbnail) */
  isAttachedPic: boolean;
}

/**
 * Individual FFmpeg job configuration for a single file
 */
export interface FFmpegJobConfig {
  /** Input file path (relative to uploads directory) */
  inputFile: string;
  /** Output file path (relative to outputs directory) */
  outputFile: string;
  /** Conversion options */
  options: ConversionOptions;
  /** Job name for display */
  jobName: string;
  /** Detected subtitle codec formats from source file (e.g., ['ass', 'srt']) */
  subtitleCodecs?: string[];
  /** Information about video streams (which are attached pictures vs main video) */
  videoStreams?: VideoStreamInfo[];
}

/**
 * Generated FFmpeg command with metadata
 */
export interface FFmpegCommand {
  /** Complete FFmpeg command as array (safer than string) */
  args: string[];
  /** Human-readable command string for display */
  displayCommand: string;
  /** Input file path */
  inputPath: string;
  /** Output file path */
  outputPath: string;
  /** Job configuration */
  config: FFmpegJobConfig;
}

/**
 * Validate and sanitize a file path argument
 *
 * Since we use spawn() with an array of arguments (not shell execution),
 * shell metacharacters are inherently safe and don't need to be blocked.
 * We only need to prevent:
 * - Null bytes (can cause issues with C string handling)
 * - Path traversal (security concern for filesystem access)
 */
function escapeFilePath(filePath: string): string {
  // Remove any null bytes (security)
  const cleaned = filePath.replace(/\0/g, '');

  // Validate path structure - prevent path traversal
  // Check if ".." appears as a path segment (not just anywhere in the filename)
  const segments = cleaned.split(/[/\\]/);
  if (segments.some((segment) => segment === '..')) {
    console.error(
      '[FFmpeg Command] Invalid file path - path traversal detected:',
      filePath,
    );
    throw new Error('Path traversal not allowed', { cause: { filePath } });
  }

  // Allow absolute paths (needed for server-local files)
  return cleaned;
}

/**
 * Validate and escape a generic FFmpeg argument
 *
 * Note: Since we use spawn() with an array of arguments (not shell execution),
 * shell metacharacters are inherently safe. We only sanitize null bytes.
 */
function escapeArgument(arg: string | number): string {
  const str = String(arg);

  // Remove null bytes (the only real threat in array-based spawn)
  const cleaned = str.replace(/\0/g, '');

  return cleaned;
}

/**
 * Generate output filename with proper extension
 * Places the output file in the same directory as the source file
 */
function generateOutputFileName(inputFile: string, format: string): string {
  const parsed = path.parse(inputFile);
  return path.join(parsed.dir, `${parsed.name}_converted.${format}`);
}

/**
 * Build FFmpeg arguments array from conversion options
 */
function buildFFmpegArgs(config: FFmpegJobConfig): string[] {
  const { options } = config;
  const args: string[] = [];

  // Input file
  args.push('-i', escapeFilePath(config.inputFile));

  // A custom command that does its own stream mapping (-map) is a complete
  // command, such as the ones the seedlink service submits through the API.
  // Appending it would map every stream twice, so it replaces the generated
  // options. Anything else (for example -x265-params ...) is just an extra
  // option and is appended to the generated options below.
  if (options.customCommand) {
    const customArgs = options.customCommand.trim().split(/\s+/);
    if (customArgs.includes('-map')) {
      customArgs.forEach((arg) => args.push(escapeArgument(arg)));
      args.push('-progress', 'pipe:1');
      args.push('-y');
      args.push(escapeFilePath(config.outputFile));
      return args;
    }
  }

  // Map streams based on removeExtraVideoStreams setting:
  // When enabled (default): Map only the first video stream to exclude attached pictures
  // like cover art which often have odd dimensions incompatible with x265/x264
  // When disabled: Map all streams with -map 0, but use stream-specific codecs to
  // copy attached pictures instead of re-encoding them
  const removeExtraVideoStreams =
    options.advanced.removeExtraVideoStreams !== false; // Default to true if undefined
  const videoStreams = config.videoStreams || [];
  const hasAttachedPictures = videoStreams.some((s) => s.isAttachedPic);

  if (removeExtraVideoStreams) {
    // Map selectively:
    // - First video stream only (0:v:0) - excludes attached pictures
    // - All audio streams (0:a?) - the ? makes it optional if no audio exists
    // - All subtitle streams (0:s?) - the ? makes it optional if no subtitles exist
    args.push('-map', '0:v:0');
    args.push('-map', '0:a?');
    args.push('-map', '0:s?');
  } else {
    // Map all streams including attached pictures
    args.push('-map', '0');
  }

  // Video codec
  // When keeping all streams and there are attached pictures, use stream-specific codecs:
  // - Encode non-attached-picture video streams with the selected codec
  // - Copy attached pictures to avoid dimension/encoding issues
  const useStreamSpecificVideoCodec =
    !removeExtraVideoStreams && hasAttachedPictures && videoStreams.length > 1;

  if (options.basic.videoCodec !== 'copy') {
    if (useStreamSpecificVideoCodec) {
      // Use stream-specific codecs based on whether each stream is an attached picture
      for (const stream of videoStreams) {
        if (stream.isAttachedPic) {
          // Copy attached pictures (cover art) as-is
          args.push(`-c:v:${stream.videoIndex}`, 'copy');
        } else {
          // Encode actual video streams with the selected codec
          args.push(
            `-c:v:${stream.videoIndex}`,
            escapeArgument(options.basic.videoCodec),
          );
        }
      }
    } else {
      args.push('-c:v', escapeArgument(options.basic.videoCodec));
    }

    // Quality (CRF) for lossy codecs
    if (options.advanced.bitrate.mode === 'crf') {
      args.push('-crf', escapeArgument(options.basic.quality));
    }

    // Preset for lossy codecs
    args.push('-preset', escapeArgument(options.advanced.preset));

    // Pixel format based on bit depth
    const pixFmt =
      pixelFormats[options.basic.videoCodec][options.advanced.bitDepth];
    if (pixFmt) {
      args.push('-pix_fmt', pixFmt);
    }
  } else {
    args.push('-c:v', 'copy');
  }

  // Audio codec
  if (options.advanced.audio.codec !== 'copy') {
    args.push('-c:a', escapeArgument(options.advanced.audio.codec));

    // Audio quality (VBR for AAC/Opus, CBR for AC3, none for FLAC)
    const qualityArgs = getAudioQualityArgs(
      options.advanced.audio.codec,
      options.advanced.audio.quality,
    );
    qualityArgs.forEach((arg) => args.push(escapeArgument(arg)));

    // Audio sample rate
    if (options.advanced.audio.sampleRate) {
      args.push('-ar', escapeArgument(options.advanced.audio.sampleRate));
    }

    // Audio channels
    if (options.advanced.audio.channels) {
      args.push('-ac', escapeArgument(options.advanced.audio.channels));
    }
  } else {
    args.push('-c:a', 'copy');
  }

  // Subtitle codec - decided per stream so Plex can use every track.
  // Plex-compatible text formats and bitmap formats are copied; any other
  // subtitle format (eia_608, mov_text, microdvd, ...) is converted to SRT.
  const subtitleCodecs = config.subtitleCodecs || [];

  if (subtitleCodecs.length === 0) {
    // No subtitle streams detected - skip subtitles
    args.push('-sn');
  } else {
    subtitleCodecs.forEach((codec, index) => {
      args.push(`-c:s:${index}`, subtitleCodecFor(codec));
    });
  }

  // Bitrate mode (if not CRF)
  if (
    options.advanced.bitrate.mode !== 'crf' &&
    options.basic.videoCodec !== 'copy'
  ) {
    if (options.advanced.bitrate.videoBitrate) {
      args.push(
        '-b:v',
        escapeArgument(`${options.advanced.bitrate.videoBitrate}k`),
      );
    }

    if (options.advanced.bitrate.mode === 'vbr') {
      if (options.advanced.bitrate.maxBitrate) {
        args.push(
          '-maxrate',
          escapeArgument(`${options.advanced.bitrate.maxBitrate}k`),
        );
      }
      if (options.advanced.bitrate.bufferSize) {
        args.push(
          '-bufsize',
          escapeArgument(`${options.advanced.bitrate.bufferSize}k`),
        );
      }
    }
  }

  // Resolution scaling
  if (options.advanced.resolution.width || options.advanced.resolution.height) {
    const width = options.advanced.resolution.width || -1;
    const height = options.advanced.resolution.height || -1;

    if (options.advanced.resolution.maintainAspectRatio) {
      // Use -1 to maintain aspect ratio for the unspecified dimension
      args.push('-vf', `scale=${width}:${height}`);
    } else {
      args.push('-vf', `scale=${width}:${height}`);
    }
  }

  // Frame rate
  if (
    !options.advanced.frameRate.copyOriginal &&
    options.advanced.frameRate.fps
  ) {
    args.push('-r', escapeArgument(options.advanced.frameRate.fps));
  }

  // Extra custom options (without their own -map) are appended to the
  // generated options, so the selected codec, mapping and quality always
  // apply. Options given later win over generated ones when they conflict.
  if (options.customCommand) {
    options.customCommand
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .forEach((arg) => args.push(escapeArgument(arg)));
  }

  // Progress reporting (for parsing progress updates)
  args.push('-progress', 'pipe:1');

  // Overwrite output files
  args.push('-y');

  // Output file
  args.push(escapeFilePath(config.outputFile));

  return args;
}

/**
 * Create individual FFmpeg jobs from conversion options
 */
export function createFFmpegJobs(
  options: ConversionOptions,
): FFmpegJobConfig[] {
  const jobs: FFmpegJobConfig[] = [];

  console.log(
    `[FFmpeg Command] Creating jobs for ${options.selectedFiles.length} file(s)`,
  );

  for (const inputFile of options.selectedFiles) {
    try {
      const outputFile = generateOutputFileName(
        inputFile,
        options.basic.outputFormat,
      );
      const jobName = `Convert ${path.basename(inputFile)} to ${options.basic.outputFormat.toUpperCase()}`;

      jobs.push({
        inputFile: escapeFilePath(inputFile),
        outputFile: escapeFilePath(outputFile),
        options,
        jobName,
      });
    } catch (error) {
      console.error(
        `[FFmpeg Command] Failed to create job config for file: ${inputFile}`,
        error,
      );
      throw new Error('Failed to create job config for file', {
        cause: {
          inputFile,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  console.log(
    `[FFmpeg Command] Successfully created ${jobs.length} job config(s)`,
  );
  return jobs;
}

/** Subtitle formats Plex supports in every client, kept as they are. */
const PLEX_TEXT_SUBTITLES = ['ass', 'ssa', 'srt', 'subrip', 'webvtt'];
/** Bitmap formats cannot become text without OCR, so they are copied. */
const BITMAP_SUBTITLES = ['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvdsub'];

/** The `-c:s:N` value for one subtitle stream of the given source codec. */
function subtitleCodecFor(codec: string): string {
  const name = codec.toLowerCase();
  if (PLEX_TEXT_SUBTITLES.includes(name) || BITMAP_SUBTITLES.includes(name)) {
    return 'copy';
  }
  return 'srt';
}

/**
 * Generate FFmpeg command for a single job
 */
export function generateFFmpegCommand(config: FFmpegJobConfig): FFmpegCommand {
  try {
    const args = buildFFmpegArgs(config);

    // Create display-friendly command string
    const displayCommand = `ffmpeg ${args.join(' ')}`;

    return {
      args: ['ffmpeg', ...args],
      displayCommand,
      inputPath: config.inputFile,
      outputPath: config.outputFile,
      config,
    };
  } catch (error) {
    console.error(
      `[FFmpeg Command] Failed to generate command for ${config.inputFile}:`,
      error,
    );
    throw new Error('Failed to generate FFmpeg command for file', {
      cause: {
        inputFile: config.inputFile,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

/**
 * Generate all FFmpeg commands from conversion options
 */
export function generateAllFFmpegCommands(
  options: ConversionOptions,
): FFmpegCommand[] {
  const jobs = createFFmpegJobs(options);
  return jobs.map(generateFFmpegCommand);
}

/**
 * Validate FFmpeg command for security before execution
 *
 * Since we use spawn() with an array of arguments (not shell=true),
 * shell metacharacters in arguments are automatically safe.
 * We only need to ensure the executable is ffmpeg.
 */
export function validateFFmpegCommand(command: FFmpegCommand): void {
  // Ensure ffmpeg is the only executable
  if (command.args[0] !== 'ffmpeg') {
    throw new Error('Only ffmpeg commands are allowed');
  }

  // No need to validate individual arguments - spawn() with array is safe from injection
}
