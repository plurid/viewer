import { useEffect, useSyncExternalStore } from 'react';
import { Dialog } from '../ui/primitives';
import { report } from '../state/store';
import type { WorkspaceController } from '../workspace/context';
import { connectLocalServers, localServerSessions } from './runtime';

export function ServersDialog({
  workspace,
  onClose,
}: {
  workspace: WorkspaceController;
  onClose(): void;
}) {
  const sessions = localServerSessions();
  useSyncExternalStore(sessions.subscribeAll, sessions.generation);
  useEffect(() => {
    connectLocalServers();
    void sessions.load().catch(report);
  }, [sessions]);
  const servers = sessions.all();
  return (
    <Dialog title="Local servers" onClose={onClose} wide>
      <div className="dialog-copy">
        <p>Servers keep running when their planes close. Stop one here or reopen its controls.</p>
      </div>
      <div className="server-list">
        {servers.length ? (
          servers.map((server) => (
            <div className="server-list-row" key={server.id}>
              <div>
                <strong>{server.root}</strong>
                <span className="muted">{server.state === 'running' ? server.url : 'Stopped'}</span>
              </div>
              <button
                onClick={() => {
                  workspace.openServer(server.paneID);
                  onClose();
                }}
              >
                Show plane
              </button>
              <button
                disabled={server.state !== 'running'}
                onClick={() => void sessions.action(server.paneID, 'stop').catch(report)}
              >
                Stop
              </button>
            </div>
          ))
        ) : (
          <p className="muted">No local servers in this window.</p>
        )}
      </div>
    </Dialog>
  );
}
