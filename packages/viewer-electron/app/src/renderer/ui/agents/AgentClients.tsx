import { useEffect, useState } from 'react';
import { useConfirmation } from '../settings/ConfirmAction';
import {
  agentCapabilities,
  clientLimitReached,
  defaultAgentReadBytes,
  maxAgentReadBytes,
} from '../../../domain/agents/clients';
import type { AgentClient, AgentClientInput, AgentAudit } from '../../../domain/agents/clients';
import type { ApplicationSettings } from '../../../domain/services';
import { AgentGrants } from './AgentGrants';
import { CopyButton, IconButton, PathField } from '../primitives';
import { Disclosure } from '../Disclosure';
import { errorMessage } from '../../../domain/errors';
import { statusLabel } from '../status-labels';
import { NumberField } from '../NumberField';

const descriptions = {
  metadata: [
    'Metadata and discovery',
    'Names, sizes, dates, available tools and granted workspaces.',
  ],
  content: ['Read file contents', 'Text, tables and image details from the files.'],
  navigation: [
    'Navigate without review',
    'Open paths, select files, focus planes and change workspaces.',
  ],
  propose: ['Propose changes', 'Prepare file changes and settings for you to review.'],
  execute: ['Run programs', 'Viewer asks you before every agent command.'],
  'terminal-read': ['Read terminal output', 'Also needs a terminal grant for the folder, below.'],
  'terminal-write': ['Type into terminals', 'Agents never type into a terminal.'],
} as const;
// Agents never run programs or type into terminals unreviewed: those two are not choices.
const choosable = agentCapabilities.filter(
  (capability) => capability !== 'execute' && capability !== 'terminal-write',
);
const defaults: AgentClientInput = {
  name: '',
  roots: [],
  // a new client reads; navigating the workspace for the person is a capability given to it
  capabilities: ['metadata'],
  budgets: { maxReadBytes: defaultAgentReadBytes, maxTasks: 4 },
};
const mebibyte = 1024 * 1024;

