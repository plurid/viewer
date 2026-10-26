/** Bounded optimal-string-alignment distance, including adjacent transpositions.
 * Suggestions are discovery only; callers retain the original query/command. */
export function boundedEditDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit || a.length > 256 || b.length > 256) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let before = previous;
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let minimum = i;
    for (let j = 1; j <= b.length; j++) {
      let value = Math.min(
        previous[j]! + 1,
        row[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        value = Math.min(value, before[j - 2]! + 1);
      row[j] = value;
      minimum = Math.min(minimum, value);
    }
    if (minimum > limit) return limit + 1;
    before = previous;
    previous = row;
  }
  return previous[b.length]!;
}

/** Lower than exact, prefix and subsequence matches. Word order is preserved,
 * and short abbreviations do not turn into unrelated typo matches. */
export function typoScore(label: string, query: string): number {
  if (query.length < 3 || query.length > 100) return 0;
  const words = query.split(/[\s…./_-]+/).filter(Boolean);
  const candidates = label
    .split(/[\s…./_-]+/)
    .filter(Boolean)
    .slice(0, 32);
  if (!words.length || words.length > 8) return 0;
  let next = 0,
    total = 0;
  for (const word of words) {
    const limit = word.length < 3 ? 0 : word.length < 6 ? 1 : 2;
    let best = -1,
      distance = limit + 1;
    for (let index = next; index < candidates.length; index++) {
      const value = boundedEditDistance(word, candidates[index]!, limit);
      if (value < distance) {
        best = index;
        distance = value;
      }
    }
    if (best < 0) return 0;
    next = best + 1;
    total += distance;
  }
  return Math.max(1, 60 - total * 8);
}
