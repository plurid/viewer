import { useSyncExternalStore } from 'react';
import type { TerminalPane, Workspace } from '../../domain/contracts';
import type { TerminalStart } from '../../domain/automation/actions';
import type {
  DefinitionCommandReference,
  DefinitionCommandOutcome,
  DefinitionCommandPresentation,
} from '../../domain/terminals/definition-commands';
import { errorMessage } from '../../domain/errors';
import { getState } from '../state/core';
import { terminalSession, terminalStarted } from './sessions';
import { allowTerminalStart, definitionRunReason } from './start-authority';

type CommandPhase = 'checking' | 'approval' | 'waiting' | 'preparing' | 'started';
type StartIntent = 'run' | 'shell';
type CommandPresentation = DefinitionCommandPresentation | { kind: 'checking' };
interface CommandChoice {
  phase: CommandPhase;
  error?: string;
}
const choices = new Map<string, CommandChoice>();
const checks = new Map<string, Promise<void>>();
const presentations = new Map<string, { snapshot: string; value: DefinitionCommandPresentation }>();
const presentationChecks = new Map<string, Promise<void>>();
export const definitionTerminalChanged = 'This terminal changed in the definition.';
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

export function checkDefinitionTerminal(
  workspace: Workspace,
  pane: TerminalPane,
  request: TerminalStart,
): Promise<void> {
  const id = key(workspace, pane);
  if (definitionChoice(workspace, pane).phase !== 'checking') return Promise.resolve();
  const existing = checks.get(id);
  if (existing) return existing;
  const current = () =>
    getState().saved.workspaces.some(
      (item) =>
        commandWorkspaceKey(item) === commandWorkspaceKey(workspace) &&
        item.panes.some(
          (item) =>
            item.id === pane.id &&
            item.type === 'terminal' &&
            item.path === request.cwd &&
            item.profileID === request.profileID,
        ),
    );
  const check = (async () => {
    try {
      let status = await window.viewer.terminalStatus(request);
      if (status.kind !== 'stopped' && current()) {
        if (status.kind === 'starting') set(workspace, pane, { phase: 'approval' });
        const session = await terminalSession(
          request,
          getState().settings.settings.terminals.scrollback,
        );
        if (!current() || session.disposed) return;
        session.park?.();
        const settling = window.viewer.terminalStatus(request, status.kind === 'starting');
        session.starting = settling.then(() => {});
        try {
          status = await settling;
        } finally {
          session.starting = undefined;
        }
        if (status.kind === 'running' && current() && !session.exited) {
          await terminalStarted(pane.id, session);
          if (current()) set(workspace, pane, { phase: 'started' });
          return;
        }
      }
      if (current())
        set(workspace, pane, {
          phase: 'waiting',
          error: status.kind === 'stopped' ? status.error : undefined,
        });
    } catch (error) {
      if (current()) set(workspace, pane, { phase: 'waiting', error: errorMessage(error) });
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

function catalogCommand(workspace: Workspace, pane: TerminalPane) {
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

const presentationKey = (workspace: Workspace, pane: TerminalPane) =>
  JSON.stringify([
    key(workspace, pane),
    workspace.definition?.key,
    pane.path,
    pane.profileID,
    pane.definitionPlane,
    catalogCommand(workspace, pane)?.reference.basis,
    getState().bootstrap.definitions?.revision,
  ]);

export function definitionCommandPresentation(
  workspace: Workspace,
  pane: TerminalPane,
): CommandPresentation {
  const command = catalogCommand(workspace, pane);
  if (!command) {
    const definition = getState().bootstrap.definitions?.definitions.find(
      (item) => item.key === workspace.definition?.key,
    );
    const plane = definition?.planes.find(
      (item) => item.index === pane.definitionPlane && item.index >= 0,
    );
    return {
      kind: definition && (!plane || plane.plane.kind !== 'terminal') ? 'changed' : 'unavailable',
    };
  }
  const stored = presentations.get(key(workspace, pane));
  return stored?.snapshot === presentationKey(workspace, pane)
    ? stored.value
    : { kind: 'checking' };
}

export function displayedDefinitionCommand(workspace: Workspace, pane: TerminalPane) {
  const presentation = definitionCommandPresentation(workspace, pane);
  return presentation.kind === 'available' ? presentation : undefined;
}

export function checkDefinitionCommand(
  workspace: Workspace,
  pane: TerminalPane,
  request: TerminalStart,
): Promise<void> {
  const id = presentationKey(workspace, pane);
  const command = catalogCommand(workspace, pane);
  if (!command || presentations.get(key(workspace, pane))?.snapshot === id)
    return Promise.resolve();
  const existing = presentationChecks.get(id);
  if (existing) return existing;
  const check = (async () => {
    // A newly opened pane must reach desktop persistence before its folder can be checked there.
    const { flushState } = await import('../state/persistence');
    await flushState();
    return window.viewer.terminalDefinitionCommand(request, command.reference);
  })()
    .then((presentation) => {
      if (presentationKey(workspace, pane) !== id) return;
      presentations.set(key(workspace, pane), { snapshot: id, value: presentation });
      changed();
    })
    .catch(async (error) => {
      if (presentationKey(workspace, pane) !== id) return;
      presentations.set(key(workspace, pane), { snapshot: id, value: { kind: 'changed' } });
      changed();
      if (errorMessage(error).includes('The definition changed.'))
        await refreshCommands().catch(() => {});
    })
    .finally(() => presentationChecks.delete(id));
  presentationChecks.set(id, check);
  return check;
}

export async function chooseDefinitionTerminals(
  workspace: Workspace,
  items: readonly {
    pane: TerminalPane;
    request: TerminalStart;
    reference?: DefinitionCommandReference;
    problem?: string;
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
      set(workspace, item.pane, {
        phase: 'waiting',
        error: item.problem ?? 'Review the command before running it.',
      });
      return false;
    }
    return true;
  });
  for (const { pane } of ready) set(workspace, pane, { phase: 'preparing' });
  if (ready.length !== selected.length) await refreshCommands().catch(() => {});
  if (!ready.length) return [];
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
      set(workspace, item.pane, { phase: 'approval' });
      return start;
    });
    try {
      if (prepared.length === 1) {
        const item = prepared[0]!;
        resolve([
          await window.viewer.terminalStart(
            item.request,
            intent === 'run' ? item.reference : undefined,
          ),
        ]);
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
