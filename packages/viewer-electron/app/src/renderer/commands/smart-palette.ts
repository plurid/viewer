/**
 * THE SMART PALETTE (2026-10-23): what a query asks for beyond a command's name. A path offers its
 * folder's contents, `=` calculates, `z` and a name jumps to a frecent folder (as zoxide does), and a
 * command takes its argument after its name: `new folder Drafts`, `rename notes.md`, `go ~/Downloads`.
 */
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

/** A folder's visits: how many, and the last. */
export interface Visit {
  count: number;
  last: number;
}
const hour = 3600_000;
/** zoxide's weighting: the last hour counts four times, the last day twice, the last week once. */
export function frecencyScore({ count, last }: Visit, now: number): number {
  const age = now - last;
  return count * (age < hour ? 4 : age < 24 * hour ? 2 : age < 7 * 24 * hour ? 1 : 0.25);
}
/** Folders whose paths hold the words in order, the last in the folder's own name, best first. */
export function rankFrecent(
  visits: Readonly<Record<string, Visit>>,
  text: string,
  now: number,
): string[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return Object.entries(visits)
    .filter(([path]) => {
      const lower = path.toLowerCase();
      let from = 0;
      for (const word of words) {
        const found = lower.indexOf(word, from);
        if (found < 0) return false;
        from = found + word.length;
      }
      return (lower.split('/').pop() ?? '').includes(words.at(-1)!);
    })
    .sort(([, a], [, b]) => frecencyScore(b, now) - frecencyScore(a, now))
    .map(([path]) => path);
}
/** One more visit to a folder; the 500 most frecent are kept. */
export function recordVisit(
  visits: Readonly<Record<string, Visit>>,
  path: string,
  now: number,
): Record<string, Visit> {
  const next = { ...visits, [path]: { count: (visits[path]?.count ?? 0) + 1, last: now } };
  const paths = Object.keys(next);
  if (paths.length <= 500) return next;
  const kept = paths
    // equal scores: the latest visit stays
    .sort(
      (a, b) =>
        frecencyScore(next[b]!, now) - frecencyScore(next[a]!, now) ||
        next[b]!.last - next[a]!.last,
    )
    .slice(0, 500);
  return Object.fromEntries(kept.map((kept) => [kept, next[kept]!]));
}
