import type { ResolvedCommand } from './registry';

const below = (folder: readonly string[], parent: readonly string[]) =>
  parent.every((part, index) => folder[index] === part);
export function commandFolders(
  commands: readonly ResolvedCommand[],
  rows: ResolvedCommand[],
  parent: string[],
  query: string,
) {
  const folders = new Map<string, string[]>();
  const folderRows: ResolvedCommand[] = [];
  const scoped = commands.filter((command) => below(command.paletteFolder ?? [], parent));
  if (query.trim())
    return {
      rows: parent.length ? rows.filter((row) => scoped.includes(row)) : rows,
      folders,
    };
  for (const command of scoped) {
    const next = command.paletteFolder?.[parent.length];
    if (!next) continue;
    const path = [...parent, next];
    const id = 'palette:folder:' + JSON.stringify(path);
    if (folders.has(id)) continue;
    folders.set(id, path);
    folderRows.push({
      id,
      source: command.source,
      context: command.context,
      aliases: [],
      label: next,
      group: 'Actions',
      icon: 'folder',
      detail: path.join(' / '),
      primary: false,
    });
  }
  const visible = parent.length
    ? scoped.filter((command) => command.paletteFolder?.length === parent.length)
    : rows.filter((command) => !command.paletteFolder?.length);
  return { rows: [...folderRows, ...visible], folders };
}
