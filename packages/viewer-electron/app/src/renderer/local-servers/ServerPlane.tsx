import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ServerPane as Pane } from '../../domain/contracts';
import type { LocalServerAction } from '../../domain/previews/web';
import { formatBytes } from '../../domain/files/entries';
import { IconButton } from '../ui/primitives';
import { ChoiceButton } from '../ui/ChoiceMenu';
import { connectLocalServers, localServerSessions } from './runtime';
import { filterServerLogs, type LogStatus } from './logs';
import './server-plane.css';
import { useWorkspace } from '../workspace/context';

const timestamp = (value: number) => new Date(value).toLocaleTimeString();

/** The log view can unmount while its native server keeps running for the owning pane. */
export default function ServerPlane({ pane, active }: { pane: Pane; active: boolean }) {
  const workspace = useWorkspace();
  const sessions = localServerSessions();
  const subscribe = useCallback(
    (listener: () => void) => sessions.subscribe(pane.id, listener),
    [sessions, pane.id],
  );
  const read = useCallback(() => sessions.snapshot(pane.id), [sessions, pane.id]);
  const snapshot = useSyncExternalStore(subscribe, read);
  const [follow, setFollow] = useState(true);
  const [query, setQuery] = useState('');
  const [method, setMethod] = useState('all');
  const [status, setStatus] = useState<LogStatus>('all');
  const logViewport = useRef<HTMLDivElement>(null);
  const server = snapshot.server;
  const running = server?.state === 'running';
  const busy = snapshot.pending !== null;
  const methods = useMemo(
    () =>
      [
        ...new Set([
          ...snapshot.logs.map((log) => log.method),
          ...(method === 'all' ? [] : [method]),
        ]),
      ].sort(),
    [snapshot.logs, method],
  );
  const logs = useMemo(
    () => filterServerLogs(snapshot.logs, query, method, status),
    [snapshot.logs, query, method, status],
  );

  useEffect(() => connectLocalServers(), []);
  useEffect(() => {
    if (!active) return;
    const refresh = () => {
      void sessions.refresh(pane.id).catch(() => {
        // The stable session snapshot presents refresh errors without discarding logs.
      });
    };
    refresh();
    if (!follow || !running) return;
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [active, follow, running, server?.id, sessions, pane.id]);
  useEffect(() => {
    const viewport = logViewport.current;
    if (active && follow && viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [active, follow, logs]);

  const run = (action: Exclude<LocalServerAction, 'close'> | 'start') => {
    const work = action === 'start' ? sessions.start(pane.id) : sessions.action(pane.id, action);
    void work.catch(() => {
      // Start/action errors belong to this plane and remain visible until the next action.
    });
  };

  return (
    <section className="server-plane" aria-label="Local server">
      <div className="server-summary">
        <span className="server-state" data-state={running ? 'running' : 'stopped'} role="status">
          {snapshot.pending === 'start'
            ? 'Starting…'
            : snapshot.pending === 'stop'
              ? 'Stopping…'
              : snapshot.pending === 'restart'
                ? 'Restarting…'
                : running
                  ? 'Running'
                  : 'Stopped'}
        </span>
        <span className="server-folder" title={pane.path}>
          {pane.path}
        </span>
        {running ? (
          <button type="button" disabled={busy} onClick={() => run('stop')}>
            Stop
          </button>
        ) : (
          <button type="button" className="primary" disabled={busy} onClick={() => run('start')}>
            Start
          </button>
        )}
        <IconButton
          icon="refresh"
          label="Restart server"
          disabled={busy || !server}
          onClick={() => run('restart')}
        />
      </div>
      <div className="server-address">
        <label htmlFor={`server-url-${pane.id}`}>Address</label>
        <input
          id={`server-url-${pane.id}`}
          aria-label="Server URL"
          value={server?.url ?? ''}
          placeholder="Start to get a local address"
          readOnly
          onFocus={(event) => event.currentTarget.select()}
        />
        <IconButton
          icon="copy"
          label="Copy server URL"
          disabled={!running || busy}
          onClick={() => run('copy-url')}
        />
        <IconButton
          icon="external"
          label="Open server in browser"
          disabled={!running || busy}
          onClick={() => run('open-browser')}
        />
        <button
          disabled={!running || busy}
          onClick={() =>
            server && workspace.openBrowser(server.url, pane.id, pane.runtimeID ?? pane.id)
          }
        >
          Open in Viewer
        </button>
      </div>
      {snapshot.error && (
        <p className="server-error" role="alert">
          {snapshot.error}
        </p>
      )}
      <div className="server-log-controls">
        <strong>Requests</strong>
        <input
          type="search"
          aria-label="Filter server requests"
          placeholder="Filter requests"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ChoiceButton
          label="Request method"
          value={method}
          choices={[
            { value: 'all', label: 'All methods' },
            ...methods.map((value) => ({ value, label: value })),
          ]}
          onChoose={setMethod}
        />
        <ChoiceButton
          label="Request status"
          value={status}
          choices={[
            { value: 'all', label: 'All statuses' },
            { value: 'success', label: '2xx · Success' },
            { value: 'redirect', label: '3xx · Redirect' },
            { value: 'client-error', label: '4xx · Client error' },
            { value: 'server-error', label: '5xx · Server error' },
          ]}
          onChoose={(value) => setStatus(value as LogStatus)}
        />
        <label className="server-follow">
          <input
            type="checkbox"
            checked={follow}
            onChange={(event) => setFollow(event.target.checked)}
          />
          Auto-follow
        </label>
        <IconButton
          icon="refresh"
          label="Refresh request log"
          disabled={snapshot.refreshing || busy}
          onClick={() => {
            void sessions.refresh(pane.id).catch(() => {});
          }}
        />
        <IconButton
          icon="trash"
          label="Clear request log"
          disabled={!server || busy || !snapshot.logs.length}
          onClick={() => run('clear-log')}
        />
      </div>
      <div
        className="server-log-viewport"
        ref={logViewport}
        tabIndex={0}
        aria-label="Server request log"
        onScroll={(event) => {
          const element = event.currentTarget;
          if (follow && element.scrollHeight - element.scrollTop - element.clientHeight > 12)
            setFollow(false);
        }}
      >
        {logs.length ? (
          <table className="server-log">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Method</th>
                <th scope="col">Path</th>
                <th scope="col">Status</th>
                <th scope="col">Duration</th>
                <th scope="col">Size</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.sequence} data-failed={log.status >= 400 || !!log.error}>
                  <td>{timestamp(log.timestamp)}</td>
                  <td>{log.method}</td>
                  <td
                    className="server-log-path"
                    title={log.error ? `${log.path}\n${log.error}` : log.path}
                  >
                    <span>{log.path}</span>
                    {log.error && <small>{log.error}</small>}
                  </td>
                  <td>{log.status || 'Error'}</td>
                  <td>{log.durationMs.toFixed(1)} ms</td>
                  <td>{formatBytes(log.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="server-log-empty">
            {snapshot.logs.length
              ? 'No requests match these filters.'
              : running
                ? 'Open the address to see incoming requests.'
                : 'Start the server to serve this folder.'}
          </div>
        )}
      </div>
      <footer className="server-log-footer">
        <span>
          {logs.length} of {snapshot.logs.length} requests
        </span>
        <span>Last 200 · Memory only · Paths exclude queries</span>
      </footer>
    </section>
  );
}