export function AgentClientSettings({
  settings,
  enabled,
}: {
  settings: ApplicationSettings;
  /** Agents are on: config.jsonc asks for it and the person approved it. */
  enabled: boolean;
}) {
  const [clients, setClients] = useState<AgentClient[]>([]);
  const [editing, setEditing] = useState<AgentClient>();
  const [draft, setDraft] = useState<AgentClientInput>(defaults);
  const [configuration, setConfiguration] = useState('');
  const [history, setHistory] = useState<AgentAudit[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const confirmation = useConfirmation();
  const load = async () => {
    const value = await window.viewer.agentClients({ kind: 'list' });
    setClients(value as AgentClient[]);
  };
  useEffect(() => {
    void load().catch((error: Error) => setError(error.message));
  }, []);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const edit = (client?: AgentClient) => {
    setEditing(client);
    setDraft(
      client
        ? {
            name: client.name,
            roots: client.roots,
            capabilities: client.capabilities,
            budgets: client.budgets,
          }
        : defaults,
    );
    setConfiguration('');
    setHistory([]);
  };
  const full = !editing && clientLimitReached(clients);
  // why Create Client or Save Permissions is off, so the button never just sits there
  const blocked = !enabled
    ? 'Turn on Allow local agent clients above first.'
    : full
      ? undefined
      : !draft.name.trim()
        ? `Enter a name to ${editing ? 'save' : 'create'} the client.`
        : !draft.roots.length
          ? 'Choose a folder the client may use.'
          : !draft.capabilities.length
            ? 'Turn on at least one permission.'
            : undefined;
  return (
    <>
      <h2>Agent clients</h2>
      <p className="settings-note">
        Each client has its own key, folders and permissions. Revoke stops its tasks. Agents never
        see Viewer’s keys or recovery files.
      </p>
      {clients.map((client) => (
        <div className="settings-location agent-client-row" key={client.id}>
          <span>
            <strong>{client.name}</strong>
            <small>
              {client.revoked
                ? 'Revoked'
                : client.capabilities.map((cap) => descriptions[cap][0]).join(' · ')}
            </small>
          </span>
          <div className="settings-actions">
            {!client.revoked && (
              <>
                <button disabled={busy} onClick={() => edit(client)}>
                  Permissions
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await window.viewer.agentStop(client.id);
                    })
                  }
                >
                  Stop Tasks
                </button>
                <button
                  disabled={busy}
                  className="danger"
                  onClick={() =>
                    confirmation.ask({
                      title: `Revoke the client “${client.name}”?`,
                      detail: 'Its key stops working and its tasks stop.',
                      action: 'Revoke',
                      run: () =>
                        void run(async () => {
                          await window.viewer.agentClients({
                            kind: 'revoke',
                            id: client.id,
                            revision: client.revision,
                          });
                          if (editing?.id === client.id) edit();
                          await load();
                        }),
                    })
                  }
                >
                  Revoke
                </button>
              </>
            )}
            {client.revoked && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setClients(
                      (await window.viewer.agentClients({
                        kind: 'remove',
                        id: client.id,
                        revision: client.revision,
                      })) as AgentClient[],
                    );
                    setHistory((entries) =>
                      entries.filter((entry) => entry.clientID !== client.id),
                    );
                  })
                }
              >
                Remove
              </button>
            )}
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setHistory(await window.viewer.agentAudit(client.id));
                })
              }
            >
              Activity
            </button>
          </div>
        </div>
      ))}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const reply = await window.viewer.agentClients(
              editing
                ? { kind: 'update', id: editing.id, revision: editing.revision, client: draft }
                : { kind: 'create', client: draft },
            );
            if ('token' in reply) {
              setConfiguration(reply.configuration ?? reply.token);
              setEditing(reply.client);
            } else if (!Array.isArray(reply)) setEditing(reply);
            await load();
          });
        }}
      >
        <h3>{editing ? 'Permissions for ' + editing.name : 'New client'}</h3>
        <label className="settings-row">
          <span>Name</span>
          <input
            required
            maxLength={100}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        {draft.roots.map((root) => (
          <div className="settings-location" key={root}>
            <PathField path={root} onError={(error) => setError(errorMessage(error))} />
            <IconButton
              label="Remove client folder"
              icon="close"
              onClick={() =>
                setDraft({ ...draft, roots: draft.roots.filter((value) => value !== root) })
              }
            />
          </div>
        ))}
        <div className="settings-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const root = await window.viewer.chooseFolder();
                if (root)
                  setDraft((value) => ({ ...value, roots: [...new Set([...value.roots, root])] }));
              })
            }
          >
            Choose Folder…
          </button>
        </div>
        {choosable.map((cap) => (
          <label className="settings-row" key={cap}>
            <span>
              {descriptions[cap][0]}
              <small>{descriptions[cap][1]}</small>
            </span>
            <input
              type="checkbox"
              checked={draft.capabilities.includes(cap)}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  capabilities: e.target.checked
                    ? [...draft.capabilities, cap]
                    : draft.capabilities.filter((value) => value !== cap),
                })
              }
            />
          </label>
        ))}
        <label className="settings-row">
          <span>Maximum returned content (MiB)</span>
          <NumberField
            min={1}
            max={maxAgentReadBytes / mebibyte}
            value={draft.budgets.maxReadBytes / mebibyte}
            onCommit={(mebibytes) =>
              setDraft({
                ...draft,
                budgets: { ...draft.budgets, maxReadBytes: mebibytes * mebibyte },
              })
            }
          />
        </label>
        <label className="settings-row">
          <span>Tasks at a time</span>
          <NumberField
            min={1}
            max={20}
            value={draft.budgets.maxTasks}
            onCommit={(maxTasks) =>
              setDraft({
                ...draft,
                budgets: { ...draft.budgets, maxTasks },
              })
            }
          />
        </label>
        {full && <p className="settings-note">{full}</p>}
        <div className="settings-actions">
          <button
            type="submit"
            disabled={
              busy ||
              !enabled ||
              !!full ||
              !draft.name.trim() ||
              !draft.roots.length ||
              !draft.capabilities.length
            }
          >
            {editing ? 'Save Permissions' : 'Create Client'}
          </button>
          {editing && (
            <button type="button" onClick={() => edit()}>
              New Client
            </button>
          )}
        </div>
        {!busy && blocked && <p className="settings-note">{blocked}</p>}
      </form>
      {configuration && (
        <>
          <p className="settings-note">
            Paste this into your agent app’s MCP settings. The key is shown only once.
          </p>
          <CopyButton copy={{ text: configuration }} label="Copy" appearance="text" />
          <textarea
            className="agent-configuration"
            aria-label="Client MCP configuration"
            rows={10}
            readOnly
            value={configuration}
            onFocus={(event) => event.target.select()}
          />
        </>
      )}
      {editing && !editing.revoked && (
        <AgentGrants
          key={editing.id}
          settings={settings}
          clientID={editing.id}
          roots={editing.roots}
        />
      )}
      {history.length > 0 && (
        <Disclosure variant="compact" summary="Recent activity" defaultOpen>
          <ol className="agent-activity">
            {history
              .slice(-50)
              .reverse()
              .map((entry) => (
                <li key={entry.id}>
                  <time>{new Date(entry.at).toLocaleString()}</time>
                  <span>
                    {entry.tool} · {statusLabel(entry.status)}
                    {entry.detail && entry.tool.startsWith('review:') && (
                      <small className="muted"> {entry.detail}</small>
                    )}
                  </span>
                </li>
              ))}
          </ol>
        </Disclosure>
      )}
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      {confirmation.dialog}
    </>
  );
}
