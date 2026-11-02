import { Link } from '@tanstack/react-router';
import { useDiscs } from '@/lib/api-hooks';
import { Disc } from '@phosphor-icons/react';

/**
 * The home page's way into the Discs page, with what the ripper is doing at a glance.
 * Without a DVDs folder on the server it is still a link, with a plain description.
 */
export function DiscsCard() {
  const { data: state } = useDiscs();

  let summary = 'Rip DVDs in the drive on the server to Plex-ready files.';
  if (state?.available) {
    const lines: string[] = [];
    if (state.run?.state === 'running') {
      lines.push(`Working${state.run.name ? ` on ${state.run.name}` : ''}`);
    } else if (state.drive?.alive) {
      lines.push(
        state.drive.media
          ? `Disc in the drive: ${state.drive.label || 'no name'}`
          : 'The drive is empty',
      );
    }
    if (state.attention.length > 0) {
      lines.push(
        `${state.attention.length} ${state.attention.length === 1 ? 'note needs' : 'notes need'} you`,
      );
    }
    if (lines.length > 0) summary = lines.join(' · ');
  }

  const needsYou = (state?.attention.length ?? 0) > 0;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border-2 border-gray-200 dark:border-gray-600 p-12 shadow-lg max-w-md w-full text-center">
      <Disc
        size={72}
        weight="bold"
        className="neon-icon mx-auto mb-6"
        aria-hidden="true"
      />
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
        Discs
      </h2>
      <p
        className={`mb-6 ${needsYou ? 'text-amber-700 dark:text-amber-400' : 'text-gray-600 dark:text-gray-300'}`}
      >
        {summary}
      </p>
      <Link
        to="/discs"
        className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
      >
        Open Discs
      </Link>
    </div>
  );
}
