import { useEffect, useRef } from 'react';
import { Warning, ArrowUp, ArrowDown, X } from '@phosphor-icons/react';

export interface InPageSearchProps {
  /** The current search query */
  query: string;
  /** Callback when the query changes */
  onQueryChange: (query: string) => void;
  /** The current match index (0-based) */
  currentMatchIndex: number;
  /** Total number of matches */
  totalMatches: number;
  /** Callback to go to the next match */
  onNext: () => void;
  /** Callback to go to the previous match */
  onPrevious: () => void;
  /** Callback to close the search */
  onClose: () => void;
  /** Whether to show the native search warning */
  showNativeWarning?: boolean;
  /** Ref to be attached to the input element */
  inputRef?: React.RefObject<HTMLInputElement>;
}

/**
 * In-page search UI component with input, navigation buttons, and match counter.
 */
export function InPageSearch({
  query,
  onQueryChange,
  currentMatchIndex,
  totalMatches,
  onNext,
  onPrevious,
  onClose,
  showNativeWarning = false,
  inputRef: externalInputRef,
}: InPageSearchProps) {
  const internalInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef || internalInputRef;

  // Auto-focus input when component mounts
  useEffect(() => {
    inputRef.current?.focus();
  }, [inputRef]);

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {/* Main search bar */}
      <div className="bg-white dark:bg-gray-800 border-2 border-blue-500 dark:border-blue-400 rounded-lg shadow-xl p-3 flex items-center gap-2">
        {/* Search input */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search..."
          className="w-64 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />

        {/* Match counter */}
        <div className="text-sm text-gray-600 dark:text-gray-400 min-w-[4rem] text-center">
          {totalMatches === 0 ? (
            query ? (
              'No matches'
            ) : (
              ''
            )
          ) : (
            <span>
              {currentMatchIndex + 1} of {totalMatches}
            </span>
          )}
        </div>

        {/* Navigation buttons */}
        <div className="flex gap-1">
          <button
            onClick={onPrevious}
            disabled={totalMatches === 0}
            className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Previous match (Shift+Enter)"
          >
            <ArrowUp size={16} weight="bold" />
          </button>
          <button
            onClick={onNext}
            disabled={totalMatches === 0}
            className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Next match (Enter)"
          >
            <ArrowDown size={16} weight="bold" />
          </button>
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="px-2 py-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          title="Close search (Esc)"
        >
          <X size={16} weight="bold" />
        </button>
      </div>

      {/* Info note - always shown */}
      <div
        className={`rounded-lg shadow-lg px-3 py-2 text-xs transition-opacity duration-300 ${
          showNativeWarning
            ? 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 text-yellow-700 dark:text-yellow-300 opacity-100'
            : 'bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 opacity-75'
        }`}
      >
        <div className="flex items-center gap-2">
          {showNativeWarning && <Warning size={14} weight="bold" />}
          <span>
            {showNativeWarning
              ? "Native search won't find items not currently visible."
              : 'Press search shortcut again while focused to use native search.'}
          </span>
        </div>
      </div>
    </div>
  );
}
