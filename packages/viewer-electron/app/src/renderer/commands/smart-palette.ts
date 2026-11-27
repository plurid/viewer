/**
 * The smart palette: what a query asks for beyond a command's name. A path offers its
 * folder's contents, `=` calculates, `z` and a name jumps to a frecent folder (as zoxide does), and a
 * command takes its argument after its name: `new folder Drafts`, `rename notes.md`, `go ~/Downloads`.
 */
import { trashLocation } from '../../domain/files/trash';

export type PaletteIntent =
  | { kind: 'path'; directory: string; partial: string }
  | { kind: 'calc'; expression: string }
  | { kind: 'jump'; text: string }
  | {
      kind: 'argument';
      command: 'new-folder' | 'new-file' | 'rename' | 'go-to';
      text: string;
    };
const verbs: readonly [RegExp, Extract<PaletteIntent, { kind: 'argument' }>['command']][] = [
  [/^(?:new folder|mkdir)\s+/i, 'new-folder'],
  [/^(?:new file|touch)\s+/i, 'new-file'],
  [/^(?:rename|mv)\s+/i, 'rename'],
  [/^(?:go to|go|cd)\s+/i, 'go-to'],
];
/** A typed path made absolute: `~` is home, `./` and `../` start in the current folder. */
function absolute(path: string, home: string, current: string): string {
  if (path === trashLocation) return path;
  const joined =
    path === '~' || path.startsWith('~/')
      ? home + path.slice(1)
      : path.startsWith('/')
        ? path
        : current.replace(/\/$/, '') + '/' + path;
  const parts: string[] = [];
  for (const part of joined.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return '/' + parts.join('/') + (joined.endsWith('/') && parts.length ? '/' : '');
}
export function paletteIntent(query: string, home: string, current: string): PaletteIntent | null {
  const text = query.trimStart();
  if (text.startsWith('=')) return { kind: 'calc', expression: text.slice(1).trim() };
  const jump = /^z\s+(.+)$/.exec(text);
  if (jump) return { kind: 'jump', text: jump[1]!.trim() };
  if (/^(~(\/|$)|\/|\.{1,2}\/)/.test(text)) {
    const path = absolute(text, home, current);
    const directory = text === '~' || path.endsWith('/') ? path.replace(/(.)\/$/, '$1') : path;
    if (text === '~' || text.endsWith('/') || text === '~/')
      return { kind: 'path', directory, partial: '' };
    const cut = path.lastIndexOf('/');
    return { kind: 'path', directory: path.slice(0, cut) || '/', partial: path.slice(cut + 1) };
  }
  for (const [verb, command] of verbs) {
    const match = verb.exec(text);
    if (!match) continue;
    const argument = text.slice(match[0].length).trim();
    if (!argument) return null;
    return {
      kind: 'argument',
      command,
      text:
        command === 'go-to' ? absolute(argument, home, current).replace(/(.)\/$/, '$1') : argument,
    };
  }
  return null;
}

/**
 * Arithmetic only, by recursive descent: numbers, + - * / % ^, parentheses, pi and e, and sqrt, abs,
 * round, floor, ceil, log and ln. Anything else is no calculation; nothing is evaluated as code.
 */
export function calculate(expression: string): number | undefined {
  const tokens = expression.match(/\d+(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+|[a-z]+|\*\*|[-+*/%^()]|\S/gi);
  if (!tokens?.length) return undefined;
  let at = 0;
  const peek = () => tokens[at];
  const take = () => tokens[at++];
  const functions: Record<string, (value: number) => number> = {
    sqrt: Math.sqrt,
    abs: Math.abs,
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
    log: Math.log10,
    ln: Math.log,
  };
  const constants: Record<string, number> = { pi: Math.PI, e: Math.E };
  const primary = (): number => {
    const token = take();
    if (token === undefined) throw new Error('end');
    if (token === '(') {
      const value = sum();
      if (take() !== ')') throw new Error('paren');
      return value;
    }
    if (token === '-') return -power();
    if (token === '+') return power();
    if (/^(\d|\.\d)/.test(token)) return Number(token);
    const name = token.toLowerCase();
    if (name in constants) return constants[name]!;
    if (name in functions && peek() === '(') {
      take();
      const value = sum();
      if (take() !== ')') throw new Error('paren');
      return functions[name]!(value);
    }
    throw new Error('token');
  };
  const power = (): number => {
    const base = primary();
    if (peek() === '^' || peek() === '**') {
      take();
      return base ** power();
    }
    return base;
  };
  const product = (): number => {
    let value = power();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const operator = take();
      const right = power();
      value = operator === '*' ? value * right : operator === '/' ? value / right : value % right;
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (peek() === '+' || peek() === '-') {
      const operator = take();
      const right = product();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  };
  try {
    const value = sum();
    return at === tokens.length && Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export { frecencyScore, rankFrecent, recordVisit } from '../../domain/files/folder-visits';

/** Paths can exceed the command catalog's ID bound; labels and detail retain the full path. */
export function smartRowID(value: string): string {
  if (!value.startsWith('folder:') && !value.startsWith('path:')) return `smart:${value}`;
  let hash = 14695981039346656037n;
  for (const character of value) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(character.codePointAt(0)!)) * 1099511628211n);
  }
  return `smart:${value.slice(0, value.indexOf(':'))}:${hash.toString(16)}`;
}
