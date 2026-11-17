import { useSyncExternalStore } from 'react';
import type { TerminalPane, Workspace } from '../../domain/contracts';
import type { TerminalStart } from '../../domain/automation/actions';
import type {
  DefinitionCommandReference,
  DefinitionCommandOutcome,
} from '../../domain/terminals/definition-commands';
import { errorMessage } from '../../domain/errors';
import { getState } from '../state/core';
import { terminalSession, terminalStarted } from './sessions';
import { allowTerminalStart, definitionRunReason } from './start-authority';

type CommandPhase = 'checking' | 'waiting' | 'preparing' | 'starting' | 'started';
type StartIntent = 'run' | 'shell';
interface CommandChoice {
  phase: CommandPhase;
  error?: string;
}
const choices = new Map<string, CommandChoice>();
const checks = new Map<string, Promise<void>>();
const hidden = new Set<string>();
const listeners = new Set<() => void>();
let revision = 0;
export const commandWorkspaceKey = (workspace: Workspace) =>
  `${workspace.id}:${workspace.epoch ?? 0}`;
const key = (workspace: Workspace, pane: TerminalPane) =>
  `${commandWorkspaceKey(workspace)}:${pane.id}`;
function changed(): void {
  revision++;
  for (const listener of listeners) listener();
}
function set(workspace: Workspace, pane: TerminalPane, choice: CommandChoice): void {
  choices.set(key(workspace, pane), choice);
  changed();
}
export function useDefinitionChoices(): void {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => revision,
  );
}
export function definitionChoice(workspace: Workspace, pane: TerminalPane): CommandChoice {
  return choices.get(key(workspace, pane)) ?? { phase: 'checking' };
}

export function checkDefinitionTerminal(workspace: Workspace, pane: TerminalPane, request: TerminalStart): Promise<void> {
  const id = key(workspace, pane);
  if (definitionChoice(workspace, pane).phase !== 'checking') return Promise.resolve();
  const existing = checks.get(id);
  if (existing) return existing;
  const check = (async () => {
    try {
      if (await window.viewer.terminalRunning(request)) {
        const session = await terminalSession(request, getState().settings.settings.terminals.scrollback);
        session.park?.();
        if (await window.viewer.terminalRunning(request)) {
          await terminalStarted(pane.id, session);
          set(workspace, pane, { phase: 'started' });
          return;
        }
      }
      set(workspace, pane, { phase: 'waiting' });
    } catch (error) {
      set(workspace, pane, { phase: 'waiting', error: errorMessage(error) });
    }
  })().finally(() => checks.delete(id));
  checks.set(id, check);
  return check;
}

async function refreshCommands(): Promise<void> {
  const catalog = await window.viewer.workspaceDefinitionFile({ kind: 'catalog' });
  const { receiveDefinitions } = await import('../state/definitions');
  receiveDefinitions(catalog);
}
export function waitingDefinitionPanes(workspace: Workspace): TerminalPane[] {
  return workspace.definition
    ? workspace.panes.filter(
        (pane): pane is TerminalPane =>
          pane.type === 'terminal' &&
          pane.definitionPlane !== undefined &&
          definitionChoice(workspace, pane).phase === 'waiting',
      )
    : [];
}
export const commandsNoticeHidden = (workspace: Workspace) =>
  hidden.has(commandWorkspaceKey(workspace));
export function hideCommandsNotice(workspace: Workspace): void {
  hidden.add(commandWorkspaceKey(workspace));
  changed();
}

export function displayedDefinitionCommand(workspace: Workspace, pane: TerminalPane) {
  const definition = getState().bootstrap.definitions?.definitions.find(
    (entry) => entry.key === workspace.definition?.key,
  );
  const plane = definition?.planes.find(
    (entry) => entry.index === pane.definitionPlane && entry.index >= 0,
  )?.plane;
  if (!definition || plane?.kind !== 'terminal' || !plane.command) return;
  return {
    command: plane.command,
    cwd: plane.path,
    reference: { key: definition.key, plane: pane.definitionPlane!, basis: definition.basis },
  };
}

