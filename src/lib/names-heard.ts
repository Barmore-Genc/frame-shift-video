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
