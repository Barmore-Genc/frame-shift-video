import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_SPLIT_OPTIONS,
  DEFAULT_TRACK_OPTIONS,
  buildSplitArgs,
  buildTrackArgs,
  cleanedPath,
  episodeName,
  normalizeLanguage,
  parseBlackdetect,
  parseLanguageList,
  parseTitles,
  planSegments,
  planTracks,
  resolveInHome,
  sanitizeFilename,
  type StreamInfo,
} from '../../server/split-tools';

describe('resolveInHome', () => {
  test('keeps paths inside the home folder', () => {
    expect(resolveInHome('Shows/a.mkv', '/media')).toBe('/media/Shows/a.mkv');
    expect(resolveInHome('', '/media')).toBe('/media');
  });
  test('refuses to leave it', () => {
    expect(() => resolveInHome('../etc/passwd', '/media')).toThrow();
    expect(() => resolveInHome('a/../../media-other/x', '/media')).toThrow();
    // A leading slash is still relative to the home folder.
    expect(resolveInHome('/media-other/x', '/media')).toBe(
      '/media/media-other/x',
    );
  });
});

describe('parseBlackdetect', () => {
  test('reads black segments from ffmpeg output', () => {
    const text = [
      '[blackdetect @ 0x1] black_start:100.5 black_end:101.2 black_duration:0.7',
      'noise',
      '[blackdetect @ 0x1] black_start:400 black_end:401.5 black_duration:1.5',
    ].join('\n');
    expect(parseBlackdetect(text)).toEqual([
      { start: 100.5, end: 101.2 },
      { start: 400, end: 401.5 },
    ]);
  });
});

describe('planSegments', () => {
  const options = { ...DEFAULT_SPLIT_OPTIONS, episodes: 3 };
  test('cuts at the black screens nearest an even split', () => {
    const plan = planSegments(
      [
        { start: 30, end: 31 }, // too close to the start
        { start: 440, end: 441 },
        { start: 880, end: 881 },
        { start: 100, end: 101 }, // too close to an edge margin? (inside, but far from expected)
      ],
      1320,
      options,
    );
    expect(plan.complete).toBe(true);
    expect(plan.segments).toHaveLength(3);
    const offset = options.frameOffset / options.fps;
    expect(plan.segments[0]).toEqual({ start: 0, end: 440 + offset });
    expect(plan.segments[1].start).toBeCloseTo(441 - offset, 5);
    expect(plan.segments[1].end).toBeCloseTo(880 + offset, 5);
    expect(plan.segments[2].end).toBe(1320);
  });
  test('is incomplete, with no segments, when a break is missing', () => {
    const plan = planSegments([{ start: 440, end: 441 }], 1320, options);
    expect(plan.complete).toBe(false);
    expect(plan.segments).toEqual([]);
    expect(plan.warning).toContain('1 of 2');
  });
  test('never reuses one black screen for two breaks', () => {
    const plan = planSegments([{ start: 660, end: 661 }], 1320, options);
    expect(plan.complete).toBe(false);
  });
  test('a single episode is the whole file', () => {
    const plan = planSegments([], 600, { ...options, episodes: 1 });
    expect(plan).toMatchObject({
      complete: true,
      segments: [{ start: 0, end: 600 }],
    });
  });
});

describe('naming', () => {
  test('sanitizes characters that are not allowed', () => {
    expect(sanitizeFilename('Who? What: Where!')).toBe('Who What- Where');
    expect(sanitizeFilename('A/B "C"')).toBe("A-B 'C'");
  });
  test('builds names with and without a show and title', () => {
    const naming = {
      show: 'Karate Sheep',
      season: 1,
      startEpisode: 5,
      titles: ['Top Dog!'],
    };
    expect(episodeName(naming, 0)).toBe('Karate Sheep - S01E05 - Top Dog');
    expect(episodeName(naming, 1)).toBe('Karate Sheep - S01E06');
    expect(episodeName({ ...naming, show: undefined }, 0)).toBe(
      'S01E05 - Top Dog',
    );
  });
  test('parses a pasted title list', () => {
    expect(
      parseTitles("1. Wanda's Apprentice\n\n2) Top Dog!\nRed Card"),
    ).toEqual(["Wanda's Apprentice", 'Top Dog!', 'Red Card']);
  });
});

