/* THESIS: Keep one task's checkout, evidence and tools together after views close.
 * OWN-WORLD: Existing neutral Plurid Operate tool plane, flat rows, system type.
 * STORY: Name the task, link tools, inspect actual outcomes, reopen and arrange.
 * First viewport: Checkout identity, compact actions, durable tool rows and status.
 * FORM: Existing plane/dialog primitives; task-areas-v1, no new visual world.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance */
import { useEffect, useMemo, useState } from 'react';
import type { TaskPane as Record } from '../../domain/contracts';
import type { LocalServer } from '../../domain/previews/web';
import type { ReceiptSummary } from '../../domain/automation/receipts';
import { taskReference, taskReferenceKey, taskPaneTitle } from '../../domain/workspaces/tasks';
import { errorMessage } from '../../domain/errors';
import { activeWorkspace, useViewer } from '../state/store';
import { useWorkspace } from '../workspace/context';
import { ChoiceButton } from '../ui/ChoiceMenu';
import { Empty } from '../ui/primitives';
import { renameTaskArea } from './state';
import { receiptOutcome } from './ReceiptPlane';
import './tasks.css';
import { SessionsDialog } from '../chat/SessionsDialog';
import type { AgentSessionSummary } from '../../domain/agents/sessions';
const toolNames = {
  folder: 'Folder',
  note: 'Note',
  checklist: 'Checklist',
  terminal: 'Terminal',
  chat: 'Chat',
  'git-changes': 'Changes',
  server: 'Server',
  browser: 'Browser',
} as const;
export default function TaskPlane({ pane, active }: { pane: Record; active: boolean }) {
  const space = useViewer(activeWorkspace),
    workspace = useWorkspace();
  const area = space.taskAreas?.find((area) => area.id === pane.areaID);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [attaching, setAttaching] = useState(false),
    [selected, setSelected] = useState(''),
    [browser, setBrowser] = useState(false),
    [url, setURL] = useState('');
  const [conversations, setConversations] = useState(false);
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const sessionDirectory = area?.checkout.path;
  useEffect(() => {
    if (!active || !sessionDirectory) return;
    let live = true;
    const read = async () => {
      try {
        const result = await window.viewer.agentSessions({
          kind: 'list',
          directory: sessionDirectory,
        });
        if (live && result.kind === 'list') setSessions(result.sessions);
      } catch {
        /* A failed listing leaves saved links available to open. */
      }
    };
    void read();
    const stop = window.viewer.onEvent((event) => {
      if (event.type === 'agent-session') void read();
    });
    return () => {
      live = false;
      stop();
    };
  }, [active, sessionDirectory]);
  const [receipts, setReceipts] = useState<{ [id: string]: ReceiptSummary }>({}),
    [servers, setServers] = useState<LocalServer[]>([]);
  const receiptKey =
    area?.members
      .flatMap((member) =>
        member.reference.kind === 'receipt' ? [member.reference.receiptID] : [],
      )
      .join(',') ?? '';
  useEffect(() => {
    if (!active) return;
    let live = true;
    const ids = new Set(receiptKey.split(',').filter(Boolean));
    const read = async (id: string) => {
      try {
        const result = await window.viewer.receipts({ kind: 'summary', id });
        if (live && result.kind === 'summary')
          setReceipts((values) => ({ ...values, [id]: result.receipt }));
      } catch {
        /* The row stays explicitly unavailable until it is opened. */
      }
    };
    void Promise.allSettled([...ids].map(read));
    void window.viewer
      .localServers()
      .then((values) => {
        if (live) setServers(values);
      })
      .catch(() => {});
    const stop = window.viewer.onEvent((event) => {
      if (event.type === 'receipt-changed' && ids.has(event.id)) void read(event.id);
      if (event.type === 'local-servers' && live) setServers(event.servers);
    });
    return () => {
      live = false;
      stop();
    };
  }, [active, receiptKey]);
  const attachable = useMemo(
    () => space.panes.filter((value) => !!taskReference(value)),
    [space.panes],
  );
  const run = async (work: () => unknown | Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  };
  if (!area)
    return <Empty title="Task area unavailable" detail="Open Tasks to choose a saved task area." />;
  return (
    <div className="task-plane">
      <header className="task-area-summary">
        <input
          key={area.name}
          aria-label="Task name"
          defaultValue={area.name}
          maxLength={100}
          onBlur={(event) => {
            try {
              renameTaskArea(area.id, event.target.value);
            } catch (value) {
              event.target.value = area.name;
              setError(errorMessage(value));
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              event.currentTarget.value = area.name;
              event.currentTarget.blur();
            }
          }}
        />
        <p className="task-checkout-path">{area.checkout.path}</p>
        <p className="muted">
          {area.checkout.branch ?? 'Folder task'}
          {area.checkout.commit ? ' · ' + area.checkout.commit.slice(0, 12) : ''} · observed{' '}
          {new Date(area.checkout.observed).toLocaleString()}
        </p>
        <div className="task-actions">
          <button
            disabled={busy}
            onClick={() => void run(() => workspace.refreshTaskArea(area.id))}
          >
            Refresh checkout
          </button>
          <button disabled={busy} onClick={() => workspace.arrangeTaskArea(area.id)}>
            Arrange open tools
          </button>
          <button disabled={busy} onClick={() => void run(() => workspace.runTaskCommand(area.id))}>
            Run command…
          </button>
          <button disabled={busy} onClick={() => setAttaching((value) => !value)}>
            Attach open plane…
          </button>
          <button disabled={busy} onClick={() => setConversations(true)}>
            Attach conversation…
          </button>
        </div>
      </header>
      {error && (
        <p className="inline-warning" role="alert">
          {error}
        </p>
      )}
      <div className="task-body">
        <div className="task-add-tools" role="group" aria-label="Add task tool">
          {Object.entries(toolNames).map(([kind, label]) => (
            <button
              key={kind}
              disabled={busy}
              onClick={() =>
                kind === 'browser'
                  ? setBrowser((value) => !value)
                  : void run(() => workspace.addTaskTool(area.id, kind as keyof typeof toolNames))
              }
            >
              + {label}
            </button>
          ))}
        </div>
        {browser && (
          <form
            className="task-attach-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await workspace.addTaskTool(area.id, 'browser', url);
                setBrowser(false);
              });
            }}
          >
            <label>
              Web address
              <input
                aria-label="Task browser address"
                value={url}
                placeholder="https://example.com"
                onChange={(event) => setURL(event.target.value)}
                maxLength={8192}
              />
            </label>
            <button className="primary" disabled={busy || !url.trim()}>
              Open browser
            </button>
          </form>
        )}
        {attaching && (
          <form
            className="task-attach-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => {
                workspace.attachTaskPlane(area.id, selected || attachable[0]!.id);
                setAttaching(false);
              });
            }}
          >
            <ChoiceButton
              label="Open plane to attach"
              value={selected || attachable[0]?.id || ''}
              choices={attachable.map((value) => ({
                value: value.id,
                label: taskPaneTitle(value) + ' · ' + value.type,
              }))}
              onChoose={setSelected}
            />
            <button disabled={busy || !attachable.length}>Attach</button>
          </form>
        )}
        <div className="task-tool-list" role="list" aria-label="Task tools">
          {area.members.map((member) => {
            const ref = member.reference,
              key = taskReferenceKey(ref),
              live = space.panes.find(
                (value) =>
                  member.views.includes(value.id) &&
                  taskReference(value) &&
                  taskReferenceKey(taskReference(value)!) === key,
              ),
              receipt = ref.kind === 'receipt' ? receipts[ref.receiptID] : undefined,
              server =
                ref.kind === 'server'
                  ? servers.find((server) =>
                      ref.runtimeID ? server.paneID === ref.runtimeID : server.root === ref.path,
                    )
                  : undefined;
            const state =
              ref.kind === 'chat' && ref.externalSessionID
                ? (() => {
                    const session = sessions.find(
                      (session) => session.id === ref.externalSessionID,
                    );
                    return session
                      ? `Reported ${session.status} · ${new Date(session.updated).toLocaleTimeString()}`
                      : 'Open to inspect last report';
                  })()
                : ref.kind === 'receipt'
                  ? receipt
                    ? receiptOutcome(receipt)
                    : 'Open to inspect receipt'
                  : ref.kind === 'server'
                    ? (server?.state ?? 'Open to inspect server')
                    : live
                      ? 'View open'
                      : 'View closed';
            return (
              <section className="task-tool-row" role="listitem" key={member.id}>
                <div>
                  <strong>{live && live.type === 'note' ? live.title : member.title}</strong>
                  <small>
                    {ref.kind === 'browser'
                      ? live?.type === 'browser'
                        ? live.url
                        : ref.url
                      : ref.path}
                  </small>
                  <span className="task-tool-kind">
                    {ref.kind} · {state}
                  </span>
                </div>
                <button
                  aria-label={`${live ? 'Show' : 'Open'} ${live?.type === 'note' ? live.title : member.title}`}
                  disabled={busy}
                  onClick={() => void run(() => workspace.openTaskMember(area.id, member.id))}
                >
                  {live ? 'Show' : 'Open'}
                </button>
              </section>
            );
          })}
        </div>
        <p className="task-retention-note">
          Closing a plane keeps its task link. Reopening a terminal starts a shell; commands and
          agents are never replayed. Use a terminal for Codex or Claude.
        </p>
      </div>
      {conversations && <SessionsDialog area={area} onClose={() => setConversations(false)} />}
    </div>
  );
}
