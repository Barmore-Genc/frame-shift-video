import { namesHeard } from '@/lib/names-heard';
import { useState } from 'react';
import { CaretDown, CaretRight } from '@phosphor-icons/react';
import { CollapsibleCard } from '@/components/collapsible-card';
import { MatchMovie } from '@/components/match-movie';
import {
  useDiscExtras,
  useExtraDuplicates,
  useExtraMatch,
  useRemoveExtras,
  useRemovedExtras,
  useRestoreExtras,
  useExtraPreview,
  useStartExtraMatch,
  useExtraSources,
  useRefreshExtraSources,
  useRenameDiscExtra,
} from '@/lib/api-hooks';
import { discExtraFileUrl, discExtraFrameUrl } from '@/lib/api';
import type {
  ExtraItem,
  ExtraMovie,
  ExtraSuggestion,
  RemovedExtra,
} from '@/types/discs';

const FOLDERS = [
  'Trailers',
  'Featurettes',
  'Behind The Scenes',
  'Deleted Scenes',
  'Interviews',
  'Scenes',
  'Shorts',
  'Other',
];

const INPUT =
  'w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white';
const SMALL =
  'min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 bg-blue-600 text-white hover:bg-blue-700';

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/**
 * A strip of pictures spread through an extra, to tell what it is without playing it. Each opens the
 * video at that moment. Nothing is made until it is opened.
 */
