import { useSyncExternalStore } from 'react';
import { getState, update, useViewer } from '../state/core';

const deferred = new Set<string>();
const runDeferred = new Set<string>();
const agents = new Set<string>();
const listeners = new Set<() => void>();
let revision = 0;
function changed(): void {
  revision++;
  for (const listener of listeners) listener();
}
export function deferTerminal(id: string): void {
  deferred.add(id);
  runDeferred.add(id);
  changed();
}
export function allowTerminalStart(id: string): void {
  deferred.delete(id);
  runDeferred.delete(id);
  changed();
}
export const terminalStartDeferred = (id: string) => deferred.has(id);
export function agentTerminalWork(id: string, active: boolean): void {
  if (active) agents.add(id);
  else agents.delete(id);
  // Finishing agent work enables an explicit Run, while ordinary shells still need a click.
  if (!agents.size && !getState()?.bootstrap.agentDriven) runDeferred.clear();
  changed();
}
export function definitionRunReason(ids: readonly string[]): string | undefined {
  if (agents.size || getState()?.bootstrap.agentDriven)
    return 'Only you can start workspace commands. Wait for the agent to finish.';
  if (ids.some((id) => runDeferred.has(id)))
    return 'An agent opened this view. Choose Shell only to start a terminal yourself.';
  return undefined;
}
export function useTerminalAuthority(): void {
  useViewer((state) => state.bootstrap.agentDriven);
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

export function receiveTerminalAuthority(agentDriven: boolean): void {
  const state = getState();
  update({ ...state, bootstrap: { ...state.bootstrap, agentDriven } });
  if (!agentDriven && !agents.size) {
    runDeferred.clear();
    changed();
  }
}
