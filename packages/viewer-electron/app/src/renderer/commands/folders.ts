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
  const scoped = commands.filter((command) => below(command.paletteFolder ?? [], parent));
  if (query.trim())
    return { rows: parent.length ? rows.filter((row) => scoped.includes(row)) : rows, folders };
  for (const command of scoped) {
    const next = command.paletteFolder?.[parent.length];
    if (!next) continue;
    const path = [...parent, next];
    folders.set('palette:folder:' + JSON.stringify(path), path);
  }
  const folderRows = [...folders].map(([id, path]): ResolvedCommand => ({
    ...scoped.find((command) => below(command.paletteFolder ?? [], path))!,
    id,
    label: path.at(-1)!,
    group: 'Actions',
    icon: 'folder',
    detail: path.join(' / '),
    primary: false,
  }));
  const visible = parent.length
    ? scoped.filter((command) => command.paletteFolder?.length === parent.length)
    : rows.filter((command) => !command.paletteFolder?.length);
  return { rows: [...folderRows, ...visible], folders };
}
