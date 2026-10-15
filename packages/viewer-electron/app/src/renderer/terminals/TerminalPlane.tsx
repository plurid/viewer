import { useEffect, useRef, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import type { TerminalPane as Pane } from '../../domain/contracts';
import { activeWorkspace, getState, report, setActivePane, useViewer } from '../state/store';
import { useWorkspace } from '../workspace/context';
import { terminalSession, type TerminalSession } from './sessions';
import { FILE_DRAG } from '../explorer/file-drop';
import { IconButton } from '../ui/primitives';
import { terminalTheme } from './theme';
const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
export function TerminalPlane({ pane }: { pane: Pane }) {
  const container = useRef<HTMLDivElement>(null);
  const live = useRef<TerminalSession | undefined>(undefined);
  const [error, setError] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const workspace = useWorkspace();
  const settings = useViewer((state) => state.settings.settings.terminals);
  const look = useViewer((state) => state.saved.look);
  useEffect(() => {
    let attached = true;
    let observer: ResizeObserver | undefined;
    const request = {
      id: pane.id,
      workspaceID: activeWorkspace().id,
      rootID: workspace.rootID(pane.id) || pane.id,
      cwd: pane.path,
      profileID: pane.profileID,
      cols: 80,
      rows: 24,
    };
    void terminalSession(request, settings.scrollback)
      .then(async (session) => {
        if (!attached || !container.current) return;
        live.current = session;
        session.terminal.options.theme = terminalTheme(getState().saved.look);
        session.attach(container.current);
        if (!session.started && !session.exited) {
          session.starting ??= window.viewer
            .terminalStart({ ...request, cols: session.terminal.cols, rows: session.terminal.rows })
            .then(async () => {
              if (session.disposed) {
                await window.viewer.terminalClose(request.id);
                return;
              }
              session.started = true;
              if (session.input) {
                const data = session.input;
                session.input = '';
                await window.viewer.terminalWrite(request.id, data);
              }
              await window.viewer.terminalResize(
                request.id,
                session.terminal.cols,
                session.terminal.rows,
              );
            });
          await session.starting;
        }
        if (!attached || !container.current) return;
        let width = container.current.clientWidth,
          height = container.current.clientHeight;
        observer = new ResizeObserver(() => {
          const element = container.current;
          if (!element || (width === element.clientWidth && height === element.clientHeight))
            return;
          width = element.clientWidth;
          height = element.clientHeight;
          session.fit.fit();
        });
        observer.observe(container.current);
        if (getState().activePane === pane.id) session.terminal.focus();
      })
      .catch((error: Error) => setError(error.message));
    return () => {
      attached = false;
      observer?.disconnect();
      live.current?.element.remove();
      live.current = undefined;
    };
    // One PTY session per plane: its profile and folder are captured at creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id]);
  useEffect(() => {
    if (live.current) {
      live.current.terminal.options.scrollback = settings.scrollback;
      live.current.terminal.options.theme = terminalTheme(look);
    }
  }, [settings.scrollback, look]);
  return (
    <div
      className="terminal-plane"
      data-terminal-id={pane.id}
      onPointerDownCapture={() => setActivePane(pane.id)}
      onKeyDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(FILE_DRAG)) {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          const paths: unknown = JSON.parse(event.dataTransfer.getData(FILE_DRAG));
          if (
            Array.isArray(paths) &&
            paths.length <= 2000 &&
            paths.every((path) => typeof path === 'string' && !path.includes('\0'))
          )
            live.current?.terminal.paste(paths.map(quote).join(' '));
        } catch (error) {
          report(error);
        }
      }}
    >
      <div className="terminal-search-control">
        <IconButton
          icon="search"
          label="Search terminal output"
          onClick={() => setSearchOpen((value) => !value)}
        />
        {searchOpen && (
          <input
            autoFocus
            aria-label="Search terminal output"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              live.current?.search.findNext(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') live.current?.search.findNext(query);
              if (event.key === 'Escape') {
                setSearchOpen(false);
                live.current?.terminal.focus();
              }
            }}
          />
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="terminal-container" ref={container} />
    </div>
  );
}
