import type { TextEditCommand } from '../../domain/contracts';

export function editable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    !!target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')
  );
}
const textCommands: Record<string, TextEditCommand> = {
  'undo-file': 'undo',
  'redo-file': 'redo',
  cut: 'cut',
  copy: 'copy',
  paste: 'paste',
  'select-all': 'selectAll',
};
export function textEditFor(command: string, textFocused: boolean): TextEditCommand | undefined {
  return textFocused ? textCommands[command] : undefined;
}
