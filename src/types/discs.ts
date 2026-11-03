/**
 * Types for the Discs page: the DVD ripper on the server, as seen from the files it
 * leaves in the DVDs folder.
 */

/** The drive, as last reported by the ripper's host-side helper. */
export interface DiscDrive {
  /** Whether a disc is in the drive */
  media: boolean;
  /** The disc's label, empty when there is no disc */
  label: string;
  /** When the helper last reported, in seconds since the epoch */
  updated: number | null;
  /** Whether the helper reported recently enough to trust */
  alive: boolean;
}

/** What the ripper is doing, as it reported it. */
export interface DiscRun {
  state: 'running' | 'idle';
  name: string;
  step: string;
  /** Seconds since the epoch */
  updated: number;
}

/** A note for the next disc that goes in, so it is named or filed as TV right away. */
export interface DiscNext {
  /**
   * The note is for the disc already being ripped (a movie, named while it is read), not for
   * the one after it
   */
  current?: boolean;
  mode: 'movie' | 'tv';
  name?: string;
  show?: string;
  season?: number;
  episode?: number;
}

/** A note the ripper left because something needs a person. */
export interface DiscAttention {
  /** The file name, which is what dismisses it */
  file: string;
  /** The disc it is about */
  name: string;
  lines: string[];
}

/** How far the copy of a disc has got, as the ripper wrote it. */
export interface DiscCopy {
  /** Bytes on the disc */
  total: number;
  /** Bytes copied so far */
  bytes: number;
  /** Seconds since the epoch when the copy started */
  startedAt: number;
  /** Seconds since the epoch when this was last written */
  updatedAt: number;
}

/** A disc that is being copied, extracted or converted. */
export interface DiscWorking {
  /** Its working folder, which is what identifies it */
  name: string;
  /** What to call it: the name it will be filed under when that is known */
  title: string;
  /** Where it is: copying, extracting, waiting for Frame Shift, converting, or being filed */
  stage: DiscStage;
  /** The last lines of its log */
  lines: string[];
  /** Whether its titles have been queued in Frame Shift */
  queued: boolean;
  /** Its conversions in Frame Shift, once there are any */
  conversion: DiscConversion | null;
  /** Seconds since its log was last written, to tell a slow step from a stuck one */
  quietSeconds: number | null;
  /** How far the copy has got, while the disc is being copied */
  copy: DiscCopy | null;
}

/** The steps a disc goes through after it is scanned. */
export type DiscStage =
  'copying' | 'extracting' | 'waiting' | 'converting' | 'filing';

/** How far a disc's conversions in Frame Shift have got. */
export interface DiscConversion {
  total: number;
  done: number;
  failed: number;
  /** 0 to 100, over all of them */
  percent: number;
}

/** A disc that was filed, newest first. */
export interface DiscDone {
  name: string;
  /** Unix seconds */
  at: number;
  /** What was made from the disc, or null when it could not be read */
  contents: DiscContents | null;
}

/** What a filed disc holds. */
export interface DiscContents {
  /** The movie itself */
  movie: boolean;
  /** Episodes of a show */
  episodes: number;
  trailers: number;
  featurettes: number;
  /** Other extras: behind the scenes, deleted scenes, anything not sorted */
  extras: number;
  /** Other versions of the movie: a different cut, an extended ending */
  alternates: number;
  /** Titles that were copies of the movie (another angle or playlist) and were left out */
  copies: number;
}

/** What TMDB made of a parked disc's label, left beside it by the ripper. */
export interface DiscSuggestion {
  show?: string;
  season?: number;
  disc?: number;
}

/** One match from a TMDB search, to pick from. */
export interface TmdbResult {
  kind: 'movie' | 'tv';
  id: number;
  /** "Title (Year)", already safe to use as a name */
  name: string;
  /** A movie's length, or how many seasons a show has */
  size: string;
  overview: string;
  /** TMDB's poster path or TheTVDB's poster address, or empty */
  poster: string;
  /** The database it is from: TMDB is asked first, TheTVDB has what TMDB does not */
  source: 'tmdb' | 'tvdb';
}

/** A disc that was copied and is waiting to be told what it is. */
export interface DiscParked {
  /** Its folder name, which is what a request to convert it is made by */
  name: string;
  suggestion: DiscSuggestion | null;
}

/** One way discs can be converted, as the ripper's settings file lists it. */
export interface DiscPreset {
  id: string;
  /** What the person sees */
  name: string;
  /** mkv or mp4 */
  container: string;
  /** libx265, libx264, libsvtav1 or copy */
  video: string;
  /** How good the picture is kept, 0 to 51. Lower is better and bigger */
  quality: number;
  /** ultrafast to veryslow: slower takes longer and makes smaller files */
  speed: string;
  /** 10-bit color */
  tenBit: boolean;
  /** copy, aac or ac3 */
  audio: string;
  /** Clean up interlaced video */
  deinterlace: boolean;
  /** keep or none */
  subtitles: string;
  /** One of the ones that come with the ripper: it cannot be changed or deleted */
  builtIn: boolean;
}

/** What the person fills in to make or change a preset of their own. */
export type DiscPresetInput = Omit<DiscPreset, 'id' | 'builtIn'> & {
  /** Present when changing one that exists, left out to make a new one */
  id?: string;
};

