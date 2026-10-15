import { useEffect, useState } from 'react';
import type { ExecutionGrant } from '../../domain/agent-requests';
import type { ApplicationSettings } from '../../domain/services';
export function AgentGrants({
  settings,
  clientID = 'legacy',
  roots = settings.agents.roots,
}: {
  settings: ApplicationSettings;
  clientID?: string;
  roots?: string[];
}) {
  const [grants, setGrants] = useState<ExecutionGrant[]>([]);
  const [root, setRoot] = useState(roots[0] || '');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!roots.includes(root)) setRoot(roots[0] || '');
  }, [roots, root]);
  useEffect(() => {
    void window.viewer
      .agentGrants()
      .then(setGrants)
      .catch((error: Error) => setError(error.message));
  }, []);
  const save = (id: string, capability: ExecutionGrant['capability'], allow: boolean) => {
    void window.viewer
      .agentGrant(id, root, capability, allow, clientID)
      .then(() => window.viewer.agentGrants())
      .then(setGrants)
      .catch((error: Error) => setError(error.message));
  };
  const allowed = (id: string, capability: ExecutionGrant['capability']) =>
    grants.some(
      (grant) =>
        (grant.clientID ?? 'legacy') === clientID &&
        grant.actionID === id &&
        grant.root === root &&
        grant.capability === capability,
    );
  return (
    <>
      <h2>Agent permissions</h2>
      <p className="settings-note">
        Every agent command requires approval. File removals use system Trash. Agents cannot run
        shell scripts, executables, external apps or terminal input that could permanently delete
        files.
      </p>
      <label className="settings-row settings-wide-field">
        <span>Grant for folder</span>
        <select
          value={root}
          title={root}
          disabled={!roots.length}
          onChange={(event) => setRoot(event.target.value)}
        >
          <option value="">Choose an authorized folder</option>
          {roots.map((root) => (
            <option key={root}>{root}</option>
          ))}
        </select>
      </label>
      {root && <p className="settings-field-detail">{root}</p>}
      {root && (
        <>
          <label className="settings-row">
            <span>
              Read terminal output
              <small>
                Covers terminals started in this folder, including the last 128 KB of everything
                shown there, even after changing to another folder. Separate from file and metadata
                access.
              </small>
            </span>
            <input
              type="checkbox"
              checked={allowed('*', 'terminal-read')}
              onChange={(event) => save('*', 'terminal-read', event.target.checked)}
            />
          </label>
        </>
      )}
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      {grants.some((grant) => (grant.clientID ?? 'legacy') === clientID) && (
        <details>
          <summary>Existing grants</summary>
          {grants
            .filter((grant) => (grant.clientID ?? 'legacy') === clientID)
            .map((grant) => (
              <div className="settings-grant" key={grant.id}>
                <span title={grant.root}>
                  {grant.actionID} · {grant.capability} · {grant.root}
                  {grant.capability !== 'terminal-read' &&
                    ' · Inactive; approval is required each time'}
                </span>
                <button
                  onClick={() => {
                    void window.viewer
                      .agentGrant(grant.actionID, grant.root, grant.capability, false, clientID)
                      .then(() => window.viewer.agentGrants())
                      .then(setGrants)
                      .catch((error: Error) => setError(error.message));
                  }}
                >
                  Revoke
                </button>
              </div>
            ))}
        </details>
      )}
    </>
  );
}
