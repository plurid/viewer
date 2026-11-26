import { slugID } from '../ids';
import { canonicalKey } from './keymap';
import type { Keymap, KeymapBinding } from './keymap';
import type { CustomAction } from '../automation/actions';

/**
 * Session keys: what `:bind`, `:unbind` and `:alias` change, kept until Viewer quits,
 * as tmux's prompt changes the running server and not .tmux.conf. Settings → Shortcuts keeps them
 * in config.jsonc, or discards them. `table` is `prefix`, `root` (no prefix) or a mode's name;
 * `line: null` unbinds.
 */
export interface SessionBinding {
  table: string;
  keys: string[];
  line: string | null;
  repeat?: boolean;
}
export interface SessionAlias {
  name: string;
  line: string | null;
}
export interface SessionKeys {
  bindings: SessionBinding[];
  aliases: SessionAlias[];
}
export const emptySessionKeys: SessionKeys = { bindings: [], aliases: [] };
function equivalentKeys(table: Record<string, KeymapBinding>, key: string): string[] {
  const canonical = canonicalKey(key) ?? key;
  return Object.keys(table).filter((written) => (canonicalKey(written) ?? written) === canonical);
}
/** A table with a binding set at `keys`, or removed with `null`; chords are made as needed. */
function place(
  table: Record<string, KeymapBinding>,
  keys: readonly string[],
  line: string | null,
): void {
  const parents: { table: Record<string, KeymapBinding>; key: string; shadowed: boolean }[] = [];
  let node = table;
  for (const written of keys.slice(0, -1)) {
    const matches = equivalentKeys(node, written);
    const key = matches.at(-1) ?? written;
    const next = node[key];
    if (next === undefined || typeof next === 'string' || Array.isArray(next)) {
      if (line === null) return;
      node[key] = {};
    }
    parents.push({ table: node, key, shadowed: matches.length > 1 });
    node = node[key] as Record<string, KeymapBinding>;
  }
  const last = keys.at(-1)!;
  const matches = equivalentKeys(node, last);
  if (line !== null) {
    node[matches.at(-1) ?? last] = line;
    return;
  }
  if (!matches.length) return;
  for (const key of matches) delete node[key];
  for (const parent of parents.reverse()) {
    // An empty winning branch keeps an older spelling from becoming active again.
    if (parent.shadowed || Object.keys(node).length) break;
    node = parent.table;
    delete node[parent.key];
  }
}
/** The keymap with the session's bindings over it, in order: a later one wins. */
export function withSessionKeys(keymap: Keymap, session: SessionKeys): Keymap {
  if (!session.bindings.length) return keymap;
  const next = structuredClone(keymap) as Keymap;
  next.root ??= {};
  next.modes ??= {};
  next.repeat ??= [];
  for (const binding of session.bindings) {
    if (!binding.keys.length) continue;
    const table =
      binding.table === 'prefix'
        ? next.bindings
        : binding.table === 'root'
          ? next.root
          : (next.modes[binding.table] ??= { bindings: {} }).bindings;
    place(table, binding.keys, binding.line);
    if (binding.table === 'prefix' && binding.keys.length === 1) {
      const [key] = binding.keys as [string];
      const canonical = canonicalKey(key) ?? key;
      const matches = (written: string) => (canonicalKey(written) ?? written) === canonical;
      const repeating = next.repeat.some(matches);
      if (binding.repeat && binding.line !== null && !repeating) next.repeat.push(key);
      else if ((!binding.repeat || binding.line === null) && repeating)
        next.repeat = next.repeat.filter((item) => !matches(item));
    }
  }
  return next;
}
/** The session's named lines, the later over the earlier; `null` forgets one. */
export function sessionAliases(session: SessionKeys): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const { name, line } of session.aliases)
    if (line === null) aliases.delete(name);
    else aliases.set(name, line);
  return aliases;
}
/**
 * The session's named lines kept as sequences: a name already a sequence's gets its
 * line; a new one is a new sequence; one forgotten (`:unalias`) removes the sequence of that name.
 */
export function keepAliases(
  actions: readonly CustomAction[],
  session: SessionKeys,
  now = Date.now(),
): CustomAction[] {
  let next = [...actions];
  for (const { name, line } of session.aliases) {
    const named = (action: CustomAction) =>
      action.executor.kind === 'sequence' && action.executor.command === name;
    if (line === null) {
      next = next.filter((action) => !named(action));
      continue;
    }
    const existing = next.findIndex(named);
    if (existing >= 0) {
      next[existing] = {
        ...next[existing]!,
        executor: { kind: 'sequence', commands: [line], command: name },
      };
      continue;
    }
    next.push({
      id: slugID(
        'command-' + name,
        'command',
        next.map((action) => action.id),
        now,
      ),
      name,
      aliases: ['command'],
      icon: 'command',
      shortcut: '',
      order: Math.max(0, ...next.map((action) => action.order)) + 1,
      pinned: false,
      when: { target: 'any', extensions: [], min: 0, max: 10000 },
      executor: { kind: 'sequence', commands: [line], command: name },
    });
  }
  return next;
}
