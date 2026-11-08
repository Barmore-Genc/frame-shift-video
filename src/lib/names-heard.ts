/**
 * The names said in a stretch of speech, for a person to read when an extra has no name yet: a
 * preview says the film it advertises ("The Three Musketeers"), a featurette its subject. It is only
 * the capitalized words of what was heard, with the plainest sentence openers left out, so it is a
 * hint to read, never a name to use.
 */

/** Words that are capitalized only because a sentence starts with them (and small words around names). */
const OPENERS = new Set(
  (
    'a an and are as at be because but by can come coming could did discover do does down enjoy ' +
    "every experience featuring for from get go got had has have he her here his how i i'd i'll " +
    "i'm i've if in including into introducing is it it's its join just let like look make me meet " +
    'my new no not now of oh ok okay on one only or our out over please plus see she so some sorry ' +
    'still starring that the their them then there these they this those to too up us very was we ' +
    "watch well were what when where which who why will with won't would yeah yes you your " +
    "you're you'll"
  ).split(' '),
);
/** Capitalized words that are not names. */
const NOT_NAMES = new Set(
  (
    'january february march april may june july august september october november december monday ' +
    'tuesday wednesday thursday friday saturday sunday dvd'
  ).split(' '),
);
/** Small words that can sit inside a name ("The Art of Gary Baseman", "Lord of the Rings"). */
const BETWEEN = new Set(['of', 'the', 'and', '&']);
const MOST = 8;

const clean = (word: string) =>
  word.replace(/^[“”"‘’'(]+|[“”",.!?;:)]+$/g, '').replace(/’/g, "'");
