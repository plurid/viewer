import { useEffect, useState } from 'react';
import type {
  AgentAccessRequest,
  AgentAccessState,
  AgentCapability,
} from '../../../domain/agents/clients';
import { AgentClientSettings } from '../agents/AgentClients';
import { AgentGrants } from '../agents/AgentGrants';
import { IconButton } from '../primitives';
import type { SettingsEditor } from './editor';

/** What the shared connection may do; its navigation is always reviewed. */
const sharedCapabilities: [AgentCapability, string][] = [
  ['metadata', 'Names, sizes, dates and available tools'],
  ['content', 'Search document text and run actions that read it'],
  ['navigation', 'Propose opening folders and files, for your review'],
  ['propose', 'Propose commands and changes, for your review'],
  ['terminal-read', 'Read terminal output, where granted'],
];

/** Named agent clients, and the shared connection with its folders and MCP configuration. */
export function AgentSettings({ editor }: { editor: SettingsEditor }) {
  const { snapshot, error: setError } = editor;
  const settings = snapshot.settings;
  const [agentConfig, setAgentConfig] = useState('');
  // The switch and folders are the person's approval, kept by the desktop: config.jsonc only
  // narrows them, so what it asks for beyond them waits here (2026-10-20).
  const [access, setAccess] = useState<AgentAccessState>();
  const change = (request: AgentAccessRequest) => {
    void window.viewer
      .agentAccess(request)
      .then(setAccess)
      .catch((error: Error) => setError(error.message));
  };
  useEffect(() => {
    void window.viewer
      .agentAccess({ kind: 'state' })
      .then(setAccess)
      .catch((error: Error) => setError(error.message));
  }, [snapshot.revision, setError]);
  return (
    <>
      <label className="settings-row">
        <span>
          Allow local agent clients
          <small>Turning agents on is confirmed in a system dialog.</small>
        </span>
        <input
          type="checkbox"
          checked={!!access?.enabled}
          disabled={!access}
          onChange={(event) => change({ kind: 'enable', enabled: event.target.checked })}
        />
      </label>
      {access?.requiresReapproval && (
        <p className="settings-note" role="status">
          Agent access needs a new confirmation after this update. Turn it on to review the folders
          and capabilities in a system dialog. Connections stay paused until you approve. Your saved
          clients and credentials are kept.
        </p>
      )}
      {access?.pending.enable && (
        <p className="settings-note">
          config.jsonc turns agents on; they stay off until you allow it here.
        </p>
      )}
      <AgentClientSettings settings={settings} enabled={!!access?.enabled} />
      <details>
        <summary>Shared connection</summary>
        <p className="settings-note">
          Local MCP clients can inspect authorized folders and propose tasks. File changes require
          your review in this app.
        </p>
        <h2>Authorized folders</h2>
        {access?.roots.map((root) => (
          <div className="settings-location" key={root}>
            <span>{root}</span>
            <IconButton
              icon="close"
              label="Remove agent folder access"
              onClick={() => change({ kind: 'remove-folder', root })}
            />
          </div>
        ))}
        {access?.pending.roots.map((root) => (
          <div className="settings-location" key={root}>
            <span>
              {root}
              <small>Requested in config.jsonc</small>
            </span>
            <button onClick={() => change({ kind: 'allow', roots: [root] })}>Allow…</button>
          </div>
        ))}
        <div className="settings-actions">
          <button disabled={!access} onClick={() => change({ kind: 'add-folder' })}>
            Authorize folder…
          </button>
        </div>
        <h2>What the connection may do</h2>
        {access && !access.capabilities.length && (
          <p className="settings-note" role="status">
            The shared connection has no capabilities yet. Choose what it may do below; named
            clients keep their own capability choices.
          </p>
        )}
        {sharedCapabilities.map(([capability, label]) => (
          <label className="settings-row" key={capability}>
            <span>{label}</span>
            <input
              type="checkbox"
              checked={!!access?.capabilities.includes(capability)}
              disabled={!access}
              onChange={(event) =>
                access &&
                change({
                  kind: 'capabilities',
                  capabilities: event.target.checked
                    ? [...access.capabilities, capability]
                    : access.capabilities.filter((item) => item !== capability),
                })
              }
            />
          </label>
        ))}
        {/* a new token revokes the connection's grants: the list is read again after it */}
        <AgentGrants key={agentConfig} settings={settings} roots={access?.roots ?? []} />
        <h2>Connect a client</h2>
        <p className="settings-note">
          Keep Viewer open for proposal review. Generating a configuration makes a new token: it
          disconnects previous credentials and revokes this connection's terminal read grants.
        </p>
        <div className="settings-actions">
          <button
            disabled={!access?.enabled || !access.roots.length}
            onClick={() => {
              void window.viewer
                .agentToken()
                .then(setAgentConfig)
                .catch((error) => setError(error.message));
            }}
          >
            Generate MCP configuration
          </button>
        </div>
        {agentConfig && (
          <textarea
            className="agent-configuration"
            aria-label="MCP configuration"
            readOnly
            rows={10}
            value={agentConfig}
            onFocus={(event) => event.target.select()}
          />
        )}
      </details>
    </>
  );
}
