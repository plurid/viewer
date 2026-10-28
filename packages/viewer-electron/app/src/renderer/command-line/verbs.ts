import { inheritedWindowPreferences } from '../state/effective-ui';
import { operationOutcome } from '../operations/outcome';
import {
  matchesQuery,
  parseFileQuery,
  parsePattern,
  QueryError,
  type FileQuery,
} from '../../domain/search/query';
import { folderHandle } from '../explorer/folder-handles';
import { browseSession, updateBrowseSession } from '../workspace/sessions';
import { expandPath, type Step, type Word } from '../../domain/command-line/lex';
import { didYouMean, parseCommandLine } from '../../domain/command-line/verbs';
import { canonicalKey, keyGlyphs, rootKey } from '../../domain/preferences/keymap';
import type { SessionAlias, SessionBinding } from '../../domain/preferences/session-keys';
import { enterKeyMode, leaveKeyMode } from '../keys/sequences';
import { effectiveKeymap, receiveSessionKeys } from '../keys/session';
import {
  parseSet,
  settingInput,
  settingShortName,
  settingText,
} from '../../domain/command-line/set';
import { overridable } from '../../domain/preferences/overrides';
import { parentPath } from '../../domain/workspaces/planes';
import { normalizePreferences } from '../../domain/preferences/ui';
import { defaultSettings } from '../../domain/services';
import { settingValue, workspaceMayChange } from '../../domain/preferences/catalog';
import { tileLayouts } from '../../domain/workspaces/tiling';
import { closePlanes, otherPlanes, rootPlanes } from '../commands/closing';
import { changeSetting, settingNow } from '../commands/window-commands/settings';
import { savedText } from '../commands/window-commands/text';
import { splitTile } from '../commands/window-commands/tiling';
import { editingPlane } from '../editing/planes';
import { saveAll, saveUnsaved } from '../editing/unsaved';
import { activeWorkspace, addPane, addRootFolder, getState, navigate } from '../state/store';
import { renameWorkspace, setWorkspaceOverride } from '../state/workspaces';
import { Stopped, type LineHost } from './host';
import { taskLineDraft } from '../../domain/command-line/task';

export interface VerbInput {
  step: Step;
  flags: Record<string, string | true>;
  args: Word[];
  bang: boolean;
}
/** A verb's work: a message to show, or nothing; an Error says why it could not. */
export type VerbRun = (input: VerbInput, host: LineHost) => Promise<string | void>;

