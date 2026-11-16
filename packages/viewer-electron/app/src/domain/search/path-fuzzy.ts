import { normalize } from './name-score';

/** A subsequence filter bounds the dynamic program to matching terms only. */
function termScore(path: string, term: string): number {
  const label = normalize(path);
  const query = normalize(term);
  if (!query || query.length > label.length) return 0;
  let next = 0;
  for (const character of label) if (character === query[next]) next++;
  if (next !== query.length) return 0;
  const leaf = label.lastIndexOf('/') + 1;
  let previous = new Float64Array(label.length).fill(-Infinity);
  for (let row = 0; row < query.length; row++) {
    const current = new Float64Array(label.length).fill(-Infinity);
    let best = -Infinity;
    for (let column = 0; column < label.length; column++) {
      if (column) best = Math.max(best - 0.6, previous[column - 1]! - 0.6);
      if (label[column] !== query[row]) continue;
      const boundary = column === 0 || /[/_.\-\s]/.test(label[column - 1]!) ||
        (/[a-z]/.test(path[column - 1] ?? '') && /[A-Z]/.test(path[column] ?? ''));
      const bonus = 16 + (boundary ? 14 : 0) + (column >= leaf ? 8 : 0);
      current[column] = row === 0 ? bonus - column * 0.15 :
        Math.max(best + bonus, (previous[column - 1] ?? -Infinity) + bonus + 12);
    }
    previous = current;
  }
  let best = -Infinity;
  for (const value of previous) best = Math.max(best, value);
  return Math.round(Math.max(100, Math.min(850, 100 + 750 * best / (query.length * 54))));
}

export function fuzzyPathScore(path: string, query: string): number {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;
  const scores = terms.map((term) => termScore(path, term));
  return scores.includes(0) ? 0 : Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}
