import { useEffect, useSyncExternalStore } from 'react';
import type { RemoteLabel, RemoteLabels } from '../../domain/files/path-label';
import type { RemoteConnectionSnapshot } from '../../domain/remote/contracts';

let labels: RemoteLabels = () => undefined;
let started = false;
const listeners = new Set<() => void>();

function receive(connections: readonly RemoteConnectionSnapshot[]) {
  const named = new Map<string, RemoteLabel>(
    connections.map((item) => [
      item.connection.id,
      { host: item.connection.host, user: item.connection.user, home: item.home },
    ]),
  );
  labels = (id) => named.get(id);
  for (const listener of listeners) listener();
}

/** Asks for the saved connections once, when a server location is first shown. */
function start() {
  if (started || typeof window.viewer?.remote !== 'function') return;
  started = true;
  window.viewer.onEvent((event) => {
    if (event.type === 'remote') receive(event.connections);
  });
  // A build without server planes refuses the request; its paths are all local.
  void window.viewer.remote({ type: 'list' }).then(
    (reply) => receive(reply.connections),
    () => {},
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A local path's label never re-renders for a server connection's news. */
const ignore = () => () => {};
const none = () => undefined;

/**
 * How a window names its server connections (`al@build`), for a label that shows a server
 * location. A window that shows only local paths never asks the desktop.
 */
export function useRemoteLabels(remote: boolean): RemoteLabels | undefined {
  useEffect(() => {
    if (remote) start();
  }, [remote]);
  return useSyncExternalStore(remote ? subscribe : ignore, remote ? () => labels : none);
}
