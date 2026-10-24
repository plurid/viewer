import type { ServerPane, ViewerAPI } from '../../domain/contracts';
import { getState, report, subscribe } from '../state/core';
import { LocalServerSessions } from './sessions';

interface Runtime {
  api: ViewerAPI;
  sessions: LocalServerSessions;
  disconnect?: () => void;
}

const runtimes = new WeakMap<ViewerAPI, Runtime>();
let connected: Runtime | undefined;

function runtime(): Runtime {
  const api = window.viewer;
  let value = runtimes.get(api);
  if (!value) {
    value = { api, sessions: new LocalServerSessions(api, report) };
    runtimes.set(api, value);
  }
  return value;
}

export function localServerSessions(): LocalServerSessions {
  return runtime().sessions;
}

/** Installed once per native renderer, never removed by a culled ServerPlane. */
export function connectLocalServers(): void {
  const value = runtime();
  if (connected === value) return;
  connected?.disconnect?.();
  connected = value;
  let workspaces: ReturnType<typeof getState>['saved']['workspaces'] | undefined;
  const sync = () => {
    const state = getState();
    if (!state || state.saved.workspaces === workspaces) return;
    workspaces = state.saved.workspaces;
    value.sessions.retain(
      workspaces.flatMap((space) =>
        space.panes.filter((pane): pane is ServerPane => pane.type === 'server'),
      ),
    );
  };
  sync();
  const stopState = subscribe(sync);
  const stopEvents = value.api.onEvent((event) => {
    if (event.type === 'local-servers') value.sessions.receive(event.servers);
  });
  value.disconnect = () => {
    stopState();
    stopEvents();
    value.sessions.retain([]);
  };
  void value.sessions.load().catch(() => {
    // Each retained server plane shows the load failure and exposes Refresh/Start.
  });
}
