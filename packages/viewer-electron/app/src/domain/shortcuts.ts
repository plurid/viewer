export const defaultShortcuts: Record<string, string> = {
  palette: 'Cmd+K',
  'find-file': 'Cmd+F',
  'new-root-folder': 'Cmd+N',
  settings: 'Cmd+,',
  'frame-all': 'Cmd+0',
  dock: 'Cmd+Enter',
  'toggle-sidebar': 'Cmd+Alt+S',
  'go-to': 'Cmd+L',
  'open-selection': 'Cmd+O',
  parent: 'Cmd+ArrowUp',
  back: 'Cmd+[',
  forward: 'Cmd+]',
  copy: 'Cmd+C',
  'copy-path': 'Cmd+Alt+C',
  cut: 'Cmd+X',
  paste: 'Cmd+V',
  'paste-move': 'Cmd+Alt+V',
  'select-all': 'Cmd+A',
  info: 'Cmd+I',
  duplicate: 'Cmd+D',
  trash: 'Cmd+Backspace',
  'new-folder': 'Cmd+Shift+N',
  'view-list': 'Cmd+1',
  'view-grid': 'Cmd+2',
  'view-columns': 'Cmd+3',
  'view-gallery': 'Cmd+4',
  'toggle-hidden': 'Cmd+Shift+.',
};
const aliases: Record<string, string> = {
  command: 'cmd',
  cmdorctrl: 'cmd',
  control: 'ctrl',
  option: 'alt',
  return: 'enter',
};
export function shortcutParts(value: string): string[] {
  return value
    .toLowerCase()
    .split('+')
    .map((part) => aliases[part.trim()] || part.trim())
    .filter(Boolean);
}
export function shortcutKey(value: string): string {
  return shortcutParts(value).sort().join('+');
}
export function validShortcut(value: string): boolean {
  if (!value) return true;
  const parts = shortcutParts(value);
  return (
    parts.length >= 2 &&
    parts.some((part) => part === 'cmd' || part === 'ctrl') &&
    parts.filter((part) => !['cmd', 'ctrl', 'shift', 'alt'].includes(part)).length === 1 &&
    new Set(parts).size === parts.length &&
    parts.every(
      (part) =>
        ['cmd', 'ctrl', 'shift', 'alt', 'enter', 'backspace', 'delete', 'escape'].includes(part) ||
        part.length === 1 ||
        /^arrow(up|down|left|right)$/.test(part) ||
        /^f([1-9]|1[0-9]|2[0-4])$/.test(part),
    )
  );
}
export function matchesShortcut(
  value: string,
  event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'key'>,
): boolean {
  const parts = shortcutParts(value);
  const key = parts.find((part) => !['cmd', 'ctrl', 'shift', 'alt'].includes(part));
  return (
    !!value &&
    event.metaKey === parts.includes('cmd') &&
    event.ctrlKey === parts.includes('ctrl') &&
    event.altKey === parts.includes('alt') &&
    event.shiftKey === parts.includes('shift') &&
    key === event.key.toLowerCase()
  );
}
export function accelerator(value: string): string | undefined {
  if (!value) return undefined;
  return shortcutParts(value)
    .map(
      (part) =>
        ({
          cmd: 'Command',
          ctrl: 'Control',
          alt: 'Alt',
          shift: 'Shift',
          enter: 'Return',
          arrowup: 'Up',
          arrowdown: 'Down',
          arrowleft: 'Left',
          arrowright: 'Right',
        })[part] || part.toUpperCase(),
    )
    .join('+');
}
