import type { ApplicationSettings } from '../../domain/services';
import {
  alternateShortcuts,
  defaultShortcuts,
  matchesShortcut,
  shortcutCommandID,
} from '../../domain/shortcuts';
import { editable } from '../commands/editing';
import { fileControlOwnsKey, type FileKey } from './selection';
import { overlayOpen } from '../ui/modal';
type RoutedKey = FileKey &
  Partial<Pick<KeyboardEvent, 'isComposing' | 'repeat' | 'defaultPrevented'>>;
export const explorerCommandIDs = new Set([
  'open-selection',
  'parent',
  'back',
  'forward',
  'copy',
  'cut',
  'paste',
  'paste-move',
  'select-all',
  'info',
  'duplicate',
  'trash',
  'new-folder',
  'new-folder-with-selection',
  'view-list',
  'view-grid',
  'view-columns',
  'view-gallery',
  'hidden',
]);
export function keyCommand(event: RoutedKey, settings: ApplicationSettings): string | undefined {
  if (event.isComposing || event.repeat) return;
  const bindings = {
    ...defaultShortcuts,
    ...settings.shortcuts,
    ...Object.fromEntries(
      settings.recipes
        .filter((item) => item.shortcut)
        .map((item) => ['recipe.' + item.id, item.shortcut!]),
    ),
    ...Object.fromEntries(
      settings.customActions
        .filter((item) => item.shortcut)
        .map((item) => ['custom.' + item.id, item.shortcut]),
    ),
  };
  const id = [...Object.entries(bindings), ...Object.entries(alternateShortcuts)].find(
    ([, value]) => matchesShortcut(value, event),
  )?.[0];
  if (id) return shortcutCommandID(id);
  if (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key === 'ArrowDown'
  )
    return 'open-selection';
  if (
    event.altKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    event.key === 'ArrowLeft'
  )
    return 'back';
  if (
    event.altKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    event.key === 'ArrowRight'
  )
    return 'forward';
  if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    if (event.key === 'Enter') return 'rename';
    if (event.key === ' ') return 'quick-preview';
  }
}
export interface ExplorerInput {
  settings: ApplicationSettings;
  command(id: string): void;
  move(key: string, range: boolean): void;
  clear(): void;
  horizontal?(direction: 'left' | 'right'): void;
  type?(text: string): void;
}
/** Views supply selection geometry, not independent shortcut tables. */
export function routeExplorerInput(event: RoutedKey, input: ExplorerInput): void {
  if (
    event.defaultPrevented ||
    editable(event.target) ||
    fileControlOwnsKey(event) ||
    (event.target as Element | null)?.closest?.('.terminal-plane') ||
    overlayOpen()
  )
    return;
  const command = keyCommand(event, input.settings);
  const stop = () => {
    event.preventDefault();
    event.stopPropagation();
  };
  if (command) {
    stop();
    input.command(command);
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
  if (input.type && Array.from(event.key).length === 1 && event.key !== ' ') {
    stop();
    input.type(event.key);
    return;
  }
  if (event.key === 'Escape') {
    stop();
    input.clear();
    return;
  }
  if (input.horizontal && !event.shiftKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    stop();
    input.horizontal(event.key === 'ArrowLeft' ? 'left' : 'right');
    return;
  }
  if (
    [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
      'PageUp',
      'PageDown',
    ].includes(event.key)
  ) {
    stop();
    input.move(event.key, event.shiftKey);
  }
}
