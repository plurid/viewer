import { LineError, parseLine, type Step, type Word } from './lex';

/** What a verb's argument completes from. */
export type CompleteKind =
  | 'path'
  | 'setting'
  | 'local-setting'
  | 'workspace'
  | 'theme'
  | 'profile'
  | 'layout'
  | 'mode'
  | 'help'
  | 'command';
/**
 * A VERB OF THE COMMAND LINE (2026-10-23). Its names are vim's, in vim's notation (`q[uit]`: `q`,
 * `qu`, `qui`, `quit`), then tmux's long names as synonyms; the first is the one help and hints
 * show. One table for parsing, completion and `:help`.
 */
export interface Verb {
  /** The implementation's key (renderer/command-line/verbs.ts). */
  key: string;
  names: readonly string[];
  usage?: string;
  help: string;
  /** What `!` does; without it, `!` is an error. */
  bang?: string;
  /** Flags: a switch (`-h`), or one taking the next word (`-T resize`). */
  flags?: Readonly<Record<string, 'switch' | 'value'>>;
  /** Positional words after the flags: at least, at most. */
  args?: readonly [number, number];
  complete?: CompleteKind;
  /** Its words run to the line's end, `|` included: a line of its own follows (bind). */
  rest?: boolean;
  /** From tmux: help lists it apart. */
  tmux?: boolean;
}
const LRUD = { L: 'switch', R: 'switch', U: 'switch', D: 'switch' } as const;
export const verbs: readonly Verb[] = [
  {
    key: 'quit',
    names: ['q[uit]', 'kill-pane', 'killp'],
    help: 'Close the plane',
    bang: 'discards its unsaved text',
  },
  {
    key: 'qall',
    names: ['qa[ll]', 'quita[ll]'],
    help: 'Close every plane in the workspace',
    bang: 'discards unsaved text',
  },
  {
    key: 'only',
    names: ['on[ly]'],
    help: 'Close every other plane, keeping the ones this plane opened from',
    bang: 'discards unsaved text',
  },
  {
    key: 'write',
    names: ['w[rite]'],
    usage: '[path]',
    args: [0, 1],
    complete: 'path',
    help: 'Save; with a path, Save As there',
  },
  { key: 'wall', names: ['wa[ll]'], help: 'Save every edited file' },
  { key: 'wq', names: ['wq'], help: 'Save, then close the plane' },
  { key: 'xit', names: ['x[it]', 'exi[t]'], help: 'Save if changed, then close the plane' },
  {
    key: 'edit',
    names: ['e[dit]'],
    usage: '{path}',
    args: [1, 1],
    complete: 'path',
    help: 'Open a path as a plane, a text file for editing',
  },
  {
    key: 'cd',
    names: ['cd', 'chd[ir]'],
    usage: '[path]',
    args: [0, 1],
    complete: 'path',
    help: 'Show a folder in this folder plane; home without one',
  },
  { key: 'pwd', names: ['pw[d]'], help: 'Show this plane’s folder' },
  {
    key: 'split',
    names: ['sp[lit]'],
    usage: '[path]',
    args: [0, 1],
    complete: 'path',
    help: 'Split down: a tile below, showing the path',
  },
  {
    key: 'vsplit',
    names: ['vs[plit]'],
    usage: '[path]',
    args: [0, 1],
    complete: 'path',
    help: 'Split right: a tile beside, showing the path',
  },
  {
    key: 'split-window',
    names: ['split-window', 'splitw'],
    usage: '[-h] [-c path]',
    flags: { h: 'switch', v: 'switch', c: 'value' },
    complete: 'path',
    help: 'Split down, or right with -h',
    tmux: true,
  },
  {
    key: 'mkdir',
    names: ['mkd[ir]'],
    usage: '{name}',
    args: [1, 1],
    help: 'A new folder in this folder',
  },
  { key: 'touch', names: ['touch'], usage: '{name}', args: [1, 1], help: 'A new file here' },
  { key: 'mv', names: ['mv'], usage: '{name}', args: [1, 1], help: 'Rename the selected item' },
  { key: 'trash', names: ['trash'], help: 'Move the selection to the Trash' },
  {
    key: 'tabnew',
    names: ['tabnew', 'new-window', 'neww'],
    usage: '[name]',
    flags: { n: 'value' },
    args: [0, 1],
    help: 'A new workspace',
  },
  {
    key: 'tabnext',
    names: ['tabn[ext]', 'next-window', 'next'],
    usage: '[n|name]',
    args: [0, 1],
    complete: 'workspace',
    help: 'The next workspace, or the one numbered or named',
  },
  {
    key: 'tabprevious',
    names: ['tabp[revious]', 'tabN[ext]', 'previous-window', 'prev'],
    help: 'The previous workspace',
  },
  {
    key: 'select-window',
    names: ['select-window', 'selectw'],
    usage: '-t {name}',
    flags: { t: 'value' },
    complete: 'workspace',
    help: 'The workspace named',
    tmux: true,
  },
  {
    key: 'tabclose',
    names: ['tabc[lose]', 'kill-window', 'killw'],
    help: 'Delete the workspace, after asking; Undo restores it',
  },
  {
    key: 'rename-window',
    names: ['rename-window', 'renamew'],
    usage: '{name}',
    args: [1, 1],
    help: 'Rename the workspace',
    tmux: true,
  },
  {
    key: 'set',
    names: ['se[t]'],
    usage: '{setting}…',
    args: [0, 20],
    complete: 'setting',
    help: 'Settings: grid, nogrid, grid!, grid?, grid&, opacity=60; none lists them',
  },
  {
    key: 'setlocal',
    names: ['setl[ocal]'],
    usage: '{setting}…',
    args: [1, 20],
    complete: 'local-setting',
    help: 'This workspace’s own: minimap!, grid&',
  },
  {
    key: 'colorscheme',
    names: ['colo[rscheme]', 'theme'],
    usage: '{theme}',
    args: [1, 1],
    complete: 'theme',
    help: 'The colour theme for this appearance',
  },
  {
    key: 'profile',
    names: ['profile'],
    usage: '{profile}',
    args: [1, 1],
    complete: 'profile',
    help: 'Apply a setting profile',
  },
  {
    key: 'layout',
    names: ['layout', 'select-layout', 'selectl'],
    usage: '{layout}',
    args: [1, 1],
    complete: 'layout',
    help: 'A tiling layout or a layout template',
  },
  {
    key: 'select-pane',
    names: ['select-pane', 'selectp'],
    usage: '-L|-R|-U|-D',
    flags: LRUD,
    help: 'The plane left, right, up or down',
    tmux: true,
  },
  {
    key: 'resize-pane',
    names: ['resize-pane', 'resizep'],
    usage: '-L|-R|-U|-D [n]',
    flags: LRUD,
    args: [0, 1],
    help: 'Shrink (-L, -U) or grow (-R, -D) the main tile, n steps',
    tmux: true,
  },
  {
    key: 'display-panes',
    names: ['display-panes', 'displayp'],
    help: 'Label the planes in view to jump to one',
    tmux: true,
  },
  { key: 'command-prompt', names: ['command-prompt'], help: 'The command line', tmux: true },
  {
    key: 'mode',
    names: ['mode', 'switch-client', 'switchc'],
    usage: '[name]',
    flags: { T: 'value' },
    args: [0, 1],
    complete: 'mode',
    help: 'Enter a key mode until Escape; none leaves it',
  },
  {
    key: 'bind',
    names: ['bind', 'bind-key'],
    usage: '[-n|-r|-T mode] {keys} {line}',
    flags: { n: 'switch', r: 'switch', T: 'value' },
    rest: true,
    help: 'Bind keys for this session: -n without the prefix, -r repeating, -T in a mode',
  },
  {
    key: 'unbind',
    names: ['unbind', 'unbind-key'],
    usage: '[-n|-T mode] {keys}',
    flags: { n: 'switch', T: 'value' },
    args: [1, 1],
    help: 'Unbind keys for this session',
  },
  {
    key: 'alias',
    names: ['com[mand]', 'alias', 'command-alias'],
    usage: '{Name} {line}',
    rest: true,
    help: 'Name a line for this session; :Name runs it, $1… and $* its words',
  },
  {
    key: 'unalias',
    names: ['delc[ommand]', 'unalias'],
    usage: '{Name}',
    args: [1, 1],
    help: 'Forget a named line of this session',
  },
  {
    key: 'send-keys',
    names: ['send-keys', 'send'],
    usage: '{text|Key}…',
    args: [1, 50],
    help: 'Type into the terminal plane: words as text, Enter, Tab, C-c as keys',
    tmux: true,
  },
  {
    key: 'help',
    names: ['h[elp]'],
    usage: '[topic]',
    args: [0, 1],
    complete: 'help',
    help: 'This list, or one command’s or setting’s help',
  },
  { key: 'history', names: ['his[tory]'], help: 'Recent lines' },
];

