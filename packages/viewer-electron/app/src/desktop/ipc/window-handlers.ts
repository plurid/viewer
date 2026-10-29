import type { BrowserWindow } from 'electron';
import type { ApiHandlers } from './schemas';
import type { HotkeyStatus } from '../windows/hotkey-window';
import type { ShellCommand } from '../windows/shell-command';
import type { WorkspaceSessions } from '../windows/workspace-sessions';
import type { WindowFlushRequests } from '../windows/flush-requests';

type WindowHandlers = Pick<
  ApiHandlers,
  | 'shellCommand'
  | 'hotkeyStatus'
  | 'restoreWindow'
  | 'workspaceClaim'
  | 'newWindow'
  | 'windowButtons'
  | 'openSettings'
  | 'settingsCategory'
  | 'diagnosticReport'
  | 'flushed'
>;
/** What the application process offers its windows. */
interface WindowHost {
  openSettings(focus?: string): Promise<void>;
  newWindow?(workspaceID?: string): Promise<void>;
  hotkeyStatus?(): HotkeyStatus;
  restoreWindow?(): void;
  settingsCategory?(category: string): void;
  diagnose?(detail: string): void;
}
interface WindowPorts {
  host: WindowHost;
  shellCommand: Pick<ShellCommand, 'status' | 'install' | 'uninstall'>;
  sessions: Pick<WorkspaceSessions, 'owner' | 'claim'>;
  flushes: Pick<WindowFlushRequests, 'acknowledge'>;
  window(owner: number): BrowserWindow | undefined;
  isSettings(owner: number): boolean;
  assignWorkspace(owner: number, workspaceID: string): void;
  createWorkspace(): string;
}

/** A workspace belongs to one window at a time: claiming another's focuses that window instead. */
export function createWindowHandlers(ports: WindowPorts): WindowHandlers {
  const reports = new Map<number, number[]>();
  return {
    shellCommand: ([action], owner) => {
      if (action === 'uninstall' && !ports.isSettings(owner))
        throw new Error('Uninstall the Viewer CLI from Settings → Navigation.');
      return ports.shellCommand[action]();
    },
    hotkeyStatus: () => ports.host.hotkeyStatus?.() ?? { registered: false, shortcut: '' },
    restoreWindow: () => ports.host.restoreWindow?.(),
    workspaceClaim: ([workspaceID], sender) => {
      const owner = ports.sessions.owner(workspaceID);
      if (owner !== undefined && owner !== sender) {
        const target = ports.window(owner);
        if (target && !target.isDestroyed()) {
          target.show();
          target.focus();
        }
        return false;
      }
      const claimed = ports.sessions.claim(sender, workspaceID);
      if (claimed) ports.assignWorkspace(sender, workspaceID);
      return claimed;
    },
    newWindow: async () => {
      if (!ports.host.newWindow) throw new Error('New windows are unavailable.');
      await ports.host.newWindow(ports.createWorkspace());
    },
    windowButtons: ([visible], owner) => {
      // a hidden title bar takes the window buttons with it; they come back with it
      if (process.platform === 'darwin') ports.window(owner)?.setWindowButtonVisibility(visible);
    },
    openSettings: ([focus]) => ports.host.openSettings(focus),
    settingsCategory: ([category]) => ports.host.settingsCategory?.(category),
    diagnosticReport: ([detail], owner) => {
      // A window in an error loop cannot flood the log: 30 reports a minute each.
      const now = Date.now();
      const recent = (reports.get(owner) ?? []).filter((at) => now - at < 60_000);
      if (recent.length >= 30) return;
      reports.set(owner, [...recent, now]);
      ports.host.diagnose?.(detail);
    },
    flushed: ([token, result], owner) => {
      ports.flushes.acknowledge(token, owner, result ?? { ok: true });
    },
  };
}
