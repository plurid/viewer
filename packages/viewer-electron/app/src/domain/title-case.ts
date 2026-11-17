// The words a macOS title keeps lowercase: articles, coordinating conjunctions and prepositions of
// four letters or fewer, unless one starts or ends the title.
const lowercase = new Set([
  'a',
  'an',
  'the',
  'and',
  'but',
  'or',
  'nor',
  'for',
  'so',
  'yet',
  'as',
  'at',
  'by',
  'from',
  'in',
  'into',
  'of',
  'off',
  'on',
  'onto',
  'out',
  'over',
  'per',
  'to',
  'up',
  'via',
  'with',
  'vs',
]);
// "Zoom In", "Back Up": the second word belongs to the verb, so it keeps its capital
const phrasalVerbs = new Set(['zoom', 'set', 'sign', 'back', 'log', 'turn', 'clean']);
const adverbs = new Set(['in', 'out', 'up', 'on', 'off', 'over']);

/**
 * A sentence-case name as a menu item or button shows it on a Mac: "Change space color…" becomes
 * "Change Space Color…". Words that already hold a capital past their first letter (macOS, PDF),
 * numbers and “quoted names” stay as they are.
 */
export function titleCase(text: string): string {
  const words = text.split(/(\s+)/);
  const positions = words.flatMap((word, index) => (/\S/.test(word) ? [index] : []));
  // a “quoted name” of several words is the person's own: none of its words change
  let quoted = false;
  return words
    .map((word, index) => {
      if (word.startsWith('“')) quoted = true;
      if (quoted) {
        if (word.includes('”')) quoted = false;
        return word;
      }
      if (!/\S/.test(word)) return word;
      const bare = word.replace(/^[“"‘(]+|[”"’).,:;!?…]+$/g, '');
      if (!bare || /[\d{}$`]/.test(bare) || /.[A-Z]/.test(bare)) return word;
      const at = positions.indexOf(index);
      const edge = at === 0 || at === positions.length - 1;
      const previous = at > 0 ? words[positions[at - 1]!]!.toLowerCase() : '';
      const small = (part: string) => lowercase.has(part.toLowerCase());
      const lower =
        !edge && small(bare) && !(adverbs.has(bare.toLowerCase()) && phrasalVerbs.has(previous));
      const cased = bare
        .split('-')
        .map((part, piece) =>
          lower || (piece > 0 && small(part))
            ? part.toLowerCase()
            : part.charAt(0).toUpperCase() + part.slice(1),
        )
        .join('-');
      return word.replace(bare, cased);
    })
    .join('');
}
