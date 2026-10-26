import { useEffect, useState } from 'react';
import type { AgentSessionSummary } from '../../domain/agents/sessions';
import type { ChatSummary } from '../../domain/models/chat';
import type { TaskArea } from '../../domain/workspaces/tasks';
import { errorMessage } from '../../domain/errors';
import { Dialog, Empty } from '../ui/primitives';
import { useWorkspace } from '../workspace/context';
import { attachTaskReference } from '../tasks/state';
import { activeWorkspace } from '../state/store';

export function SessionsDialog({
  area,
  directory,
  onClose,
}: {
  area?: TaskArea;
  directory?: string;
  onClose(): void;
}) {
  const workspace = useWorkspace();
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const checkout = area?.checkout.path ?? directory;
  const includesChats = !!area;
  useEffect(() => {
    let live = true;
    const read = async () => {
      try {
        const result = await window.viewer.agentSessions({
          kind: 'list',
          directory: checkout,
        });
        if (live && result.kind === 'list') setSessions(result.sessions);
        if (includesChats) {
          const result = await window.viewer.chat({ kind: 'list' });
          if (live && Array.isArray(result)) setChats(result);
        }
      } catch (error) {
        if (live) setError(errorMessage(error));
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
  }, [checkout, includesChats]);
  const open = async (id: string, external: boolean, title: string, path: string) => {
    const owner = activeWorkspace().id;
    setBusy(true);
    setError('');
    try {
      let paneID: string;
      if (area) {
        attachTaskReference(
          area.id,
          {
            kind: 'chat',
            path,
            conversationID: id,
            ...(external ? { externalSessionID: id } : {}),
          },
          title,
        );
        const member = activeWorkspace()
          .taskAreas?.find((task) => task.id === area.id)
          ?.members.find(
            (member) =>
              member.reference.kind === 'chat' &&
              member.reference.conversationID === id &&
              !!member.reference.externalSessionID === external,
          );
        if (!member || activeWorkspace().id !== owner)
          throw new Error('The task changed. Attach the conversation again.');
        paneID = await workspace.openTaskMember(area.id, member.id);
      } else paneID = await workspace.openAgentSession(id);
      onClose();
      // Closing a modal restores its opener's focus. Frame the destination after
      // that restoration, so it cannot cancel the newly spawned plane's camera move.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (activeWorkspace().id === owner) workspace.focusPane(paneID, { activate: true });
        }),
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={area ? 'Attach conversation' : 'Agent sessions'} onClose={onClose} wide>
      <div className="session-library">
        {error && (
          <p className="chat-error" role="alert">
            {error}
          </p>
        )}
        <p className="muted">
          Sessions appear when an authenticated local adapter calls report_session. Status and
          transcript are explicit reports.
        </p>
        {!sessions.length && !chats.length && (
          <Empty
            title="No reported sessions"
            detail="Connect an agent through Settings → Agents, or create a Viewer chat from the task."
          />
        )}
        {!!sessions.length && <h3>Agent sessions</h3>}
        {sessions.map((session) => (
          <section className="task-tool-row" key={session.id}>
            <div>
              <strong>{session.title}</strong>
              <small>
                {session.clientName} · reported {session.status} ·{' '}
                {new Date(session.updated).toLocaleString()}
              </small>
              <small>{session.directory}</small>
            </div>
            <button
              disabled={busy}
              onClick={() => void open(session.id, true, session.title, session.directory)}
            >
              {area ? 'Attach' : 'Open'}
            </button>
          </section>
        ))}
        {!!chats.length && <h3>Viewer conversations</h3>}
        {chats.map((chat) => (
          <section className="task-tool-row" key={chat.id}>
            <div>
              <strong>{chat.title}</strong>
              <small>{chat.path}</small>
            </div>
            <button
              disabled={busy || !!chat.problem}
              onClick={() => void open(chat.id, false, chat.title, chat.path)}
            >
              Attach
            </button>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
