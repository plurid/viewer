import type { CommandContext } from './registry';

/** A Columns plane can browse a child without changing its root or history. */
export function folderCommandPath(
  context: Pick<CommandContext, 'folder' | 'directory'>,
): string | undefined {
  return context.folder?.mode === 'columns'
    ? context.directory || context.folder.path
    : context.folder?.path;
}
