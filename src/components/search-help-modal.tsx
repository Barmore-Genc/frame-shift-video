import React from 'react';
import { ClipboardText } from '@phosphor-icons/react';

interface SearchHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const HELP_CONTENT = `# File Search Pattern Guide

This search uses **micromatch** pattern matching to filter files.

## Filter Options

**Simple Mode (Default)**
- Your search is automatically wrapped with wildcards: \`charlie\` becomes \`*charlie*\`
- **Videos Only** (enabled by default): Only shows video files by adding \`.{mp4,mkv,avi,mov,wmv,flv,webm,m4v,mpg,mpeg,3gp,mts,m2ts}\`
- Example: Typing \`charlie\` searches for \`*charlie*.{mp4,mkv,...}\`

**Advanced Mode**
- Use exact pattern matching without modifications
- Full control over your search pattern
- Can be combined with all other filters
- Use this when you need precise pattern matching

**Show Hidden Files**
- By default, hidden files (starting with \`.\`) are not shown
- Enable this option to include hidden files and folders in search results
- Works in both Simple and Advanced modes

## Basic Patterns

- **\`*.mp4\`** - Match all MP4 files
- **\`video.mkv\`** - Match a specific filename
- **\`file?.txt\`** - Match single character (file1.txt, file2.txt)

## Wildcard Patterns

- **\`*\`** - Match any characters except slash (/)
- **\`**\`** - Match any characters including slashes (globstar)
- **\`?\`** - Match exactly one character
- **\`[abc]\`** - Match any character in brackets (a, b, or c)
- **\`[a-z]\`** - Match any character in range (a through z)

## Multiple Patterns

- **\`*.{mp4,mkv,avi}\`** - Match files with multiple extensions
- **\`{video,movie}*.mp4\`** - Match files starting with video or movie

## Advanced Patterns

- **\`!(*.txt)\`** - Negation: match anything except .txt files
- **\`+(pattern)\`** - Match one or more occurrences
- **\`*(pattern)\`** - Match zero or more occurrences
- **\`?(pattern)\`** - Match zero or one occurrence

## Examples

**Simple Mode:**
- **\`charlie\`** - Finds any video file containing "charlie" anywhere in the name (e.g., charlie_brown.mp4, the_charlie_project.mkv)
- **\`2024-\`** - Finds video files containing "2024-" anywhere in the name (e.g., 2024-vacation.mkv, summer-2024-trip.mp4)

**Advanced Mode:**
- **\`**/*.mp4\`** - Find all MP4 files in any subdirectory
- **\`2024-*.{mp4,mov}\`** - Files starting with "2024-" and ending in .mp4 or .mov
- **\`[0-9][0-9][0-9][0-9]-*.mp4\`** - Files starting with 4 digits
- **\`!(draft)*.mp4\`** - MP4 files not starting with "draft"

## Tips

- Search is **case-insensitive** (Charlie matches CHARLIE, charlie, ChArLiE, etc.)
- Search scans the entire directory tree
- Only matching files and their parent folders are shown
- Empty folders (with no matches) are hidden
- Use **Advanced Mode** when you need exact pattern control
- **Videos Only** filters common video formats automatically in Simple Mode
- Enable **Show Hidden Files** to see files starting with a dot (e.g., .env, .gitignore)
`;

export function SearchHelpModal({ isOpen, onClose }: SearchHelpModalProps) {
  const handleCopyAIInstructions = () => {
    const aiPrompt = `The following is documentation about how file search works in an application. Please help me construct a search query based on my needs.

${HELP_CONTENT}`;

    navigator.clipboard.writeText(aiPrompt);
    alert('AI help instructions copied to clipboard!');
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-600">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Search Pattern Help
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <span className="text-2xl">×</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="prose dark:prose-invert max-w-none">
            {HELP_CONTENT.split('\n').map((line, index) => {
              // Headers
              if (line.startsWith('# ')) {
                return (
                  <h1
                    key={index}
                    className="text-2xl font-bold mb-4 text-gray-900 dark:text-white"
                  >
                    {line.substring(2)}
                  </h1>
                );
              }
              if (line.startsWith('## ')) {
                return (
                  <h2
                    key={index}
                    className="text-xl font-semibold mt-6 mb-3 text-gray-800 dark:text-gray-200"
                  >
                    {line.substring(3)}
                  </h2>
                );
              }

              // List items with code
              if (line.startsWith('- **')) {
                const match = line.match(/^- \*\*`([^`]+)`\*\* - (.+)$/);
                if (match) {
                  return (
                    <div key={index} className="mb-2 ml-4">
                      <code className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-sm font-mono text-blue-600 dark:text-blue-400">
                        {match[1]}
                      </code>
                      <span className="ml-2 text-gray-700 dark:text-gray-300">
                        - {match[2]}
                      </span>
                    </div>
                  );
                }
              }

              // Regular list items
              if (line.startsWith('- ')) {
                return (
                  <div
                    key={index}
                    className="mb-2 ml-4 text-gray-700 dark:text-gray-300"
                  >
                    {line.substring(2)}
                  </div>
                );
              }

              // Empty lines
              if (line.trim() === '') {
                return <div key={index} className="h-2" />;
              }

              // Regular paragraphs
              return (
                <p
                  key={index}
                  className="mb-2 text-gray-700 dark:text-gray-300"
                >
                  {line}
                </p>
              );
            })}
          </div>
        </div>

        <div className="p-6 border-t border-gray-200 dark:border-gray-600">
          <div className="flex items-center justify-between gap-4">
            <button
              onClick={handleCopyAIInstructions}
              className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium transition-colors"
            >
              <span className="inline-flex items-center justify-center gap-2">
                <ClipboardText size={18} weight="bold" aria-hidden="true" />
                Copy AI Help Instructions
              </span>
            </button>
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-medium transition-colors"
            >
              Close
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 text-center">
            Click "Copy AI Help Instructions" to copy this documentation and
            paste it into any AI assistant for help with search queries
          </p>
        </div>
      </div>
    </div>
  );
}
