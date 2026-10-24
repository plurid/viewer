/**
 * THE COMMAND LINE (2026-10-23): one small language for `:` lines, key bindings and sequences, as
 * vim's ex lines and tmux's commands are. A line is steps separated by `|` (tmux's `;` too); a step
 * is `[count]name[!] words…`. Words are bare, 'literal' or "escaped" (`\"`, `\\`); outside quotes a
 * backslash keeps the next character (`\|`, `\ `). A command id is a step on its own, so every
 * binding and sequence saved before lines existed is a line already.
 */
export interface Word {
  text: string;
  /** Some of it was quoted: never expanded (`~`, `%`). */
  quoted: boolean;
  /** Its columns in the line, from 0. */
  at: number;
  end: number;
}
export interface Step {
  at: number;
  count?: number;
  name: string;
  bang: boolean;
  words: Word[];
  /** The rest of the line after the name, as typed, for a verb that takes it whole (bind). */
  rest?: { text: string; at: number };
}
/** A line that does not parse: what, and the column where. */
export class LineError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
    this.name = 'LineError';
  }
}
export const lineLimits = { length: 500, steps: 50, count: 99 } as const;
/** The characters of a name: what command ids are made of. */
const nameCharacter = /[A-Za-z0-9._:=@/-]/;
const space = /\s/;
const separator = (character: string | undefined) => character === '|' || character === ';';

/** Reads one word from `at`; returns it and where it ended. `rest` keeps `|` and `;` in it. */
function readWord(text: string, at: number, rest: boolean): Word {
  let value = '';
  let quoted = false;
  let index = at;
  while (index < text.length) {
    const character = text[index]!;
    if (space.test(character) || (!rest && separator(character))) break;
    if (character === "'") {
      const close = text.indexOf("'", index + 1);
      if (close < 0) throw new LineError('A quote is not closed.', index);
      value += text.slice(index + 1, close);
      quoted = true;
      index = close + 1;
    } else if (character === '"') {
      let close = index + 1;
      while (close < text.length && text[close] !== '"') {
        if (text[close] === '\\' && close + 1 < text.length) close++;
        value += text[close];
        close++;
      }
      if (close >= text.length) throw new LineError('A quote is not closed.', index);
      quoted = true;
      index = close + 1;
    } else if (character === '\\' && index + 1 < text.length) {
      value += text[index + 1];
      index += 2;
    } else {
      value += character;
      index++;
    }
  }
  return { text: value, quoted, at, end: index };
}

/**
 * The steps of a line. `takesRest` names the verbs whose words run to the line's end, `|` included,
 * as vim's `:command` and tmux's `bind-key` take a command line of their own.
 */
export function parseLine(
  text: string,
  takesRest: (name: string) => boolean = () => false,
): Step[] {
  if (text.length > lineLimits.length)
    throw new LineError(`A line is at most ${lineLimits.length} characters.`, lineLimits.length);
  const steps: Step[] = [];
  let index = 0;
  const skip = () => {
    while (index < text.length && space.test(text[index]!)) index++;
  };
  while (index < text.length) {
    skip();
    if (index >= text.length) break;
    if (separator(text[index])) {
      index++;
      continue;
    }
    const at = index;
    // `:q` as vim users write it, in a binding too
    if (text[index] === ':') index++;
    let count: number | undefined;
    const digits = /^\d+/.exec(text.slice(index))?.[0];
    if (digits) {
      count = Number(digits);
      if (count < 1 || count > lineLimits.count)
        throw new LineError(`A count is from 1 to ${lineLimits.count}.`, index);
      index += digits.length;
      skip();
    }
    const nameAt = index;
    while (index < text.length && nameCharacter.test(text[index]!)) index++;
    const name = text.slice(nameAt, index);
    if (!name)
      throw new LineError(
        count === undefined ? 'A command name is expected here.' : 'A count needs a command.',
        nameAt,
      );
    const bang = text[index] === '!';
    if (bang) index++;
    if (index < text.length && !space.test(text[index]!) && !separator(text[index]))
      throw new LineError(`“${text[index]}” cannot follow a command name.`, index);
    const step: Step = { at, ...(count === undefined ? {} : { count }), name, bang, words: [] };
    const rest = takesRest(name);
    if (rest) {
      skip();
      step.rest = { text: text.slice(index).trimEnd(), at: index };
    }
    for (;;) {
      skip();
      if (index >= text.length || (!rest && separator(text[index]))) break;
      const word = readWord(text, index, rest);
      step.words.push(word);
      index = word.end;
    }
    steps.push(step);
    if (steps.length > lineLimits.steps)
      throw new LineError(`A line runs at most ${lineLimits.steps} steps.`, at);
  }
  return steps;
}

/**
 * A named line's words put in it (2026-10-23): `$1` to `$9` each word, `$*` all of them, escaped so
 * each stays one word; `$$` is a dollar. Words given to a line that takes none are an error.
 */
export function withArguments(line: string, words: readonly string[], name: string): string {
  if (!/\$[1-9*]/.test(line)) {
    if (words.length) throw new LineError(`:${name} takes no words.`, 0);
    return line;
  }
  return line.replace(/\$([1-9*$])/g, (_match, which: string) =>
    which === '$'
      ? '$'
      : which === '*'
        ? words.map(escapeWord).join(' ')
        : words[Number(which) - 1] === undefined
          ? ''
          : escapeWord(words[Number(which) - 1]!),
  );
}
/** A word kept one word by backslashes, not quotes: `~` and `%` in it still expand. */
const escapeWord = (text: string) => (text ? text.replace(/([\s'"\\|;$])/g, '\\$1') : "''");
/** A word as a line would need it written: bare when it can be, quoted otherwise. */
export function quoteWord(text: string): string {
  if (/^[A-Za-z0-9._:=@/~%+,#-]+$/.test(text)) return text;
  if (!text.includes("'")) return `'${text}'`;
  return `"${text.replace(/["\\]/g, (character) => '\\' + character)}"`;
}

/**
 * A path word made absolute: `~` is home, `%` the current plane's path and `%:h` its folder, as in
 * vim; relative paths start in `folder`. Quoted words are taken as they are written.
 */
export function expandPath(
  word: Pick<Word, 'text' | 'quoted'>,
  places: { home: string; folder: string; current?: string },
): string {
  let text = word.text;
  if (!word.quoted) {
    if (text === '~' || text.startsWith('~/')) text = places.home + text.slice(1);
    else if (text === '%' || text.startsWith('%/') || text.startsWith('%:h')) {
      if (!places.current) throw new LineError('% needs a plane with a path.', 0);
      const parent = places.current.replace(/\/[^/]*$/, '') || '/';
      text = text.startsWith('%:h') ? parent + text.slice(3) : places.current + text.slice(1);
    }
  }
  const joined = text.startsWith('/') ? text : places.folder.replace(/\/$/, '') + '/' + text;
  const parts: string[] = [];
  for (const part of joined.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return '/' + parts.join('/');
}
