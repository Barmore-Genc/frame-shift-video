/**
 * A look inside an extra without playing it: its length, and a still picture from any moment.
 * The page shows a strip of these (spread evenly through the video) so a person can tell what an
 * extra is at a glance, and open it at the moment they clicked.
 */

import { execFile } from 'child_process';

const FRAMES = 8;
const TIMEOUT_MS = 20000;
const MAX_JPEG = 4 * 1024 * 1024;

export function run(
  command: string,
  args: string[],
  encoding: 'utf8' | 'buffer',
): Promise<string | Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: TIMEOUT_MS, maxBuffer: MAX_JPEG, encoding },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

/** How long a video is, in seconds. */
export async function videoSeconds(file: string): Promise<number> {
  const out = (await run(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    'utf8',
  )) as string;
  const seconds = Number(out.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error('That video has no length');
  }
  return seconds;
}

/** The moments to show: the middle of each of `count` equal parts of the video. */
export function previewTimes(
  seconds: number,
  count: number = FRAMES,
): number[] {
  return Array.from(
    { length: count },
    (_, i) => Math.round(((i + 0.5) / count) * seconds * 10) / 10,
  );
}

/** A still from the video at `at` seconds, as a small JPEG. */
export async function frameJpeg(file: string, at: number): Promise<Buffer> {
  if (!Number.isFinite(at) || at < 0)
    throw new Error('Pick a moment in the video');
  const picture = (await run(
    'ffmpeg',
    [
      '-v',
      'error',
      '-ss',
      String(at),
      '-i',
      file,
      '-frames:v',
      '1',
      '-vf',
      'scale=320:-2',
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      '-',
    ],
    'buffer',
  ).catch(() => Buffer.alloc(0))) as Buffer;
  if (picture.length === 0) throw new Error('There is no picture there');
  return picture;
}

/** A checksum of the picture at `at` seconds: the same picture gives the same sum. */
export async function frameSum(file: string, at: number): Promise<string> {
  const out = (await run(
    'ffmpeg',
    [
      '-v',
      'error',
      '-ss',
      String(at),
      '-i',
      file,
      '-frames:v',
      '1',
      '-an',
      '-sn',
      '-f',
      'md5',
      '-',
    ],
    'utf8',
  ).catch(() => '')) as string;
  const sum = out.match(/^MD5=([0-9a-f]+)/m)?.[1];
  if (!sum) throw new Error('There is no picture there');
  return sum;
}
