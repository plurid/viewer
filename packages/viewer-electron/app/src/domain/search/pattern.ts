import { RE2JS } from 're2js';

export interface SearchPattern {
  test(value: string): boolean;
}

/** Escapes for a class of characters, which end a literal but carry nothing after them. */
const classEscapes = new Set([...'dDwWsSbB']);
const ascii = /^[\x00-\x7f]*$/;

/** The index of the `]` that closes the class opened at `start`, or -1. */
function classEnd(source: string, start: number): number {
  let index = start + 1;
  if (source[index] === '^') index++;
  // a `]` first in a class is one of its characters
  if (source[index] === ']') index++;
  for (; index < source.length; index++) {
    const char = source[index];
    if (char === '\\') index++;
    else if (char === '[' && source[index + 1] === ':') {
      const close = source.indexOf(':]', index + 2);
      if (close < 0) return -1;
      index = close + 1;
    } else if (char === ']') return index;
  }
  return -1;
}

/** The index of the `)` that closes the group opened at `start`, or -1. */
function groupEnd(source: string, start: number): number {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (char === '\\') index++;
    else if (char === '[') {
      index = classEnd(source, index);
      if (index < 0) return -1;
    } else if (char === '(') depth++;
    else if (char === ')' && --depth === 0) return index;
  }
  return -1;
}

/**
 * The longest literal that every match must contain, lowercased, or undefined when the pattern
 * guarantees none. Only the top level of a pattern without alternatives is read, and anything
 * not understood exactly gives undefined: a wrong literal would hide real matches.
 */
export function requiredLiteral(source: string): string | undefined {
  let best = '';
  let run = '';
  const end = () => {
    if (run.length > best.length) best = run;
    run = '';
  };
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (char === '|') return undefined;
    if (char === '\\') {
      const next = source[++index];
      if (next === undefined) return undefined;
      if (classEscapes.has(next)) end();
      else if (/[A-Za-z0-9]/.test(next)) return undefined;
      else run += next;
    } else if (char === '(' || char === '[') {
      end();
      index = char === '(' ? groupEnd(source, index) : classEnd(source, index);
      if (index < 0) return undefined;
    } else if (char === '*' || char === '?' || char === '+' || char === '{') {
      // the quantified character stays required only when at least one must appear
      const repeat = char === '{' ? /^\{(\d+)(,\d*)?\}/.exec(source.slice(index)) : null;
      if (char === '{' && !repeat) return undefined;
      const minimum = char === '+' ? 1 : repeat ? Number(repeat[1]) : 0;
      if (repeat) index += repeat[0].length - 1;
      if (!minimum) run = run.slice(0, -1);
      end();
    } else if (char === '.' || char === '^' || char === '$') end();
    else run += char;
  }
  end();
  return best ? best.toLowerCase() : undefined;
}

/**
 * User patterns run in the renderer and index worker. Never use a backtracking fallback.
 * RE2 costs microseconds a name; a literal the pattern requires rejects most names first. Case
 * folding goes beyond lowercasing outside ASCII, so only ASCII names are rejected that way.
 */
export function searchPattern(source: string): SearchPattern {
  if (source.length > 512) throw new Error('Name patterns are limited to 512 characters.');
  let compiled: SearchPattern;
  try {
    compiled = RE2JS.compile(RE2JS.translateRegExp(source), RE2JS.CASE_INSENSITIVE);
  } catch {
    throw new Error('Use a valid RE2 name pattern. Lookaround and backreferences are unavailable.');
  }
  const literal = requiredLiteral(source);
  if (!literal || !ascii.test(literal)) return compiled;
  return {
    test: (value) =>
      ascii.test(value) && !value.toLowerCase().includes(literal) ? false : compiled.test(value),
  };
}
