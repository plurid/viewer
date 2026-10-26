import { useEffect, useState } from 'react';
import type { ChatPane } from '../../domain/contracts';
import type { AgentSession } from '../../domain/agents/sessions';
import { errorMessage } from '../../domain/errors';
import { sourceVersion } from '../../domain/files/inspection';
import { activeWorkspace } from '../state/store';
import { useWorkspace } from '../workspace/context';
import { Empty, Loading } from '../ui/primitives';
import './chat.css';

export default function SessionPlane({ pane }: { pane: ChatPane }) {
  const workspace = useWorkspace();
  const [session, setSession] = useState<AgentSession>();
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const read = async () => {
      try {
        const reply = await window.viewer.agentSessions({
          kind: 'read',
          id: pane.externalSessionID!,
        });
        if (live && reply.kind === 'session') {
          setSession((previous) =>
            previous &&
            previous.id === reply.session.id &&
            previous.sequence > reply.session.sequence
              ? previous
              : reply.session,
          );
          setError('');
        }
      } catch (error) {
        if (live) setError(errorMessage(error));
      }
    };
    void read();
    const stop = window.viewer.onEvent((event) => {
      if (event.type === 'agent-session' && event.id === pane.externalSessionID) void read();
    });
    return () => {
      live = false;
      stop();
    };
  }, [pane.externalSessionID]);
  if (!session)
    return error ? (
      <Empty title="Agent session unavailable" detail={error} />
    ) : (
      <Loading label="Opening agent session…" />
    );
  return (
    <section className="chat-plane" aria-label="Agent session">
      <header className="chat-toolbar">
        <strong>{session.title}</strong>
        <span>{session.clientName}</span>
      </header>
      <div className="chat-context">
        <span>{session.directory}</span>
      </div>
      <p className="session-reported-status" role="status">
        Reported {session.status} · {new Date(session.updated).toLocaleString()} · sequence{' '}
        {session.sequence}
      </p>
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      <div className="chat-transcript" role="log" aria-label="Agent transcript" tabIndex={0}>
        {session.entries.map((entry) => (
          <article className="chat-message" data-role={entry.role} key={entry.id}>
            <strong>
              {entry.role === 'user'
                ? 'You'
                : entry.role === 'tool'
                  ? 'Tool report'
                  : session.clientName}
            </strong>
            <p>{entry.text}</p>
            {!!entry.links?.length && (
              <div className="session-links">
                {entry.links.map((link, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      const owner = activeWorkspace().id;
                      setError('');
                      void (async () => {
                        if (link.kind === 'git-diff')
                          await workspace.openGitDiff(link.path, pane.id);
                        else {
                          const file = await window.viewer.stat(link.path);
                          if (
                            activeWorkspace().id !== owner ||
                            !activeWorkspace().panes.some((value) => value.id === pane.id)
                          )
                            throw new Error(
                              'The originating workspace changed. Open the reference again.',
                            );
                          workspace.open(file, pane.id, {
                            activate: true,
                            ...(link.line && !file.directory
                              ? {
                                  evidence: {
                                    path: file.path,
                                    version: sourceVersion(file),
                                    anchor: { kind: 'text', line: link.line, start: 0, end: 0 },
                                    quote: '',
                                  },
                                }
                              : {}),
                          });
                        }
                      })().catch((value) => setError(errorMessage(value)));
                    }}
                  >
                    {link.kind === 'git-diff' ? 'Current diff: ' : 'Open current file: '}
                    {link.path.split('/').at(-1)}
                    {link.line ? ':' + link.line : ''}
                  </button>
                ))}
              </div>
            )}
          </article>
        ))}
        {!session.entries.length && (
          <Empty title="No messages reported" detail="The adapter has reported status only." />
        )}
      </div>
      <footer className="session-retention">
        Read-only adapter reports. Returning here never resumes or starts an agent.
      </footer>
    </section>
  );
}
