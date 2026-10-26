import { effectiveWindowSettings, effectiveWindowLook } from '../state/effective-ui';
import { useTheme } from '../ui/theme';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import '@xterm/xterm/css/xterm.css';
import type { TerminalPane as Pane } from '../../domain/contracts';
import { activeWorkspace, getState, report, setActivePane, useViewer } from '../state/store';
import { useWorkspace } from '../workspace/context';
import { terminalSession, type TerminalSession } from './sessions';
import { FILE_DRAG } from '../explorer/file-drop';
import { IconButton } from '../ui/primitives';
import { usePreviewControlsSlot } from '../previews/controls';
import { searchDecorations, terminalFontOptions, terminalTheme } from './theme';
import { registerTerminalFind } from './find';
import { gitTerminalProfileID } from '../../domain/comparison/git-actions';
const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
export function TerminalPlane({ pane }: { pane: Pane }) {
  const container = useRef<HTMLDivElement>(null);
  const live = useRef<TerminalSession | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ index: number; count: number } | null>(null);
  const workspace = useWorkspace();
  const settings = useViewer((state) => state.settings.settings.terminals);
  const font = useViewer((state) => effectiveWindowSettings(state).terminalFont);
  const look = useViewer(effectiveWindowLook);
  const palette = useTheme(
    useViewer((state) => state.settings.settings),
    look,
  ).terminal;
  // Find lives in the plane's header: a row of its own wasted the plane's top, and
  // opening it grew that row and shifted the terminal. With headers off it floats over the top.
  const header = usePreviewControlsSlot(pane.id);
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
    const git = !!pane.gitAction || pane.profileID === gitTerminalProfileID;
    void terminalSession(
      request,
      settings.scrollback,
      git ? { readonly: true, processLabel: 'Git' } : undefined,
    )
      .then(async (session) => {
        if (!attached || !container.current) return;
        live.current = session;
        session.terminal.options.theme = terminalTheme(getState().saved.look);
        Object.assign(
          session.terminal.options,
          terminalFontOptions(effectiveWindowSettings(getState()).terminalFont),
        );
        session.attach(container.current);
        setReady(true);
        if (git && !session.started && !session.exited) {
          session.exited = true;
          session.terminal.options.disableStdin = true;
          session.terminal.writeln('This Git output is from a previous session.');
          session.terminal.writeln('Run a Git action from its folder to open a new result.');
        } else if (!git && !session.started && !session.exited) {
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
    const session = live.current;
    if (!session) return;
    session.terminal.options.scrollback = settings.scrollback;
    session.terminal.options.theme = terminalTheme(look, palette);
    Object.assign(session.terminal.options, terminalFontOptions(font));
    // another font or spacing changes the cells: the rows and columns follow
    session.fit.fit();
  }, [ready, settings.scrollback, look, font, palette]);
  useEffect(() => {
    const session = live.current;
    if (!session || !ready) return;
    const subscription = session.search.onDidChangeResults(({ resultIndex, resultCount }) =>
      setFound({ index: resultIndex, count: resultCount }),
    );
    return () => subscription.dispose();
  }, [ready]);
  useEffect(() => registerTerminalFind(pane.id, () => setSearchOpen(true)), [pane.id]);
  const options = () => ({ incremental: true, decorations: searchDecorations(look) });
  const closeSearch = () => {
    setSearchOpen(false);
    setFound(null);
    live.current?.search.clearDecorations();
    live.current?.terminal.focus();
  };
  const find = (
    <div className={'preview-toolbar terminal-find' + (header ? '' : ' terminal-find-floating')}>
      {searchOpen ? (
        <>
          <input
            autoFocus
            aria-label="Find in terminal"
            placeholder="Find"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (event.target.value) live.current?.search.findNext(event.target.value, options());
              else {
                setFound(null);
                live.current?.search.clearDecorations();
              }
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter' && query) {
                if (event.shiftKey) live.current?.search.findPrevious(query, options());
                else live.current?.search.findNext(query, { ...options(), incremental: false });
              }
              if (event.key === 'Escape') closeSearch();
            }}
          />
          <span className="terminal-find-count muted" aria-live="polite">
            {query && found
              ? found.count
                ? `${found.index + 1} / ${found.count}`
                : 'No matches'
              : ''}
          </span>
          <IconButton
            icon="up"
            label="Previous match"
            onClick={() => query && live.current?.search.findPrevious(query, options())}
          />
          <IconButton
            icon="down"
            label="Next match"
            onClick={() =>
              query && live.current?.search.findNext(query, { ...options(), incremental: false })
            }
          />
          <IconButton icon="close" label="Close find" onClick={closeSearch} />
        </>
      ) : (
        <IconButton icon="search" label="Find in terminal" onClick={() => setSearchOpen(true)} />
      )}
    </div>
  );
  return (
    <div
      className="terminal-plane"
      data-terminal-id={pane.id}
      // the whole plane in the terminal's own background: no frame around it, no bar below
      style={{ '--terminal-background': terminalTheme(look, palette).background } as CSSProperties}
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
      {header ? createPortal(find, header) : find}
      {error && (
        <p className="terminal-error" role="alert">
          {error}
        </p>
      )}
      <div className="terminal-container" ref={container} />
    </div>
  );
}
