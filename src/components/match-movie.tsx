import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { TmdbPicker } from '@/components/tmdb-picker';
import { useDiscCommand } from '@/lib/api-hooks';
import { matchedName, sourceName } from '@/lib/tmdb-results';
import type { TmdbResult } from '@/types/discs';

const BUTTON =
  'min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

/** "The Proud Famil" and "Duma (2005) {tmdb-1}" as a title to search for. */
export function titleToSearch(folder: string): string {
  return folder
    .replace(/\{[^}]*\}/g, '')
    .replace(/\(\d{4}\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Matches a movie that is already filed to its TMDB (or TheTVDB) entry, for when that was not done
 * before it was ripped. Picking a result renames the movie's folder and files to "Title (Year)",
 * with the TMDB id after it so Plex cannot pick the wrong film. If an older copy already has that
 * name, it can be set aside (kept in _replaced, not deleted) so this one takes its place.
 */
export function MatchMovie({ folder }: { folder: string }) {
  const command = useDiscCommand();
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<TmdbResult | null>(null);
  const [addId, setAddId] = useState(true);
  const result = command.data;
  const taken =
    result?.done === true &&
    result.ok === false &&
    /already exists/.test(result.message ?? '');
  const renamed = result?.done === true && result.ok === true;
  const target = chosen ? matchedName(chosen, addId) : '';

  const rename = (replace: boolean) =>
    command.mutate(
      {
        action: 'rename',
        old: folder,
        new: target,
        ...(replace ? { replace } : {}),
      },
      {
        onSuccess: (answer) => {
          if (answer.done && answer.ok) {
            for (const key of ['disc-extras', 'removed-extras', 'subtitles']) {
              queryClient.invalidateQueries({ queryKey: [key] });
            }
          }
        },
      },
    );

  return (
    <details className="mt-2">
      <summary className="flex min-h-[44px] cursor-pointer items-center text-sm text-gray-600 dark:text-gray-300">
        Match this movie to TMDB…
      </summary>
      <div className="mt-2 space-y-3">
        <TmdbPicker
          kind="movie"
          initialQuery={titleToSearch(folder)}
          onPick={(picked) => {
            setChosen(picked);
            command.reset();
          }}
        />
        {chosen && !renamed && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-600 p-3 space-y-2">
            <p className="text-sm text-gray-900 dark:text-white">
              Rename “{folder}” to “{target}”, and the files inside with it.
            </p>
            {chosen.source === 'tmdb' ? (
              <label className="flex items-start gap-2 text-sm text-gray-900 dark:text-white">
                <input
                  type="checkbox"
                  checked={addId}
                  onChange={(event) => setAddId(event.target.checked)}
                />
                <span>
                  Put the {sourceName(chosen)} id in the name, so Plex matches
                  exactly this movie
                </span>
              </label>
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Plex does not read TheTVDB ids in a movie’s name, so only the
                title and year are used.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`${BUTTON} bg-blue-600 text-white hover:bg-blue-700`}
                disabled={command.isPending}
                onClick={() => rename(false)}
              >
                {command.isPending ? 'Renaming…' : 'Rename'}
              </button>
              {taken && (
                <button
                  type="button"
                  className={`${BUTTON} bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-600`}
                  disabled={command.isPending}
                  onClick={() => rename(true)}
                >
                  Replace the older copy
                </button>
              )}
            </div>
            {taken && (
              <p className="text-sm text-gray-600 dark:text-gray-300">
                An older copy already has that name. “Replace the older copy”
                moves it to the _replaced folder (kept, not deleted) and gives
                its name to this one.
              </p>
            )}
          </div>
        )}
        {command.error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {command.error.message}
          </p>
        )}
        {result && (result.done || result.message) && (
          <p
            role={renamed ? 'status' : 'alert'}
            className={`text-sm ${renamed ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
          >
            {result.message || (renamed ? 'Done.' : 'That did not work.')}
          </p>
        )}
      </div>
    </details>
  );
}
