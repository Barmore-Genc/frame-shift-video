import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { AppErrorBoundary } from '@/components/app-error-boundary';
import {
  CollapsibleCard,
  setAllSections,
  showSection,
} from '@/components/collapsible-card';
import { ConvertChoice } from '@/components/convert-choice';
import { TmdbPicker } from '@/components/tmdb-picker';
import { SubtitlesSection } from '@/components/subtitles-section';
import { ExtrasSection } from '@/components/extras-section';
import { describeContents } from '@/lib/disc-contents';
import { copyProgress } from '@/lib/copy-progress';
import { parseLabel } from '@/lib/tmdb-results';
import {
  applyTextSize,
  describeTextSize,
  nextTextSize,
  readTextSize,
  saveTextSize,
  type TextSize,
} from '@/lib/text-size';
import type { SubtitlesState } from '@/types/subtitles';
import {
  useDiscs,
  useSubtitles,
  useSetDiscEject,
  useSetDiscAutoScan,
  useSetDiscMovieOnly,
  useSetDiscPreset,
  useSetDiscNext,
  useDismissDiscAttention,
  useDiscCommand,
} from '@/lib/api-hooks';
import type {
  DiscCommand,
  DiscCommandResult,
  DiscConversion,
  DiscCopy,
  DiscNext,
  DiscParked,
  DiscsState,
  DiscStage,
} from '@/types/discs';
import { Check } from '@phosphor-icons/react';

export const Route = createFileRoute('/discs/')({
  component: DiscsPage,
});

/** What a person fills in to say what a disc is. */
interface Details {
  mode: 'movie' | 'tv';
  name: string;
  show: string;
  season: string;
  episode: string;
}

const EMPTY_DETAILS: Details = {
  mode: 'movie',
  name: '',
  show: '',
  season: '1',
  episode: '1',
};

/** Why the details are not enough yet, or null. */
function detailsProblem(details: Details): string | null {
  if (details.mode === 'movie') return null;
  if (!details.show.trim()) {
    return 'Type the show name, with its year, like The Show (2001).';
  }
  if (!/^\d+$/.test(details.season) || Number(details.season) < 1) {
    return 'The season must be a number, like 2.';
  }
  if (
    details.episode &&
    (!/^\d+$/.test(details.episode) || Number(details.episode) < 1)
  ) {
    return 'The first episode must be a number, like 1.';
  }
  return null;
}

function toNote(details: Details): DiscNext {
  if (details.mode === 'tv') {
    return {
      mode: 'tv',
      show: details.show.trim(),
      season: Number(details.season),
      episode: Number(details.episode || 1),
    };
  }
  const name = details.name.trim();
  return name ? { mode: 'movie', name } : { mode: 'movie' };
}

function toRip(
  details: Details,
  image?: string,
  replace?: boolean,
): DiscCommand {
  const note = toNote(details);
  const base = image ? { image } : {};
  if (note.mode === 'tv') {
    return {
      action: 'rip',
      mode: 'tv',
      show: note.show!,
      season: note.season!,
      episode: note.episode,
      ...base,
    };
  }
  return {
    action: 'rip',
    mode: 'movie',
    ...(note.name ? { name: note.name } : {}),
    ...(replace ? { replace: true } : {}),
    ...base,
  };
}

function describeNote(note: DiscNext): string {
  if (note.current) {
    return `${note.name ? `the movie ${note.name}` : 'a movie'}, named once it has been copied`;
  }
  if (note.mode === 'tv') {
    return `episodes of ${note.show}, season ${note.season}, from episode ${note.episode}`;
  }
  return note.name ? `the movie ${note.name}` : 'a movie';
}

/**
 * The name the person picked for the disc that is being read or copied right now, in words, or
 * null. The disc's own label is all the queue knows until the copy is done, so without this the
 * row looks as if the pick was lost.
 */
export function chosenName(
  next: DiscNext | null,
  stage: DiscStage | 'scanning',
): string | null {
  if (!next?.current) return null;
  if (stage !== 'scanning' && stage !== 'copying') return null;
  if (next.mode === 'tv') {
    return next.show
      ? `${next.show}${next.season ? `, season ${next.season}` : ''}`
      : null;
  }
  return next.name ?? null;
}

function secondsAgo(epochSeconds: number | null): string {
  if (!epochSeconds) return 'never';
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - epochSeconds));
  if (seconds < 5) return 'just now';
  if (seconds < 90) return `${seconds} seconds ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes ago`;
  return `${Math.round(seconds / 3600)} hours ago`;
}

