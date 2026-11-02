import { useCallback, useEffect, useRef, useState } from 'react';
import { runDiscCommand } from '@/lib/api-hooks';
import {
  parseTmdbResults,
  posterUrl,
  sourceColors,
  sourceName,
  tmdbPage,
} from '@/lib/tmdb-results';
import type { TmdbResult } from '@/types/discs';

const INPUT =
  'w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white';

/**
 * A TMDB search box: a title and a year to look up, the best matches with their poster, year,
 * length and a short description, and a button to use one. A TMDB or IMDb page address pasted
 * into the title goes straight to that title. When `autoSearch` is on it looks the title up by
 * itself whenever `initialQuery` changes, which is how a disc's label finds its movie.
 *
 * The search is done by the ripper's helper on the server, which holds the TMDB token and the
 * TheTVDB key: results are TMDB's first, then those only TheTVDB has, each marked with its source.
 */
export function TmdbPicker({
  kind,
  initialQuery,
  autoSearch = false,
  onPick,
}: {
  kind: 'movie' | 'tv' | 'any';
  initialQuery: string;
  autoSearch?: boolean;
  onPick: (result: TmdbResult) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [year, setYear] = useState('');
  const [results, setResults] = useState<TmdbResult[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [chosen, setChosen] = useState<TmdbResult | null>(null);
  const [looking, setLooking] = useState(false);
  const lastAuto = useRef<string | null>(null);
  // What was last looked up, to look it up again when the kind is switched.
  const lastSearch = useRef<{ title: string; year: string } | null>(null);
  // Only the newest search is shown: an older one that answers late is ignored.
  const latest = useRef(0);

  const search = useCallback(
    (text: string, forYear: string) => {
      const title = text.trim();
      if (!title) return;
      const mine = ++latest.current;
      lastSearch.current = { title: text, year: forYear };
      setMessage(null);
      setLooking(true);
      runDiscCommand({
        action: 'search',
        kind,
        query: title,
        ...(/^\d{4}$/.test(forYear) ? { year: Number(forYear) } : {}),
      })
        .then((answer) => {
          if (mine !== latest.current) return;
          const found = (
            answer.ok ? parseTmdbResults(answer.message) : []
          ).filter((result) => kind === 'any' || result.kind === kind);
          setResults(found);
          if (!answer.done) {
            setMessage(answer.message ?? 'The server did not answer.');
          } else if (!answer.ok) {
            setMessage(answer.message || 'The search did not work.');
          } else if (found.length === 0) {
            setMessage('Nothing found. Try a shorter title.');
          }
        })
        .catch((error: Error) => {
          if (mine === latest.current) setMessage(error.message);
        })
        .finally(() => {
          if (mine === latest.current) setLooking(false);
        });
    },
    [kind],
  );

  // Switching between movie and TV show looks the same title up again for the other kind, so
  // the list never has the other kind in it.
  const lastKind = useRef(kind);
  useEffect(() => {
    if (lastKind.current === kind) return;
    lastKind.current = kind;
    setChosen(null);
    setResults([]);
    const again = lastSearch.current;
    if (again) search(again.title, again.year);
  }, [kind, search]);

  // A new title to start from (a different disc went in): fill the box and look it up. The
  // search starts from a timer, not straight from the effect: React's development double
  // mount would otherwise detach the request from this component before it answers.
  useEffect(() => {
    setQuery(initialQuery);
    if (
      !autoSearch ||
      !initialQuery.trim() ||
      lastAuto.current === initialQuery
    ) {
      return;
    }
    const timer = setTimeout(() => {
      lastAuto.current = initialQuery;
      setChosen(null);
      search(initialQuery, '');
    }, 0);
    return () => clearTimeout(timer);
  }, [initialQuery, autoSearch, search]);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-600 p-4 space-y-3">
      <h3 className="font-medium text-gray-900 dark:text-white">
        Find the movie or show
      </h3>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_7rem_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          search(query, year);
        }}
      >
        <label className="block text-sm text-gray-700 dark:text-gray-300">
          Title
          <input
            className={`${INPUT} mt-1`}
            value={query}
            placeholder="Andre, or paste a TMDB or IMDb address"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="block text-sm text-gray-700 dark:text-gray-300">
          Year
          <input
            className={`${INPUT} mt-1`}
            inputMode="numeric"
            value={year}
            placeholder="optional"
            onChange={(event) => setYear(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="self-end min-h-[44px] px-4 py-2 rounded-lg font-medium transition-colors bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={looking || !query.trim()}
        >
          {looking ? 'Looking…' : 'Look it up'}
        </button>
      </form>

      {message && (
        <p className="text-sm text-gray-600 dark:text-gray-300">{message}</p>
      )}
      {chosen && (
        <p className="text-sm text-green-700 dark:text-green-400">
          Using “{chosen.name}” from {sourceName(chosen)} (
          <a
            className="underline"
            href={tmdbPage(chosen)}
            target="_blank"
            rel="noreferrer"
          >
            {chosen.kind} {chosen.id}
          </a>
          ).
        </p>
      )}

      {results.length > 0 && (
        <ul className="max-h-96 overflow-y-auto overscroll-contain divide-y divide-gray-200 dark:divide-gray-600 rounded-lg border border-gray-200 dark:border-gray-600">
          {results.map((result) => {
            const poster = posterUrl(result.poster);
            return (
              <li
                key={`${result.source}${result.kind}${result.id}`}
                className={`flex gap-3 border-l-4 p-2 ${sourceColors(result).stripe}`}
              >
                {poster ? (
                  <img
                    src={poster}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="h-20 w-14 shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="h-20 w-14 shrink-0 rounded bg-gray-200 dark:bg-gray-700" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-900 dark:text-white">
                    {result.name}{' '}
                    <span className="text-sm font-normal text-gray-600 dark:text-gray-400">
                      {result.kind === 'tv' ? 'TV · ' : ''}
                      {result.size}
                    </span>{' '}
                    <span
                      className={`rounded px-1.5 py-0.5 align-middle text-xs font-semibold ${sourceColors(result).badge}`}
                      title={`This result is from ${sourceName(result)}`}
                    >
                      {sourceName(result)}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-sm text-gray-600 dark:text-gray-400">
                    {result.overview}
                  </p>
                </div>
                <button
                  type="button"
                  className="self-center min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-600"
                  onClick={() => {
                    setChosen(result);
                    setResults([]);
                    onPick(result);
                  }}
                >
                  Use this
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
