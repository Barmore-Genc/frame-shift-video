import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_SPLIT_OPTIONS,
  DEFAULT_TRACK_OPTIONS,
  TRACK_PRESETS,
  isMp4Family,
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
  test('ignores black screens inside the edge margin, even close to an even split', () => {
    // 300 s, two episodes: an even split is 150 s, but 100 s is inside the opening margin.
    const plan = planSegments([{ start: 100, end: 101 }], 300, {
      ...DEFAULT_SPLIT_OPTIONS,
      episodes: 2,
    });
    expect(plan.complete).toBe(false);
    const late = planSegments([{ start: 200, end: 201 }], 300, {
      ...DEFAULT_SPLIT_OPTIONS,
      episodes: 2,
    });
    expect(late.complete).toBe(false);
  });
  test('ignores a black screen farther from an even split than the tolerance', () => {
    const options = { ...DEFAULT_SPLIT_OPTIONS, episodes: 2 };
    expect(
      planSegments([{ start: 700, end: 701 }], 1000, options).complete,
    ).toBe(false);
    expect(
      planSegments([{ start: 600, end: 601 }], 1000, options).complete,
    ).toBe(true);
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
      '-disposition:a:0',
      '0',
      '-disposition:s:0',
      '0',
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

describe('default tracks and order', () => {
  // Like the raw Ladybug files: English first and on by default, French second, English subtitles on.
  const raw: StreamInfo[] = [
    { index: 0, type: 'video', default: true },
    { index: 1, type: 'audio', language: 'eng', default: true },
    { index: 2, type: 'audio', language: 'fra', default: false },
    { index: 3, type: 'subtitle', language: 'eng', default: true },
    { index: 4, type: 'subtitle', language: 'fra', default: false },
  ];
  const preset = (id: string) => ({
    ...DEFAULT_TRACK_OPTIONS,
    ...TRACK_PRESETS.find((p) => p.id === id)!.settings,
  });

  test('dual audio, French first: both audio kept, French first and default, subtitles off', () => {
    const plan = planTracks(raw, preset('dual-french'));
    expect(plan.action).toBe('clean');
    expect(plan.keepAudio).toEqual([2, 1]);
    expect(plan.keepSubtitles).toEqual([3]);
    expect(plan.removeSubtitles).toEqual([4]);
    expect(plan.defaults).toEqual([2]);
    expect(plan.reason).toBe(
      'Remove 1 track, Reorder tracks, Change default tracks',
    );
  });

  test('French with English subtitles: only French audio, English subtitles on', () => {
    const plan = planTracks(raw, preset('french-english-subs'));
    expect(plan.keepAudio).toEqual([2]);
    expect(plan.removeAudio).toEqual([1]);
    expect(plan.keepSubtitles).toEqual([3]);
    expect(plan.defaults).toEqual([2, 3]);
  });

  test('audio and subtitle languages are separate lists', () => {
    const plan = planTracks(raw, {
      ...DEFAULT_TRACK_OPTIONS,
      audioLanguages: ['eng'],
      subtitleLanguages: ['fra'],
    });
    expect(plan.keepAudio).toEqual([1]);
    expect(plan.keepSubtitles).toEqual([4]);
  });

  test('without asking for defaults or order, the file keeps its own flags and order', () => {
    const plan = planTracks(raw, {
      ...DEFAULT_TRACK_OPTIONS,
      audioLanguages: ['eng', 'fra'],
      subtitleLanguages: ['eng', 'fra'],
    });
    expect(plan.action).toBe('already-clean');
    expect(plan.keepAudio).toEqual([1, 2]);
    expect(plan.defaults).toEqual([1, 3]);
  });

  test('a file already in the wanted state needs nothing', () => {
    const done: StreamInfo[] = [
      { index: 0, type: 'video' },
      { index: 1, type: 'audio', language: 'fra', default: true },
      { index: 2, type: 'audio', language: 'eng', default: false },
      { index: 3, type: 'subtitle', language: 'eng', default: false },
    ];
    const plan = planTracks(done, preset('dual-french'));
    expect(plan.action).toBe('already-clean');
    expect(plan.reason).toBe('Nothing to change');
  });

  test('only the default changes when filtering is off', () => {
    const plan = planTracks(raw, {
      ...DEFAULT_TRACK_OPTIONS,
      filterAudio: false,
      filterSubtitles: false,
      defaultAudio: 'French',
      defaultSubtitle: 'none',
    });
    expect(plan.keepAudio).toEqual([1, 2]);
    expect(plan.removeAudio).toEqual([]);
    expect(plan.defaults).toEqual([2]);
    expect(plan.reason).toBe('Change default tracks');
  });

  test('a default language the file does not have leaves the flags alone', () => {
    const plan = planTracks(raw, {
      ...DEFAULT_TRACK_OPTIONS,
      filterAudio: false,
      filterSubtitles: false,
      defaultAudio: 'jpn',
      defaultSubtitle: 'jpn',
    });
    expect(plan.action).toBe('already-clean');
    expect(plan.defaults).toEqual([1, 3]);
  });

  test('when the default audio track is removed, the first one left becomes the default', () => {
    const plan = planTracks(raw, {
      ...DEFAULT_TRACK_OPTIONS,
      audioLanguages: ['fra'],
    });
    expect(plan.keepAudio).toEqual([2]);
    expect(plan.defaults).toContain(2);
  });

  test('tracks of one language keep the file order, other languages go last', () => {
    const many: StreamInfo[] = [
      { index: 1, type: 'audio', language: 'jpn' },
      { index: 2, type: 'audio', language: 'eng' },
      { index: 3, type: 'audio', language: 'fra' },
      { index: 4, type: 'audio', language: 'eng' },
    ];
    const plan = planTracks(many, {
      ...DEFAULT_TRACK_OPTIONS,
      filterAudio: false,
      audioLanguages: ['fra', 'eng'],
      orderByLanguage: true,
    });
    expect(plan.keepAudio).toEqual([3, 2, 4, 1]);
  });

  test("ffmpeg is told each kept track's default flag, in output order", () => {
    const plan = planTracks(raw, preset('dual-french'));
    const args = buildTrackArgs('in.mkv', 'out.mkv', plan);
    expect(args).toEqual([
      '-y',
      '-hide_banner',
      '-i',
      'in.mkv',
      '-map',
      '0:v',
      '-map_chapters',
      '0',
      '-map',
      '0:2',
      '-map',
      '0:1',
      '-map',
      '0:3',
      '-disposition:a:0',
      'default',
      '-disposition:a:1',
      '0',
      '-disposition:s:0',
      '0',
      '-c',
      'copy',
      'out.mkv',
    ]);
  });

  test('an MP4 cannot have every subtitle off, so its first stays on and the plan says so', () => {
    const mp4 = planTracks(raw, preset('dual-french'), 'Ep.mp4');
    expect(mp4.defaults).toEqual([2, 3]);
    expect(mp4.notes).toHaveLength(1);
    const mkv = planTracks(raw, preset('dual-french'), 'Ep.mkv');
    expect(mkv.defaults).toEqual([2]);
    expect(mkv.notes).toEqual([]);
    // Once an MP4 is in that state, running the same settings again changes nothing.
    const done: StreamInfo[] = [
      { index: 0, type: 'video' },
      { index: 1, type: 'audio', language: 'fra', default: true },
      { index: 2, type: 'audio', language: 'eng', default: false },
      { index: 3, type: 'subtitle', language: 'eng', default: true },
    ];
    expect(planTracks(done, preset('dual-french'), 'Ep.mp4').action).toBe(
      'already-clean',
    );
    expect(isMp4Family('a.M4V')).toBe(true);
    expect(isMp4Family('a.mkv')).toBe(false);
  });

  test('the presets are what they say', () => {
    expect(TRACK_PRESETS.map((p) => p.id)).toEqual([
      'dual-french',
      'french-english-subs',
      'english',
    ]);
    expect(preset('english').audioLanguages).toEqual(['eng']);
  });
});