function Preview({ item, movie }: { item: ExtraItem; movie: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useExtraPreview(item.path, open);
  return (
    <details
      className="mt-2"
      onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
    >
      <summary
        className="cursor-pointer text-sm text-blue-700 dark:text-blue-300"
        aria-label={`Preview the extra ${item.name} in ${movie}`}
      >
        Preview
      </summary>
      {isLoading && (
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Looking inside...
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
          {error.message}
        </p>
      )}
      {data && (
        <div>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {clock(data.seconds)} long. Press a picture to watch from there.
          </p>
          <ul className="mt-1 flex gap-2 overflow-x-auto pb-1">
            {data.times.map((at) => (
              <li key={at} className="shrink-0">
                <a
                  href={discExtraFileUrl(item.path, false, at)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Watch from ${clock(at)}`}
                >
                  <img
                    src={discExtraFrameUrl(item.path, at)}
                    alt=""
                    loading="lazy"
                    className="h-20 w-auto rounded bg-gray-200 dark:bg-gray-700"
                  />
                  <span className="block text-center text-xs text-gray-600 dark:text-gray-400">
                    {clock(at)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}

/**
 * What matching said about this extra: a name to use when it is clear, a maybe, or why there is none,
 * with what was written on the video and said in it for a person to judge by.
 */
function Suggestion({
  suggestion,
  onUse,
}: {
  suggestion: ExtraSuggestion;
  onUse: () => void;
}) {
  // What was said, read for names: a hint when there is no clear name yet, so not for a clear one.
  const names =
    suggestion.state === 'matched' ? [] : namesHeard(suggestion.heard);
  const tone =
    suggestion.state === 'matched'
      ? 'text-green-700 dark:text-green-400'
      : suggestion.state === 'unsure'
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-gray-600 dark:text-gray-400';
  return (
    <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-600 p-2">
      <p className={`text-sm ${tone}`}>{suggestion.note}</p>
      {names.length > 0 && (
        <p className="mt-1 text-sm text-gray-800 dark:text-gray-200">
          Names said in it: {names.join(' · ')}
        </p>
      )}
      {suggestion.name && (
        <button
          type="button"
          className="mt-1 min-h-[44px] px-3 py-2 rounded-lg text-sm font-medium bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-600"
          onClick={onUse}
        >
          {suggestion.state === 'matched' ? 'Use this name' : 'Use it anyway'}
        </button>
      )}
      {(suggestion.saw || suggestion.heard) && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-gray-600 dark:text-gray-400">
            What it saw and heard
          </summary>
          {suggestion.saw && (
            <p className="mt-1 text-xs text-gray-700 dark:text-gray-300">
              Written on it: {suggestion.saw}
            </p>
          )}
          {suggestion.heard && (
            <p className="mt-1 text-xs text-gray-700 dark:text-gray-300">
              Said in it: {suggestion.heard}
            </p>
          )}
        </details>
      )}
    </div>
  );
}

/**
 * The button that listens to a movie's unnamed extras and compares them with DVD Fandom's names, and
 * how far it has got. It only suggests; each suggestion has its own button.
 */
function MatchBar({ movie, enabled }: { movie: string; enabled: boolean }) {
  const { data } = useExtraMatch(movie);
  const start = useStartExtraMatch(movie);
  if (!enabled) return null;
  const running = data?.status === 'running';
  const matched = Object.values(data?.suggestions ?? {}).filter(
    (s) => s.state === 'matched',
  ).length;
  return (
    <div className="mt-2">
      <button
        type="button"
        className="min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 bg-blue-600 text-white hover:bg-blue-700"
        disabled={running || start.isPending}
        onClick={() => start.mutate()}
      >
        {running ? 'Listening...' : 'Try to match the names'}
      </button>
      {running && data && (
        <span className="ml-3 text-sm text-gray-600 dark:text-gray-400">
          {data.done} of {data.total} looked at
        </span>
      )}
      {data?.status === 'done' && (
        <span className="ml-3 text-sm text-gray-600 dark:text-gray-400">
          Done: {matched} of {data.total} matched clearly.
        </span>
      )}
      {data?.warning && (
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
          {data.warning}
        </p>
      )}
      {data?.sources && data.sources.length > 0 && data.status === 'done' && (
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          Compared with the names and lengths from {data.sources.join(', ')}.
        </p>
      )}
      {(data?.status === 'failed' || start.error) && (
        <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
          {data?.error ?? start.error?.message}
        </p>
      )}
    </div>
  );
}

function ExtraRow({
  item,
  movie,
  suggestion,
  selected,
  onToggle,
  copyOf,
  reelOf,
}: {
  item: ExtraItem;
  movie: string;
  suggestion?: ExtraSuggestion;
  selected: boolean;
  onToggle: () => void;
  /** The other extras this one is the same video as (same length, same pictures) */
  copyOf: string[];
  /** When this extra is other extras played one after another, those extras in order */
  reelOf: string[];
}) {
  const rename = useRenameDiscExtra();
  const removeOne = useRemoveExtras();
  // The ripper's own name ("Trailer 01 (2 min)") is not something to edit into a real one, so a
  // box for an extra with no name yet starts empty; what it is called now is shown above it.
  const [name, setName] = useState(item.unnamed ? '' : item.name);
  const [folder, setFolder] = useState(item.folder);
  const typed = name.trim();
  const changed =
    (typed !== '' && typed !== item.name) || folder !== item.folder;
  const id = `${item.path}`;
  const save = () =>
    rename.mutate({
      path: item.path,
      name: typed || item.name,
      ...(folder !== item.folder ? { folder } : {}),
    });

  return (
    <li
      className={`rounded-lg border p-3 ${
        selected
          ? 'border-blue-500 dark:border-blue-400'
          : 'border-gray-200 dark:border-gray-600'
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 shrink-0"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select the extra ${item.name} in ${movie}`}
        />
        <label
          htmlFor={`name-${id}`}
          className="block text-sm text-gray-700 dark:text-gray-300"
        >
          {item.unnamed
            ? `Not named yet (${item.name}). What is this one?`
            : 'Name of this extra'}
        </label>
      </div>
      {copyOf.length > 0 && (
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
          The same video as {copyOf.map((n) => `“${n}”`).join(' and ')}: the
          same length and the same pictures.
        </p>
      )}
      {reelOf.length > 0 && (
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
          This is {reelOf.length} extras played one after another (
          {reelOf.length > 3
            ? `“${reelOf[0]}” to “${reelOf[reelOf.length - 1]}”`
            : reelOf.map((n) => `“${n}”`).join(', ')}
          ), so it is a second copy of them.
        </p>
      )}
      <p className="mt-1 text-sm">
        <a
          className="underline text-blue-700 dark:text-blue-300"
          href={discExtraFileUrl(item.path)}
          target="_blank"
          rel="noreferrer"
          aria-label={`Watch the extra ${item.name} in ${movie}`}
        >
          Watch it
        </a>
        {' · '}
        <a
          className="underline text-blue-700 dark:text-blue-300"
          href={discExtraFileUrl(item.path, true)}
          aria-label={`Download the extra ${item.name} in ${movie}`}
        >
          Download
        </a>
      </p>
      <Preview item={item} movie={movie} />
      {suggestion && (
        <Suggestion
          suggestion={suggestion}
          onUse={() => {
            if (suggestion.name) setName(suggestion.name);
            if (suggestion.kind) setFolder(suggestion.kind);
          }}
        />
      )}
      <input
        id={`name-${id}`}
        className={`${INPUT} mt-1`}
        aria-label={`Name of the extra ${item.name} in ${movie}`}
        value={name}
        placeholder={item.unnamed ? 'Type its name' : undefined}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && changed && !rename.isPending) save();
        }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="text-sm text-gray-700 dark:text-gray-300">
          Kind{' '}
          <select
            className={`${INPUT} inline-block w-auto`}
            aria-label={`Kind of the extra ${item.name} in ${movie}`}
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
          >
            {FOLDERS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={SMALL}
          disabled={!changed || rename.isPending}
          onClick={save}
        >
          Save
        </button>
        <button
          type="button"
          className="min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          disabled={removeOne.isPending}
          aria-label={`Remove the extra ${item.name} from ${movie}`}
          onClick={() => removeOne.mutate([item.path])}
        >
          Remove
        </button>
      </div>
      {rename.error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {rename.error.message}
        </p>
      )}
      {rename.isSuccess && !changed && (
        <p className="mt-2 text-sm text-green-700 dark:text-green-400">
          Saved.
        </p>
      )}
    </li>
  );
}

/**
 * What the databases list as the bonus features of this movie's disc, with the lengths they give.
 * Lengths are what an extra can be matched by; names alone are something to read while typing.
 */
function Sources({ movie, enabled }: { movie: string; enabled: boolean }) {
  const { data, isLoading } = useExtraSources(movie, enabled);
  const refresh = useRefreshExtraSources(movie);
  if (!enabled) return null;
  if (isLoading) {
    return (
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        Looking up {movie} on DVD Compare, TheDiscDB and DVD Fandom...
      </p>
    );
  }
  const again = (
    <p className="mt-1 text-sm">
      <button
        type="button"
        className="underline text-blue-700 dark:text-blue-300 disabled:opacity-50 disabled:no-underline"
        disabled={refresh.isPending}
        onClick={() => refresh.mutate()}
      >
        {refresh.isPending
          ? 'Looking them up again…'
          : 'Look the names up again'}
      </button>
      {refresh.isError && (
        <span className="ml-2 text-red-700 dark:text-red-400">
          Could not look them up again.
        </span>
      )}
    </p>
  );
  if (!data || data.length === 0) {
    return (
      <>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          DVD Compare, TheDiscDB and DVD Fandom have no list for this movie.
        </p>
        {again}
      </>
    );
  }
  return (
    <>
      <details className="mt-1 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 p-3">
        <summary className="cursor-pointer text-sm font-medium text-blue-900 dark:text-blue-100">
          What the databases list on this disc (
          {data.map((s) => s.source).join(', ')})
        </summary>
        {data.map((source) => (
          <div
            key={`${source.source}-${source.release ?? ''}-${source.url}`}
            className="mt-3"
          >
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              {source.url ? (
                <a
                  className="underline"
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {source.source}
                </a>
              ) : (
                source.source
              )}
              {source.release ? `: ${source.release}` : ''}
              {source.runtime ? ` (the movie: ${source.runtime})` : ''}
            </p>
            {source.features.length === 0 ? (
              <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                No bonus features are listed.
              </p>
            ) : (
              <ul className="mt-1 text-sm text-gray-800 dark:text-gray-200">
                {source.features.map((line, index) => (
                  <li
                    key={`${index}-${line.text}`}
                    style={{
                      paddingLeft: `${Math.max(line.depth - 1, 0) * 16}px`,
                    }}
                    className={
                      line.depth === 0 ? 'mt-2 font-semibold' : undefined
                    }
                  >
                    {line.text}
                    {line.seconds ? ` (${clock(line.seconds)})` : ''}
                    {line.playAll ? ' (plays the others in a row)' : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
          DVD Compare and TheDiscDB are for Region 1 discs. A length is what the
          database gives; many give names only, so match those by what each one
          is.
        </p>
      </details>
      {again}
    </>
  );
}

/** The extras of one movie, with what matching suggested for each, and ways to pick and remove them. */
function MovieExtras({
  movie,
  onShowRemoved,
}: {
  movie: ExtraMovie;
  onShowRemoved: () => void;
}) {
  const { data } = useExtraMatch(movie.movie);
  const duplicates = useExtraDuplicates(movie.movie, movie.items.length > 1);
  const remove = useRemoveExtras();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anyUnnamed = movie.items.some((i) => i.unnamed);
  const paths = movie.items.map((i) => i.path);
  const groups = duplicates.data?.groups ?? [];
  const reels = duplicates.data?.reels ?? [];
  const nameOf = (path: string) =>
    movie.items.find((i) => i.path === path)?.name ?? path;
  // Of each group of copies, the one to keep: a named one if there is one, else the first.
  const copies = groups.flatMap((group) => {
    const keep =
      group.find(
        (p) => movie.items.find((i) => i.path === p)?.unnamed === false,
      ) ?? group[0]!;
    return group.filter((p) => p !== keep);
  });
  // A reel is the copy: its parts are the ones to keep, because each can be named.
  for (const reel of reels)
    if (!copies.includes(reel.path)) copies.push(reel.path);
  const count = paths.filter((p) => selected.has(p)).length;
  const toggle = (path: string) =>
    setSelected((now) => {
      const next = new Set(now);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const button =
    'min-h-[44px] px-3 py-2 rounded-lg text-sm font-medium bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed';
  return (
    <>
      <MatchBar movie={movie.movie} enabled={anyUnnamed} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={button}
          onClick={() => setSelected(new Set(paths))}
        >
          Select all
        </button>
        <button
          type="button"
          className={button}
          onClick={() => setSelected(new Set())}
        >
          Select none
        </button>
        <button
          type="button"
          className={button}
          onClick={() =>
            setSelected(new Set(paths.filter((p) => !selected.has(p))))
          }
        >
          Invert selection
        </button>
        <button
          type="button"
          className={button}
          disabled={copies.length === 0}
          onClick={() => setSelected(new Set(copies))}
        >
          Select copies{copies.length > 0 ? ` (${copies.length})` : ''}
        </button>
        <button
          type="button"
          className={button}
          disabled={count === 0 || remove.isPending}
          onClick={() =>
            remove.mutate(
              paths.filter((p) => selected.has(p)),
              { onSuccess: () => setSelected(new Set()) },
            )
          }
        >
          Remove selected{count > 0 ? ` (${count})` : ''}
        </button>
      </div>
      {remove.data && remove.data.removed.length > 0 && (
        <p
          role="status"
          className="mt-2 text-sm text-gray-700 dark:text-gray-300"
        >
          Moved {remove.data.removed.length}{' '}
          {remove.data.removed.length === 1 ? 'extra' : 'extras'} to the Removed
          tab, where {remove.data.removed.length === 1 ? 'it' : 'they'} can be
          put back.{' '}
          <button
            type="button"
            onClick={onShowRemoved}
            className="text-blue-700 underline dark:text-blue-300"
          >
            Open the Removed tab
          </button>
        </p>
      )}
      {remove.error && (
        <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
          {remove.error.message}
        </p>
      )}
      {remove.data && remove.data.failed.length > 0 && (
        <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
          Could not remove {remove.data.failed.length}:{' '}
          {remove.data.failed
            .map((f) => `${nameOf(f.path)} (${f.error})`)
            .join(', ')}
        </p>
      )}
      <ul className="mt-2 space-y-3">
        {movie.items.map((item) => (
          <ExtraRow
            key={item.path}
            item={item}
            movie={movie.movie}
            suggestion={item.unnamed ? data?.suggestions[item.path] : undefined}
            selected={selected.has(item.path)}
            onToggle={() => toggle(item.path)}
            copyOf={
              groups
                .find((g) => g.includes(item.path))
                ?.filter((p) => p !== item.path)
                .map(nameOf) ?? []
            }
            reelOf={
              reels.find((r) => r.path === item.path)?.parts.map(nameOf) ?? []
            }
          />
        ))}
      </ul>
    </>
  );
}

const MOVIES_OPEN = 'extras-movies-open';

function readOpenMap(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(MOVIES_OPEN) ?? '{}') as Record<
      string,
      boolean
    >;
  } catch {
    return {};
  }
}

/** A movie's extras under a heading that folds them away. */
function MovieSection({
  movie,
  open,
  onToggle,
  onShowRemoved,
}: {
  movie: ExtraMovie;
  open: boolean;
  onToggle: () => void;
  onShowRemoved: () => void;
}) {
  const unnamed = movie.items.filter((i) => i.unnamed).length;
  const Caret = open ? CaretDown : CaretRight;
  return (
    <section>
      <h3 className="font-semibold text-gray-900 dark:text-white">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-h-[44px] w-full items-center gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <Caret size={18} weight="bold" aria-hidden="true" />
          <span className="flex-1">{movie.movie}</span>
          <span className="text-sm font-normal text-gray-600 dark:text-gray-300">
            {movie.items.length} {movie.items.length === 1 ? 'extra' : 'extras'}
            {unnamed > 0 ? `, ${unnamed} not named` : ', all named'}
          </span>
        </button>
      </h3>
      {open && (
        <>
          <MatchMovie folder={movie.movie} />
          <Sources
            movie={movie.movie}
            enabled={movie.items.some((i) => i.unnamed)}
          />
          <MovieExtras movie={movie} onShowRemoved={onShowRemoved} />
        </>
      )}
    </section>
  );
}

/** Extras that were taken out of movies, with a way to put them back. */
function RemovedExtras({ extras }: { extras: RemovedExtra[] }) {
  const restore = useRestoreExtras();
  const button =
    'min-h-[44px] px-3 py-2 rounded-lg text-sm font-medium bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed';
  if (extras.length === 0) {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Nothing has been removed. Extras you remove from a movie wait here, and
        can be put back.
      </p>
    );
  }
  const movies = [...new Set(extras.map((e) => e.movie))];
  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        These are out of their movies, so Plex does not show them. They are kept
        in the _removed folder, not deleted.
      </p>
      {restore.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {restore.error.message}
        </p>
      )}
      {restore.data && restore.data.failed.length > 0 && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Could not put back {restore.data.failed.length}:{' '}
          {restore.data.failed
            .map((f) => `${f.path.split('/').pop()} (${f.error})`)
            .join(', ')}
        </p>
      )}
      {movies.map((movie) => {
        const mine = extras.filter((e) => e.movie === movie);
        return (
          <section key={movie}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-gray-900 dark:text-white">
                {movie}
              </h3>
              <button
                type="button"
                className={button}
                disabled={restore.isPending}
                onClick={() => restore.mutate(mine.map((e) => e.path))}
              >
                Put all back ({mine.length})
              </button>
            </div>
            <ul className="mt-2 space-y-2">
              {mine.map((extra) => (
                <li
                  key={extra.path}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 p-2 dark:border-gray-600"
                >
                  <span className="text-gray-900 dark:text-white">
                    {extra.name}{' '}
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      ({extra.folder})
                    </span>
                  </span>
                  <button
                    type="button"
                    className={button}
                    disabled={restore.isPending}
                    aria-label={`Put ${extra.name} back in ${movie}`}
                    onClick={() => restore.mutate([extra.path])}
                  >
                    Put back
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Names the extras of ripped movies. A disc stores no names for them, so the ripper only sorts them
 * by length; Plex shows what is typed here. Extras taken out of a movie wait in the Removed tab.
 */
export function ExtrasSection() {
  const { data } = useDiscExtras();
  const removed = useRemovedExtras().data ?? [];
  const [tab, setTab] = useState<'name' | 'removed'>('name');
  const [openMap, setOpenMap] = useState(readOpenMap);
  const movies = data ?? [];
  if (movies.length === 0 && removed.length === 0) return null;
  const unnamed = movies.reduce(
    (sum, movie) => sum + movie.items.filter((i) => i.unnamed).length,
    0,
  );
  // A movie with something to name starts open; one that is all named starts folded.
  const isOpen = (movie: ExtraMovie) =>
    openMap[movie.movie] ?? movie.items.some((i) => i.unnamed);
  const setOpen = (next: Record<string, boolean>) => {
    setOpenMap(next);
    try {
      localStorage.setItem(MOVIES_OPEN, JSON.stringify(next));
    } catch {
      // Remembering is a convenience only.
    }
  };
  const setAll = (open: boolean) =>
    setOpen(Object.fromEntries(movies.map((m) => [m.movie, open])));
  const tabClass = (active: boolean) =>
    `min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
      active
        ? 'bg-blue-600 text-white'
        : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-600'
    }`;

  return (
    <CollapsibleCard
      title="Name the extras"
      help="A DVD does not store names for its bonus features, so they are sorted by length and called Trailer 01, Featurette 01 and so on. Try to match the names listens to each one and compares it with the names DVD Fandom lists, and suggests a name when it is clear. Or press Preview or Watch it to see what one is (Safari cannot play .mkv files: use Download and open it in VLC or Infuse), then type the real name and press Save. Plex shows that name, and sorts each into the kind you pick. Extras you remove wait in the Removed tab, where you can put them back."
      hint="Bonus features of movies that are ready to watch."
      badge={unnamed > 0 ? `${unnamed} not named` : undefined}
    >
      <div role="tablist" className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'name'}
          className={tabClass(tab === 'name')}
          onClick={() => setTab('name')}
        >
          To name ({movies.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'removed'}
          className={tabClass(tab === 'removed')}
          onClick={() => setTab('removed')}
        >
          Removed ({removed.length})
        </button>
        {tab === 'name' && movies.length > 1 && (
          <span className="ml-auto flex gap-2">
            <button
              type="button"
              className={tabClass(false)}
              onClick={() => setAll(true)}
            >
              Expand all
            </button>
            <button
              type="button"
              className={tabClass(false)}
              onClick={() => setAll(false)}
            >
              Collapse all
            </button>
          </span>
        )}
      </div>
      {tab === 'removed' ? (
        <RemovedExtras extras={removed} />
      ) : movies.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          No movie has extras left to name.
        </p>
      ) : (
        <div className="space-y-4">
          {movies.map((movie) => (
            <MovieSection
              key={movie.movie}
              movie={movie}
              open={isOpen(movie)}
              onToggle={() =>
                setOpen({ ...openMap, [movie.movie]: !isOpen(movie) })
              }
              onShowRemoved={() => setTab('removed')}
            />
          ))}
        </div>
      )}
    </CollapsibleCard>
  );
}