export interface DiscConvert {
  presets: DiscPreset[];
  /** The id of the preset new discs are converted with */
  chosen: string;
}

export interface DiscsState {
  /** Whether the DVDs folder exists on the server */
  available: boolean;
  /** Whether the ripper ejects a disc when it is done with it */
  eject: boolean;
  /** Whether a disc that goes in is scanned and ripped without being asked */
  autoScan: boolean;
  /** Whether only a movie is made from a disc, with none of its extras */
  movieOnly: boolean;
  drive: DiscDrive | null;
  run: DiscRun | null;
  next: DiscNext | null;
  attention: DiscAttention[];
  working: DiscWorking[];
  /** Discs copied and waiting to be told what they are, by folder name */
  parked: DiscParked[];
  /** Finished folders whose name has no year in it, which Plex wants */
  needsYear: string[];
  /** How many finished folders there are */
  finishedCount: number;
  /** The last few filed, newest first */
  recent: DiscDone[];
  /** How discs are converted when they are sent to Frame Shift */
  convert: DiscConvert;
  /** The folder in the DVDs folder where finished discs are put */
  outputFolder: string;
}

/** What the page can ask the host to do. */
export type DiscCommand =
  | { action: 'eject' }
  | {
      action: 'rip';
      mode: 'movie';
      name?: string;
      image?: string;
      /** Redo a movie that is already filed: the old file is kept, not a second copy made */
      replace?: boolean;
    }
  | {
      action: 'rip';
      mode: 'tv';
      show: string;
      season: number;
      episode?: number;
      image?: string;
    }
  | {
      action: 'rename';
      old: string;
      new: string;
      /** When the new name is taken, the folder that has it is set aside (kept), not refused */
      replace?: boolean;
    }
  /** Ask TMDB which movie a finished folder is, and rename it Title (Year) */
  | { action: 'match'; old: string }
  /** Search TMDB for movies, shows or either; the query may be a TMDB or IMDb address */
  | {
      action: 'search';
      kind: 'movie' | 'tv' | 'any';
      query: string;
      year?: number;
    };

export interface DiscCommandResult {
  /** Whether the host has answered yet */
  done: boolean;
  ok?: boolean;
  message?: string;
}

/** One extra (trailer, featurette...) of a ripped movie. */
export interface ExtraItem {
  /** Where it is, under the DVDs folder, as the page sends it back to rename it */
  path: string;
  /** The Plex extras folder it is in */
  folder: string;
  /** Its name, without the file ending */
  name: string;
  /** Still the ripper's own name, like "Trailer 01 (2 min)" */
  unnamed: boolean;
}

/** What DVD Fandom lists for a movie's disc. */
export interface FandomHint {
  found: boolean;
  /** The wiki page's title, and its address */
  page?: string;
  url?: string;
  /** The movie's running time as the wiki words it, like "Approx. 77 minutes" */
  runtime?: string | null;
  /** The bonus features, each with how deep it is nested under the one above */
  features?: { text: string; depth: number }[];
}

/** One bonus feature a database lists, with the length it gives (if it gives one). */
export interface NameEntry {
  text: string;
  /** How deep it is under the entry above it (0 is a heading such as "Disc 1") */
  depth: number;
  seconds: number | null;
  /** Marked as the others played one after another */
  playAll?: boolean;
  /** The extras folder the database's own type of it points to */
  kind?: string | null;
}

/** What one database lists as the bonus features of a movie's disc. */
export interface NameSource {
  source: 'DVD Compare' | 'TheDiscDB' | 'DVD Fandom';
  /** The page the list is from, and its address */
  page: string;
  url: string;
  /** Which release of the movie (Region 1 only for DVD Compare and TheDiscDB) */
  release?: string;
  /** The movie's running time as the database words it, if it gives one */
  runtime?: string | null;
  features: NameEntry[];
}

/** What "Try to match the names" made of one extra. */
export interface ExtraSuggestion {
  /** matched: clear; unsure: might be; none: nothing like a listed name */
  state: 'matched' | 'unsure' | 'none';
  /** One sentence saying why */
  note: string;
  /** How long the extra is, in seconds, when that was found out */
  seconds?: number | null;
  name?: string;
  /** The extras folder its place on the wiki's list suggests */
  kind?: string | null;
  /** What was written on the video and what was said in it */
  saw: string;
  heard: string;
}

/** A movie's matching of its unnamed extras, as far as it has got. */
export interface ExtraMatch {
  status: 'running' | 'done' | 'failed';
  total: number;
  done: number;
  /** By the extra's path */
  suggestions: Record<string, ExtraSuggestion>;
  /** The databases whose names were compared with */
  sources?: string[];
  /** Something that did not work but did not stop it (the listener being down) */
  warning?: string;
  error?: string;
}

export interface ExtraMovie {
  movie: string;
  items: ExtraItem[];
}

/** An extra that was taken out of its movie (it sits in the _removed folder until put back) */
export interface RemovedExtra {
  /** Where it is, under the DVDs folder, as the page sends it back to restore it */
  path: string;
  /** The movie it came from */
  movie: string;
  /** The Plex extras folder it came from */
  folder: string;
  /** Its name, without the file ending */
  name: string;
}
