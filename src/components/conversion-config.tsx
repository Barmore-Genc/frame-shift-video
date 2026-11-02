import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  ConversionOptions,
  DEFAULT_CONVERSION_OPTIONS,
  VideoCodec,
  OutputFormat,
  EncodingPreset,
  AudioCodec,
  AudioQuality,
  BitrateMode,
  BitDepth,
} from '@/types/conversion';
import { useSettings } from '@/lib/api-hooks';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import Highlighter from 'react-highlight-words';
import { ArrowCounterClockwise } from '@phosphor-icons/react';

interface ConversionConfigProps {
  /** Selected files with their relative paths */
  selectedFiles: string[];
  /** Initial config to load (from API) */
  initialConfig?: ConversionOptions;
  /** Callback when conversion options change */
  onOptionsChange: (options: ConversionOptions) => void;
  /** Callback when user wants to start conversion */
  onStartConversion: (options: ConversionOptions) => void;
  /** Callback when files are removed */
  onFilesChange?: (files: string[]) => void;
  /** Search query from in-page search */
  searchQuery?: string;
  /** Current match index from in-page search */
  searchCurrentMatch?: number;
  /** Callback to report total matches found */
  onSearchMatchesFound?: (count: number) => void;
}

interface SearchMatch {
  type: 'file' | 'option';
  index?: number; // For files
  ref?: React.RefObject<HTMLDivElement | null>; // For options
  text: string;
}

