import { refreshClipboard } from '../state/store';
import type { CommandContext, CommandDefinition } from './registry';

function paths(context: CommandContext): string[] {
  if (context.scope === 'sidebar') return context.sidebar?.path ? [context.sidebar.path] : [];
  if (context.scope === 'preview') return context.path ? [context.path] : [];
  if (!['window', 'files', 'folder'].includes(context.scope)) return [];
  if (context.selection.length) return context.selection.map((entry) => entry.path);
  return context.folder && context.directory ? [context.directory] : [];
}
export const copyPathCommand: CommandDefinition = {
  id: 'copy-path',
  label: (context) => (paths(context).length > 1 ? 'Copy paths' : 'Copy path'),
  group: 'Files',
  icon: 'copy',
  aliases: ['copy pathname', 'copy file path', 'copy folder path'],
  shortcut: '⌥⌘C',
  when: (context) => paths(context).length > 0,
  run: async (context) => {
    await window.viewer.copyPaths(paths(context));
    await refreshClipboard();
  },
};