const places = (host: LineHost) => {
  const context = host.context();
  const home = getState().bootstrap.home;
  return {
    home,
    folder: context.directory || (context.path ? parentPath(context.path) : home),
    current: context.path || context.directory,
  };
};
const pathOf = (word: Word, host: LineHost) => expandPath(word, places(host));
const statPath = async (path: string) => {
  try {
    return await window.viewer.stat(path);
  } catch {
    throw new Error(`Nothing at ${path}.`);
  }
};
const activeID = (host: LineHost) => {
  const id = host.context().paneID;
  if (!id || !activeWorkspace().panes.some((pane) => pane.id === id))
    throw new Error('No plane is active.');
  return id;
};
const closing = async (done: Promise<boolean>) => {
  if (!(await done)) throw new Stopped();
};
const run = async (host: LineHost, id: string, why: string) => {
  if (!(await host.invoke(id, false))) throw new Error(why);
};
/** A workspace by its number from 1, its name, or the start of one name. */
function workspaceBy(text: string): string {
  const workspaces = getState().saved.workspaces;
  if (/^\d+$/.test(text)) {
    const found = workspaces[Number(text) - 1];
    if (!found) throw new Error(`There are ${workspaces.length} workspaces.`);
    return found.id;
  }
  const lower = text.toLowerCase();
  const exact = workspaces.find((space) => space.name.toLowerCase() === lower);
  if (exact) return exact.id;
  const starting = workspaces.filter((space) => space.name.toLowerCase().startsWith(lower));
  if (starting.length === 1) return starting[0]!.id;
  const meant = didYouMean(
    text,
    workspaces.map((space) => space.name),
  );
  throw new Error(
    starting.length
      ? `“${text}” starts ${starting.length} workspaces’ names.`
      : `No workspace “${text}”${meant ? ` — did you mean ${meant}?` : '.'}`,
  );
}
/** A command of a family (`theme.`, `profile.`, `layout.`) by its id or its name. */
function familyCommand(host: LineHost, prefix: string, text: string, what: string): string {
  const context = host.context();
  const members = host.registry
    .list({ scope: 'window', paneID: context.paneID, context })
    .filter((command) => command.id.startsWith(prefix));
  const name = (label: string) => (/[“:]\s*(.+?)”?$/.exec(label)?.[1] ?? label).toLowerCase();
  const lower = text.toLowerCase();
  const found =
    members.find((command) => command.id.slice(prefix.length).toLowerCase() === lower) ??
    members.find((command) => name(command.label) === lower) ??
    (() => {
      const starting = members.filter((command) => name(command.label).startsWith(lower));
      return starting.length === 1 ? starting[0] : undefined;
    })();
  if (found) return found.id;
  const meant = didYouMean(
    lower,
    members.map((command) => name(command.label)),
  );
  throw new Error(`No ${what} “${text}”${meant ? ` — did you mean ${meant}?` : '.'}`);
}
const defaultName = () => {
  const names = new Set(getState().saved.workspaces.map((space) => space.name));
  for (let index = names.size + 1; ; index++)
    if (!names.has(`Workspace ${index}`)) return `Workspace ${index}`;
};
/** `:set` and `:setlocal`: vim's forms over the catalog, the workspace's own for `local`. */
async function setSettings(words: Word[], host: LineHost, local: boolean): Promise<string | void> {
  const messages: string[] = [];
  const home = getState().bootstrap.home;
  const defaults = { settings: defaultSettings(home), ui: normalizePreferences() };
  for (const operation of parseSet(words)) {
    const { definition } = operation;
    const path = definition.path;
    const name = settingShortName(path);
    if (local && !overridable(path))
      throw new Error(`${name} is not a workspace’s own; :set it for all.`);
    const general = settingNow(path);
    const current = general;
    const inherited = settingValue(inheritedWindowPreferences(getState()), path);
    if (operation.op === 'show') {
      messages.push(settingText(definition, current));
      continue;
    }
    if (!local && !workspaceMayChange(path.split('.'))) {
      // what only Settings changes, Settings shows
      await window.viewer.openSettings(path);
      messages.push(`${name} changes in Settings.`);
      continue;
    }
    let value: unknown;
    switch (operation.op) {
      case 'on':
      case 'off':
        value = operation.op === 'on';
        break;
      case 'toggle':
        value = !current;
        break;
      case 'add':
        value = settingInput(definition, String(Number(current) + operation.value));
        break;
      case 'default':
        value = local ? undefined : settingValue(defaults, path);
        break;
      case 'value':
        value = operation.value;
    }
    if (local)
      setWorkspaceOverride(
        path,
        value === undefined || JSON.stringify(value) === JSON.stringify(inherited)
          ? undefined
          : value,
      );
    else await changeSetting(path, value);
  }
  return messages.join('  ') || undefined;
}