export async function chooseDefinitionTerminals(
  workspace: Workspace,
  items: readonly {
    pane: TerminalPane;
    request: TerminalStart;
    reference?: DefinitionCommandReference;
  }[],
  intent: StartIntent = 'run',
): Promise<string[]> {
  const selected = items.filter(
    ({ pane }) => definitionChoice(workspace, pane).phase === 'waiting',
  );
  if (!selected.length) return [];
  if (intent === 'run') {
    const reason = definitionRunReason(selected.map(({ pane }) => pane.id));
    if (reason) throw new Error(reason);
  }
  const ready = selected.filter((item) => {
    if (intent === 'run' && !item.reference) {
      set(workspace, item.pane, { phase: 'waiting', error: 'Review the command before running it.' });
      return false;
    }
    return true;
  });
  if (ready.length !== selected.length) await refreshCommands().catch(() => {});
  for (const { pane } of ready) set(workspace, pane, { phase: 'preparing' });
  const started = new Set<string>();
  try {
    // Desktop lookup sees these exact persisted panes before any request can start a PTY.
    const { flushState } = await import('../state/persistence');
    await flushState();
    const prepared = await Promise.all(
      ready.map(async (item) => {
        try {
          const session = await terminalSession(
            item.request,
            getState().settings.settings.terminals.scrollback,
          );
          session.park?.();
          return {
            ...item,
            session,
            request: { ...item.request, cols: session.terminal.cols, rows: session.terminal.rows },
          };
        } catch (error) {
          set(workspace, item.pane, { phase: 'waiting', error: errorMessage(error) });
          return undefined;
        }
      }),
    ).then((items) => items.filter((item) => item !== undefined));
    if (!prepared.length) return [];
    let resolve!: (outcomes: (DefinitionCommandOutcome | void)[]) => void;
    let reject!: (error: unknown) => void;
    const result = new Promise<(DefinitionCommandOutcome | void)[]>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const settling = prepared.map((item, index) => {
      const start = result
        .then(async (outcomes) => {
          const outcome = outcomes[index];
          if (outcome?.kind === 'failed') throw new Error(outcome.message);
          if (outcome?.kind === 'declined') {
            set(workspace, item.pane, { phase: 'waiting' });
            return;
          }
          await terminalStarted(item.pane.id, item.session);
          allowTerminalStart(item.pane.id);
          set(workspace, item.pane, { phase: 'started' });
          started.add(item.pane.id);
        })
        .catch(async (error) => {
          set(workspace, item.pane, {
            phase: item.session.started ? 'started' : 'waiting',
            error: errorMessage(error),
          });
          if (errorMessage(error).includes('The definition changed.')) {
            try {
              await refreshCommands();
            } catch {
              // A refresh failure must not replace other planes' independent outcomes.
            }
          }
        })
        .finally(() => {
          item.session.starting = undefined;
        });
      item.session.starting = start;
      set(workspace, item.pane, { phase: 'starting' });
      return start;
    });
    try {
      if (prepared.length === 1) {
        const item = prepared[0]!;
        resolve([await window.viewer.terminalStart(item.request, intent === 'run' ? item.reference : undefined)]);
      } else {
        resolve(
          await window.viewer.terminalStartAll(
            prepared.map(({ request, reference }) => {
              if (!reference) throw new Error('Choose workspace commands for Run all.');
              return { request, ...reference };
            }),
          ),
        );
      }
    } catch (error) {
      reject(error);
    }
    await Promise.all(settling);
  } catch (error) {
    for (const { pane } of ready)
      set(workspace, pane, { phase: 'waiting', error: errorMessage(error) });
  }
  return selected.filter(({ pane }) => started.has(pane.id)).map(({ pane }) => pane.id);
}
