import { useEffect, useState } from 'react';
import {
  agentCapabilities,
  type AgentClient,
  type AgentClientInput,
  type AgentAudit,
} from '../../domain/agent-clients';
import type { ApplicationSettings } from '../../domain/services';
import { AgentGrants } from './AgentGrants';
import { IconButton } from './primitives';

const descriptions = {
  metadata: [
    'Metadata and discovery',
    'Names, sizes, dates, available tools and granted workspaces.',
  ],
  content: ['Read file contents', 'Original passages, tables, image facts and inspection results.'],
  navigation: [
    'Navigate without review',
    'Open paths, select files, focus planes and change workspaces.',
  ],
  propose: ['Propose changes', 'Create review tasks and suggest configuration changes.'],
  execute: ['Unattended execution unavailable', 'Every agent command requires approval.'],
  'terminal-read': ['Read terminal output', 'Also requires a separate terminal read grant.'],
  'terminal-write': [
    'Terminal input unavailable',
    'Shell commands can permanently delete files and bypass Trash.',
  ],
} as const;
const defaults: AgentClientInput = {
  name: '',
  roots: [],
  capabilities: ['metadata', 'navigation'],
  budgets: { maxReadBytes: 4 * 1024 * 1024, maxTasks: 4 },
};

export function AgentClientSettings({ settings }: { settings: ApplicationSettings }) {
  const [clients, setClients] = useState<AgentClient[]>([]);
  const [editing, setEditing] = useState<AgentClient>();
  const [draft, setDraft] = useState<AgentClientInput>(defaults);
  const [configuration, setConfiguration] = useState('');
  const [history, setHistory] = useState<AgentAudit[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
      setError((error as Error).message);
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
  return (
    <>
      <h2>Agent clients</h2>
      <p className="settings-note">
        Each client has its own credential, folder scope and permissions. Removing access cancels
        its pending tasks. Private credentials and recovery files are excluded from file tools.
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
                  Stop tasks
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await window.viewer.agentClients({
                        kind: 'revoke',
                        id: client.id,
                        revision: client.revision,
                      });
                      if (editing?.id === client.id) edit();
                      await load();
                    })
                  }
                >
                  Revoke
                </button>
              </>
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
            <span>{root}</span>
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
            Choose folder…
          </button>
        </div>
        {agentCapabilities.map((cap) => (
          <label className="settings-row" key={cap}>
            <span>
              {descriptions[cap][0]}
              <small>{descriptions[cap][1]}</small>
            </span>
            <input
              type="checkbox"
              disabled={cap === 'execute' || cap === 'terminal-write'}
              checked={
                cap !== 'execute' && cap !== 'terminal-write' && draft.capabilities.includes(cap)
              }
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
          <input
            type="number"
            min={1}
            max={64}
            value={draft.budgets.maxReadBytes / 1048576}
            onChange={(e) =>
              setDraft({
                ...draft,
                budgets: { ...draft.budgets, maxReadBytes: Number(e.target.value) * 1048576 },
              })
            }
          />
        </label>
        <label className="settings-row">
          <span>Concurrent requests and pending recipe tasks</span>
          <input
            type="number"
            min={1}
            max={20}
            value={draft.budgets.maxTasks}
            onChange={(e) =>
              setDraft({
                ...draft,
                budgets: { ...draft.budgets, maxTasks: Number(e.target.value) },
              })
            }
          />
        </label>
        <div className="settings-actions">
          <button
            type="submit"
            disabled={
              busy ||
              !settings.agents.enabled ||
              !draft.name.trim() ||
              !draft.roots.length ||
              !draft.capabilities.length
            }
          >
            {editing ? 'Save permissions' : 'Create client'}
          </button>
          {editing && (
            <button type="button" onClick={() => edit()}>
              New client
            </button>
          )}
        </div>
      </form>
      {configuration && (
        <>
          <p className="settings-note">
            Save this configuration in your agent client. The credential is displayed once.
          </p>
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
        <details open>
          <summary>Recent activity</summary>
          <ol className="agent-activity">
            {history
              .slice(-50)
              .reverse()
              .map((entry) => (
                <li key={entry.id}>
                  <time>{new Date(entry.at).toLocaleString()}</time>
                  <span>
                    {entry.tool} · {entry.status}
                  </span>
                </li>
              ))}
          </ol>
        </details>
      )}
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
