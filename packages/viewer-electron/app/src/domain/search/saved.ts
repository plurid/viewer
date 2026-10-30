import { parseFileQuery, QueryError } from './query';

/** The characters a search plane's or a saved search's name holds. */
export const searchNameLength = 100;
/** The saved searches Viewer keeps. */
export const savedSearchCount = 100;

/** A name for a search: its query, cut at a word when it is longer than a name holds. */
export function searchName(query: string): string {
  const text = query.trim().replace(/\s+/g, ' ');
  if (text.length <= searchNameLength) return text;
  const cut = text.slice(0, searchNameLength - 1);
  const space = cut.lastIndexOf(' ');
  return (space >= searchNameLength / 2 ? cut.slice(0, space) : cut) + '…';
}

/** Why a query cannot be saved, said as what to change; none when it can. */
export function savedSearchProblem(query: string, saved: number): string | undefined {
  if (saved >= savedSearchCount)
    return `Viewer keeps ${savedSearchCount} saved searches. Remove one in Settings → Search to save this one.`;
  try {
    parseFileQuery(query);
  } catch (error) {
    if (error instanceof QueryError) return error.message;
    throw error;
  }
  return undefined;
}