const capitalized = (word: string) => /^[A-Z][\w'-]*$/.test(word);
const number = (word: string) => /^\d+$/.test(word);
const endsSentence = (raw: string) => /[.!?]["”’']*$/.test(raw);

/** Whether `inner` is a stretch of the words of `outer`. */
function within(inner: string, outer: string): boolean {
  if (inner === outer) return false;
  return ` ${outer} `.includes(` ${inner} `);
}

/** The runs of capitalized words in `text`, as they were said, first appearance first. */
export function namesHeard(text: string): string[] {
  const raw = text.split(/\s+/).filter(Boolean);
  const words = raw.map(clean);
  const runs: { from: number; to: number }[] = [];
  for (let i = 0; i < words.length;) {
    if (!capitalized(words[i]!)) {
      i++;
      continue;
    }
    let to = i;
    // The run goes on over more capitalized words, a number after a name ("Lion King 2"), and the
    // small words that sit inside a name when a capitalized word follows them; a comma or the end of
    // a sentence ends it.
    while (
      to + 1 < words.length &&
      !endsSentence(raw[to]!) &&
      !/,$/.test(raw[to]!)
    ) {
      const next = words[to + 1]!;
      if (capitalized(next) || number(next)) {
        to++;
        continue;
      }
      let span = 0;
      while (
        to + 1 + span < words.length &&
        span < 2 &&
        BETWEEN.has(words[to + 1 + span]!.toLowerCase()) &&
        !endsSentence(raw[to + span]!)
      ) {
        span++;
      }
      if (span > 0 && capitalized(words[to + 1 + span] ?? '')) to += span + 1;
      else break;
    }
    runs.push({ from: i, to });
    i = to + 1;
  }
  const startsSentence = (at: number) => at === 0 || endsSentence(raw[at - 1]!);
  // Single words capitalized in the middle of a sentence somewhere: they are names even at a start.
  const inTheMiddle = new Set(
    runs
      .filter((r) => !startsSentence(r.from))
      .flatMap((r) =>
        words.slice(r.from, r.to + 1).map((w) => w.toLowerCase()),
      ),
  );
  const names: string[] = [];
  for (const { from, to } of runs) {
    let a = from;
    let b = to;
    // An opener that begins a sentence is not part of the name that follows it ("On Disney DVD");
    // neither is a date or "DVD" at the end.
    while (
      a < b &&
      startsSentence(from) &&
      OPENERS.has(words[a]!.toLowerCase()) &&
      words[a]!.toLowerCase() !== 'the'
    ) {
      a++;
    }
    // (a small word left at the front, like the "the" of "I'm the Master of Evil", is not capitalized)
    while (
      a < b &&
      words[a] === words[a]!.toLowerCase() &&
      BETWEEN.has(words[a]!)
    )
      a++;
    while (b > a && NOT_NAMES.has(words[b]!.toLowerCase())) b--;
    const parts = words.slice(a, b + 1);
    if (
      parts.length === 0 ||
      parts.every(
        (p) =>
          OPENERS.has(p.toLowerCase()) ||
          NOT_NAMES.has(p.toLowerCase()) ||
          number(p),
      )
    )
      continue;
    if (parts.length === 1) {
      const one = parts[0]!.toLowerCase();
      if (one.length < 3 || OPENERS.has(one) || NOT_NAMES.has(one)) continue;
      if (startsSentence(a) && !inTheMiddle.has(one)) continue;
    }
    const name = parts.join(' ');
    if (!names.some((n) => n.toLowerCase() === name.toLowerCase()))
      names.push(name);
  }
  // A name that is only a part of another one said is left out ("Musketeers" beside "The Three Musketeers").
  return names
    .filter((n) => !names.some((o) => within(n.toLowerCase(), o.toLowerCase())))
    .slice(0, MOST);
}

/** The studios and channels a preview names on the way; they are not the film it advertises. */
const STUDIOS = new Set(
  'disney pixar walt pictures channel dreamworks miramax touchstone buena vista hollywood'.split(
    ' ',
  ),
);

/**
 * The film (or show) a preview advertises, from what was said in it: a preview says its title more
 * than once ("The Aladdin Special Edition on Disney DVD ... The Aladdin Special Edition ..."), so it
 * is the capitalized word said most often, grown into the longest stretch of words around it that is
 * said as often as twice. Null when nothing is said twice. It is a suggestion for a person, not a fact.
 */
export function trailerTitle(
  text: string,
): { title: string; times: number } | null {
  const raw = text.split(/\s+/).filter(Boolean);
  const words = raw.map((w) => clean(w).toLowerCase());
  const stop = (at: number) => endsSentence(raw[at]!) || /,$/.test(raw[at]!);
  // The capitalized words that could be a title's, by how often they are said.
  const tally = new Map<string, number>();
  const first = new Map<string, number>();
  raw.forEach((r, at) => {
    const word = clean(r);
    const low = words[at]!;
    if (
      !capitalized(word) ||
      // (a word capitalized only because a sentence starts with it says nothing: "All four, one for all")
      at === 0 ||
      endsSentence(raw[at - 1]!) ||
      number(word) ||
      low.length < 3 ||
      OPENERS.has(low) ||
      NOT_NAMES.has(low) ||
      STUDIOS.has(low)
    )
      return;
    tally.set(low, (tally.get(low) ?? 0) + 1);
    if (!first.has(low)) first.set(low, at);
  });
  const seeds = [...tally].filter(([, n]) => n >= 2).map(([low]) => low);
  if (seeds.length === 0) return null;
  // Where the phrase is said: start positions of runs of words equal to `phrase`, none ending a sentence inside.
  const at = (phrase: string[]): number[] => {
    const found: number[] = [];
    for (let k = 0; k + phrase.length <= words.length; k++) {
      if (
        phrase.every(
          (w, m) =>
            words[k + m] === w && (m === phrase.length - 1 || !stop(k + m)),
        )
      )
        found.push(k);
    }
    return found;
  };
  const grow = (seed: string): string[] => {
    let phrase = [seed];
    for (let grown = true; grown && phrase.length < 8;) {
      grown = false;
      const places = at(phrase);
      // To the right: the word that follows (a "the/of/and" only along with the word after it).
      const right = new Map<string, number>();
      for (const k of places) {
        const end = k + phrase.length - 1;
        if (stop(end) || end + 1 >= words.length) continue;
        let next = [words[end + 1]!];
        if (BETWEEN.has(next[0]!)) {
          if (stop(end + 1) || end + 2 >= words.length) continue;
          next = [words[end + 1]!, words[end + 2]!];
        }
        if (OPENERS.has(next[next.length - 1]!) && !BETWEEN.has(next[0]!))
          continue;
        const key = next.join(' ');
        right.set(key, (right.get(key) ?? 0) + 1);
      }
      const best = [...right].sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] >= 2) {
        phrase = [...phrase, ...best[0].split(' ')];
        grown = true;
        continue;
      }
      // To the left: only "the" ("The Three Musketeers").
      const the = places.filter(
        (k) => k > 0 && words[k - 1] === 'the' && !stop(k - 1),
      );
      if (the.length >= 2 && phrase[0] !== 'the') {
        phrase = ['the', ...phrase];
        grown = true;
      }
    }
    return phrase;
  };
  // Every word said twice is grown into its phrase. The title is the one with the most words that
  // count (not "the", "of", "and"), then the most said, then the one said first.
  const rank = (grown: string[]) => {
    const places = at(grown);
    return [
      grown.filter((w) => !BETWEEN.has(w)).length,
      places.length,
      -places[0]!,
    ] as const;
  };
  let phrase: string[] = [];
  let top: readonly number[] = [0, 0, -Infinity];
  for (const seed of seeds) {
    const grown = grow(seed);
    const now = rank(grown);
    if (
      now[0] > top[0]! ||
      (now[0] === top[0] &&
        (now[1] > top[1]! || (now[1] === top[1] && now[2] > top[2]!)))
    ) {
      phrase = grown;
      top = now;
    }
  }
  const times = at(phrase).length;
  const title = phrase
    .map((w, i) =>
      i > 0 && BETWEEN.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(' ');
  return { title, times };
}
