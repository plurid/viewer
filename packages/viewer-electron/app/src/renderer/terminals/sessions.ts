import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { SearchAddon } from '@xterm/addon-search';
import type { TerminalStart } from '../../domain/automation';
import { report } from '../state/store';
import { terminalTheme } from './theme';
export interface TerminalSession {
  terminal: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  element: HTMLDivElement;
  started: boolean;
  starting?: Promise<void>;
  input: string;
  disposed: boolean;
  exited: boolean;
  attach(container: HTMLElement): void;
}
const sessions = new Map<string, Promise<TerminalSession>>();
/** Terminals revealed by an agent's navigation wait for the person to start a shell. */
const deferred = new Set<string>();
export function deferTerminalStart(ids: Iterable<string>): void {
  for (const id of ids) if (!sessions.has(id)) deferred.add(id);
}
export const terminalStartDeferred = (id: string) => deferred.has(id);
export function allowTerminalStart(id: string): void {
  deferred.delete(id);
}
let subscribed = false;
function subscribe(): void {
  if (subscribed) return;
  subscribed = true;
  window.viewer.onEvent((event) => {
    if (event.type !== 'terminal') return;
    const value = event.event;
    const pending = sessions.get(value.id);
    if (!pending) {
      if (value.type === 'data')
        void window.viewer.terminalAck(value.id, value.data.length).catch(() => {});
      return;
    }
    void pending.then((session) => {
      if (value.type === 'data')
        session.terminal.write(value.data, () => {
          void window.viewer.terminalAck(value.id, value.data.length).catch(() => {});
        });
      else {
        session.exited = true;
        session.terminal.writeln(
          '\r\n' +
            (value.type === 'error'
              ? value.message
              : `Shell exited (${value.code}). Close this plane to finish.`),
        );
      }
    });
  });
}
export function terminalSession(
  request: TerminalStart,
  scrollback: number,
): Promise<TerminalSession> {
  subscribe();
  let value = sessions.get(request.id);
  if (!value) {
    value = (async () => {
      const [{ Terminal }, { FitAddon }, { SearchAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-search'),
      ]);
      const terminal = new Terminal({
        scrollback,
        fontFamily: 'Menlo, Monaco, monospace',
        fontSize: 13,
        // Find highlights its matches with decorations, a proposed API
        allowProposedApi: true,
        cursorBlink: true,
        convertEol: false,
        theme: terminalTheme('dark'),
      });
      const fit = new FitAddon();
      const search = new SearchAddon();
      terminal.loadAddon(fit);
      terminal.loadAddon(search);
      const element = document.createElement('div');
      element.className = 'terminal-emulator';
      let opened = false;
      const session: TerminalSession = {
        terminal,
        fit,
        search,
        element,
        started: false,
        input: '',
        disposed: false,
        exited: false,
        attach(container) {
          container.append(element);
          if (!opened) {
            terminal.open(element);
            opened = true;
          }
          fit.fit();
        },
      };
      terminal.attachCustomKeyEventHandler((event) => {
        if (event.metaKey && event.key.toLowerCase() === 'c') {
          if (event.type === 'keydown' && terminal.hasSelection())
            void navigator.clipboard.writeText(terminal.getSelection()).catch(report);
          return false;
        }
        if (event.metaKey && event.key.toLowerCase() === 'v') {
          if (event.type === 'keydown')
            void navigator.clipboard
              .readText()
              .then((text) => terminal.paste(text))
              .catch(report);
          return false;
        }
        // ⌘K, ⌘, and ⌘F (the terminal's Find) are Viewer's, not the shell's
        if (event.metaKey && ['k', ',', 'f'].includes(event.key.toLowerCase())) return false;
        return true;
      });
      terminal.onData((data) => {
        if (!session.started && !session.exited && !session.disposed)
          session.input = (session.input + data).slice(-64 * 1024);
        if (session.started && !session.exited)
          void window.viewer.terminalWrite(request.id, data).catch(report);
      });
      terminal.onResize(({ cols, rows }) => {
        if (session.started && !session.exited)
          void window.viewer.terminalResize(request.id, cols, rows).catch(report);
      });
      return session;
    })();
    sessions.set(request.id, value);
  }
  return value;
}
export function trimTerminals(ids: ReadonlySet<string>): void {
  for (const [id, session] of sessions)
    if (!ids.has(id)) {
      sessions.delete(id);
      void session.then((session) => {
        session.disposed = true;
        session.terminal.dispose();
      });
      void window.viewer.terminalClose(id).catch(() => {});
    }
}
export async function terminalEditing(id: string, command: string): Promise<boolean> {
  const pending = sessions.get(id);
  if (!pending || !['copy', 'cut', 'paste', 'select-all'].includes(command)) return false;
  const session = await pending;
  if (command === 'paste') session.terminal.paste(await navigator.clipboard.readText());
  else if (command === 'select-all') session.terminal.selectAll();
  else if (session.terminal.hasSelection())
    await navigator.clipboard.writeText(session.terminal.getSelection());
  return true;
}
