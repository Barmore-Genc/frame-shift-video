import { useState } from 'react';
import { Folder, FileVideo, CaretLeft } from '@phosphor-icons/react';
import { useFiles } from '@/lib/api-hooks';

/**
 * A small file and folder chooser for the Split page. It browses the server's home folder (the
 * same listing the file picker uses) and reports a path relative to it; choosing a folder means
 * "every video in here".
 */
export function PathPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (path: string) => void;
}) {
  const [browsing, setBrowsing] = useState(false);
  const [folder, setFolder] = useState('');
  const { data, isLoading, error } = useFiles(folder);

  const parent = folder.includes('/')
    ? folder.slice(0, folder.lastIndexOf('/'))
    : '';

  return (
    <div>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Folder or video file, relative to the home folder"
          aria-label="Path"
          className="flex-1 min-h-[44px] px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
        />
        <button
          type="button"
          onClick={() => {
            setBrowsing(!browsing);
            if (!browsing && value) {
              setFolder(
                value.includes('.')
                  ? value.slice(0, Math.max(value.lastIndexOf('/'), 0))
                  : value,
              );
            }
          }}
          className="min-h-[44px] px-4 py-2 rounded-lg bg-gray-600 text-white hover:bg-gray-700 font-medium"
        >
          {browsing ? 'Close' : 'Browse'}
        </button>
      </div>

      {browsing && (
        <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-600">
            <button
              type="button"
              disabled={!folder}
              onClick={() => setFolder(parent)}
              className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 disabled:text-gray-400"
            >
              <CaretLeft size={16} aria-hidden="true" /> Up
            </button>
            <span className="truncate text-sm text-gray-600 dark:text-gray-300">
              /{folder}
            </span>
            <button
              type="button"
              onClick={() => {
                onChange(folder);
                setBrowsing(false);
              }}
              className="px-3 py-1 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
            >
              Use this folder
            </button>
          </div>
          <ul className="max-h-64 overflow-y-auto">
            {isLoading && <li className="px-3 py-2 text-gray-500">Loading…</li>}
            {error && (
              <li className="px-3 py-2 text-red-600">
                Could not read this folder
              </li>
            )}
            {data?.items.map((item) => (
              <li key={item.path}>
                <button
                  type="button"
                  onClick={() => {
                    if (item.isDirectory) setFolder(item.path);
                    else {
                      onChange(item.path);
                      setBrowsing(false);
                    }
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-white"
                >
                  {item.isDirectory ? (
                    <Folder size={18} aria-hidden="true" />
                  ) : (
                    <FileVideo size={18} aria-hidden="true" />
                  )}
                  <span className="truncate">{item.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