describe('buildSplitArgs', () => {
  const segment = { start: 100, end: 160 };
  test('re-encode keeps subtitles in the right form for the container', () => {
    const mp4 = buildSplitArgs('in.mp4', 'out.mp4', segment, 'reencode');
    expect(mp4.slice(mp4.indexOf('-c:s'), mp4.indexOf('-c:s') + 2)).toEqual([
      '-c:s',
      'mov_text',
    ]);
    const mkv = buildSplitArgs('in.mkv', 'out.mkv', segment, 'reencode');
    expect(mkv).toContain('libx264');
    expect(mkv.slice(mkv.indexOf('-c:s'), mkv.indexOf('-c:s') + 2)).toEqual([
      '-c:s',
      'copy',
    ]);
  });
  test('seeks before and after the input and limits the length', () => {
    const args = buildSplitArgs('in.mkv', 'out.mkv', segment, 'copy');
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 2)).toEqual([
      '-ss',
      '95.000',
    ]);
    expect(args).toContain('5.000');
    expect(args[args.indexOf('-t') + 1]).toBe('60.000');
    expect(args).toContain('copy');
  });
});

describe('tracks', () => {
  const streams: StreamInfo[] = [
    { index: 0, type: 'video' },
    { index: 1, type: 'audio', language: 'eng' },
    { index: 2, type: 'audio', language: 'jpn' },
    { index: 3, type: 'subtitle', language: 'en' },
    { index: 4, type: 'subtitle', language: 'fre' },
    { index: 5, type: 'subtitle' },
  ];
  test('normalizes language names', () => {
    expect(normalizeLanguage('English')).toBe('eng');
    expect(normalizeLanguage('EN')).toBe('eng');
    expect(parseLanguageList('en, Japanese')).toEqual(['eng', 'jpn']);
  });
  test('keeps only the wanted languages', () => {
    const plan = planTracks(streams, DEFAULT_TRACK_OPTIONS);
    expect(plan.action).toBe('clean');
    expect(plan.keepAudio).toEqual([1]);
    expect(plan.keepSubtitles).toEqual([3]);
    expect(plan.removeAudio).toEqual([2]);
    expect(plan.removeSubtitles).toEqual([4, 5]);
  });
  test('can keep untagged tracks', () => {
    const plan = planTracks(streams, {
      ...DEFAULT_TRACK_OPTIONS,
      keepUntagged: true,
    });
    expect(plan.keepSubtitles).toEqual([3, 5]);
  });
  test('skips a file with no audio in the wanted languages', () => {
    const plan = planTracks(
      streams.filter((s) => s.index !== 1),
      DEFAULT_TRACK_OPTIONS,
    );
    expect(plan.action).toBe('skip-no-audio');
  });
  test('says when nothing needs removing', () => {
    const plan = planTracks(streams.slice(0, 2), DEFAULT_TRACK_OPTIONS);
    expect(plan.action).toBe('already-clean');
  });
  test('can filter subtitles only', () => {
    const plan = planTracks(streams, {
      ...DEFAULT_TRACK_OPTIONS,
      filterAudio: false,
    });
    expect(plan.keepAudio).toEqual([1, 2]);
    expect(plan.removeSubtitles).toEqual([4, 5]);
  });
  test('maps video, chapters and the kept tracks without re-encoding', () => {
    const plan = planTracks(streams, DEFAULT_TRACK_OPTIONS);
    expect(buildTrackArgs('in.mkv', 'out.mkv', plan)).toEqual([
      '-y',
      '-hide_banner',
      '-i',
      'in.mkv',
      '-map',
      '0:v',
      '-map_chapters',
      '0',
      '-map',
      '0:1',
      '-map',
      '0:3',
      '-c',
      'copy',
      'out.mkv',
    ]);
  });
  test('temporary and side-by-side output names keep the extension', () => {
    expect(cleanedPath('/a/b.mkv', true)).toBe('/a/b.fs-temp.mkv');
    expect(cleanedPath('/a/b.mkv', false)).toBe('/a/b.cleaned.mkv');
  });
});
