import type { ResolvedCommand } from '../commands/registry';
import type { ApplicationSettings } from '../../domain/services';
import {
  resolvedAlternateShortcuts,
  defaultShortcuts,
  hasShortcutForEvent,
  isPreviewShortcut,
  matchesShortcut,
  resolvedShortcut,
  shortcutCommandID,
} from '../../domain/preferences/shortcuts';
import { editable } from '../commands/editing';
import { fileControlOwnsKey, type FileKey } from './selection';
import { overlayOpen } from '../ui/modal';
import { previewOwnsKey } from '../previews/keys';
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
  'view-map',
  'hidden',
]);
export function keyCommand(event: RoutedKey, settings: ApplicationSettings): string | undefined {
  if (event.isComposing || event.repeat) return;
  // a picture that has the keyboard takes its own keys, as ⌘L and ⌘R (previews/keys.ts)
  if (previewOwnsKey(event, settings)) return;
  const bindings = {
    // as shipped, unless the person gave a shipped key to something else, which keeps it
    ...Object.fromEntries(
      Object.keys(defaultShortcuts).map((id) => [id, resolvedShortcut(settings, id)]),
    ),
    // a picture's keys are no window command
    ...Object.fromEntries(
      Object.entries(settings.shortcuts).filter(([id]) => !isPreviewShortcut(id)),
    ),
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
  const id = [
    ...Object.entries(bindings),
    ...Object.entries(resolvedAlternateShortcuts(settings)),
  ].find(([, value]) => matchesShortcut(value, event, settings))?.[0];
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
export function windowKeyCommand(
  event: KeyboardEvent,
  settings: ApplicationSettings,
  previewCommand: (ids: readonly string[]) => ResolvedCommand | undefined,
): string | ResolvedCommand | undefined {
  if (!(event.metaKey || event.ctrlKey) || event.isComposing || event.repeat) return;
  if (
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    ['+', '=', '-'].includes(event.key) &&
    !editable(event.target) &&
    !overlayOpen() &&
    !hasShortcutForEvent(settings, event)
  ) {
    const zoom = event.key === '-' ? 'preview.zoom-out' : 'preview.zoom-in';
    const command = previewCommand([zoom]);
    if (command) return command;
  }
  return keyCommand(event, settings);
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
    (!event.fromQuickPreview && (fileControlOwnsKey(event) || overlayOpen())) ||
    (event.target as Element | null)?.closest?.('.terminal-plane')
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
