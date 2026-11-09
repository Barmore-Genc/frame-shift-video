import { createFileRoute, Link } from '@tanstack/react-router';
import { SplitTools } from '@/components/split-tools';

export const Route = createFileRoute('/split/')({
  component: SplitPage,
});

function SplitPage() {
  return (
    <div className="container mx-auto px-6 py-12 max-w-4xl">
      <header className="mb-8">
        <Link
          to="/"
          className="text-blue-600 dark:text-blue-400 hover:underline"
        >
          ← Jobs
        </Link>
        <h1 className="mt-2 text-4xl font-bold text-gray-900 dark:text-white">
          Split &amp; Tracks
        </h1>
        <p className="text-gray-600 dark:text-gray-300">
          Separate combined episode files, and strip audio and subtitle tracks
          you do not want. Removing tracks never re-encodes; splitting can
          re-encode or copy, as you choose.
        </p>
      </header>

      <SplitTools />
    </div>
  );
}
