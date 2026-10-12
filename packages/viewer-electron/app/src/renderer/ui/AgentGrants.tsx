import { useEffect, useState } from 'react';
import type { ExecutionGrant } from '../../domain/agent-requests';
import type { ApplicationSettings } from '../../domain/services';
export function AgentGrants({ settings }: { settings: ApplicationSettings }) {
  const [grants, setGrants] = useState<ExecutionGrant[]>([]);
  const [root, setRoot] = useState(settings.agents.roots[0] || '');
  const [error, setError] = useState('');
  useEffect(() => {
    void window.viewer
      .agentGrants()
      .then(setGrants)
      .catch((error: Error) => setError(error.message));
  }, []);
  const save = (id: string, capability: ExecutionGrant['capability'], allow: boolean) => {
    void window.viewer
      .agentGrant(id, root, capability, allow)
      .then(() => window.viewer.agentGrants())
      .then(setGrants)
      .catch((error: Error) => setError(error.message));
  };
  const allowed = (id: string, capability: ExecutionGrant['capability']) =>
    grants.some(
      (grant) => grant.actionID === id && grant.root === root && grant.capability === capability,
    );
  return (
    <>
      <h2>Execution approvals</h2>
      <p className="settings-note">
        Agents submit actions for review by default. These optional grants are stored outside
        config.jsonc. Changing a custom command invalidates its execution grant. A working directory
        does not restrict which files a command can access.
      </p>
      <label className="settings-row">
        <span>Grant for folder</span>
        <select value={root} onChange={(event) => setRoot(event.target.value)}>
          <option value="">Choose an authorized folder</option>
          {settings.agents.roots.map((root) => (
            <option key={root}>{root}</option>
          ))}
        </select>
      </label>
      {root && (
        <>
          {settings.customActions.map((action) => (
            <label className="settings-row" key={action.id}>
              <span>Run {action.name} without review</span>
              <input
                type="checkbox"
                checked={allowed('custom.' + action.id, 'execute')}
                onChange={(event) => save('custom.' + action.id, 'execute', event.target.checked)}
              />
            </label>
          ))}
          <label className="settings-row">
            <span>
              Read terminal output<small>Separate from file and metadata access.</small>
            </span>
            <input
              type="checkbox"
              checked={allowed('*', 'terminal-read')}
              onChange={(event) => save('*', 'terminal-read', event.target.checked)}
            />
          </label>
          <label className="settings-row">
            <span>
              Write to terminals without review
              <small>Terminal input can execute shell commands.</small>
            </span>
            <input
              type="checkbox"
              checked={allowed('*', 'terminal-write')}
              onChange={(event) => save('*', 'terminal-write', event.target.checked)}
            />
          </label>
        </>
      )}
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      {grants.length > 0 && (
        <details>
          <summary>Existing grants</summary>
          {grants.map((grant) => (
            <div className="settings-folder-override" key={grant.id}>
              <span title={grant.root}>
                {grant.actionID} · {grant.capability} · {grant.root}
              </span>
              <button
                onClick={() => {
                  void window.viewer
                    .agentGrant(grant.actionID, grant.root, grant.capability, false)
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
