import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { BrowserPane as Pane } from '../../domain/contracts';
import type { BrowserRequest, BrowserSnapshot } from '../../domain/previews/browser';
import { browserAddress } from '../../domain/previews/browser';
import { IconButton } from '../ui/primitives';
import { measureLocalPoint, type Point } from '../ui/projectedResize';
import { activeWorkspace, getState, updatePane } from '../state/store';
import { localServerSessions } from '../local-servers/runtime';
import { browserFrames } from './frames';
import { connectBrowsers } from './runtime';
import './browser.css';

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
  const surface = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    address = useRef<HTMLInputElement>(null);
  const [snapshot, setSnapshot] = useState<BrowserSnapshot>();
  const [url, setURL] = useState(pane.url),
    [problem, setProblem] = useState('');
  const size = useRef({ width: 960, height: 640 });
  const opening = useRef<Promise<unknown> | undefined>(undefined);
  const projection = useRef<((point: Point) => Point | undefined) | undefined>(undefined);
  const composing = useRef(false);
  const click = useRef({ time: 0, x: 0, y: 0, button: -1, count: 0 });
  const sessions = localServerSessions();
  useSyncExternalStore(sessions.subscribeAll, sessions.generation);
  const server = pane.serverRuntimeID ? sessions.snapshot(pane.serverRuntimeID).server : undefined;
  const command = (request: BrowserRequest) =>
    window.viewer.browser(request).catch((error) => {
      setProblem(String(error.message || error));
    });
  const action = (action: Extract<BrowserRequest, { kind: 'action' }>['action']) =>
    void command({ kind: 'action', id: pane.id, action });
  const send = (event: Extract<BrowserRequest, { kind: 'input' }>['event']) =>
    void command({ kind: 'input', id: pane.id, event });
  useEffect(() => {
    connectBrowsers();
    const offFrame = browserFrames(pane.id, canvas.current!);
    const off = window.viewer.onEvent((event) => {
      if (event.type !== 'browser' || event.browser.id !== pane.id) return;
      const value = event.browser;
      setSnapshot(value);
      if (!/^https?:/.test(value.url)) return;
      setURL(value.url);
      const current = activeWorkspace(getState()).panes.find((item) => item.id === pane.id);
      if (
        current?.type === 'browser' &&
        (current.url !== value.url || current.title !== value.title)
      ) {
        const associated =
          current.serverRuntimeID && sessions.snapshot(current.serverRuntimeID).server;
        const local = associated && new URL(value.url).origin === new URL(associated.url).origin;
        updatePane(pane.id, {
          url: value.url,
          title: value.title.slice(0, 1000),
          ...(associated
            ? local
              ? {
                  serverPath:
                    new URL(value.url).pathname +
                    new URL(value.url).search +
                    new URL(value.url).hash,
                }
              : { serverRuntimeID: undefined, serverPath: undefined }
            : {}),
        });
      }
    });
    opening.current = command({ kind: 'open', id: pane.id, url: pane.url, ...size.current }).then(
      (value) => {
        if (value) setSnapshot(value);
      },
    );
    return () => {
      off();
      offFrame();
      void command({ kind: 'viewport', id: pane.id, ...size.current, visible: false });
    };
    // A saved URL is a navigation result, never a request to recreate this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id]);
  useEffect(() => {
    const element = surface.current!;
    const observer = new ResizeObserver(() => {
      size.current = {
        width: Math.max(160, Math.min(2048, Math.round(element.clientWidth))),
        height: Math.max(160, Math.min(2048, Math.round(element.clientHeight))),
      };
      projection.current = undefined;
      void opening.current?.then(() =>
        command({ kind: 'viewport', id: pane.id, ...size.current, visible: active }),
      );
    });
    observer.observe(element);
    void opening.current?.then(() =>
      command({ kind: 'viewport', id: pane.id, ...size.current, visible: active }),
    );
    return () => observer.disconnect();
  }, [pane.id, active]);
  useEffect(() => {
    if (!server || server.state !== 'running') return;
    const destination = new URL(pane.serverPath || '/', server.url).href;
    if (destination !== pane.url)
      void opening.current?.then(() =>
        command({ kind: 'navigate', id: pane.id, url: destination }),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server?.url, server?.state]);
  const local = (event: { clientX: number; clientY: number }) => {
    projection.current ??= measureLocalPoint(surface.current!);
    const point = projection.current({ x: event.clientX, y: event.clientY });
    if (!point) return { x: 0, y: 0 };
    return {
      x: (point.x * size.current.width) / surface.current!.clientWidth,
      y: (point.y * size.current.height) / surface.current!.clientHeight,
    };
  };
  return (
    <section className="browser-plane" aria-label="Browser">
      <form
        className="browser-navigation"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const destination = browserAddress(url);
            setProblem('');
            void command({ kind: 'navigate', id: pane.id, url: destination });
          } catch (error) {
            setProblem(String((error as Error).message));
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
      {(problem || snapshot?.error) && (
        <div className="browser-error" role="alert">
          {problem || snapshot?.error}{' '}
          <button
            onClick={() => {
              setProblem('');
              action('reload');
            }}
          >
            Retry
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
        onWheel={(event) => {
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
        }}
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
        <button onClick={() => action('zoom-reset')}>
          {Math.round((snapshot?.zoom ?? 1) * 100)}%
        </button>
      </footer>
    </section>
  );
}
