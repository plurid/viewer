import {
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { BrowserPane as Pane } from '../../domain/contracts';
import type { BrowserRequest, BrowserSnapshot } from '../../domain/previews/browser';
import { browserAddress } from '../../domain/previews/browser';
import { IconButton, tryAgainLabel } from '../ui/primitives';
import { measureLocalPoint, type Point } from '../ui/projectedResize';
import { activeWorkspace, getState, updatePane } from '../state/store';
import { connectLocalServers, localServerSessions } from '../local-servers/runtime';
import { browserFrames } from './frames';
import { connectBrowsers } from './runtime';
import { WorkspaceContext } from '../workspace/context';
import './browser.css';
import { errorMessage } from '../../domain/errors';

const modifiers = (event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}) =>
  (event.altKey ? 1 : 0) |
  (event.ctrlKey ? 2 : 0) |
  (event.metaKey ? 4 : 0) |
  (event.shiftKey ? 8 : 0);
export default function BrowserPlane({ pane, active }: { pane: Pane; active: boolean }) {
  const workspace = useContext(WorkspaceContext);
  const surface = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    address = useRef<HTMLInputElement>(null);
  const [snapshot, setSnapshot] = useState<BrowserSnapshot>();
  const [url, setURL] = useState(pane.url),
    [problem, setProblem] = useState('');
  const size = useRef({ width: 960, height: 640 });
  const [attempt, setAttempt] = useState(0);
  const opened = useRef(false);
  const opening = useRef<Promise<boolean> | undefined>(undefined);
  const projection = useRef<((point: Point) => Point | undefined) | undefined>(undefined);
  const composing = useRef(false);
  const click = useRef({ time: 0, x: 0, y: 0, button: -1, count: 0 });
  const sessions = localServerSessions();
  useSyncExternalStore(sessions.subscribeAll, sessions.generation);
  const serverSnapshot = pane.serverRuntimeID ? sessions.snapshot(pane.serverRuntimeID) : undefined;
  const server = serverSnapshot?.server;
  const canStartServer =
    pane.serverRuntimeID && (server || sessions.descriptor(pane.serverRuntimeID));
  const previousServer = useRef<string | undefined>(undefined);
  const command = (request: BrowserRequest) => {
    if (!opened.current) return;
    return window.viewer.browser(request).catch((error) => {
      setProblem(String(error.message || error));
    });
  };
  const action = (action: Extract<BrowserRequest, { kind: 'action' }>['action']) =>
    void command({ kind: 'action', id: pane.id, action });
  const send = (event: Extract<BrowserRequest, { kind: 'input' }>['event']) =>
    void command({ kind: 'input', id: pane.id, event });
  useEffect(() => {
    connectBrowsers();
    if (pane.serverRuntimeID) connectLocalServers();
    opened.current = false;
    let live = true;
    let updates = 0;
    const offFrame = browserFrames(pane.id, canvas.current!);
    const accept = (value: BrowserSnapshot) => {
      if (!live) return;
      const current = activeWorkspace(getState()).panes.find((item) => item.id === pane.id);
      const linkedID = current?.type === 'browser' ? current.serverRuntimeID : undefined;
      const associated = linkedID ? sessions.snapshot(linkedID).server : undefined;
      const destination = /^https?:/.test(value.url) ? new URL(value.url) : undefined;
      const local = associated && destination?.origin === new URL(associated.url).origin;
      // The guest may still report its saved address before React sees the server's new port.
      if (
        associated?.state === 'running' &&
        !local &&
        destination &&
        current?.type === 'browser' &&
        destination.origin === new URL(current.url).origin
      )
        return;
      setSnapshot(value);
      if (!value.error && !value.loading) setProblem('');
      if (!destination) return;
      setURL(value.url);
      if (
        current?.type === 'browser' &&
        (current.url !== value.url || current.title !== value.title)
      ) {
        updatePane(pane.id, {
          url: value.url,
          title: value.title.slice(0, 1000),
          ...(associated
            ? local
              ? {
                  serverPath: destination.pathname + destination.search + destination.hash,
                }
              : { serverRuntimeID: undefined, serverPath: undefined }
            : {}),
        });
      }
    };
    const off = window.viewer.onEvent((event) => {
      if (event.type !== 'browser' || event.browser.id !== pane.id) return;
      updates += 1;
      accept(event.browser);
    });
    const acquiring = window.viewer
      .browser({ kind: 'open', id: pane.id, url: pane.url, ...size.current })
      .then(
        (value) => {
          // Loading/title events may arrive before this initial IPC reply.
          if (live) {
            opened.current = true;
            if (value && updates === 0) accept(value);
          }
          return true;
        },
        (error) => {
          if (live) setProblem(errorMessage(error));
          return false;
        },
      );
    opening.current = acquiring;
    return () => {
      live = false;
      off();
      offFrame();
      void acquiring.then((ok) => {
        if (ok && opening.current === acquiring && !opened.current)
          return window.viewer
            .browser({ kind: 'viewport', id: pane.id, ...size.current, visible: false })
            .catch(() => {});
      });
      opened.current = false;
    };
    // A saved URL is a navigation result, never a request to recreate this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id, attempt]);
  useEffect(() => {
    const element = surface.current!;
    let live = true;
    const observer = new ResizeObserver(() => {
      size.current = {
        width: Math.max(160, Math.min(2048, Math.round(element.clientWidth))),
        height: Math.max(160, Math.min(2048, Math.round(element.clientHeight))),
      };
      projection.current = undefined;
      void opening.current?.then(() => {
        if (live && opened.current)
          return command({ kind: 'viewport', id: pane.id, ...size.current, visible: active });
      });
    });
    observer.observe(element);
    void opening.current?.then(() => {
      if (live && opened.current)
        return command({ kind: 'viewport', id: pane.id, ...size.current, visible: active });
    });
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [pane.id, active, attempt]);
  useEffect(() => {
    const previous = previousServer.current;
    previousServer.current = server?.state ?? 'stopped';
    if (!server || server.state !== 'running') return;
    const destination = new URL(pane.serverPath || '/', server.url).href;
    if (destination !== pane.url || (previous && previous !== 'running')) {
      let live = true;
      void opening.current?.then((ok) => {
        if (live && ok) return command({ kind: 'navigate', id: pane.id, url: destination });
      });
      return () => {
        live = false;
      };
    }
    // only a server's start or move navigates; the page's own navigation changes `pane.url`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server?.url, server?.state, attempt]);
  const local = (event: { clientX: number; clientY: number }) => {
    projection.current ??= measureLocalPoint(surface.current!);
    const point = projection.current({ x: event.clientX, y: event.clientY });
    if (!point) return { x: 0, y: 0 };
    return {
      x: (point.x * size.current.width) / surface.current!.clientWidth,
      y: (point.y * size.current.height) / surface.current!.clientHeight,
    };
  };
  const wheel = useEffectEvent((event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    projection.current = undefined;
    send({
      type: 'mouseWheel',
      ...local(event),
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      modifiers: modifiers(event),
    });
  });
  useEffect(() => {
    // Plurid gives a clicked plane the wheel by stopping it at its view, before React's root
    // listener sees it, so the surface listens itself; not passively, to cancel its default.
    const element = surface.current!;
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  return (
    <section className="browser-plane" aria-label="Browser">
      <form
        className="browser-navigation"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            if (!opened.current) return;
            const destination = browserAddress(url);
            setProblem('');
            void command({ kind: 'navigate', id: pane.id, url: destination });
          } catch (error) {
            setProblem(String(errorMessage(error)));
          }
        }}
      >
        <IconButton
          icon="left"
          label="Back"
          disabled={!snapshot?.back}
          onClick={() => action('back')}
        />
        <IconButton
          icon="right"
          label="Forward"
          disabled={!snapshot?.forward}
          onClick={() => action('forward')}
        />
        <IconButton
          icon={snapshot?.loading ? 'close' : 'refresh'}
          label={snapshot?.loading ? 'Stop loading' : 'Reload page'}
          onClick={() => action(snapshot?.loading ? 'stop' : 'reload')}
        />
        <input
          ref={address}
          aria-label="Web address"
          placeholder="Enter a web address"
          value={url}
          onChange={(event) => setURL(event.target.value)}
          onFocus={(event) => event.target.select()}
        />
        <button type="submit">Go</button>
        <IconButton
          icon="external"
          label="Open in default browser"
          onClick={() => action('external')}
        />
      </form>
      {pane.serverRuntimeID && server?.state !== 'running' && (
        <div className="browser-error" role="status">
          <span>
            {canStartServer
              ? 'The local server is stopped.'
              : 'Open the server folder and choose Start Local Server.'}
          </span>
          {canStartServer && (
            <button
              disabled={!!serverSnapshot?.pending}
              onClick={() => {
                void sessions
                  .start(pane.serverRuntimeID!)
                  .catch((error) => setProblem(String(error.message || error)));
              }}
            >
              Start Server
            </button>
          )}
          {canStartServer && workspace && (
            <button onClick={() => workspace.openServer(pane.serverRuntimeID!)}>
              Server Details
            </button>
          )}
        </div>
      )}
      {(problem || snapshot?.error) && (
        <div className="browser-error" role="alert">
          {problem || snapshot?.error}{' '}
          <button
            onClick={() => {
              setProblem('');
              if (opened.current) action('reload');
              else setAttempt((value) => value + 1);
            }}
          >
            {tryAgainLabel}
          </button>
        </div>
      )}
      <div
        ref={surface}
        className="browser-surface"
        onPointerEnter={() => {
          projection.current = undefined;
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          projection.current = measureLocalPoint(surface.current!);
          const point = local(event);
          const last = click.current;
          click.current = {
            time: event.timeStamp,
            ...point,
            button: event.button,
            count:
              last.button === event.button &&
              event.timeStamp - last.time < 500 &&
              Math.hypot(point.x - last.x, point.y - last.y) < 5
                ? (last.count % 3) + 1
                : 1,
          };
          input.current!.style.left = `${point.x}px`;
          input.current!.style.top = `${point.y}px`;
          input.current!.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          send({
            type: 'mousePressed',
            ...point,
            button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left',
            buttons: event.buttons,
            clickCount: click.current.count,
            modifiers: modifiers(event),
          });
        }}
        onPointerMove={(event) => {
          event.stopPropagation();
          send({
            type: 'mouseMoved',
            ...local(event),
            button: 'none',
            buttons: event.buttons,
            clickCount: 0,
            modifiers: modifiers(event),
          });
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
          send({
            type: 'mouseReleased',
            ...local(event),
            button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left',
            buttons: event.buttons,
            clickCount: click.current.count || 1,
            modifiers: modifiers(event),
          });
        }}
        onPointerCancel={(event) =>
          send({
            type: 'mouseReleased',
            ...local(event),
            button: 'left',
            buttons: 0,
            clickCount: 1,
            modifiers: modifiers(event),
          })
        }
        onContextMenu={(event) => event.preventDefault()}
      >
        <canvas ref={canvas} aria-label={snapshot?.title || 'Web page'} />
        <textarea
          ref={input}
          className="browser-input"
          aria-label="Web page keyboard input"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(event) => {
            const key = event.key.toLowerCase(),
              modified = event.metaKey || event.ctrlKey;
            if (modified && ['w', 'q', 'h'].includes(key)) return;
            event.stopPropagation();
            if (modified && key === 'l') {
              event.preventDefault();
              address.current?.focus();
              return;
            }
            const shortcuts: Record<string, Extract<BrowserRequest, { kind: 'action' }>['action']> =
              {
                c: 'copy',
                v: 'paste',
                x: 'cut',
                a: 'select-all',
                r: 'reload',
                '+': 'zoom-in',
                '=': 'zoom-in',
                '-': 'zoom-out',
                '0': 'zoom-reset',
              };
            if (modified && shortcuts[key]) {
              event.preventDefault();
              action(shortcuts[key]);
              return;
            }
            if (event.nativeEvent.isComposing || composing.current) return;
            send({
              type: 'keyDown',
              key: event.key,
              code: event.code,
              windowsVirtualKeyCode: event.keyCode,
              modifiers: modifiers(event),
            });
            if (event.key.length > 1 || modified || event.key === ' ') event.preventDefault();
            if (event.key === ' ') send({ type: 'text', text: ' ' });
          }}
          onKeyUp={(event) => {
            event.stopPropagation();
            if (!composing.current)
              send({
                type: 'keyUp',
                key: event.key,
                code: event.code,
                windowsVirtualKeyCode: event.keyCode,
                modifiers: modifiers(event),
              });
          }}
          onInput={(event) => {
            if (!composing.current && event.currentTarget.value) {
              send({ type: 'text', text: event.currentTarget.value });
              event.currentTarget.value = '';
            }
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionUpdate={(event) =>
            send({
              type: 'composition',
              text: event.data,
              selectionStart: event.data.length,
              selectionEnd: event.data.length,
            })
          }
          onCompositionEnd={(event) => {
            composing.current = false;
            send({ type: 'composition', text: '', selectionStart: 0, selectionEnd: 0 });
            if (event.data) send({ type: 'text', text: event.data });
            event.currentTarget.value = '';
          }}
        />
      </div>
      <footer className="browser-status">
        <span>{snapshot?.loading ? 'Loading…' : snapshot?.title || 'Browser'}</span>
        <button disabled={!snapshot?.url} onClick={() => action('native-window')}>
          Open Page in Window
        </button>
        <button
          className="readout"
          aria-label="Actual size"
          title="Actual size"
          onClick={() => action('zoom-reset')}
        >
          {Math.round((snapshot?.zoom ?? 1) * 100)}%
        </button>
      </footer>
    </section>
  );
}
