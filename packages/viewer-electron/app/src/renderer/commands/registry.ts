import type { FileEntry, FolderPane, OperationJob, SidebarSection } from '../../domain/contracts';
import type { IconName } from '../ui/Icon';
import { typoScore } from '../../domain/search/approximate';

export type CommandScope = 'window' | 'folder' | 'files' | 'preview' | 'sidebar' | 'workspace';
export interface CommandContext {
  scope: CommandScope;
  workspaceID: string;
  rootID?: string;
  paneID?: string;
  selection: readonly FileEntry[];
  folder?: FolderPane;
  searchOpen?: boolean;
  directory?: string;
  resourceID?: string;
  path?: string;
  clipboard: { paths: string[]; cut: boolean } | null;
  jobs: readonly OperationJob[];
  sidebar?: { section: SidebarSection; path?: string; name?: string };
  /** A lens group heading's menu: the group, or null for Unsorted. */
  lensGroup?: { id: string | null; label: string };
}
export interface CommandDefinition {
  id: string;
  label: string | ((context: CommandContext) => string);
  group: string;
  paletteFolder?: readonly string[];
  icon?: IconName;
  aliases?: readonly string[];
  shortcut?: string;
  detail?: string | ((context: CommandContext) => string);
  primary?: boolean | ((context: CommandContext) => boolean);
  remember?: boolean;
  /** A setting's command: the palette lists it apart, by the setting's name, with its
   * value (on or off, or the current value) and whether it is a workspace's own. */
  setting?: CommandSetting;
  when(context: CommandContext): boolean;
  run(context: CommandContext): void | Promise<void>;
}
export interface CommandSetting {
  name: string;
  value?: boolean | string;
  workspace?: boolean;
  /** One of a setting's choices: its label, and whether it is the current one. */
  choice?: string;
  current?: boolean;
}
export interface CommandSource {
  context(): CommandContext;
  definitions(): readonly CommandDefinition[];
  valid?(invocation: CommandContext, live: CommandContext): boolean;
}
export interface CommandRequest {
  paneID?: string;
  scope?: CommandScope;
  context?: Partial<CommandContext>;
  sources?: readonly string[];
  global?: boolean;
  ids?: readonly string[];
  /** False for a command the person did not choose, such as an agent's: it stays out of Recent
   * commands, where it ranked first in the palette. */
  remember?: boolean;
}
export interface ResolvedCommand {
  id: string;
  label: string;
  group: string;
  paletteFolder?: readonly string[];
  icon?: IconName;
  shortcut?: string;
  aliases: readonly string[];
  detail?: string;
  primary: boolean;
  setting?: CommandSetting;
  source: string;
  context: CommandContext;
}

