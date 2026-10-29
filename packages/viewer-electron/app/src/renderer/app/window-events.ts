import { useEffect, useLayoutEffect, useRef } from 'react';
import type { CapturedTarget } from '../../domain/automation/actions';
import type { TaskWorkflowDraft } from '../../domain/command-line/task';
import type { OperationPlan } from '../../domain/operations/operation-plan';
import type { CommandContext } from '../commands/registry';
import type { ProjectCommand } from '../workspace/projects';

/**
 * Requests between parts of one renderer window: each DOM event name and the detail it carries.
 * `undefined` marks a bare signal.
 */
export interface WindowEvents {
  'viewer:action-request': { recipeID: string; context: CommandContext };
  'viewer:agent-review': undefined;
  'viewer:checkpoints': undefined;
  'viewer:collections': undefined;
  'viewer:command-progress': undefined;
  /** Up to two paths, for the left and right sides. */
  'viewer:compare': string[];
  'viewer:dictate': undefined;
  'viewer:duplicates': string[];
  'viewer:inspect': string;
  /** The plane whose notes to edit. */
  'viewer:notes': string;
  'viewer:operation-plan': OperationPlan;
  'viewer:project': ProjectCommand;
  /** Without paths, every open folder lists again. */
  'viewer:refresh': { paths: readonly string[] } | undefined;
  'viewer:relationships': { paths: string[]; paneID?: string };
  'viewer:run-command': CapturedTarget;
  /** The action plan to show, or none for the task list. */
  'viewer:tasks': string | undefined;
  'viewer:task-request': TaskWorkflowDraft;
  'viewer:trash': undefined;
  'viewer:volumes': undefined;
  'viewer:workflows': { file?: string; runID?: string; context?: CommandContext };
}

export type WindowEventName = keyof WindowEvents;

/** A bare signal takes no detail; one that may be absent is optional. */
type DetailArguments<T> = [T] extends [undefined]
  ? []
  : undefined extends T
    ? [detail?: T]
    : [detail: T];

export function sendWindowEvent<K extends WindowEventName>(
  name: K,
  ...detail: DetailArguments<WindowEvents[K]>
): void {
  window.dispatchEvent(new CustomEvent(name, { detail: detail.at(0) }));
}

/**
 * The detail of an event sent as `name`, which only selects the type. A `CustomEvent` sent
 * without a detail carries null, and a plain `Event` none: both read as undefined.
 */
export function windowEventDetail<K extends WindowEventName>(
  name: K,
  event: Event,
): WindowEvents[K] {
  const detail: unknown = (event as Partial<CustomEvent<unknown>>).detail;
  return (detail ?? undefined) as WindowEvents[K];
}

/** Calls `listener` with the detail of each `name` event; returns the unsubscribe. */
export function onWindowEvent<K extends WindowEventName>(
  name: K,
  listener: (detail: WindowEvents[K]) => void,
): () => void {
  const receive = (event: Event) => listener(windowEventDetail(name, event));
  window.addEventListener(name, receive);
  return () => window.removeEventListener(name, receive);
}

/** Listens while the component is mounted; each event reaches the latest `listener`. */
export function useWindowEvent<K extends WindowEventName>(
  name: K,
  listener: (detail: WindowEvents[K]) => void,
): void {
  const latest = useRef(listener);
  useLayoutEffect(() => {
    latest.current = listener;
  });
  useEffect(() => onWindowEvent(name, (detail) => latest.current(detail)), [name]);
}
