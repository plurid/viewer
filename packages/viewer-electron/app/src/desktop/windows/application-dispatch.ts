type EditingAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll';

interface MenuWindow {
  webContents: Record<EditingAction, () => void>;
}

const settingsEdits: Readonly<Record<string, EditingAction | undefined>> = {
  'undo-file': 'undo',
  'redo-file': 'redo',
  cut: 'cut',
  copy: 'copy',
  paste: 'paste',
  'select-all': 'selectAll',
};

export async function dispatchApplicationCommand<Window extends MenuWindow>(
  command: string,
  host: {
    openSettings(): Promise<void>;
    newWindow(): Promise<void>;
    checkForUpdates(): Promise<void>;
    acknowledgements(): Promise<void>;
    focusedWindow(): Window | null;
    settingsWindow(): Window | null;
    workspaceCommand(command: string): void;
  },
): Promise<void> {
  // Application actions cannot depend on a renderer or a focused native window.
  if (command === 'settings') return host.openSettings();
  if (command === 'new-native-window') return host.newWindow();
  if (command === 'check-for-updates') return host.checkForUpdates();
  if (command === 'acknowledgements') return host.acknowledgements();
  const focused = host.focusedWindow();
  if (focused && focused === host.settingsWindow()) {
    const action = settingsEdits[command];
    if (action) focused.webContents[action]();
    return;
  }
  host.workspaceCommand(command);
}

/** Allocate a fresh workspace, never reusing another window's active workspace or profile. */
export async function createIndependentWindow<Window>(host: {
  available(): boolean;
  prepare(): Promise<void>;
  createWorkspace(): string;
  create(workspaceID: string): Promise<Window | undefined>;
}): Promise<Window | undefined> {
  if (!host.available()) return;
  await host.prepare();
  if (!host.available()) return;
  return host.create(host.createWorkspace());
}

interface ActivationWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

/** Dock activation first recovers a hotkey target, then an existing ordinary Viewer window. */
export async function activateApplication<Window extends ActivationWindow>(host: {
  available(): boolean;
  present: boolean;
  restoreHotkey(): boolean;
  currentWindow(): Window | undefined;
  createWindow(): Promise<Window | undefined>;
}): Promise<void> {
  if (!host.available()) return;
  if (host.present && host.restoreHotkey()) return;
  const current = host.currentWindow();
  const target = current && !current.isDestroyed() ? current : await host.createWindow();
  if (!host.available() || !host.present || !target || target.isDestroyed()) return;
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
}
