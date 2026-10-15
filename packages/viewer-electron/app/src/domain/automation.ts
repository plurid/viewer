import type { FileEntry } from './contracts';
export interface CapturedTarget {
  workspaceID: string;
  rootID: string;
  paneID: string;
  directory: string;
  panePath?: string;
  selection: FileEntry[];
}
export interface TerminalProfile {
  id: string;
  name: string;
  executable: string;
  args: string[];
  env: Record<string, string>;
}
export interface CustomAction {
  id: string;
  name: string;
  aliases: string[];
  icon: string;
  shortcut: string;
  order: number;
  pinned: boolean;
  when: {
    target: 'any' | 'files' | 'folders' | 'background';
    extensions: string[];
    min: number;
    max: number;
  };
  executor:
    | { kind: 'builtin'; command: string }
    | { kind: 'recipe'; recipeID: string }
    | { kind: 'terminal'; profileID: string }
    | { kind: 'executable'; executable: string; args: string[]; perItem: boolean }
    | { kind: 'shell'; executable: string; script: string; perItem: boolean };
}
export interface ExecutionTask {
  id: string;
  title: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  output: string;
  exitCode?: number;
  error?: string;
}
export type TerminalEvent =
  | { type: 'data'; id: string; data: string }
  | { type: 'exit'; id: string; code: number }
  | { type: 'error'; id: string; message: string };
export interface TerminalStart {
  id: string;
  workspaceID: string;
  rootID: string;
  cwd: string;
  profileID: string;
  cols: number;
  rows: number;
}
export function actionAvailable(action: CustomAction, target: CapturedTarget): boolean {
  const { selection } = target;
  const rule = action.when;
  return (
    selection.length >= rule.min &&
    selection.length <= rule.max &&
    (rule.target !== 'background' || !selection.length) &&
    (rule.target !== 'files' ||
      (selection.length > 0 && selection.every((file) => !file.directory))) &&
    (rule.target !== 'folders' ||
      (selection.length > 0 && selection.every((file) => file.directory))) &&
    (!rule.extensions.length ||
      (selection.length > 0 &&
        selection.every((file) => rule.extensions.includes(file.extension.toLowerCase()))))
  );
}
/** No shell interpolation: placeholders produce individual literal argv values. */
export function actionArguments(
  args: string[],
  target: CapturedTarget,
  item?: FileEntry,
): string[] {
  const selected = item ? [item] : target.selection;
  return args.flatMap((argument) => {
    if (argument === '{paths}') return selected.map((file) => file.path);
    return [
      argument.replace(/\{(directory|path|name|extension)\}/g, (_, field: string) => {
        if (field === 'directory') return target.directory;
        const [item] = selected;
        if (selected.length !== 1 || !item)
          throw new Error(`{${field}} needs one selected item or per-item execution.`);
        return item[field as 'path' | 'name' | 'extension'];
      }),
    ];
  });
}
export function terminalDirectory(directory: string, selected: FileEntry[]): string {
  const [item] = selected;
  return selected.length === 1 && item ? (item.directory ? item.path : item.parent) : directory;
}
