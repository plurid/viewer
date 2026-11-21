import { typoScore } from './approximate';

export const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

export function scoreLabel(label: string, query: string): number {
  if (label.startsWith(query)) return 1000;
  if (label.split(/[\s…./-]+/).some((word) => word.startsWith(query))) return 900;
  const index = label.indexOf(query);
  if (index >= 0) return Math.max(101, 800 - index);
  let position = -1;
  let first = -1;
  for (const char of query) {
    position = label.indexOf(char, position + 1);
    if (position < 0) return typoScore(label, query);
    if (first < 0) first = position;
  }
  return 100 - Math.min(90, position - first - query.length + 1);
}
