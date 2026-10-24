import type { FileEntry } from '../../domain/contracts';
import { expandPath } from '../../domain/command-line/lex';
import { findVerb, verbName, verbs, type CompleteKind } from '../../domain/command-line/verbs';
import { settingByName, settingNames, settingText } from '../../domain/command-line/set';
import { overridable } from '../../domain/preferences/overrides';
import { tileLayouts } from '../../domain/workspaces/tiling';

export interface Completion {
  label: string;
  detail?: string;
  /** The whole line with this completion in it. */
  insert: string;
}
export interface CompletionSources {
  /** Commands in this context, for a name. */
  commands: readonly { id: string; label: string }[];
  /** A family's members (`theme.`, `profile.`, `layout.`) by their names. */
  family(prefix: string): readonly string[];
  workspaces: readonly string[];
  /** A setting's current value, by its path. */
  value(path: string): unknown;
  places: { home: string; folder: string; current?: string };
  /** The folder `directory` lists, once read: a path completes from it. */
  listing?: { directory: string; entries: readonly FileEntry[] };
  modes?: readonly string[];
  users?: readonly string[];
}
export interface LineCompletions {
  completions: Completion[];
  /** The folder a path being typed is in: to list, then complete from. */
  directory?: string;
}
/** The file query language's terms, as completion offers them. */
export const queryTerms: Readonly<Record<string, string>> = {
  'ext:': 'ext:md,txt',
  'kind:folder': 'Folders',
  'kind:file': 'Files',
  'kind:image': 'Images',
  'kind:video': 'Videos',
  'kind:audio': 'Audio',
  'kind:document': 'Documents',
  'kind:archive': 'Archives',
  'kind:app': 'Applications',
  'name:': 'In the name',
  'path:': 'In the path',
  'size>': 'size>10mb',
  'size<': 'size<1kb',
  'modified<': 'modified<7d: within a week',
  'modified>': 'modified>2026-01-01',
  'modified:today': 'Today',
  'created>': 'created>=2026-01',
  'tag:': 'tag:red, tag:"Project X"',
  'is:hidden': 'Hidden items',
  'is:link': 'Links',
  OR: 'Either side: a OR b',
};
/** A word written so a line reads it back as it is; paths keep `~` working (no quotes). */
const escaped = (text: string) => text.replace(/([\s'"\\|;])/g, '\\$1');
/** Where the step being typed starts, or undefined inside an unclosed quote. */
function stepStart(text: string): number | undefined {
  let start = 0;
  let quote: string | undefined;
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (quote) {
      if (character === '\\' && quote === '"') index++;
      else if (character === quote) quote = undefined;
    } else if (character === '\\') index++;
    else if (character === "'" || character === '"') quote = character;
    else if (character === '|' || character === ';') start = index + 1;
  }
  return quote ? undefined : start;
}
const limit = 60;
/**
 * COMPLETION (2026-10-23): the name being typed (verbs with their usage, then commands), or the word
 * being typed by what the verb takes: paths, settings, workspaces, themes, profiles, layouts.
 */
export function lineCompletions(text: string, sources: CompletionSources): LineCompletions {
  const start = stepStart(text);
  if (start === undefined) return { completions: [] };
  const head = /^(\s*:?\s*(?:\d+\s*)?)([A-Za-z0-9._:=@/-]*)(!?)(\s*)/.exec(text.slice(start))!;
  const [matched, lead = '', name = '', bang = '', gap = ''] = head;
  const before = text.slice(0, start) + lead;
  if (!gap && !bang && start + matched.length === text.length) {
    const named: Completion[] = [];
    for (const verb of verbs)
      for (const full of verb.names.map((item) => item.replace(/\[|\]/g, ''))) {
        if (!full.startsWith(name) || named.some((item) => item.label === full)) continue;
        const primary = verbName(verb);
        named.push({
          label: full,
          detail: [verb.usage, verb.help, full === primary ? '' : `as :${primary}`]
            .filter(Boolean)
            .join(' · '),
          insert: before + full + (verb.args?.[1] || verb.flags || verb.rest ? ' ' : ''),
        });
      }
    for (const user of sources.users ?? [])
      if (user.startsWith(name))
        named.push({ label: user, detail: 'Your command', insert: before + user });
    const ids = sources.commands
      .filter((command) => command.id.startsWith(name) && !/\s/.test(command.id))
      .map((command) => ({
        label: command.id,
        detail: command.label,
        insert: before + command.id,
      }));
    // what was typed already names a verb (`tabn` is tabnext): that one first
    const meant = findVerb(name);
    const first = meant ? named.filter((item) => item.label === verbName(meant)) : [];
    return {
      completions: [...first, ...named.filter((item) => !first.includes(item)), ...ids].slice(
        0,
        limit,
      ),
    };
  }
  const verb = findVerb(name);
  if (!verb?.complete) return { completions: [] };
  const rest = text.slice(start + matched.length);
  const cut = Math.max(rest.lastIndexOf(' ') + 1, 0);
  const partial = rest.slice(cut);
  const prefix = before + name + bang + gap + rest.slice(0, cut);
  return complete(verb.complete, partial, prefix, sources);
}
function complete(
  kind: CompleteKind,
  partial: string,
  prefix: string,
  sources: CompletionSources,
): LineCompletions {
  const named = (names: readonly string[], detail?: (name: string) => string | undefined) => ({
    completions: names
      .filter((name) => name.toLowerCase().startsWith(partial.toLowerCase()))
      .slice(0, limit)
      .map((name) => ({ label: name, detail: detail?.(name), insert: prefix + escaped(name) })),
  });
  switch (kind) {
    case 'path': {
      const slash = partial.lastIndexOf('/');
      const folderPart = partial.slice(0, slash + 1);
      const base = partial.slice(slash + 1).replace(/\\(.)/g, '$1');
      const directory = expandPath(
        { text: folderPart.replace(/\\(.)/g, '$1') || '.', quoted: false },
        sources.places,
      );
      const entries =
        sources.listing?.directory === directory
          ? sources.listing.entries.filter(
              (entry) => entry.name.startsWith(base) && (base.startsWith('.') || !entry.hidden),
            )
          : [];
      return {
        directory,
        completions: entries
          .slice()
          .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
          .slice(0, limit)
          .map((entry) => ({
            label: entry.name + (entry.directory ? '/' : ''),
            detail: entry.directory ? 'Folder' : undefined,
            insert: prefix + folderPart + escaped(entry.name) + (entry.directory ? '/' : ''),
          })),
      };
    }
    case 'setting':
    case 'local-setting': {
      const local = kind === 'local-setting';
      const assignment = /^([A-Za-z0-9._]+)=(.*)$/.exec(partial);
      if (assignment) {
        const definition = settingByName(assignment[1]!);
        const values =
          definition?.kind === 'choice'
            ? (definition.choices ?? []).filter(([value]) => value !== 'custom')
            : definition?.kind === 'boolean'
              ? [
                  ['on', 'On'],
                  ['off', 'Off'],
                ]
              : [];
        return {
          completions: values
            .filter(([value]) => value!.startsWith(assignment[2]!))
            .map(([value, label]) => ({
              label: `${assignment[1]}=${value}`,
              detail: label,
              insert: `${prefix}${assignment[1]}=${value}`,
            })),
        };
      }
      const negated = /^(no|inv)/.exec(partial)?.[1] ?? '';
      const names = Object.keys(settingNames).filter((name) => {
        const path = settingNames[name]!;
        return !local || overridable(path);
      });
      const rows = names.flatMap((name) => {
        const definition = settingByName(name)!;
        const forms = [name, ...(definition.kind === 'boolean' && negated ? [negated + name] : [])];
        return forms
          .filter((form) => form.startsWith(partial))
          .map((form) => ({
            label: form,
            detail: `${settingText(definition, sources.value(definition.path))} · ${definition.label}`,
            insert: prefix + form + (definition.kind === 'boolean' ? '' : '='),
          }));
      });
      return { completions: rows.slice(0, limit) };
    }
    case 'workspace':
      return named(sources.workspaces, () => 'Workspace');
    case 'theme':
      return named(sources.family('theme.'), () => 'Theme');
    case 'profile':
      return named(sources.family('profile.'), () => 'Profile');
    case 'layout':
      return named([...tileLayouts, ...sources.family('layout.')], (name) =>
        (tileLayouts as readonly string[]).includes(name) ? 'Tiling layout' : 'Layout template',
      );
    case 'mode':
      return named(sources.modes ?? [], () => 'Key mode');
    case 'help':
      return named(
        [...verbs.map(verbName), ...Object.keys(settingNames), 'keys', 'query'],
        (name) =>
          findVerb(name)?.help ??
          settingByName(name)?.label ??
          (name === 'query' ? 'The file query language' : 'Prefix keys'),
      );
    case 'query':
      // the file query language's terms (domain/search/query.ts), with an example each
      return named(Object.keys(queryTerms), (term) => queryTerms[term]);
    case 'command':
      return named(
        sources.commands.map((command) => command.id),
        (id) => sources.commands.find((command) => command.id === id)?.label,
      );
  }
}