const INPUT =
  'w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white';
const BUTTON =
  'min-h-[44px] px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
const PRIMARY = `${BUTTON} bg-blue-600 text-white hover:bg-blue-700`;
const SECONDARY = `${BUTTON} bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-600`;

const HELP: Record<string, string> = {
  Drive:
    'This is the DVD drive. Put a disc in and, by default, it is copied by itself. When the copy is done the disc comes out, and you can put the next one in.',
  'Tell it what the disc is':
    'Optional. If you know the name of the disc, or that it is a TV show, say so here before putting it in. Otherwise it works it out from the disc.',
  'Needs you':
    'Something shows up here only when it cannot go on without you. Read the note, do what it says, then press Dismiss.',
  Queue:
    'Every disc in progress, from copying to being ready to watch. Nothing to do here but wait. You will get a message when a disc is finished.',
  'Copied, waiting to be told what they are':
    'These discs look like TV shows. Tell it the show and the season and it will finish them.',
  'Finished, but no year yet':
    'Plex finds the poster and details best when the name has the year, like Stellaluna (1996). Press Match on TMDB and it fills it in for you.',
};

function Section({
  title,
  children,
  hint,
  badge,
  urgent,
}: {
  title: string;
  children: ReactNode;
  hint?: string;
  badge?: string;
  urgent?: boolean;
}) {
  return (
    <CollapsibleCard
      title={title}
      hint={hint}
      help={HELP[title]}
      badge={badge}
      urgent={urgent}
    >
      {children}
    </CollapsibleCard>
  );
}

