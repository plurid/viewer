import { getState, subscribe } from '../state/core';
import { report } from '../state/store';
let connected: unknown;
let disconnect: (() => void) | undefined;
export function connectBrowsers() {
  const api = window.viewer;
  if (connected === api) return;
  disconnect?.();
  connected = api;
  let retained = new Set<string>();
  const sync = () => {
    const wanted = new Set(
      getState().saved.workspaces.flatMap((space) =>
        space.panes.filter((pane) => pane.type === 'browser').map((pane) => pane.id),
      ),
    );
    for (const id of retained)
      if (!wanted.has(id)) void api.browser({ kind: 'close', id }).catch(report);
    retained = wanted;
  };
  sync();
  disconnect = subscribe(sync);
}
