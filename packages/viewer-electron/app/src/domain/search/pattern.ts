import { RE2JS } from 're2js';

export interface SearchPattern {
  test(value: string): boolean;
}

/** User patterns run in the renderer and index worker. Never use a backtracking fallback. */
export function searchPattern(source: string): SearchPattern {
  if (source.length > 512) throw new Error('Name patterns are limited to 512 characters.');
  try {
    return RE2JS.compile(RE2JS.translateRegExp(source), RE2JS.CASE_INSENSITIVE);
  } catch {
    throw new Error('Use a valid RE2 name pattern. Lookaround and backreferences are unavailable.');
  }
}