/** A name in vim's notation as the shortest form and the whole name. */
const forms = (name: string) => {
  const open = name.indexOf('[');
  return open < 0
    ? { short: name, full: name }
    : { short: name.slice(0, open), full: name.slice(0, open) + name.slice(open + 1, -1) };
};
/** Every name a verb answers to, each form spelled out. */
export function verbForms(verb: Verb): string[] {
  return verb.names.flatMap((name) => {
    const { short, full } = forms(name);
    return Array.from({ length: full.length - short.length + 1 }, (_, index) =>
      full.slice(0, short.length + index),
    );
  });
}
/** A verb's names as help shows them: the first, then the others. */
export const verbName = (verb: Verb) => forms(verb.names[0]!).full;
const byForm = new Map(verbs.flatMap((verb) => verbForms(verb).map((form) => [form, verb])));
export const findVerb = (name: string) => byForm.get(name);
/** A line that is one command id alone: no verb, no words, not a person's command. */
export const plainCommandID = (line: string) =>
  /^[a-z0-9][A-Za-z0-9._:=@/-]*$/.test(line) && !findVerb(line);
/** A verb whose words run to the line's end. */
export const takesRest = (name: string) => !!findVerb(name)?.rest;
/** A line's steps, the verbs that take the rest of it known. */
export const parseCommandLine = (text: string) => parseLine(text, takesRest);

