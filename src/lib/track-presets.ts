/**
 * Ready-made settings for the Remove extra tracks tab, shared by the page (to fill its fields) and
 * the server (so tests can run the same settings).
 */

export interface TrackPresetSettings {
  audioLanguages: string[];
  subtitleLanguages: string[];
  orderByLanguage: boolean;
  defaultAudio: string;
  defaultSubtitle: string;
}

export const TRACK_PRESETS: Array<{
  id: string;
  label: string;
  settings: TrackPresetSettings;
}> = [
  {
    id: 'dual-french',
    label: 'Dual audio, French first (English subtitles off)',
    settings: {
      audioLanguages: ['fra', 'eng'],
      subtitleLanguages: ['eng'],
      orderByLanguage: true,
      defaultAudio: 'fra',
      defaultSubtitle: 'none',
    },
  },
  {
    id: 'french-english-subs',
    label: 'French only, English subtitles on',
    settings: {
      audioLanguages: ['fra'],
      subtitleLanguages: ['eng'],
      orderByLanguage: true,
      defaultAudio: 'fra',
      defaultSubtitle: 'eng',
    },
  },
  {
    id: 'english',
    label: 'English only',
    settings: {
      audioLanguages: ['eng'],
      subtitleLanguages: ['eng'],
      orderByLanguage: true,
      defaultAudio: 'eng',
      defaultSubtitle: '',
    },
  },
];
