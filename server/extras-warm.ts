/**
 * Keeps the answer to "which extras are copies of others" ready, so the Discs page does not wait
 * for it. Looking at the pictures of every extra of a movie takes a minute or two (and the
 * listener's CPUs), so it is done here, one movie at a time, shortly after the server starts and
 * again whenever a movie's extras change or its answer is getting old.
 */

import { pictureDeps, warmCopies } from './extras-copies';
import { readExtras } from './extras-state';

type Deps = {
  /** Warms one movie (a test can give another). */
  warm?: (movie: string) => Promise<void>;
  /** Whether there is a listener to take pictures from. */
  listener?: boolean;
  log?: (message: string, detail?: Record<string, unknown>) => void;
};

/** One pass over every movie that has extras to compare. One movie failing does not stop the rest. */
export async function warmAll(dir: string, deps: Deps = {}): Promise<number> {
  if (!(deps.listener ?? Boolean(process.env.EXTRAS_EYES_URL))) return 0;
  const warm = deps.warm ?? ((movie) => warmCopies(dir, movie, pictureDeps()));
  const movies = (await readExtras(dir))
    .filter((m) => m.items.length > 1)
    .map((m) => m.movie);
  let warmed = 0;
  for (const movie of movies) {
    try {
      await warm(movie);
      warmed++;
    } catch (error) {
      deps.log?.('Could not warm the copies of a movie', {
        movie,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return warmed;
}

/**
 * Starts warming: a first pass after `delayMs`, then another `everyMs` after each pass ends (so passes
 * never overlap). Returns a function that stops it.
 */
export function startWarming(
  dir: string,
  options: {
    delayMs?: number;
    everyMs?: number;
    pass?: () => Promise<unknown>;
  } = {},
): () => void {
  const delayMs = options.delayMs ?? 30 * 1000;
  const everyMs = options.everyMs ?? 10 * 60 * 1000;
  const pass = options.pass ?? (() => warmAll(dir));
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const next = (wait: number) => {
    if (stopped) return;
    timer = setTimeout(async () => {
      try {
        await pass();
      } catch {
        // A pass that failed is tried again next time.
      }
      next(everyMs);
    }, wait);
    timer.unref?.();
  };
  next(delayMs);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
