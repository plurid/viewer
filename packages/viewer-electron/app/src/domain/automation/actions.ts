import type { FileEntry } from '../contracts';
export interface CapturedTarget {
  /** Assigned by the desktop; a reopened window cannot inherit a pending proposal. */
  originID?: string;
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
  /** User-organized palette folders under Actions. */
  folder?: string[];
  inputs?: ActionInput[];
  when: {
    target: 'any' | 'files' | 'folders' | 'background';
    extensions: string[];
    min: number;
    max: number;
    directories?: string[];
  };
  executor:
    | { kind: 'builtin'; command: string }
    | { kind: 'recipe'; recipeID: string }
    | { kind: 'terminal'; profileID: string }
    | { kind: 'executable'; executable: string; args: string[]; perItem: boolean }
    | { kind: 'shell'; executable: string; script: string; perItem: boolean }
    | { kind: 'workflow'; steps: WorkflowStep[] }
    /** Lines in order, as a macro records them (2026-10-23); no custom actions. `command`, with a
     * capital, runs it from the command line as `:Name`, its words as $1… and $*. */
    | { kind: 'sequence'; commands: string[]; command?: string };
}
export type WorkflowStep = { kind: 'action'; actionID: string } | { kind: 'command'; line: string };
export interface ActionInput {
  name: string;
  label: string;
  kind: 'text' | 'number' | 'choice' | 'boolean';
  required: boolean;
  initial?: string;
  choices?: string[];
}
export type ActionValues = Record<string, string>;
export function actionInputs(
  action: CustomAction,
  actions: readonly CustomAction[],
): ActionInput[] {
  const inputs = [...(action.inputs ?? [])];
  if (action.executor.kind === 'workflow')
    for (const step of action.executor.steps) {
      if (step.kind !== 'action') continue;
      const child = actions.find((action) => action.id === step.actionID);
      if (!child || !['shell', 'executable'].includes(child.executor.kind))
        throw new Error('Workflow steps must name existing executable or shell commands.');
      inputs.push(...(child.inputs ?? []));
    }
  const merged = new Map<string, ActionInput>();
  for (const input of inputs) {
    const previous = merged.get(input.name);
    if (previous && JSON.stringify(previous) !== JSON.stringify(input))
      throw new Error(`The workflow has conflicting definitions for parameter ${input.name}.`);
    merged.set(input.name, input);
  }
  if (merged.size > 20) throw new Error('Commands support up to 20 parameters.');
  return [...merged.values()];
}
/** Values stay literal argv or named environment values; they never become shell source. */
export function actionValues(inputs: readonly ActionInput[], supplied: ActionValues): ActionValues {
  if (Object.keys(supplied).some((name) => !inputs.some((input) => input.name === name)))
    throw new Error('The command received an unknown parameter.');
  return Object.fromEntries(
    inputs.map((input) => {
      const value =
        supplied[input.name] ?? input.initial ?? (input.kind === 'boolean' ? 'false' : '');
      if (typeof value !== 'string' || value.includes('\0') || value.length > 4000)
        throw new Error(`Enter a bounded value for ${input.label}.`);
      if (input.required && !value.trim()) throw new Error(`${input.label} is required.`);
      if (value && input.kind === 'number' && !Number.isFinite(Number(value)))
        throw new Error(`${input.label} must be a number.`);
      if (value && input.kind === 'choice' && !input.choices?.includes(value))
        throw new Error(`Choose an available value for ${input.label}.`);
      if (input.kind === 'boolean' && !['true', 'false'].includes(value))
        throw new Error(`${input.label} must be true or false.`);
      return [input.name, value];
    }),
  );
}
/**
 * Whether a workspace's change to custom actions only adds, edits or removes command sequences
 * (2026-10-23): Record macro saves from the workspace, which can run any built-in command anyway;
 * programs, scripts and terminals still change only in Settings.
 */
export function sequencesOnly(
  current: readonly CustomAction[],
  next: readonly CustomAction[],
): boolean {
  const before = new Map(current.map((action) => [action.id, action]));
  const after = new Map(next.map((action) => [action.id, action]));
  return [...new Set([...before.keys(), ...after.keys()])].every((id) => {
    const old = before.get(id);
    const changed = after.get(id);
    if (old && changed && JSON.stringify(old) === JSON.stringify(changed)) return true;
    return (
      (!old || old.executor.kind === 'sequence') &&
      (!changed || changed.executor.kind === 'sequence')
    );
  });
}
export interface ExecutionTask {
  id: string;
  title: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  output: string;
  exitCode?: number;
  error?: string;
  directory?: string;
  started?: number;
  ended?: number;
  truncated?: boolean;
  workspaceID?: string;
  paneID?: string;
  /** Private human command metadata, never included in portable workspace projects. */
  command?: string;
  folderIdentity?: string;
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
    (!rule.directories?.length ||
      rule.directories.some(
        (root) =>
          target.directory === root || target.directory.startsWith(root.replace(/\/$/, '') + '/'),
      )) &&
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
  values: ActionValues = {},
): string[] {
  const selected = item ? [item] : target.selection;
  return args.flatMap((argument) => {
    if (argument === '{paths}') return selected.map((file) => file.path);
    return [
      argument.replace(
        /\{(directory|path|name|extension|input:[a-z][a-z0-9_]{0,31})\}/g,
        (_, field: string) => {
          if (field.startsWith('input:')) {
            const name = field.slice(6);
            if (!Object.hasOwn(values, name)) throw new Error(`Unknown input ${name}.`);
            return values[name]!;
          }
          if (field === 'directory') return target.directory;
          const [item] = selected;
          if (selected.length !== 1 || !item)
            throw new Error(`{${field}} needs one selected item or per-item execution.`);
          return item[field as 'path' | 'name' | 'extension'];
        },
      ),
    ];
  });
}
export function terminalDirectory(directory: string, selected: FileEntry[]): string {
  const [item] = selected;
  return selected.length === 1 && item ? (item.directory ? item.path : item.parent) : directory;
}
