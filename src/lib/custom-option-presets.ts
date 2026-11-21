/**
 * Ready-made custom FFmpeg options for the "Custom FFmpeg Options" box.
 * They are appended to the generated command, so they never replace the
 * codec, mapping or quality chosen on the page.
 */

export interface CustomOptionPreset {
  id: string;
  label: string;
  /** The options added to the box */
  options: string;
  /** Plain-language explanation shown under the dropdown */
  description: string;
}

export const CUSTOM_OPTION_PRESETS: CustomOptionPreset[] = [
  {
    id: 'x265-low-memory',
    label: 'H.265: use less memory',
    options: '-x265-params pools=8:frame-threads=2',
    description:
      'Limits the H.265 encoder to 8 worker threads and 2 frames in flight at once. Use this when a conversion is killed partway through (exit code null), which usually means the container ran out of memory. Slightly slower, much lighter on RAM. Only affects H.265.',
  },
  {
    id: 'x265-very-low-memory',
    label: 'H.265: use much less memory',
    options: '-x265-params pools=4:frame-threads=1',
    description:
      'Same as above but stricter: 4 worker threads and 1 frame at a time. Try this if "use less memory" still gets killed. Noticeably slower. Only affects H.265.',
  },
  {
    id: 'limit-threads',
    label: 'Limit CPU threads to 8',
    options: '-threads 8',
    description:
      'Caps how many CPU threads ffmpeg uses for any codec, leaving CPU and memory for other jobs running at the same time.',
  },
  {
    id: 'x265-quiet',
    label: 'H.265: quieter encoder log',
    options: '-x265-params log-level=error',
    description:
      'Hides the encoder’s info messages so error logs stay short and easier to read. Does not change the video. Only affects H.265.',
  },
];

/**
 * Add a preset's options to the existing text, skipping it if it is
 * already there.
 */
export function addPresetOptions(
  current: string | undefined,
  preset: CustomOptionPreset,
): string {
  const existing = (current ?? '').trim();
  if (existing.split(/\s+/).join(' ').includes(preset.options)) {
    return existing;
  }
  return existing ? `${existing} ${preset.options}` : preset.options;
}