/** What the host answered to a request, or what went wrong sending it. */
function Answer({
  result,
  error,
}: {
  result?: DiscCommandResult;
  error?: Error | null;
}) {
  if (error) {
    return (
      <p className="mt-3 text-sm text-red-600 dark:text-red-400">
        {error.message}
      </p>
    );
  }
  if (!result) return null;
  const good = result.done && result.ok;
  return (
    <p
      className={`mt-3 text-sm ${good ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
    >
      {result.message || (result.ok ? 'Done.' : 'That did not work.')}
    </p>
  );
}

/** Movie or TV, and the fields each needs. */
function DetailsFields({
  value,
  onChange,
}: {
  value: Details;
  onChange: (next: Details) => void;
}) {
  const set = (patch: Partial<Details>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <div className="flex gap-4 text-gray-900 dark:text-white">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={value.mode === 'movie'}
            onChange={() => set({ mode: 'movie' })}
          />
          Movie
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={value.mode === 'tv'}
            onChange={() => set({ mode: 'tv' })}
          />
          TV show
        </label>
      </div>
      {value.mode === 'movie' ? (
        <label className="block text-sm text-gray-700 dark:text-gray-300">
          Name, with the year if you know it (optional)
          <input
            className={`${INPUT} mt-1`}
            placeholder="Stellaluna (1996)"
            value={value.name}
            onChange={(event) => set({ name: event.target.value })}
          />
        </label>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm text-gray-700 dark:text-gray-300 sm:col-span-3">
            Show, with its year
            <input
              className={`${INPUT} mt-1`}
              placeholder="The Fairly OddParents (2001)"
              value={value.show}
              onChange={(event) => set({ show: event.target.value })}
            />
          </label>
          <label className="block text-sm text-gray-700 dark:text-gray-300">
            Season
            <input
              className={`${INPUT} mt-1`}
              inputMode="numeric"
              value={value.season}
              onChange={(event) => set({ season: event.target.value })}
            />
          </label>
          <label className="block text-sm text-gray-700 dark:text-gray-300">
            First episode on the disc
            <input
              className={`${INPUT} mt-1`}
              inputMode="numeric"
              value={value.episode}
              onChange={(event) => set({ episode: event.target.value })}
            />
          </label>
        </div>
      )}
    </div>
  );
}

export function DriveSection({ state }: { state: DiscsState }) {
  const eject = useSetDiscEject();
  const autoScan = useSetDiscAutoScan();
  const movieOnly = useSetDiscMovieOnly();
  const preset = useSetDiscPreset();
  const command = useDiscCommand();
  const { drive, run } = state;
  // The same bar the queue shows, here too, so the card that says "working" also shows how far.
  const copying = state.working.find((disc) => disc.copy)?.copy ?? null;

  return (
    <Section title="Drive">
      {!drive || !drive.alive ? (
        <p className="text-amber-700 dark:text-amber-400">
          The disc helper on the server has not reported{' '}
          {drive ? secondsAgo(drive.updated) : 'yet'}. Discs still copy by
          themselves, but the buttons here will not work until it is running.
        </p>
      ) : (
        <p className="text-gray-900 dark:text-white">
          {drive.media ? (
            <>
              A disc is in the drive:{' '}
              <strong>{drive.label || 'no name'}</strong>
            </>
          ) : (
            'The drive is empty.'
          )}
        </p>
      )}
      <p className="mt-2 text-gray-700 dark:text-gray-300">
        {run?.state === 'running' ? (
          <>
            <strong>Working</strong>
            {run.name ? ` on ${run.name}` : ''}: {run.step}{' '}
            <span className="text-sm text-gray-600 dark:text-gray-400">
              ({secondsAgo(run.updated)})
            </span>
          </>
        ) : (
          'Nothing is being copied right now.'
        )}
      </p>
      {run?.state === 'running' && copying && <CopyBar copy={copying} />}

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-gray-900 dark:text-white">
          <input
            type="checkbox"
            checked={state.autoScan}
            disabled={autoScan.isPending}
            onChange={(event) => autoScan.mutate(event.target.checked)}
          />
          Start by itself when a disc is put in
        </label>
      </div>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        If this is off, nothing starts until you press “Rip the disc in the
        drive now”, so you can type its name first.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-gray-900 dark:text-white">
          <input
            type="checkbox"
            checked={state.movieOnly}
            disabled={movieOnly.isPending}
            onChange={(event) => movieOnly.mutate(event.target.checked)}
          />
          Keep only the movie (skip bonus features)
        </label>
      </div>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        Bonus features and trailers on the disc are skipped. TV discs are not
        affected.
      </p>
      <ConvertChoice
        convert={state.convert}
        folder={state.outputFolder}
        pending={preset.isPending}
        onChoose={(id) => preset.mutate(id)}
      />
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-gray-900 dark:text-white">
          <input
            type="checkbox"
            checked={state.eject}
            disabled={eject.isPending}
            onChange={(event) => eject.mutate(event.target.checked)}
          />
          Open the tray when the disc has been read
        </label>
        <button
          type="button"
          className={SECONDARY}
          disabled={command.isPending || !drive?.media}
          onClick={() => command.mutate({ action: 'eject' })}
        >
          {command.isPending ? 'Ejecting…' : 'Eject now'}
        </button>
      </div>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        The disc comes out as soon as it has been read. If part of it could not
        be read, it stays in. With this off, it always stays in until you press
        “Eject now”.
      </p>
      <Answer
        result={command.data}
        error={
          command.error ??
          eject.error ??
          autoScan.error ??
          movieOnly.error ??
          preset.error
        }
      />
    </Section>
  );
}

export function NextSection({ state }: { state: DiscsState }) {
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS);
  const [replace, setReplace] = useState(false);
  const setNext = useSetDiscNext();
  const command = useDiscCommand();
  const problem = detailsProblem(details);
  const diskIn = state.drive?.alive && state.drive.media;
  // A disc that is already being read cannot be started again, but it is named once it has
  // been copied, so a movie picked now still goes to it.
  const ripping = !!diskIn && state.run?.state === 'running';
  // The disc in the drive is looked up by what its label says it is.
  const labelInfo =
    diskIn && state.drive?.label ? parseLabel(state.drive.label) : null;

  return (
    <Section
      title="Tell it what the disc is"
      hint="The name printed on a disc is often short or odd. Tell it the real name here before you put the disc in. A TV show also needs its season. While a disc is being copied, a movie you pick here names that disc once it has been copied."
    >
      {state.next && (
        <p className="mb-4 rounded-lg bg-blue-50 dark:bg-blue-900/30 p-3 text-blue-900 dark:text-blue-100">
          {state.next.current ? 'The disc being copied' : 'The next disc'} will
          be treated as {describeNote(state.next)}.{' '}
          <button
            type="button"
            className="underline"
            disabled={setNext.isPending}
            onClick={() => setNext.mutate(null)}
          >
            Take that back
          </button>
        </p>
      )}
      <TmdbPicker
        kind={details.mode}
        initialQuery={labelInfo?.title ?? ''}
        autoSearch={!!labelInfo}
        onPick={(result) =>
          setDetails((current) =>
            result.kind === 'movie'
              ? { ...current, mode: 'movie', name: result.name }
              : {
                  ...current,
                  mode: 'tv',
                  show: result.name,
                  season: String(labelInfo?.season ?? current.season),
                },
          )
        }
      />
      <div className="mt-4">
        <DetailsFields value={details} onChange={setDetails} />
      </div>
      {problem && (
        <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
          {problem}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          className={PRIMARY}
          disabled={!!problem || setNext.isPending}
          onClick={() => setNext.mutate(toNote(details))}
        >
          For the next disc
        </button>
        {ripping && details.mode === 'movie' && (
          <button
            type="button"
            className={SECONDARY}
            disabled={!!problem || setNext.isPending}
            onClick={() =>
              setNext.mutate({ ...toNote(details), current: true })
            }
          >
            For the disc being copied
          </button>
        )}
        <button
          type="button"
          className={SECONDARY}
          disabled={!!problem || command.isPending || !diskIn || ripping}
          title={
            !diskIn
              ? 'There is no disc in the drive'
              : ripping
                ? 'The disc is already being copied'
                : undefined
          }
          onClick={() => command.mutate(toRip(details, undefined, replace))}
        >
          {command.isPending ? 'Starting…' : 'Rip the disc in the drive now'}
        </button>
      </div>
      {details.mode === 'movie' && (
        <label className="mt-3 flex items-start gap-2 text-sm text-gray-900 dark:text-white">
          <input
            type="checkbox"
            className="mt-1"
            checked={replace}
            onChange={(event) => setReplace(event.target.checked)}
          />
          <span>
            Do it again over a movie that is already in the library. The old
            file is kept, and the new one takes its place when it is ready.
            Without this, a second copy is made with “(2)” in its name.
          </span>
        </label>
      )}
      <Answer result={command.data} error={command.error ?? setNext.error} />
    </Section>
  );
}

function AttentionSection({ state }: { state: DiscsState }) {
  const dismiss = useDismissDiscAttention();
  if (state.attention.length === 0) return null;
  return (
    <Section title="Needs you" badge={String(state.attention.length)} urgent>
      <ul className="space-y-4">
        {state.attention.map((note) => (
          <li
            key={note.file}
            className="rounded-lg border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <strong className="text-gray-900 dark:text-white">
                {note.name}
              </strong>
              <button
                type="button"
                className={`${SECONDARY} shrink-0`}
                disabled={dismiss.isPending}
                onClick={() => dismiss.mutate(note.file)}
              >
                Dismiss
              </button>
            </div>
            {note.lines.map((line, index) => (
              <p
                key={index}
                className="mt-1 text-sm text-gray-800 dark:text-gray-200"
              >
                {line}
              </p>
            ))}
          </li>
        ))}
      </ul>
      {dismiss.error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">
          {dismiss.error.message}
        </p>
      )}
    </Section>
  );
}

/** The steps a disc goes through, in order, as the queue shows them. */
const PIPELINE: { stage: DiscStage | 'scanning'; label: string }[] = [
  { stage: 'scanning', label: 'Reading' },
  { stage: 'copying', label: 'Copying' },
  { stage: 'extracting', label: 'Preparing' },
  { stage: 'waiting', label: 'Waiting' },
  { stage: 'converting', label: 'Converting' },
  { stage: 'filing', label: 'Saving' },
];

/** Past this many quiet seconds a step is called slow, not busy. */
const QUIET_SECONDS = 30 * 60;

function describeStage(disc: QueueEntry): string {
  switch (disc.stage) {
    case 'scanning':
      return 'Checking that the disc can be read';
    case 'copying':
      return 'Copying the disc. The tray opens when this is done, and the next disc can go in.';
    case 'extracting':
      return 'The disc is out. Getting the movie out of the copy.';
    case 'waiting':
      return disc.queued
        ? 'In line to be converted'
        : 'Ready. It joins the line within a few minutes.';
    case 'converting':
      return 'Being converted into a movie file that plays everywhere';
    case 'filing':
      return 'Done converting. Putting it in the library.';
  }
}

/** A row of the queue: a disc in the working folder, or the one the drive is reading. */
interface QueueEntry {
  key: string;
  title: string;
  stage: DiscStage | 'scanning';
  queued: boolean;
  conversion: DiscConversion | null;
  lines: string[];
  quietSeconds: number | null;
  copy: DiscCopy | null;
}

function queueOf(state: DiscsState): QueueEntry[] {
  const entries: QueueEntry[] = state.working.map((disc) => ({
    key: disc.name,
    title: disc.title,
    stage: disc.stage,
    queued: disc.queued,
    conversion: disc.conversion,
    lines: disc.lines,
    quietSeconds: disc.quietSeconds,
    copy: disc.copy,
  }));
  // The disc being scanned has no folder yet, so it comes from the ripper's own status.
  if (
    state.run?.state === 'running' &&
    !entries.some((e) => e.stage === 'copying')
  ) {
    entries.unshift({
      key: 'scanning',
      title: state.run.name || 'A disc',
      stage: 'scanning',
      queued: false,
      conversion: null,
      lines: state.run.step ? [state.run.step] : [],
      quietSeconds: null,
      copy: null,
    });
  }
  return entries;
}

/** The bar for a disc that is being copied, with how much is done and how long is left. */
function CopyBar({ copy }: { copy: DiscCopy }) {
  const progress = copyProgress(copy, Math.floor(Date.now() / 1000));
  if (!progress) return null;
  return (
    <div className="mt-2">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
        aria-label="How much of the disc is copied"
        className="h-3 w-full rounded-full bg-gray-200 dark:bg-gray-700"
      >
        <div
          className="h-3 rounded-full bg-blue-600"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
        {progress.percent}% · {progress.copied} of {progress.total}
        {progress.speed ? ` · ${progress.speed}` : ''}
        {progress.left
          ? ` · ${progress.left}`
          : progress.stalled
            ? ' · not updating, it may be stuck'
            : ' · working out the time left…'}
      </p>
    </div>
  );
}

function Pipeline({ stage }: { stage: DiscStage | 'scanning' }) {
  const at = PIPELINE.findIndex((step) => step.stage === stage);
  return (
    <ol className="mt-2 flex flex-wrap items-center gap-1 text-sm">
      {PIPELINE.map((step, index) => (
        <li
          key={step.stage}
          className={`rounded-full px-2 py-0.5 ${
            index < at
              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
              : index === at
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
          }`}
        >
          {index < at ? (
            <Check
              size={12}
              weight="bold"
              aria-hidden="true"
              className="mr-1 inline"
            />
          ) : null}
          {step.label}
        </li>
      ))}
    </ol>
  );
}

/** How many filed discs the queue shows before it is asked to show them all. */
const FILED_SHOWN = 5;

function WorkingSection({ state }: { state: DiscsState }) {
  const [showFiled, setShowFiled] = useState(false);
  const queue = queueOf(state);
  const drive = state.drive;
  const driveBusy = state.run?.state === 'running';
  if (queue.length === 0 && state.recent.length === 0) return null;
  return (
    <Section
      title="Queue"
      badge={
        state.working.length > 0 ? `${state.working.length} working` : undefined
      }
      hint="Every disc, from being read to being ready to watch. The tray opens when a disc has been copied, so the next one can go in while this one is made ready."
    >
      <p className="mb-4 text-sm text-gray-700 dark:text-gray-300">
        {driveBusy
          ? 'The drive is busy with a disc. The next one can go in once it is copied and out.'
          : drive?.media
            ? 'The drive is free, and there is a disc in it.'
            : 'The drive is free. Put in the next disc.'}
      </p>
      {queue.length > 0 && (
        <ul className="space-y-4">
          {queue.map((disc) => (
            <li
              key={disc.key}
              className="rounded-lg border border-gray-200 dark:border-gray-600 p-4"
            >
              <strong className="text-gray-900 dark:text-white">
                {disc.title}
              </strong>
              {chosenName(state.next, disc.stage) && (
                <p className="mt-1 text-sm font-medium text-green-700 dark:text-green-400">
                  <Check
                    size={14}
                    weight="bold"
                    aria-hidden="true"
                    className="mr-1 inline"
                  />
                  You picked “{chosenName(state.next, disc.stage)}”. The disc
                  gets that name when the copy is done.
                </p>
              )}
              <Pipeline stage={disc.stage} />
              <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                {describeStage(disc)}
                {disc.quietSeconds !== null &&
                  disc.quietSeconds > QUIET_SECONDS &&
                  (disc.stage === 'copying' || disc.stage === 'extracting') &&
                  ' Nothing has been written for a while, so it may be stuck.'}
              </p>
              {disc.copy && <CopyBar copy={disc.copy} />}
              {disc.conversion && (
                <div className="mt-2">
                  <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                    <div
                      className="h-2 rounded-full bg-blue-600"
                      style={{ width: `${disc.conversion.percent}%` }}
                    />
                  </div>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    {disc.conversion.done + disc.conversion.failed} of{' '}
                    {disc.conversion.total} file
                    {disc.conversion.total === 1 ? '' : 's'} ·{' '}
                    {disc.conversion.percent}%
                    {disc.conversion.failed > 0
                      ? ` · ${disc.conversion.failed} failed`
                      : ''}
                  </p>
                </div>
              )}
              <details className="mt-2">
                <summary className="flex min-h-[44px] cursor-pointer items-center text-sm text-gray-600 dark:text-gray-400">
                  Log
                </summary>
                <pre className="mt-1 overflow-x-auto rounded-lg bg-gray-100 dark:bg-gray-900 p-3 text-sm text-gray-800 dark:text-gray-200">
                  {disc.lines.join('\n') || 'No log yet.'}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      )}
      {state.recent.length > 0 && (
        <div className={queue.length > 0 ? 'mt-5' : ''}>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Filed
          </h3>
          <ul className="mt-1 space-y-1 text-sm text-gray-700 dark:text-gray-300">
            {(showFiled
              ? state.recent
              : state.recent.slice(0, FILED_SHOWN)
            ).map((done) => (
              <li key={done.name}>
                <Check
                  size={14}
                  weight="bold"
                  aria-label="Filed"
                  className="inline text-green-600 dark:text-green-400"
                />{' '}
                {done.name}{' '}
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {secondsAgo(done.at)}
                </span>
                {done.contents && describeContents(done.contents) && (
                  <span className="block pl-5 text-gray-600 dark:text-gray-400">
                    {describeContents(done.contents)}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {state.recent.length > FILED_SHOWN && (
            <button
              type="button"
              className={`${SECONDARY} mt-2 !px-3 !py-1 text-sm`}
              onClick={() => setShowFiled((value) => !value)}
            >
              {showFiled
                ? 'Show fewer'
                : state.finishedCount > state.recent.length
                  ? `Show all ${state.recent.length} of the ${state.finishedCount} filed`
                  : `Show all ${state.recent.length}`}
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

function ParkedDisc({ disc }: { disc: DiscParked }) {
  const { name, suggestion } = disc;
  // What TMDB made of the disc's label, to start from. The first episode is not guessed.
  const [details, setDetails] = useState<Details>({
    ...EMPTY_DETAILS,
    mode: 'tv',
    show: suggestion?.show ?? '',
    season: String(suggestion?.season ?? 1),
  });
  const command = useDiscCommand();
  const problem = detailsProblem(details);
  return (
    <li className="rounded-lg border border-gray-200 dark:border-gray-600 p-4">
      <strong className="text-gray-900 dark:text-white">{name}</strong>
      {suggestion?.show && (
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          TMDB thinks it is {suggestion.show}
          {suggestion.season ? `, season ${suggestion.season}` : ''}
          {suggestion.disc ? `, disc ${suggestion.disc}` : ''}. Check the first
          episode on the disc, then convert it.
        </p>
      )}
      <div className="mt-3">
        <TmdbPicker
          kind="tv"
          initialQuery={(suggestion?.show ?? parseLabel(name).title).replace(
            / \(\d{4}\)$/,
            '',
          )}
          autoSearch
          onPick={(result) =>
            setDetails((current) => ({
              ...current,
              mode: 'tv',
              show: result.name,
              season: String(suggestion?.season ?? current.season),
            }))
          }
        />
      </div>
      <div className="mt-3">
        <DetailsFields value={details} onChange={setDetails} />
      </div>
      {problem && (
        <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
          {problem}
        </p>
      )}
      <button
        type="button"
        className={`${PRIMARY} mt-4`}
        disabled={!!problem || command.isPending}
        onClick={() => command.mutate(toRip(details, name))}
      >
        {command.isPending ? 'Starting…' : 'Convert it'}
      </button>
      <Answer result={command.data} error={command.error} />
    </li>
  );
}

function ParkedSection({ state }: { state: DiscsState }) {
  if (state.parked.length === 0) return null;
  return (
    <Section
      title="Copied, waiting to be told what they are"
      badge={String(state.parked.length)}
      urgent
      hint="These discs were copied but look like TV episodes, whose season and episode numbers are not on the disc."
    >
      <ul className="space-y-4">
        {state.parked.map((disc) => (
          <ParkedDisc key={disc.name} disc={disc} />
        ))}
      </ul>
    </Section>
  );
}

function NeedsYearRow({ name }: { name: string }) {
  const [value, setValue] = useState(name);
  const command = useDiscCommand();
  const changed = value.trim() !== '' && value.trim() !== name;
  return (
    <li>
      <div className="flex flex-wrap gap-2">
        <input
          className={`${INPUT} flex-1 min-w-48`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label={`New name for ${name}`}
        />
        <button
          type="button"
          className={SECONDARY}
          disabled={!changed || command.isPending}
          onClick={() =>
            command.mutate({ action: 'rename', old: name, new: value })
          }
        >
          Rename
        </button>
        <button
          type="button"
          className={PRIMARY}
          disabled={command.isPending}
          title="Ask TMDB which movie this is, by its name and the length of its file"
          onClick={() => command.mutate({ action: 'match', old: name })}
        >
          Match on TMDB
        </button>
      </div>
      <details className="mt-2">
        <summary className="flex min-h-[44px] cursor-pointer items-center text-sm text-gray-600 dark:text-gray-400">
          Search TMDB yourself
        </summary>
        <div className="mt-2">
          <TmdbPicker
            kind="movie"
            initialQuery={parseLabel(name).title}
            onPick={(result) => setValue(result.name)}
          />
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            “Use this” fills the name above. Press Rename to apply it.
          </p>
        </div>
      </details>
      <Answer result={command.data} error={command.error} />
    </li>
  );
}

function NeedsYearSection({ state }: { state: DiscsState }) {
  if (state.needsYear.length === 0) return null;
  return (
    <Section
      title="Finished, but no year yet"
      badge={String(state.needsYear.length)}
      hint="Plex matches best with the year in the name, like Stellaluna (1996). Match on TMDB finds the movie by its name and the length of its file; Rename lets you type it. Either one renames the files inside too."
    >
      <ul className="space-y-3">
        {state.needsYear.map((name) => (
          <NeedsYearRow key={name} name={name} />
        ))}
      </ul>
    </Section>
  );
}

/**
 * One sentence at the top that says whether anything needs the person, so nobody has to read
 * the cards to find out. Green: nothing to do. Amber: something needs you. Blue: working.
 */
export function summarize(state: DiscsState): {
  tone: 'ok' | 'busy' | 'attention';
  text: string;
  /** The card the "Show me" button goes to */
  goto?: string;
} {
  if (state.attention.length > 0) {
    const count = state.attention.length;
    return {
      tone: 'attention',
      goto: 'Needs you',
      text:
        count === 1
          ? 'One thing needs you. Read the “Needs you” box below.'
          : `${count} things need you. Read the “Needs you” box below.`,
    };
  }
  if (!state.drive || !state.drive.alive) {
    return {
      tone: 'attention',
      text: 'The disc helper on the server is not answering. Discs still copy by themselves, but the buttons here will not work.',
    };
  }
  if (state.parked.length > 0) {
    return {
      tone: 'attention',
      goto: 'Copied, waiting to be told what they are',
      text: 'A disc is waiting to be told what it is. See “Copied, waiting” below.',
    };
  }
  if (state.run?.state === 'running') {
    const where = state.run.name ? ` on ${state.run.name}` : '';
    return {
      tone: 'busy',
      text: `Working${where}. Nothing to do. You will get a message when it is done.`,
    };
  }
  if (state.working.length > 0) {
    return {
      tone: 'busy',
      text: `${state.working.length === 1 ? 'A disc is' : `${state.working.length} discs are`} being made ready to watch. Nothing to do. You can put the next disc in.`,
    };
  }
  if (state.drive.media) {
    return {
      tone: 'ok',
      text: state.autoScan
        ? 'A disc is in the drive. It will start by itself.'
        : 'A disc is in the drive. Press “Rip the disc in the drive now” when you are ready.',
    };
  }
  return {
    tone: 'ok',
    text: 'All good. Put a disc in the drive to start.',
  };
}

const TONES = {
  ok: 'border-green-300 bg-green-50 text-green-900 dark:border-green-700 dark:bg-green-900/20 dark:text-green-200',
  busy: 'border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-200',
  attention:
    'border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-600 dark:bg-amber-900/20 dark:text-amber-200',
};

/** A hint about subtitles waiting to be converted, or null when there is nothing to say. */
export function subtitleHint(
  subtitles: SubtitlesState | undefined,
): string | null {
  if (!subtitles?.available || subtitles.current) return null;
  const waiting = subtitles.files.filter(
    (f) => f.pictures > 0 && f.status === null,
  ).length;
  if (waiting === 0) return null;
  const movies = waiting === 1 ? '1 movie has' : `${waiting} movies have`;
  return `${movies} subtitles that many TVs cannot show. Open “Subtitles” below and press Convert.`;
}

function StatusBanner({
  state,
  updatedAt,
  subtitles,
}: {
  state: DiscsState;
  updatedAt: number;
  subtitles?: SubtitlesState;
}) {
  const { tone, text, goto } = summarize(state);
  const note = subtitleHint(subtitles);
  // The browser tab says so too, for when the page is in another tab.
  useEffect(() => {
    const before = document.title;
    if (tone === 'attention') document.title = '⚠ Discs: needs you';
    return () => {
      document.title = before;
    };
  }, [tone]);
  return (
    <div
      role="status"
      className={`rounded-xl border-2 p-4 text-lg font-medium ${TONES[tone]}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>{text}</span>
        {goto && (
          <button
            type="button"
            className={`${SECONDARY} shrink-0 self-start`}
            onClick={() => showSection(goto)}
          >
            Show me
          </button>
        )}
      </div>
      {note && (
        <div className="mt-3 flex flex-col gap-3 text-base font-normal sm:flex-row sm:items-center sm:justify-between">
          <span>{note}</span>
          <button
            type="button"
            className={`${SECONDARY} shrink-0 self-start`}
            onClick={() => showSection('Subtitles')}
          >
            Show me
          </button>
        </div>
      )}
      <div className="mt-1 text-sm font-normal opacity-90">
        Updated {secondsAgo(Math.floor(updatedAt / 1000))}
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <Section title="How this works">
      <ol className="list-decimal space-y-2 pl-6 text-gray-900 dark:text-white">
        <li>Put a DVD in the drive. It starts by itself.</li>
        <li>
          Wait. The disc is read, and the tray opens when it is done. You can
          put the next disc in while the first one is being made ready.
        </li>
        <li>
          When it is finished, the movie is ready to watch in Plex, and you get
          a message.
        </li>
      </ol>
      <p className="mt-3 text-gray-700 dark:text-gray-300">
        You only need to do something when a yellow box at the top says so. The
        “?” buttons explain each part.
      </p>
    </Section>
  );
}

function DiscsContent() {
  const { data: state, isLoading, error, dataUpdatedAt } = useDiscs();
  const [textSize, setTextSize] = useState<TextSize>(readTextSize);
  // The size applies to this page only, and goes back when you leave it.
  useEffect(() => {
    applyTextSize(textSize);
    return () => applyTextSize(100);
  }, [textSize]);
  const { data: subtitles } = useSubtitles();

  if (isLoading) {
    return <p className="text-gray-600 dark:text-gray-300">Loading…</p>;
  }
  if (error || !state) {
    return (
      <p className="text-red-600 dark:text-red-400">
        {error?.message ?? 'Could not load the discs.'}
      </p>
    );
  }
  if (!state.available) {
    return (
      <Section title="No DVDs folder">
        <p className="text-gray-700 dark:text-gray-300">
          This server has no DVDs folder yet, so there is nothing to show yet.
          It is the folder named DVDs inside the folder Frame Shift is allowed
          to browse.
        </p>
      </Section>
    );
  }

  return (
    <div className="space-y-6">
      <StatusBanner
        state={state}
        updatedAt={dataUpdatedAt}
        subtitles={subtitles}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className={SECONDARY}
          onClick={() => {
            const next = nextTextSize(textSize);
            setTextSize(next);
            saveTextSize(next);
          }}
        >
          Text size: {describeTextSize(textSize)}
        </button>
        <button
          type="button"
          className={SECONDARY}
          onClick={() => setAllSections(true)}
        >
          Expand all
        </button>
        <button
          type="button"
          className={SECONDARY}
          onClick={() => setAllSections(false)}
        >
          Collapse all
        </button>
      </div>
      <HowItWorks />
      <DriveSection state={state} />
      <AttentionSection state={state} />
      <NextSection state={state} />
      <WorkingSection state={state} />
      <ExtrasSection />
      <SubtitlesSection />
      <ParkedSection state={state} />
      <NeedsYearSection state={state} />
      <p className="text-center text-sm text-gray-600 dark:text-gray-400">
        {state.finishedCount === 1
          ? '1 movie or show is finished and ready to watch.'
          : `${state.finishedCount} movies and shows are finished and ready to watch.`}
      </p>
    </div>
  );
}

function DiscsPage() {
  return (
    <div className="container mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
          Discs
        </h1>
      </header>
      <AppErrorBoundary>
        <DiscsContent />
      </AppErrorBoundary>
    </div>
  );
}
