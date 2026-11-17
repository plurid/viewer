import { normalize } from './name-score';

export interface PathScoreWork {
  prefilter: number;
  cells: number;
}

export interface PreparedPathScore {
  label: string;
  leaf: number;
  boundaries: Uint8Array;
  endings: Uint8Array;
  bonuses: Uint8Array;
  positions: Map<string, number[]>;
}

export interface PathScoreBuffers {
  previous: Float64Array;
  current: Float64Array;
}

export function preparePathScore(path: string): PreparedPathScore {
  const label = normalize(path);
  const leaf = label.lastIndexOf('/') + 1;
  const columns = Array.from({ length: label.length }, (_, column) => column);
  const positions = new Map<string, number[]>();
  for (const column of columns) {
    const character = label[column]!;
    const matches = positions.get(character) ?? [];
    matches.push(column);
    positions.set(character, matches);
  }
  const boundaries = Uint8Array.from(columns, (column) =>
    Number(
      column === 0 ||
        /[/_.\-\s]/.test(label[column - 1]!) ||
        (/[a-z]/.test(path[column - 1] ?? '') && /[A-Z]/.test(path[column] ?? '')),
    ),
  );
  return {
    label,
    positions,
    leaf,
    boundaries,
    endings: Uint8Array.from(columns, (column) =>
      Number(column === label.length - 1 || /[/_.\-\s]/.test(label[column + 1]!)),
    ),
    bonuses: Uint8Array.from(
      columns,
      (column) => 16 + (boundaries[column] ? 14 : 0) + (column >= leaf ? 8 : 0),
    ),
  };
}

export const pathScoreBuffers = (): PathScoreBuffers => ({
  previous: new Float64Array(256),
  current: new Float64Array(256),
});

/** A subsequence filter bounds the dynamic program to matching terms only. */
export function scorePreparedPath(
  path: PreparedPathScore,
  query: string,
  buffers: PathScoreBuffers,
  work?: PathScoreWork,
): number {
  const { label, endings, bonuses } = path;
  if (!query || query.length > label.length) return 0;
  let position = -1;
  for (let index = 0; index < query.length; index++) {
    const next = label.indexOf(query[index]!, position + 1);
    if (work) work.prefilter += next < 0 ? label.length - position - 1 : next - position;
    if (next < 0) return 0;
    position = next;
  }
  if (buffers.previous.length < label.length) {
    buffers.previous = new Float64Array(label.length);
    buffers.current = new Float64Array(label.length);
  }
  let previous = buffers.previous;
  let current = buffers.current;
  let preceding: readonly number[] = [];
  let best = -Infinity;
  for (let row = 0; row < query.length; row++) {
    const columns = path.positions.get(query[row]!)!;
    let cursor = 0;
    let prefix = -Infinity;
    best = -Infinity;
    for (const column of columns) {
      if (work) work.cells++;
      while (cursor < preceding.length && preceding[cursor]! < column) {
        const before = preceding[cursor++]!;
        prefix = Math.max(prefix, previous[before]! + before * 0.6);
      }
      const bonus = bonuses[column]! + (row === query.length - 1 && endings[column] ? 8 : 0);
      current[column] =
        row === 0
          ? bonus - column * 0.15
          : Math.max(
              prefix - column * 0.6 + bonus,
              column && label[column - 1] === query[row - 1]
                ? previous[column - 1]! + bonus + 12
                : -Infinity,
            );
      best = Math.max(best, current[column]!);
    }
    [previous, current] = [current, previous];
    preceding = columns;
  }
  return Math.round(Math.max(100, Math.min(850, 100 + (750 * best) / (query.length * 54))));
}

export function fuzzyPathScore(path: string, query: string, work?: PathScoreWork): number {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;
  const prepared = preparePathScore(path);
  const buffers = pathScoreBuffers();
  const scores = terms.map((term) => scorePreparedPath(prepared, normalize(term), buffers, work));
  return scores.includes(0)
    ? 0
    : Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}