/** Each verb's work, by its key in the domain table (domain/command-line/verbs.ts). */
export const verbRuns: Record<string, VerbRun> = {
  'task-new': async ({ step }, host) => {
    const draft = taskLineDraft(step.words, (word) => pathOf(word, host));
    window.dispatchEvent(
      new CustomEvent('viewer:task-request', {
        detail: {
          ...draft,
          repo: draft.repo ?? places(host).folder,
          workspace: draft.workspace ?? activeWorkspace().id,
        },
      }),
    );
  },
  quit: async ({ bang }, host) => closing(closePlanes(host.workspace, [activeID(host)], bang)),
  qall: async ({ bang }, host) =>
    closing(closePlanes(host.workspace, rootPlanes(host.workspace), bang)),
  only: async ({ bang }, host) => {
    const others = otherPlanes(host.workspace, activeID(host));
    if (others.length) await closing(closePlanes(host.workspace, others, bang));
  },
  write: async ({ args }, host) => {
    const plane = editingPlane(activeID(host));
    if (args[0]) {
      if (!plane?.saveAs) throw new Error('This plane has no text to save.');
      if (!(await plane.saveAs(pathOf(args[0], host)))) throw new Stopped();
      return;
    }
    if (!plane?.save) throw new Error('This plane is not being edited.');
    if (!(await plane.save())) throw new Stopped();
  },
  wall: async () => savedText(await saveAll()),
  wq: async (input, host) => {
    await verbRuns.write!({ ...input, args: [] }, host);
    await verbRuns.quit!({ ...input, bang: false }, host);
  },
  xit: async (input, host) => {
    if (!(await saveUnsaved(activeID(host)))) throw new Stopped();
    await verbRuns.quit!({ ...input, bang: false }, host);
  },
  edit: async ({ args }, host) => {
    const entry = await statPath(pathOf(args[0]!, host));
    const context = host.context();
    await host.workspace.openPath(entry.path, {
      paneID: context.paneID,
      workspaceID: context.workspaceID,
      edit: true,
      activate: true,
    });
  },
  cd: async ({ args }, host) => {
    const pane = activeWorkspace().panes.find((item) => item.id === host.context().paneID);
    if (pane?.type !== 'folder') throw new Error(':cd needs a folder plane.');
    const entry = await statPath(args[0] ? pathOf(args[0], host) : getState().bootstrap.home);
    if (!entry.directory) throw new Error(`${entry.path} is not a folder.`);
    navigate(pane.id, entry.path);
  },
  pwd: async (_input, host) => places(host).folder,
  split: async ({ args }, host) => split(host, 'down', args[0]),
  vsplit: async ({ args }, host) => split(host, 'right', args[0]),
  'split-window': async ({ flags }, host) =>
    split(
      host,
      flags.h ? 'right' : 'down',
      typeof flags.c === 'string'
        ? { text: flags.c, quoted: false, at: 0, end: flags.c.length }
        : undefined,
    ),
  mkdir: async ({ args }, host) => create(host, 'mkdir', args[0]!.text),
  touch: async ({ args }, host) => create(host, 'mkfile', args[0]!.text),
  mv: async ({ args }, host) => {
    const selection = host.context().selection;
    if (selection.length !== 1) throw new Error('Select one item to rename.');
    if (args[0]!.text.includes('/')) throw new Error('A name, not a path.');
    await operationOutcome(
      await window.viewer.operate({
        kind: 'rename',
        name: args[0]!.text,
        sources: [selection[0]!.path],
      }),
    );
  },
  // the file query language (domain/search/query.ts), in the folder plane's filter row
  filter: async ({ step }, host) => {
    const text = step.rest?.text ?? '';
    if (text) readQuery(text);
    const pane = activeWorkspace().panes.find((item) => item.id === host.context().paneID);
    if (pane?.type !== 'folder') throw new Error(':filter needs a folder plane.');
    browseSession(pane.id, pane.path);
    updateBrowseSession(pane.id, pane.path, { query: text, searchOpen: !!text, subtree: false });
  },
  find: async ({ step }, host) => {
    const text = step.rest?.text ?? '';
    if (!text) throw new Error(':find needs a query.');
    readQuery(text);
    host.workspace.newSearch(text, text, places(host).folder, true, false);
  },
  // a commander's select by pattern: globs or a query, added or taken out
  select: async ({ step }, host) => choose(host, step.rest?.text ?? '', true),
  deselect: async ({ step }, host) => choose(host, step.rest?.text ?? '', false),
  // the Trash command itself: its confirmation, as Settings has it; `!` is not taken
  trash: async (_input, host) => run(host, 'trash', 'Select something to move to the Trash.'),
  tabnew: async ({ flags, args }, host) =>
    host.newWorkspace((typeof flags.n === 'string' ? flags.n : args[0]?.text) || defaultName()),
  tabnext: async ({ args }, host) => {
    if (args[0]) await host.switchWorkspace(workspaceBy(args[0].text));
    else await run(host, 'next-workspace', 'There is no other workspace.');
  },
  tabprevious: async (_input, host) =>
    run(host, 'previous-workspace', 'There is no other workspace.'),
  'select-window': async ({ flags }, host) => {
    if (typeof flags.t !== 'string') throw new Error('select-window needs -t and a name.');
    await host.switchWorkspace(workspaceBy(flags.t));
  },
  tabclose: async (_input, host) => run(host, 'delete-workspace', 'This workspace stays.'),
  'rename-window': async ({ args }) => renameWorkspace(args[0]!.text),
  set: async ({ args }, host) => {
    if (!args.length) {
      host.palette('settings');
      return;
    }
    return setSettings(args, host, false);
  },
  setlocal: async ({ args }, host) => setSettings(args, host, true),
  colorscheme: async ({ args }, host) =>
    run(host, familyCommand(host, 'theme.', args[0]!.text, 'theme'), 'That theme is not here.'),
  profile: async ({ args }, host) =>
    run(
      host,
      familyCommand(host, 'profile.', args[0]!.text, 'profile'),
      'That profile is not available.',
    ),
  layout: async ({ args }, host) => {
    const name = args[0]!.text;
    if ((tileLayouts as readonly string[]).includes(name)) {
      if (!activeWorkspace().tiling) await run(host, 'tile-visible', 'Nothing to tile.');
      await run(host, `tile-layout-${name}`, 'Nothing is tiled.');
      return;
    }
    await run(host, familyCommand(host, 'layout.', name, 'layout'), 'That layout cannot open.');
  },
  'select-pane': async ({ flags }, host) => {
    const direction = (['L', 'R', 'U', 'D'] as const).find((letter) => flags[letter]);
    if (!direction) throw new Error('select-pane needs -L, -R, -U or -D.');
    const id = { L: 'focus-left', R: 'focus-right', U: 'focus-up', D: 'focus-down' }[direction];
    await run(host, id, 'No plane that way.');
  },
  'resize-pane': async ({ flags, args }, host) => {
    const direction = flags.L
      ? 'left'
      : flags.R
        ? 'right'
        : flags.U
          ? 'up'
          : flags.D
            ? 'down'
            : undefined;
    if (!direction) throw new Error('resize-pane needs -L, -R, -U or -D.');
    const steps = Number(args[0]?.text ?? 1);
    if (!Number.isInteger(steps) || steps < 1 || steps > 12)
      throw new Error('resize-pane takes 1 to 12 steps.');
    for (let step = 0; step < steps; step++)
      await run(host, `tile-resize-${direction}`, 'Nothing is tiled.');
  },
  'display-panes': async (_input, host) => run(host, 'plane-hints', 'No planes in view.'),
  'command-prompt': async (_input, host) => host.palette('line'),
  help: async ({ args }, host) => host.palette('line', args[0] ? `help ${args[0].text}` : 'help'),
  history: async (_input, host) => host.palette('line'),
  mode: async ({ flags, args }) => {
    const name = typeof flags.T === 'string' ? flags.T : args[0]?.text;
    if (!name) {
      leaveKeyMode();
      return;
    }
    if (enterKeyMode(name)) return;
    const meant = didYouMean(name, Object.keys(effectiveKeymap().modes));
    throw new Error(`No mode “${name}”${meant ? ` — did you mean ${meant}?` : '.'}`);
  },
  bind: async ({ step, flags, args }) => {
    const [keysWord] = args;
    if (!keysWord || !step.rest) throw new Error(':bind needs keys, then a line.');
    const { table, keys } = bindingPlace(flags, keysWord);
    if (flags.r && (table !== 'prefix' || keys.length !== 1))
      throw new Error('-r is for one prefix key.');
    const line = step.rest.text.slice(keysWord.end - step.rest.at).trim();
    if (!line) throw new Error(':bind needs a line after the keys.');
    parseCommandLine(line);
    await changeSession({ table, keys, line, ...(flags.r ? { repeat: true } : {}) });
    return `${keys.map(keyGlyphs).join(' ')} runs “${line}” this session; Settings → Shortcuts keeps it.`;
  },
  unbind: async ({ flags, args }) => {
    const { table, keys } = bindingPlace(flags, args[0]!);
    await changeSession({ table, keys, line: null });
    return `${keys.map(keyGlyphs).join(' ')} unbound this session.`;
  },
  alias: async ({ step, args }) => {
    const [nameWord] = args;
    if (!nameWord || !step.rest) throw new Error(':command needs a Name, then a line.');
    if (!/^[A-Z][A-Za-z0-9]{0,30}$/.test(nameWord.text))
      throw new Error('A command’s name starts with a capital: Dev, OpenDocs.');
    const line = step.rest.text.slice(nameWord.end - step.rest.at).trim();
    if (!line) throw new Error(`:command ${nameWord.text} needs a line.`);
    parseCommandLine(line);
    await changeAliases({ name: nameWord.text, line });
    return `:${nameWord.text} runs “${line}” this session; Settings → Shortcuts keeps it.`;
  },
  unalias: async ({ args }) => {
    await changeAliases({ name: args[0]!.text, line: null });
    return `:${args[0]!.text} forgotten this session.`;
  },
  // tmux's send-keys: words as text, key names as keys, into the active terminal plane
  'send-keys': async ({ args }, host) => {
    const pane = activeWorkspace().panes.find((item) => item.id === host.context().paneID);
    if (pane?.type !== 'terminal') throw new Error(':send-keys types into a terminal plane.');
    await window.viewer.terminalWrite(pane.id, args.map((word) => terminalInput(word)).join(''));
  },
};
/** The folder plane's items matching a pattern, added to its selection or taken out. */
async function choose(host: LineHost, text: string, adding: boolean): Promise<string> {
  const verb = adding ? 'select' : 'deselect';
  if (!text) throw new Error(`:${verb} needs a pattern: *.md, or a query.`);
  const handle = folderHandle(host.context().paneID);
  if (!handle) throw new Error(`:${verb} works in a folder plane.`);
  let query: FileQuery;
  try {
    query = parsePattern(text);
  } catch (error) {
    throw error instanceof QueryError ? new Error(error.message) : error;
  }
  const tagged = new Map<string, Set<string>>();
  for (const tag of query.tags)
    tagged.set(
      tag,
      new Set((await window.viewer.taggedFiles(tag, [handle.path()])).map((entry) => entry.path)),
    );
  const matching = handle
    .entries()
    .filter((entry) => matchesQuery(query, entry, { tagged: (tag) => tagged.get(tag) }));
  const chosen = new Set(handle.selected().map((entry) => entry.path));
  for (const entry of matching)
    if (adding) chosen.add(entry.path);
    else chosen.delete(entry.path);
  handle.select(handle.entries().filter((entry) => chosen.has(entry.path)));
  return `${matching.length} matching; ${chosen.size} selected.`;
}
/** A query that does not read, said as the line's error. */
function readQuery(text: string): void {
  try {
    parseFileQuery(text);
  } catch (error) {
    throw error instanceof QueryError ? new Error(error.message) : error;
  }
}
/** Where `:bind` and `:unbind` put keys: the prefix's table, the root (-n) or a mode's (-T). */
function bindingPlace(flags: Record<string, string | true>, word: Word) {
  const table = flags.n ? 'root' : typeof flags.T === 'string' ? flags.T : 'prefix';
  if (!/^(prefix|root|[a-z][a-z0-9-]{0,30})$/.test(table))
    throw new Error('A mode’s name is lowercase: resize, panes.');
  const keys = word.text
    .split(/\s+/)
    .filter(Boolean)
    .map((written) => {
      const key = canonicalKey(written);
      if (!key) throw new Error(`“${written}” is not a key.`);
      return key;
    });
  if (!keys.length || keys.length > 4) throw new Error('One to four keys, in turn.');
  if (table === 'root' && !keys.every(rootKey))
    throw new Error('A key without the prefix needs ⌃, ⌥ or ⌘, or is an F-key.');
  return { table, keys };
}
/** One more named line of this session's. */
async function changeAliases(alias: SessionAlias): Promise<void> {
  const session = await window.viewer.sessionKeys();
  receiveSessionKeys(
    await window.viewer.sessionKeysSet({ ...session, aliases: [...session.aliases, alias] }),
  );
}
const keyInput: Readonly<Record<string, string>> = {
  Enter: '\r',
  Tab: '\t',
  Escape: '\x1b',
  Space: ' ',
  Backspace: '\x7f',
  Delete: '\x1b[3~',
  Up: '\x1b[A',
  Down: '\x1b[B',
  Right: '\x1b[C',
  Left: '\x1b[D',
  Home: '\x1b[H',
  End: '\x1b[F',
};
/** A send-keys word as a terminal reads it: a key name (Enter, C-c, M-x) as that key, else text. */
function terminalInput(word: Word): string {
  if (word.quoted) return word.text;
  const key = /^[A-Z]|^[CM]-|^<.+>$/.test(word.text) ? canonicalKey(word.text) : undefined;
  if (!key) return word.text;
  if (keyInput[key]) return keyInput[key]!;
  const control = /^Ctrl\+([a-z@\[\]\\^_])$/.exec(key);
  if (control) return String.fromCharCode(control[1]!.toUpperCase().charCodeAt(0) - 64);
  const meta = /^Alt\+(.)$/.exec(key);
  if (meta) return '\x1b' + meta[1];
  return word.text;
}
/** One more binding of this session's, kept by the main process until quit. */
async function changeSession(binding: SessionBinding): Promise<void> {
  const session = await window.viewer.sessionKeys();
  receiveSessionKeys(
    await window.viewer.sessionKeysSet({ ...session, bindings: [...session.bindings, binding] }),
  );
}
async function split(host: LineHost, direction: 'right' | 'down', word?: Word): Promise<void> {
  let add: (() => string | undefined) | undefined;
  if (word) {
    const entry = await statPath(pathOf(word, host));
    add = () =>
      entry.directory
        ? addRootFolder({ path: entry.path, workspaceID: activeWorkspace().id })?.id
        : addPane(entry.path, 'preview', true).id;
  }
  if (!splitTile(host.workspace, direction, add)) throw new Error('No plane to split.');
}
async function create(host: LineHost, kind: 'mkdir' | 'mkfile', name: string): Promise<void> {
  const destination = host.context().directory;
  if (!destination)
    throw new Error(`:${kind === 'mkdir' ? 'mkdir' : 'touch'} needs a folder plane.`);
  if (name.includes('/')) throw new Error('A name, not a path.');
  await operationOutcome(await window.viewer.operate({ kind, name, sources: [], destination }));
}
