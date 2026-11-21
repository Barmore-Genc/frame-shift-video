import { createFileRoute, Link } from '@tanstack/react-router';
import { JobList } from '@/components/job-list';
import { AppErrorBoundary } from '@/components/app-error-boundary';
import { DiscsCard } from '@/components/discs-card';
import { FilmSlate } from '@phosphor-icons/react';

export const Route = createFileRoute('/')({
  component: IndexComponent,
});

function IndexComponent() {
  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-12 text-center">
        <h1 className="text-5xl font-bold text-gray-900 dark:text-white mb-4">
          Frame Shift Video
        </h1>
        <p className="text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
          Self-hosted video conversion service with FFmpeg
        </p>
      </header>

      <main>
        <div className="py-16 flex flex-wrap justify-center gap-8">
          <div className="bg-white dark:bg-gray-800 rounded-xl border-2 border-gray-200 dark:border-gray-600 p-12 shadow-lg max-w-md w-full text-center">
            <FilmSlate
              size={72}
              weight="bold"
              className="neon-icon mx-auto mb-6"
              aria-hidden="true"
            />
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              Start Video Conversion
            </h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              Select files from your server to begin converting videos.
            </p>
            <Link
              to="/convert"
              search={{}}
              className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
            >
              Start Conversions
            </Link>
          </div>
          <AppErrorBoundary>
            <DiscsCard />
          </AppErrorBoundary>
        </div>

        <div className="mt-16">
          <AppErrorBoundary>
            <JobList />
          </AppErrorBoundary>
        </div>

        <div className="mt-8 flex justify-center gap-3">
          <Link
            to="/discs"
            className="inline-flex min-h-[44px] items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-medium transition-colors text-base"
          >
            Discs
          </Link>
          <Link
            to="/split"
            className="inline-flex min-h-[44px] items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-medium transition-colors text-base"
          >
            Split &amp; Tracks
          </Link>
          <Link
            to="/settings"
            className="inline-flex min-h-[44px] items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-medium transition-colors text-base"
          >
            Settings
          </Link>
        </div>
      </main>
    </div>
  );
}