export type ResolvedName =
  | { kind: 'verb'; verb: Verb }
  /** A command of the person's, capitalised as vim's `:command` requires. */
  | { kind: 'user'; name: string }
  | { kind: 'id'; id: string };
/** What a step's name means: a person's capitalised command, a verb, or a command id. */
export function resolveName(name: string): ResolvedName {
  if (/^[A-Z]/.test(name)) return { kind: 'user', name };
  const verb = findVerb(name);
  return verb ? { kind: 'verb', verb } : { kind: 'id', id: name };
}

/** A step's words after its verb's flags. */
export interface BoundStep {
  flags: Record<string, string | true>;
  args: Word[];
}
/** Splits a step's flags from its words and checks both, and `!`, against the verb. */
export function bindStep(step: Step, verb: Verb): BoundStep {
  const name = verbName(verb);
  if (step.bang && !verb.bang) throw new LineError(`:${name} does not take !.`, step.at);
  const flags: Record<string, string | true> = {};
  const words = [...step.words];
  while (words[0] && !words[0].quoted && /^-[A-Za-z]+$/.test(words[0].text)) {
    const word = words.shift()!;
    for (const letter of word.text.slice(1)) {
      const kind = verb.flags?.[letter];
      if (!kind) throw new LineError(`:${name} has no -${letter}.`, word.at);
      if (kind === 'switch') flags[letter] = true;
      else {
        const value = words.shift();
        if (!value) throw new LineError(`-${letter} needs a value.`, word.end);
        flags[letter] = value.text;
      }
    }
  }
  if (words[0] && !words[0].quoted && words[0].text === '--') words.shift();
  const [least, most] = verb.args ?? [0, 0];
  // one name or path takes every word left, spaces and all: `tabnew My Studio`, `e ~/My Docs/a.md`
  if (most === 1 && words.length > 1) {
    const [first] = words;
    const last = words.at(-1)!;
    words.splice(0, words.length, {
      text: words.map((item) => item.text).join(' '),
      quoted: words.some((item) => item.quoted),
      at: first!.at,
      end: last.end,
    });
  }
  if (!verb.rest && words.length > most)
    throw new LineError(
      most
        ? `:${name} takes at most ${most} ${most === 1 ? 'word' : 'words'}.`
        : `:${name} takes no words.`,
      words[most]!.at,
    );
  if (!verb.rest && words.length < least)
    throw new LineError(
      `:${name} needs ${verb.usage ?? 'a word'}.`,
      step.words.at(-1)?.end ?? step.at,
    );
  return { flags, args: words };
}

/** The closest of `candidates` to a mistyped name, when it is close. */
export function didYouMean(name: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined;
  let distance = name.length <= 3 ? 1 : 2;
  for (const candidate of candidates) {
    const next = editDistance(name, candidate, distance);
    if (next <= distance && (next < distance || !best)) {
      best = candidate;
      distance = next;
    }
  }
  return best;
}
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(
        previous[j]! + 1,
        row[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = row;
  }
  return previous[b.length]!;
}
/** Every verb form, for did-you-mean and completion. */
export const verbNames = () => [...byForm.keys()];
