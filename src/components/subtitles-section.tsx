import { useState } from 'react';
import { MatchMovie } from '@/components/match-movie';
import { CollapsibleCard } from '@/components/collapsible-card';
import {
  useClearOldCopies,
  useCleanSubtitles,
  useConvertSubtitles,
  useDismissSubtitles,
  useRemoveSubtitleTrack,
  useRemoveSubtitlePictures,
  useRestoreSubtitles,
  useSetSubtitlesAuto,
  useSubtitles,
} from '@/lib/api-hooks';
import type { SubtitleFile, SubtitleTrack } from '@/types/subtitles';
import { Check, X } from '@phosphor-icons/react';

const BUTTON =
  'min-h-[44px] px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
const PRIMARY = `${BUTTON} bg-blue-600 text-white hover:bg-blue-700`;
const SMALL =
  'min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-600';

const LANGUAGES: Record<string, string> = {
  eng: 'English',
  fre: 'French',
  fra: 'French',
  spa: 'Spanish',
  ger: 'German',
  deu: 'German',
  ita: 'Italian',
  por: 'Portuguese',
  dut: 'Dutch',
  nld: 'Dutch',
  und: 'Unknown',
};

const HOURS = 3600;

function gigabytes(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

function ago(epochSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - epochSeconds));
  if (seconds < 90) return 'just now';
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes ago`;
  if (seconds < 48 * HOURS) return `${Math.round(seconds / HOURS)} hours ago`;
  return `${Math.round(seconds / (24 * HOURS))} days ago`;
}

/** "English", "Spanish (foreign speech only)", "French (picture)" for one track. */
export function describeTrack(track: SubtitleTrack): string {
  const language = LANGUAGES[track.language] ?? track.language;
  const flags = [
    track.codec === 'picture' ? 'picture' : '',
    track.forced ? 'foreign speech only' : '',
    track.default ? 'plays by default' : '',
  ].filter(Boolean);
  return flags.length > 0 ? `${language} (${flags.join(', ')})` : language;
}

/** The movie's name: the folder it is filed in, or the file name for a single file. */
export function movieName(file: string): string {
  const parts = file.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join(' / ') : parts[0];
}

/** The folder of a movie's own file (Name (Year)/Name (Year).mkv), which a TMDB match renames. */
export function matchFolder(file: string): string | null {
  const parts = file.split('/');
  if (parts.length < 2) return null;
  const folder = parts[parts.length - 2]!;
  const base = parts[parts.length - 1]!.replace(/\.[^.]+$/, '');
  return folder && base === folder ? folder : null;
}

function FileRow({
  file,
  busy,
  onConvert,
  onRemove,
  onRemoveTrack,
  onRemovePictures,
}: {
  file: SubtitleFile;
  busy: boolean;
  onConvert: () => void;
  onRemove: () => void;
  /** Shown only when the full list is open: takes one subtitle track out of the file */
  onRemoveTrack?: (index: number) => void;
  /** Takes out the picture subtitles that could not be read */
  onRemovePictures?: () => void;
}) {
  const waiting = file.status !== null;
  return (
    <li className="py-3 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="font-medium text-gray-900 dark:text-white break-words">
          {file.path.split('/').pop()}
        </div>
        {file.path.includes('/') && (
          <div className="text-sm text-gray-600 dark:text-gray-400 break-words">
            {movieName(file.path)}
          </div>
        )}
        <div className="mt-1 flex flex-wrap gap-1">
          {file.tracks.length === 0 && (
            <span className="text-sm text-gray-600 dark:text-gray-400">
              No subtitles
            </span>
          )}
          {file.tracks.map((track, index) => (
            <span
              key={index}
              className={`rounded-full px-2 py-0.5 text-sm ${
                track.codec === 'picture'
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                  : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
              }`}
            >
              {describeTrack(track)}
            </span>
          ))}
        </div>
        {onRemoveTrack && file.tracks.length > 0 && !waiting && (
          <details className="mt-2">
            <summary className="flex min-h-[44px] cursor-pointer items-center text-sm text-gray-600 dark:text-gray-300">
              Remove a subtitle track…
            </summary>
            <div className="mt-2 flex flex-wrap gap-2">
              {file.tracks.map((track, index) => (
                <button
                  key={index}
                  type="button"
                  className={SMALL}
                  onClick={() => onRemoveTrack(index)}
                >
                  Remove {describeTrack(track)}
                </button>
              ))}
            </div>
          </details>
        )}
        {matchFolder(file.path) && (
          <MatchMovie folder={matchFolder(file.path)!} />
        )}
      </div>
      {file.pictures > 0 ? (
        <div className="flex gap-2">
          <button
            type="button"
            className={SMALL}
            disabled={busy || waiting}
            onClick={onConvert}
          >
            {file.status === 'converting'
              ? 'Converting…'
              : file.status === 'queued'
                ? 'Waiting'
                : 'Convert'}
          </button>
          {file.status === 'queued' && (
            <button type="button" className={SMALL} onClick={onRemove}>
              Remove
            </button>
          )}
        </div>
      ) : file.unreadable ? (
        <div className="flex max-w-xs flex-col items-start gap-2">
          <span className="text-sm text-amber-700 dark:text-amber-400">
            Some picture subtitles could not be read, so they stay as pictures
          </span>
          {onRemovePictures && (
            <button
              type="button"
              className={SMALL}
              disabled={waiting}
              onClick={onRemovePictures}
            >
              Remove the problem subtitles
            </button>
          )}
        </div>
      ) : (
        <span className="text-sm text-green-700 dark:text-green-400">
          <span className="inline-flex items-center gap-1">
            <Check size={14} weight="bold" aria-hidden="true" />
            Text
          </span>
        </span>
      )}
    </li>
  );
}

function batchTitle(kind: 'convert' | 'recheck' | 'mixed'): string {
  if (kind === 'recheck') return 'Fixing typing mistakes';
  if (kind === 'convert') return 'Converting subtitles';
  return 'Working on subtitles';
}

/**
 * A DVD's subtitles are pictures, which most Plex clients cannot show without burning them in.
 * This turns them into text, one movie at a time, on the host.
 */
export function SubtitlesSection() {
  const { data: state, error } = useSubtitles();
  const convert = useConvertSubtitles();
  const auto = useSetSubtitlesAuto();
  const restore = useRestoreSubtitles();
  const dismiss = useDismissSubtitles();
  const clean = useCleanSubtitles();
  const removeTrack = useRemoveSubtitleTrack();
  const removePictures = useRemoveSubtitlePictures();
  const clear = useClearOldCopies();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  if (error) {
    return (
      <CollapsibleCard title="Subtitles">
        <p className="text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : 'Could not load'}
        </p>
      </CollapsibleCard>
    );
  }
  if (!state) return null;

  const todo = state.files.filter((file) => file.pictures > 0);
  const free = todo.filter((file) => file.status === null);
  const unreadable = state.files.filter((file) => file.unreadable);
  const listed = showAll ? state.files : todo;
  const current = state.current;
  const percent =
    current?.total && current.done !== null
      ? Math.min(100, Math.round((current.done / current.total) * 100))
      : null;
  const history = showHistory ? state.recent : state.recent.slice(0, 3);

  return (
    <CollapsibleCard
      title="Subtitles"
      help="A DVD’s subtitles are little pictures, and many TVs and apps cannot show those. This turns them into real text that every player can show, in every language on the disc. Your original file is always kept first, so nothing can be lost. Press Convert, then wait."
      hint="Turns the picture subtitles of a DVD into real text that every TV and app can show. Your original file is always kept first, under “Old copies”."
    >
      {!state.available ? (
        <p className="mt-4 text-sm text-gray-600 dark:text-gray-300">
          The converter has not made its list of movies yet. It does within a
          few minutes of being set up.
        </p>
      ) : (
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-gray-900 dark:text-white">
            <input
              type="checkbox"
              checked={state.auto}
              disabled={auto.isPending}
              onChange={(event) => auto.mutate(event.target.checked)}
            />
            Convert the subtitles of new discs by itself
          </label>

          {(current || state.batch) && (
            <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-3 space-y-2">
              {state.batch && (
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">
                    {batchTitle(state.batch.kind)}: {state.batch.done} of{' '}
                    {state.batch.total} movies done
                  </div>
                  <div
                    role="progressbar"
                    aria-label={batchTitle(state.batch.kind)}
                    aria-valuemin={0}
                    aria-valuemax={state.batch.total}
                    aria-valuenow={state.batch.done}
                    className="mt-2 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700"
                  >
                    <div
                      className="h-2 rounded-full bg-blue-600 transition-all"
                      style={{
                        width: `${Math.round((state.batch.done / state.batch.total) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}
              {current && (
                <div>
                  <div className="font-medium text-gray-900 dark:text-white break-words">
                    Converting {current.path.split('/').pop()}
                  </div>
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    {current.step}
                  </div>
                  {percent !== null && (
                    <div className="mt-2 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                      <div
                        className="h-2 rounded-full bg-blue-600"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={PRIMARY}
              disabled={convert.isPending || free.length === 0}
              onClick={() => {
                if (
                  window.confirm(
                    `Convert the subtitles of ${free.length} movie${free.length === 1 ? '' : 's'}? Each original file is kept until you delete it.`,
                  )
                ) {
                  convert.mutate({ all: true });
                }
              }}
            >
              {free.length === 0
                ? 'Nothing left to convert'
                : `Convert ${free.length} movie${free.length === 1 ? '' : 's'}`}
            </button>
            {todo.length - free.length > 0 && (
              <button
                type="button"
                className={SMALL}
                disabled={dismiss.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      'Take everything off the waiting list? No movie is changed.',
                    )
                  ) {
                    dismiss.mutate({ queue: 'all' });
                  }
                }}
              >
                Clear queue
              </button>
            )}
            <span className="text-sm text-gray-600 dark:text-gray-300">
              {todo.length} of {state.files.length} files still have picture
              subtitles
            </span>
          </div>
          {unreadable.length > 0 && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3">
              <p className="text-sm text-gray-900 dark:text-white">
                {unreadable.length === 1
                  ? 'Some picture subtitles in this movie could not be read'
                  : `Some picture subtitles in these ${unreadable.length} movies could not be read`}
                , so they stay as pictures:{' '}
                {unreadable.map((f) => movieName(f.path)).join(', ')}.
              </p>
              <button
                type="button"
                className={`${SMALL} mt-2`}
                disabled={
                  removePictures.isPending ||
                  unreadable.every((f) => f.status !== null)
                }
                onClick={() => {
                  if (
                    window.confirm(
                      `Take the picture subtitles that could not be read out of ${unreadable.length} movie${unreadable.length === 1 ? '' : 's'}? Text subtitles stay. Each old file is kept until you delete it.`,
                    )
                  ) {
                    removePictures.mutate({ all: true });
                  }
                }}
              >
                Remove the problem subtitles
              </button>
              {removePictures.isSuccess && removePictures.data.queued > 0 && (
                <p className="mt-2 text-sm text-green-700 dark:text-green-400">
                  Asked. It starts within a minute.
                </p>
              )}
              {removePictures.error && (
                <p
                  role="alert"
                  className="mt-2 text-sm text-red-600 dark:text-red-400"
                >
                  {removePictures.error.message}
                </p>
              )}
            </div>
          )}
          {state.files.some((f) => f.needsClean) && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3">
              <div className="text-sm text-gray-900 dark:text-white">
                {(() => {
                  const count = state.files.filter((f) => f.needsClean).length;
                  return count === 1
                    ? "1 movie's subtitles have"
                    : `${count} movies' subtitles have`;
                })()}{' '}
                small typing mistakes that can be fixed automatically. The old
                file is kept first.
              </div>
              <button
                type="button"
                className={`${SMALL} mt-2`}
                disabled={clean.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      'Clean up the text of these files? The old file is kept first.',
                    )
                  ) {
                    clean.mutate({ all: true });
                  }
                }}
              >
                Fix the typing mistakes
              </button>
              {clean.isSuccess && (
                <p className="mt-2 text-sm text-green-700 dark:text-green-400">
                  Asked. It starts within a minute.
                </p>
              )}
              {clean.error && (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                  {clean.error.message}
                </p>
              )}
            </div>
          )}
          {convert.isSuccess && convert.data.queued > 0 && (
            <p className="text-sm text-green-700 dark:text-green-400">
              Asked. It starts within a minute. You can leave this page.
            </p>
          )}
          {(dismiss.error || auto.error || removeTrack.error) && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {(dismiss.error ?? auto.error ?? removeTrack.error)?.message}
            </p>
          )}
          {removeTrack.isSuccess && (
            <p className="text-sm text-green-700 dark:text-green-400">
              Asked. It starts within a minute.
            </p>
          )}
          {convert.error && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {convert.error.message}
            </p>
          )}

          {listed.length > 0 && (
            <ul className="divide-y divide-gray-200 dark:divide-gray-600">
              {listed.map((file) => (
                <FileRow
                  key={file.path}
                  file={file}
                  busy={convert.isPending}
                  onConvert={() => convert.mutate({ path: file.path })}
                  onRemove={() => dismiss.mutate({ queued: file.path })}
                  onRemovePictures={() => {
                    if (
                      window.confirm(
                        `Take the picture subtitles that could not be read out of ${movieName(file.path)}? Text subtitles stay. The old file is kept until you delete it.`,
                      )
                    ) {
                      removePictures.mutate({ path: file.path });
                    }
                  }}
                  onRemoveTrack={
                    showAll
                      ? (index) => {
                          const track = file.tracks[index];
                          if (
                            track &&
                            window.confirm(
                              `Take the ${describeTrack(track)} subtitle track out of ${movieName(file.path)}? The old file is kept until you delete it.`,
                            )
                          ) {
                            removeTrack.mutate({
                              path: file.path,
                              track: index,
                            });
                          }
                        }
                      : undefined
                  }
                />
              ))}
            </ul>
          )}
          {state.files.length > todo.length && (
            <button
              type="button"
              className={SMALL}
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll
                ? 'Show only the ones to convert'
                : `Show all ${state.files.length} files`}
            </button>
          )}

          {state.held.length > 0 && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-600 p-3">
              <h3 className="font-medium text-gray-900 dark:text-white">
                Old copies kept: {state.held.length} file
                {state.held.length === 1 ? '' : 's'},{' '}
                {gigabytes(state.held.reduce((sum, h) => sum + h.size, 0))}
              </h3>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Each file as it was before its subtitles were converted. Nothing
                here is deleted unless you delete it.
              </p>
              <ul className="mt-2 divide-y divide-gray-200 dark:divide-gray-600">
                {state.held.map((held) => (
                  <li
                    key={`${held.path}${held.at}`}
                    className="py-2 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="min-w-0 text-sm text-gray-900 dark:text-white break-words">
                      {movieName(held.path)}{' '}
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        {held.version === 0
                          ? 'newest old copy'
                          : `older copy ${held.version}`}
                        , {gigabytes(held.size)}, set aside {ago(held.at)}
                      </span>
                    </div>
                    {held.version === 0 && (
                      <button
                        type="button"
                        className={SMALL}
                        disabled={restore.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              'Put the old file back? The new one is kept, so you can swap again.',
                            )
                          ) {
                            restore.mutate(held.path);
                          }
                        }}
                      >
                        Put this one back
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {restore.error && (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                  {restore.error.message}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {confirmingDelete ? (
                  <>
                    <span className="text-sm text-gray-900 dark:text-white">
                      Delete all {state.held.length} old cop
                      {state.held.length === 1 ? 'y' : 'ies'} for good? This
                      cannot be undone.
                    </span>
                    <button
                      type="button"
                      className={`${BUTTON} bg-red-600 text-white hover:bg-red-700`}
                      disabled={clear.isPending}
                      onClick={() =>
                        clear.mutate(undefined, {
                          onSettled: () => setConfirmingDelete(false),
                        })
                      }
                    >
                      Yes, delete them
                    </button>
                    <button
                      type="button"
                      className={SMALL}
                      onClick={() => setConfirmingDelete(false)}
                    >
                      Keep them
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={SMALL}
                    onClick={() => setConfirmingDelete(true)}
                  >
                    Delete old copies…
                  </button>
                )}
              </div>
              {clear.error && (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                  {clear.error.message}
                </p>
              )}
            </div>
          )}

          {state.recent.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Done
              </h3>
              <ul className="mt-1 space-y-2 text-sm text-gray-700 dark:text-gray-300">
                {history.map((result) => (
                  <li key={`${result.path}${result.at}`}>
                    <span
                      className={
                        result.ok
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-red-600 dark:text-red-400'
                      }
                    >
                      {result.ok ? (
                        <Check
                          size={14}
                          weight="bold"
                          aria-label="Done"
                          className="inline"
                        />
                      ) : (
                        <X
                          size={14}
                          weight="bold"
                          aria-label="Failed"
                          className="inline"
                        />
                      )}
                    </span>{' '}
                    {result.path.split('/').pop()}{' '}
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {ago(result.at)}
                    </span>
                    <button
                      type="button"
                      className="ml-2 min-h-[44px] px-2 text-sm text-gray-600 underline hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                      onClick={() => dismiss.mutate({ result: result.id })}
                    >
                      Dismiss
                    </button>
                    <div className="text-sm text-gray-600 dark:text-gray-400 break-words">
                      {result.message}
                    </div>
                    {result.details.length > 0 && (
                      <details className="mt-1">
                        <summary className="flex min-h-[44px] cursor-pointer items-center text-sm text-gray-600 dark:text-gray-300">
                          What was changed ({result.details.length})
                        </summary>
                        <ul className="mb-2 list-disc pl-6 text-sm text-gray-700 dark:text-gray-300">
                          {result.details.map((detail, index) => (
                            <li key={index}>{detail}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2">
                {state.recent.length > 3 && (
                  <button
                    type="button"
                    className={SMALL}
                    onClick={() => setShowHistory((value) => !value)}
                  >
                    {showHistory
                      ? 'Show fewer'
                      : `Show all ${state.recent.length}`}
                  </button>
                )}
                <button
                  type="button"
                  className={SMALL}
                  disabled={dismiss.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        'Clear this list? It only removes the notes, not any movie.',
                      )
                    ) {
                      dismiss.mutate({ results: 'all' });
                    }
                  }}
                >
                  Clear this list
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </CollapsibleCard>
  );
}