export function ConversionConfig({
  selectedFiles,
  initialConfig,
  onOptionsChange,
  onStartConversion,
  onFilesChange,
  searchQuery = '',
  searchCurrentMatch = 0,
  onSearchMatchesFound,
}: ConversionConfigProps) {
  const [options, setOptions] = useState<ConversionOptions>({
    ...DEFAULT_CONVERSION_OPTIONS,
    selectedFiles,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showCustomOptions, setShowCustomOptions] = useState(false);
  const [removedHistory, setRemovedHistory] = useState<string[]>([]);
  const MAX_UNDO_HISTORY = 10;

  // Fetch server settings for FFmpeg capabilities
  const { data: settings } = useSettings();

  // Refs for search
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const videoCodecRef = useRef<HTMLDivElement>(null);
  const outputFormatRef = useRef<HTMLDivElement>(null);
  const encodingPresetRef = useRef<HTMLDivElement>(null);
  const bitDepthRef = useRef<HTMLDivElement>(null);
  const bitrateModeRef = useRef<HTMLDivElement>(null);
  const audioCodecRef = useRef<HTMLDivElement>(null);

  // Load initial config from API or localStorage
  useEffect(() => {
    try {
      // Prefer initialConfig from API (for retries)
      if (initialConfig) {
        setOptions({
          ...initialConfig,
          selectedFiles, // Always use current selected files
        });
        return;
      }

      // Otherwise fall back to localStorage
      const saved = localStorage.getItem('frame-shift-conversion-options');
      if (saved) {
        const savedOptions = JSON.parse(saved);
        setOptions({
          ...savedOptions,
          selectedFiles, // Always use current selected files
        });
      }
    } catch (error) {
      console.error('Failed to load saved options:', error);
    }
  }, [selectedFiles, initialConfig]);

  // Save options to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(
        'frame-shift-conversion-options',
        JSON.stringify(options),
      );
      onOptionsChange(options);
    } catch (error) {
      console.error('Failed to save options:', error);
    }
  }, [options, onOptionsChange]);

  const updateBasicOption = <K extends keyof ConversionOptions['basic']>(
    key: K,
    value: ConversionOptions['basic'][K],
  ) => {
    setOptions((prev) => ({
      ...prev,
      basic: {
        ...prev.basic,
        [key]: value,
      },
    }));
  };

  const updateAdvancedOption = <K extends keyof ConversionOptions['advanced']>(
    key: K,
    value: ConversionOptions['advanced'][K],
  ) => {
    setOptions((prev) => ({
      ...prev,
      advanced: {
        ...prev.advanced,
        [key]: value,
      },
    }));
  };

  const handleRemoveFile = (fileToRemove: string) => {
    const newFiles = selectedFiles.filter((f) => f !== fileToRemove);
    // Add to history, keeping only the last MAX_UNDO_HISTORY items
    setRemovedHistory((prev) =>
      [fileToRemove, ...prev].slice(0, MAX_UNDO_HISTORY),
    );
    onFilesChange?.(newFiles);
  };

  const handleUndo = () => {
    if (removedHistory.length > 0) {
      const fileToRestore = removedHistory[0];
      const newFiles = [...selectedFiles, fileToRestore];
      setRemovedHistory((prev) => prev.slice(1));
      onFilesChange?.(newFiles);
    }
  };

  // Get quality range based on codec
  const getQualityRange = (codec: VideoCodec) => {
    switch (codec) {
      case 'libx265':
        return {
          min: 0,
          max: 51,
          default: 28,
          recommended: '20 for archival (lower = higher quality)',
        };
      case 'libx264':
        return {
          min: 0,
          max: 51,
          default: 23,
          recommended: '20 for archival (lower = higher quality)',
        };
      case 'libsvtav1':
        return {
          min: 20,
          max: 30,
          default: 25,
          recommended: '25 for archival (higher = higher quality)',
        };
      default:
        return {
          min: 0,
          max: 51,
          default: 25,
          recommended: 'N/A for copy mode',
        };
    }
  };

  const qualityRange = getQualityRange(options.basic.videoCodec);

  // Search functionality: find all matches
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];

    const matches: SearchMatch[] = [];
    const query = searchQuery.toLowerCase();

    // Search in files
    selectedFiles.forEach((file, index) => {
      if (file.toLowerCase().includes(query)) {
        matches.push({ type: 'file', index, text: file });
      }
    });

    // Search in options
    const optionTexts = [
      { text: 'video codec h.265 hevc h.264 avc av1 copy', ref: videoCodecRef },
      { text: 'output format mp4 mkv webm avi mov', ref: outputFormatRef },
      {
        text: 'encoding preset ultrafast superfast veryfast faster fast medium slow slower veryslow',
        ref: encodingPresetRef,
      },
      { text: 'bit depth 8-bit 10-bit color', ref: bitDepthRef },
      { text: 'bitrate mode crf cbr vbr quality', ref: bitrateModeRef },
      { text: 'audio codec opus aac fdk ac3 flac copy', ref: audioCodecRef },
    ];

    optionTexts.forEach(({ text, ref }) => {
      if (text.toLowerCase().includes(query)) {
        matches.push({ type: 'option', ref, text });
      }
    });

    return matches;
  }, [searchQuery, selectedFiles]);

  // Report total matches
  useEffect(() => {
    onSearchMatchesFound?.(searchMatches.length);
  }, [searchMatches.length, onSearchMatchesFound]);

  // Scroll to current match
  useEffect(() => {
    if (searchQuery.trim() && searchMatches.length > 0) {
      const currentMatch = searchMatches[searchCurrentMatch];
      if (currentMatch) {
        if (currentMatch.type === 'file' && currentMatch.index !== undefined) {
          // Scroll to file in virtuoso
          virtuosoRef.current?.scrollToIndex({
            index: currentMatch.index,
            align: 'center',
            behavior: 'smooth',
          });
        } else if (currentMatch.type === 'option' && currentMatch.ref) {
          // Scroll to option
          currentMatch.ref.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        }
      }
    }
  }, [searchCurrentMatch, searchQuery, searchMatches]);

  const renderFileItem = useCallback(
    (index: number) => {
      const file = selectedFiles[index];
      const isActiveMatch =
        searchQuery.trim() &&
        searchMatches.length > 0 &&
        searchMatches[searchCurrentMatch]?.type === 'file' &&
        searchMatches[searchCurrentMatch]?.index === index;

      return (
        <div
          className={`flex items-center justify-between text-sm font-mono text-gray-600 dark:text-gray-400 rounded px-2 py-1 group mb-1 ${
            isActiveMatch
              ? 'bg-blue-100 dark:bg-blue-800/40 ring-2 ring-blue-500 dark:ring-blue-400'
              : 'bg-white dark:bg-gray-800'
          }`}
        >
          <span className="truncate flex-1 mr-2">
            {searchQuery.trim() ? (
              <Highlighter
                searchWords={[searchQuery]}
                autoEscape={true}
                textToHighlight={file}
                highlightClassName={
                  isActiveMatch
                    ? 'bg-blue-400 dark:bg-blue-600 text-white'
                    : 'bg-yellow-200 dark:bg-yellow-700'
                }
              />
            ) : (
              file
            )}
          </span>
          <button
            type="button"
            onClick={() => handleRemoveFile(file)}
            className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-600 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-500 focus:opacity-100"
            aria-label={`Remove ${file}`}
            title="Remove file"
          >
            ×
          </button>
        </div>
      );
    },
    [
      selectedFiles,
      handleRemoveFile,
      searchQuery,
      searchMatches,
      searchCurrentMatch,
    ],
  );

  return (
    <div className="p-6 space-y-6">
      {/* Selected Files Display */}
      <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-gray-900 dark:text-white">
            Selected Files ({selectedFiles.length})
          </h3>
          {removedHistory.length > 0 && (
            <button
              onClick={handleUndo}
              className="flex items-center gap-1 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              title={`Undo (${removedHistory.length} action${removedHistory.length !== 1 ? 's' : ''} available)`}
            >
              <ArrowCounterClockwise
                size={16}
                weight="bold"
                aria-hidden="true"
              />
              <span>Undo</span>
              {removedHistory.length > 1 && (
                <span className="ml-1 px-1.5 py-0.5 bg-blue-500 rounded text-xs">
                  {removedHistory.length}
                </span>
              )}
            </button>
          )}
        </div>
        <div style={{ height: '128px' }}>
          <Virtuoso
            ref={virtuosoRef}
            style={{ height: '100%' }}
            totalCount={selectedFiles.length}
            itemContent={renderFileItem}
          />
        </div>
      </div>

      {/* Basic Options */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600 p-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Basic Options
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Video Codec */}
          <div ref={videoCodecRef}>
            <label
              htmlFor="video-codec"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Video Codec
            </label>
            <select
              id="video-codec"
              value={options.basic.videoCodec}
              onChange={(e) =>
                updateBasicOption('videoCodec', e.target.value as VideoCodec)
              }
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="libx265">H.265 (HEVC) - Best compression</option>
              <option value="libx264">H.264 (AVC) - More compatible</option>
              <option value="libsvtav1">
                AV1 - Better compression, slower
              </option>
              <option value="copy">Copy - No re-encoding</option>
            </select>
          </div>

          {/* Output Format */}
          <div ref={outputFormatRef}>
            <label
              htmlFor="output-format"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Output Format
            </label>
            <select
              id="output-format"
              value={options.basic.outputFormat}
              onChange={(e) =>
                updateBasicOption(
                  'outputFormat',
                  e.target.value as OutputFormat,
                )
              }
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="mp4">MP4 - Most compatible</option>
              <option value="mkv">MKV - Open standard</option>
              <option value="webm">WebM - Web optimized</option>
              <option value="avi">AVI - Legacy format</option>
              <option value="mov">MOV - Apple format</option>
            </select>
          </div>
        </div>
      </div>

      {/* Advanced Options Toggle */}
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded px-2 py-1"
        >
          <span
            className={`transform transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
          >
            ▶
          </span>
          Advanced Options
        </button>
      </div>

      {/* Advanced Options */}
      {showAdvanced && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600 p-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Advanced Options
          </h3>

          <div className="space-y-6">
            {/* Encoding Preset */}
            <div ref={encodingPresetRef}>
              <label
                htmlFor="encoding-preset"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                Encoding Preset (Speed vs Compression)
              </label>
              <select
                id="encoding-preset"
                value={options.advanced.preset}
                onChange={(e) =>
                  updateAdvancedOption(
                    'preset',
                    e.target.value as EncodingPreset,
                  )
                }
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="ultrafast">Ultra Fast - Poor compression</option>
                <option value="superfast">Super Fast - Poor compression</option>
                <option value="veryfast">Very Fast - Poor compression</option>
                <option value="faster">Faster - Decent compression</option>
                <option value="fast">Fast - Decent compression</option>
                <option value="medium">Medium - Balanced</option>
                <option value="slow">
                  Slow - Better compression (recommended)
                </option>
                <option value="slower">Slower - Best compression</option>
                <option value="veryslow">Very Slow - Best compression</option>
              </select>
            </div>

            {/* Bit Depth */}
            <div ref={bitDepthRef}>
              <label
                htmlFor="bit-depth"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                Bit Depth
              </label>
              <select
                id="bit-depth"
                value={options.advanced.bitDepth}
                onChange={(e) =>
                  updateAdvancedOption('bitDepth', e.target.value as BitDepth)
                }
                disabled={options.basic.videoCodec === 'copy'}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="8bit">
                  8-bit - Smaller files, more compatible
                </option>
                <option
                  value="10bit"
                  disabled={
                    options.basic.videoCodec === 'libx264' &&
                    !settings?.ffmpeg?.x264_10bit
                  }
                >
                  10-bit - Better quality, reduced banding
                  {options.basic.videoCodec === 'libx264' &&
                    !settings?.ffmpeg?.x264_10bit &&
                    ' (not supported by your FFmpeg)'}
                </option>
              </select>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                10-bit provides smoother gradients and reduces banding artifacts
              </div>
            </div>

            {/* Bitrate Control */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div ref={bitrateModeRef}>
                <label
                  htmlFor="bitrate-mode"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Bitrate Mode
                </label>
                <select
                  id="bitrate-mode"
                  value={options.advanced.bitrate.mode}
                  onChange={(e) =>
                    updateAdvancedOption('bitrate', {
                      ...options.advanced.bitrate,
                      mode: e.target.value as BitrateMode,
                    })
                  }
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="crf">CRF - Quality-based (recommended)</option>
                  <option value="cbr">CBR - Constant bitrate</option>
                  <option value="vbr">VBR - Variable bitrate</option>
                </select>
              </div>

              {options.advanced.bitrate.mode === 'crf' ? (
                <div>
                  <label
                    htmlFor="quality-slider"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Quality (CRF: {options.basic.quality})
                  </label>
                  <input
                    id="quality-slider"
                    type="range"
                    min={qualityRange.min}
                    max={qualityRange.max}
                    value={options.basic.quality}
                    onChange={(e) =>
                      updateBasicOption('quality', parseInt(e.target.value))
                    }
                    disabled={options.basic.videoCodec === 'copy'}
                    className="w-full"
                  />
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {qualityRange.recommended}
                  </div>
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="video-bitrate"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Video Bitrate (kbps)
                  </label>
                  <input
                    id="video-bitrate"
                    type="number"
                    value={options.advanced.bitrate.videoBitrate || ''}
                    onChange={(e) =>
                      updateAdvancedOption('bitrate', {
                        ...options.advanced.bitrate,
                        videoBitrate: e.target.value
                          ? parseInt(e.target.value)
                          : undefined,
                      })
                    }
                    placeholder="e.g., 2000"
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              )}
            </div>

            {/* Audio Settings */}
            <div ref={audioCodecRef}>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Audio Settings
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="audio-codec"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Audio Codec
                  </label>
                  <select
                    id="audio-codec"
                    value={options.advanced.audio.codec}
                    onChange={(e) =>
                      updateAdvancedOption('audio', {
                        ...options.advanced.audio,
                        codec: e.target.value as AudioCodec,
                      })
                    }
                    className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="libopus">
                      Opus - Best quality/size (recommended)
                    </option>
                    <option value="aac">AAC - Good compatibility</option>
                    <option value="ac3">AC3 - Dolby Digital</option>
                    <option value="flac">FLAC - Lossless</option>
                    <option value="copy">Copy - No re-encoding</option>
                  </select>
                </div>

                {options.advanced.audio.codec !== 'copy' &&
                  options.advanced.audio.codec !== 'flac' && (
                    <div>
                      <label
                        htmlFor="audio-quality"
                        className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                      >
                        Audio Quality
                      </label>
                      <select
                        id="audio-quality"
                        value={options.advanced.audio.quality}
                        onChange={(e) =>
                          updateAdvancedOption('audio', {
                            ...options.advanced.audio,
                            quality: e.target.value as AudioQuality,
                          })
                        }
                        className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      >
                        <option value="low">Low - Smaller files</option>
                        <option value="medium">Medium - Balanced</option>
                        <option value="high">High - Best quality</option>
                      </select>
                    </div>
                  )}
                {options.advanced.audio.codec === 'flac' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Audio Quality
                    </label>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      Automatically determined
                    </div>
                  </div>
                )}
                {options.advanced.audio.codec === 'copy' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Audio Quality
                    </label>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      Same as source video
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Extra Video Streams Toggle */}
            <div className="pt-4 border-t border-gray-200 dark:border-gray-600">
              <div className="flex items-center justify-between">
                <div>
                  <label
                    htmlFor="remove-extra-video-streams"
                    className="text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Remove extra video streams
                  </label>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Keep only the main video stream. Disable to preserve cover
                    art and other embedded images.
                  </div>
                </div>
                <button
                  id="remove-extra-video-streams"
                  type="button"
                  role="switch"
                  aria-checked={
                    options.advanced.removeExtraVideoStreams !== false
                  }
                  onClick={() =>
                    updateAdvancedOption(
                      'removeExtraVideoStreams',
                      options.advanced.removeExtraVideoStreams === false,
                    )
                  }
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                    options.advanced.removeExtraVideoStreams !== false
                      ? 'bg-blue-600'
                      : 'bg-gray-200 dark:bg-gray-600'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      options.advanced.removeExtraVideoStreams !== false
                        ? 'translate-x-5'
                        : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Options Toggle */}
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setShowCustomOptions(!showCustomOptions)}
          className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded px-2 py-1"
        >
          <span
            className={`transform transition-transform ${showCustomOptions ? 'rotate-90' : ''}`}
          >
            ▶
          </span>
          Custom FFmpeg Options
        </button>
      </div>

      {/* Custom Options */}
      {showCustomOptions && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600 p-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Custom FFmpeg Options (Additional options to append to the generated
            command)
          </label>
          <textarea
            value={options.customCommand || ''}
            onChange={(e) =>
              setOptions((prev) => ({
                ...prev,
                customCommand: e.target.value || undefined,
              }))
            }
            placeholder="-tune film -profile:v high -level 4.1"
            rows={3}
            style={{
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            }}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
          />
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            Enter additional FFmpeg options that will be added to the command
            built from your settings above. Do not include input/output files or
            basic codec settings.
          </div>
        </div>
      )}
    </div>
  );
}
