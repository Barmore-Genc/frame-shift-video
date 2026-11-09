import { useState, type ReactNode } from 'react';
import { PathPicker } from '@/components/path-picker';
import { AppErrorBoundary } from '@/components/app-error-boundary';
import {
  useCancelSplitTask,
  useClearSplitTasks,
  useSplitPreview,
  useSplitRun,
  useSplitTasks,
  useTracksPreview,
  useTracksRun,
  type SplitPreviewFile,
  type SplitTask,
  type TrackPreviewFile,
} from '@/lib/split-api';

type Tab = 'episodes' | 'tracks';

const inputClass =
  'min-h-[44px] px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white';
const primaryButton =
  'min-h-[44px] px-5 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-gray-700 dark:text-gray-200">
      {label}
      {children}
    </label>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl border-2 border-gray-200 dark:border-gray-600 p-6 shadow-lg flex flex-col gap-4">
      {children}
    </section>
  );
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

export function SplitTools() {
  const [tab, setTab] = useState<Tab>('episodes');
  return (
    <div>
      <div role="tablist" className="mb-6 flex gap-2">
        {(
          [
            ['episodes', 'Separate episodes'],
            ['tracks', 'Remove extra tracks'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`min-h-[44px] px-5 py-2 rounded-lg font-medium transition-colors ${
              tab === id
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-6">
        {/* Both tabs stay mounted so what was typed in one is still there when you come back. */}
        <div
          role="tabpanel"
          aria-label="Separate episodes"
          hidden={tab !== 'episodes'}
        >
          <AppErrorBoundary>
            <EpisodesTab />
          </AppErrorBoundary>
        </div>
        <div
          role="tabpanel"
          aria-label="Remove extra tracks"
          hidden={tab !== 'tracks'}
        >
          <AppErrorBoundary>
            <TracksTab />
          </AppErrorBoundary>
        </div>
        <AppErrorBoundary>
          <TaskList />
        </AppErrorBoundary>
      </div>
    </div>
  );
}

function EpisodesTab() {
  const [path, setPath] = useState('');
  const [episodesPerFile, setEpisodesPerFile] = useState(2);
  const [frameOffset, setFrameOffset] = useState(6);
  const [show, setShow] = useState('');
  const [season, setSeason] = useState(1);
  const [startEpisode, setStartEpisode] = useState(1);
  const [titles, setTitles] = useState('');
  const [mode, setMode] = useState<'reencode' | 'copy'>('reencode');
  const [outputDir, setOutputDir] = useState('');
  const [overwrite, setOverwrite] = useState(false);

  const preview = useSplitPreview();
  const run = useSplitRun();
  const files = preview.data?.files;
  const ready = files?.filter((f) => f.plan.complete) ?? [];

  const findBreaks = () => {
    run.reset();
    preview.mutate({
      path,
      episodesPerFile,
      frameOffset,
      season,
      startEpisode,
      show,
      titles,
    });
  };

  return (
    <Card>
      <h2 className="text-xl font-bold text-gray-900 dark:text-white">
        Separate combined episodes
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Finds the black screen between the episodes in each file and cuts there.
        Check the plan below before anything is written.
      </p>
      <Field label="Video file or folder">
        <PathPicker value={path} onChange={setPath} />
      </Field>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Field label="Episodes per file">
          <input
            type="number"
            min={2}
            max={12}
            value={episodesPerFile}
            onChange={(e) => setEpisodesPerFile(Number(e.target.value))}
            className={inputClass}
          />
        </Field>
        <Field label="Season">
          <input
            type="number"
            min={0}
            value={season}
            onChange={(e) => setSeason(Number(e.target.value))}
            className={inputClass}
          />
        </Field>
        <Field label="First episode number">
          <input
            type="number"
            min={0}
            value={startEpisode}
            onChange={(e) => setStartEpisode(Number(e.target.value))}
            className={inputClass}
          />
        </Field>
        <Field label="Frames kept in the black">
          <input
            type="number"
            min={0}
            value={frameOffset}
            onChange={(e) => setFrameOffset(Number(e.target.value))}
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="Show name (optional, put in front of each file name)">
        <input
          type="text"
          value={show}
          onChange={(e) => setShow(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Episode titles, one per line, in order (optional)">
        <textarea
          rows={5}
          value={titles}
          onChange={(e) => setTitles(e.target.value)}
          placeholder={"Wanda's Apprentice\nTop Dog!\nRed Card for Wanda"}
          className={inputClass}
        />
      </Field>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="How to cut">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as 'reencode' | 'copy')}
            className={inputClass}
          >
            <option value="reencode">Re-encode (exact cuts, slower)</option>
            <option value="copy">
              Copy (fast, may be off by a few frames)
            </option>
          </select>
        </Field>
        <Field label="Output folder (optional, default: Split beside each file)">
          <input
            type="text"
            value={outputDir}
            onChange={(e) => setOutputDir(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-gray-800 dark:text-gray-100">
        <input
          type="checkbox"
          checked={overwrite}
          onChange={(e) => setOverwrite(e.target.checked)}
        />
        Replace files that already exist
      </label>

      <div className="flex gap-3">
        <button
          className={primaryButton}
          disabled={!path || preview.isPending}
          onClick={findBreaks}
        >
          {preview.isPending ? 'Looking for the breaks…' : 'Find the breaks'}
        </button>
        <button
          className={primaryButton}
          disabled={ready.length === 0 || run.isPending}
          onClick={() =>
            run.mutate({
              files: ready.map((f) => ({ path: f.path, episodes: f.episodes })),
              mode,
              outputDir,
              overwrite,
            })
          }
        >
          Split{' '}
          {ready.length > 0
            ? `${ready.length} file${ready.length === 1 ? '' : 's'}`
            : ''}
        </button>
      </div>
      {preview.error && <p className="text-red-600">{preview.error.message}</p>}
      {run.error && <p className="text-red-600">{run.error.message}</p>}
      {run.isSuccess && (
        <p className="text-green-700 dark:text-green-400">
          Queued. Progress is below.
        </p>
      )}
      {files && <PreviewList files={files} />}
    </Card>
  );
}

function PreviewList({ files }: { files: SplitPreviewFile[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {files.map((file) => (
        <li
          key={file.path}
          className="rounded-lg border border-gray-200 dark:border-gray-600 p-3"
        >
          <div className="font-medium text-gray-900 dark:text-white break-all">
            {file.path}
          </div>
          <div className="text-sm text-gray-500">
            {formatTime(file.duration)} long
          </div>
          {!file.plan.complete ? (
            <p className="text-amber-700 dark:text-amber-400">
              {file.plan.warning}
            </p>
          ) : (
            <ol className="mt-1 text-sm text-gray-800 dark:text-gray-100 list-decimal pl-5">
              {file.episodes.map((episode) => (
                <li key={episode.name}>
                  {episode.name}{' '}
                  <span className="text-gray-500">
                    {formatTime(episode.start)} – {formatTime(episode.end)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </li>
      ))}
    </ul>
  );
}

function TracksTab() {
  const [path, setPath] = useState('');
  const [languages, setLanguages] = useState('eng');
  const [filterAudio, setFilterAudio] = useState(true);
  const [filterSubtitles, setFilterSubtitles] = useState(true);
  const [keepUntagged, setKeepUntagged] = useState(false);
  const [replace, setReplace] = useState(false);

  const preview = useTracksPreview();
  const run = useTracksRun();
  const options = { languages, filterAudio, filterSubtitles, keepUntagged };
  const files = preview.data?.files;
  const toClean = files?.filter((f) => f.plan.action === 'clean') ?? [];

  return (
    <Card>
      <h2 className="text-xl font-bold text-gray-900 dark:text-white">
        Remove extra tracks
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Keeps only the audio and subtitle tracks in the languages you choose and
        copies everything else untouched. A file with no audio in those
        languages is skipped, never changed.
      </p>
      <Field label="Video file or folder">
        <PathPicker value={path} onChange={setPath} />
      </Field>
      <Field label="Languages to keep (comma separated, e.g. eng, jpn)">
        <input
          type="text"
          value={languages}
          onChange={(e) => setLanguages(e.target.value)}
          className={inputClass}
        />
      </Field>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-gray-800 dark:text-gray-100">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filterAudio}
            onChange={(e) => setFilterAudio(e.target.checked)}
          />
          Filter audio tracks
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filterSubtitles}
            onChange={(e) => setFilterSubtitles(e.target.checked)}
          />
          Filter subtitle tracks
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={keepUntagged}
            onChange={(e) => setKeepUntagged(e.target.checked)}
          />
          Keep tracks with no language tag
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={replace}
            onChange={(e) => setReplace(e.target.checked)}
          />
          Replace the original file (otherwise saved as .cleaned)
        </label>
      </div>
      <div className="flex gap-3">
        <button
          className={primaryButton}
          disabled={!path || preview.isPending}
          onClick={() => {
            run.reset();
            preview.mutate({ path, ...options });
          }}
        >
          {preview.isPending ? 'Reading the files…' : 'Check the tracks'}
        </button>
        <button
          className={primaryButton}
          disabled={toClean.length === 0 || run.isPending}
          onClick={() =>
            run.mutate({
              paths: toClean.map((f) => f.path),
              ...options,
              replace,
            })
          }
        >
          Clean{' '}
          {toClean.length > 0
            ? `${toClean.length} file${toClean.length === 1 ? '' : 's'}`
            : ''}
        </button>
      </div>
      {preview.error && <p className="text-red-600">{preview.error.message}</p>}
      {run.error && <p className="text-red-600">{run.error.message}</p>}
      {run.isSuccess && (
        <p className="text-green-700 dark:text-green-400">
          Queued. Progress is below.
        </p>
      )}
      {files && <TrackList files={files} />}
    </Card>
  );
}

function TrackList({ files }: { files: TrackPreviewFile[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {files.map((file) => {
        // A file that is skipped or already clean is left as it is, so nothing in it is struck out.
        const removed = new Set(
          file.plan.action === 'clean'
            ? [...file.plan.removeAudio, ...file.plan.removeSubtitles]
            : [],
        );
        return (
          <li
            key={file.path}
            className="rounded-lg border border-gray-200 dark:border-gray-600 p-3"
          >
            <div className="font-medium text-gray-900 dark:text-white break-all">
              {file.path}
            </div>
            <div
              className={`text-sm ${file.plan.action === 'clean' ? 'text-blue-700 dark:text-blue-300' : 'text-gray-500'}`}
            >
              {file.plan.reason}
            </div>
            <ul className="mt-1 text-sm">
              {file.streams
                .filter((s) => s.type === 'audio' || s.type === 'subtitle')
                .map((s) => (
                  <li
                    key={s.index}
                    className={
                      removed.has(s.index)
                        ? 'line-through text-red-600 dark:text-red-400'
                        : 'text-gray-800 dark:text-gray-100'
                    }
                  >
                    {s.type} #{s.index} · {s.language || 'no language'} ·{' '}
                    {s.codec}
                    {s.title ? ` · ${s.title}` : ''}
                  </li>
                ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

const STATUS_STYLE: Record<SplitTask['status'], string> = {
  queued: 'text-gray-500',
  running: 'text-blue-600 dark:text-blue-400',
  done: 'text-green-700 dark:text-green-400',
  failed: 'text-red-600',
  cancelled: 'text-gray-500',
  skipped: 'text-amber-700 dark:text-amber-400',
};

function TaskList() {
  const { data: tasks = [] } = useSplitTasks();
  const cancel = useCancelSplitTask();
  const clear = useClearSplitTasks();
  if (tasks.length === 0) return null;
  const finished = tasks.some((t) => !['queued', 'running'].includes(t.status));
  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
          Progress
        </h2>
        {finished && (
          <button
            className="text-blue-600 dark:text-blue-400 hover:underline"
            onClick={() => clear.mutate()}
          >
            Clear finished
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-3">
        {[...tasks].reverse().map((task) => (
          <li
            key={task.id}
            className="rounded-lg border border-gray-200 dark:border-gray-600 p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-gray-900 dark:text-white break-all">
                {task.kind === 'split' ? 'Split' : 'Tracks'}: {task.label}
              </span>
              <span
                className={`text-sm capitalize ${STATUS_STYLE[task.status]}`}
              >
                {task.status}
              </span>
            </div>
            {task.status === 'running' && (
              <div
                className="mt-2 h-2 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden"
                role="progressbar"
                aria-valuenow={Math.round(task.progress * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full bg-blue-600"
                  style={{ width: `${Math.round(task.progress * 100)}%` }}
                />
              </div>
            )}
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              {task.message}
            </div>
            {(task.status === 'queued' || task.status === 'running') && (
              <button
                className="mt-1 text-sm text-red-600 hover:underline"
                onClick={() => cancel.mutate(task.id)}
              >
                Cancel
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
