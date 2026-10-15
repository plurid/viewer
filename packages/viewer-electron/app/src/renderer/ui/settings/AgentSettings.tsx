import { useState } from 'react';
import { AgentClientSettings } from '../AgentClients';
import { AgentGrants } from '../AgentGrants';
import { IconButton } from '../primitives';
import type { SettingsEditor } from './editor';

/** Named agent clients, and the shared connection with its folders and MCP configuration. */
export function AgentSettings({ editor }: { editor: SettingsEditor }) {
  const { snapshot, patch, error: setError } = editor;
  const settings = snapshot.settings;
  const [agentConfig, setAgentConfig] = useState('');
  return (
    <>
      <AgentClientSettings settings={settings} />
      <details>
        <summary>Shared connection</summary>
        <p className="settings-note">
          Local MCP clients can inspect authorized folders and propose tasks. File changes require
          your review in this app.
        </p>
        <h2>Authorized folders</h2>
        {settings.agents.roots.map((root) => (
          <div className="settings-location" key={root}>
            <span>{root}</span>
            <IconButton
              icon="close"
              label="Remove agent folder access"
              onClick={() =>
                patch(
                  'settings.agents.roots',
                  settings.agents.roots.filter((item) => item !== root),
                )
              }
            />
          </div>
        ))}
        <div className="settings-actions">
          <button
            onClick={() => {
              void window.viewer
                .chooseFolder()
                .then((root) => {
                  if (root && !settings.agents.roots.includes(root))
                    patch('settings.agents.roots', [...settings.agents.roots, root]);
                })
                .catch((error) => setError(error.message));
            }}
          >
            Authorize folder…
          </button>
        </div>
        <AgentGrants settings={settings} />
        <h2>Connect a client</h2>
        <p className="settings-note">
          Keep Viewer open for proposal review. Regenerating the token disconnects previous
          credentials.
        </p>
        <div className="settings-actions">
          <button
            disabled={!settings.agents.enabled || !settings.agents.roots.length}
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