/** One action path for menus, shortcuts, toolbars and preview extensions. */
export class CommandRegistry {
  private sources = new Map<string, CommandSource>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private revisions = new Map<string, number>();
  private definitions = new Map<
    string,
    { revision: number; items: readonly CommandDefinition[] }
  >();
  private catalog(id: string, source: CommandSource) {
    const revision = this.revisions.get(id) || 0;
    const cached = this.definitions.get(id);
    if (cached?.revision === revision) return cached.items;
    const items = source.definitions();
    this.definitions.set(id, { revision, items });
    return items;
  }
  constructor(
    private chosen: (id: string) => void = () => {},
    private shortcut: (id: string) => string | undefined = () => undefined,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.revision;
  scopedSnapshot = (paneID: string) =>
    (this.revisions.get('window') || 0) +
    (this.revisions.get(`folder:${paneID}`) || 0) +
    (this.revisions.get(`preview:${paneID}`) || 0) +
    (this.revisions.get(`collection:${paneID}`) || 0);
  touch = (source = 'window') => {
    this.revisions.set(source, (this.revisions.get(source) || 0) + 1);
    this.revision++;
    for (const listener of this.listeners) listener();
  };
  register(id: string, source: CommandSource): () => void {
    this.sources.set(id, source);
    this.touch(id);
    return () => {
      if (this.sources.get(id) !== source) return;
      this.sources.delete(id);
      this.definitions.delete(id);
      this.touch(id);
    };
  }
  context(paneID?: string): CommandContext | undefined {
    return (
      this.sources.get(`folder:${paneID}`)?.context() ??
      this.sources.get(`preview:${paneID}`)?.context() ??
      this.sources.get(`collection:${paneID}`)?.context() ??
      this.sources.get('window')?.context()
    );
  }
  /** A command's label in a context, available there or not: which-key names every binding. */
  label(id: string, context: CommandContext): string | undefined {
    for (const source of this.sources.values())
      for (const definition of source.definitions())
        if (definition.id === id)
          return typeof definition.label === 'string'
            ? definition.label
            : definition.label(context);
    return undefined;
  }
  /** Every command id the sources define, available or not: a line may name any. */
  ids(): string[] {
    const ids = new Set<string>();
    for (const [id, source] of this.sources)
      for (const definition of this.catalog(id, source)) ids.add(definition.id);
    return [...ids];
  }
  list(request: CommandRequest = {}): ResolvedCommand[] {
    const commands: ResolvedCommand[] = [];
    const seen = new Set<string>();
    for (const [id, source] of this.sources) {
      if (
        request.sources
          ? !request.sources.includes(id)
          : id !== 'window' && source.context().paneID !== request.paneID
      )
        continue;
      if (id === 'window' && request.global === false) continue;
      const context = {
        ...source.context(),
        ...request.context,
        ...(request.scope ? { scope: request.scope } : {}),
      };
      for (const definition of this.catalog(id, source)) {
        if (request.ids && !request.ids.includes(definition.id)) continue;
        if (seen.has(definition.id) || !definition.when(context)) continue;
        seen.add(definition.id);
        commands.push({
          id: definition.id,
          label:
            typeof definition.label === 'function' ? definition.label(context) : definition.label,
          detail:
            typeof definition.detail === 'function'
              ? definition.detail(context)
              : definition.detail,
          group: definition.group,
          paletteFolder: definition.paletteFolder,
          icon: definition.icon,
          aliases: definition.aliases ?? [],
          shortcut: this.shortcut(definition.id) ?? definition.shortcut,
          primary:
            typeof definition.primary === 'function'
              ? definition.primary(context)
              : !!definition.primary,
          ...(definition.setting ? { setting: definition.setting } : {}),
          source: id,
          context,
        });
      }
    }
    return commands;
  }
  async run(command: ResolvedCommand, remember = true): Promise<boolean> {
    const source = this.sources.get(command.source);
    if (!source) return false;
    const live = source.context();
    if (source.valid && !source.valid(command.context, live)) return false;
    const definition = this.catalog(command.source, source).find((item) => item.id === command.id);
    const context = {
      ...live,
      ...command.context,
      folder: live.folder,
      clipboard: live.clipboard,
      jobs: live.jobs,
    };
    if (!definition?.when(context)) return false;
    await definition.run(context);
    if (remember && definition.remember !== false) this.chosen(definition.id);
    this.touch(command.source);
    return true;
  }
  async invoke(id: string, request: CommandRequest): Promise<boolean> {
    const command = this.list(request).find((item) => item.id === id);
    return command ? this.run(command, request.remember !== false) : false;
  }
}

export const normalize = (value: string) =>
  value
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
function scoreLabel(label: string, query: string): number {
  if (label.startsWith(query)) return 1000;
  if (label.split(/[\s…./-]+/).some((word) => word.startsWith(query))) return 900;
  const index = label.indexOf(query);
  if (index >= 0) return 800 - index;
  let position = -1;
  let first = -1;
  for (const char of query) {
    position = label.indexOf(char, position + 1);
    if (position < 0) return typoScore(label, query);
    if (first < 0) first = position;
  }
  return 100 - Math.min(90, position - first - query.length + 1);
}
/** Rank lightweight filenames before constructing at most 150 executable commands. */
export function rankFiles(entries: readonly FileEntry[], query: string, limit = 150): FileEntry[] {
  const needle = normalize(query.trim());
  if (!needle) return entries.slice(0, limit);
  return entries
    .map((entry, index) => ({
      entry,
      index,
      score: Math.max(
        scoreLabel(normalize(entry.name), needle),
        'files'.startsWith(needle) ? 500 : 'files'.includes(needle) ? 400 : 0,
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.entry);
}
/** How well a command matches a normalized query: its label, aliases or group. */
export function commandScore(command: ResolvedCommand, needle: string): number {
  const label = scoreLabel(normalize(command.label), needle);
  const alias = Math.max(
    0,
    ...command.aliases.map((alias) => {
      const value = normalize(alias);
      return value === needle
        ? 1100
        : value.startsWith(needle)
          ? 950
          : scoreLabel(value, needle) * 0.5;
    }),
  );
  const group = normalize(command.group);
  return Math.max(label, alias, group.startsWith(needle) ? 500 : group.includes(needle) ? 400 : 0);
}
export function rankCommands(
  commands: readonly ResolvedCommand[],
  query: string,
  recent: readonly string[],
  mode: 'menu' | 'palette' = 'menu',
): ResolvedCommand[] {
  const needle = normalize(query.trim());
  const recency = (id: string) => {
    const index = recent.indexOf(id);
    return index < 0 ? 1000 : index;
  };
  if (!needle) {
    const recentRows = recent
      .flatMap((id) => commands.find((item) => item.id === id) ?? [])
      .slice(0, 2);
    const rest = commands.filter((item) => !recentRows.some((recent) => recent.id === item.id));
    return [
      ...recentRows,
      ...(mode === 'palette' ? rest.filter((item) => item.primary).slice(0, 10) : rest),
    ];
  }
  return commands
    .map((command, index) => ({ command, score: commandScore(command, needle), index }))
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || recency(a.command.id) - recency(b.command.id) || a.index - b.index,
    )
    .map((item) => item.command);
}
