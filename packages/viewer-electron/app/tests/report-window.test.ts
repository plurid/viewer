// @vitest-environment jsdom
import type { BrowserWindowConstructorOptions, Input, MenuItemConstructorOptions } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportWindow, reportDisclosure, reportPage } from '../src/desktop/windows/report-window';
import { reportCopyChannel } from '../src/domain/diagnostics/report-window';
import { installApplicationMenu } from '../src/desktop/windows/application-menu';
import { dispatchApplicationCommand } from '../src/desktop/windows/application-dispatch';

const native = vi.hoisted(() => ({
  windows: [] as {
    options: BrowserWindowConstructorOptions;
    webContents: {
      emit(name: string, ...args: unknown[]): boolean;
      setWindowOpenHandler: ReturnType<typeof vi.fn>;
      mainFrame: object;
      ipc: { emit(name: string, ...args: unknown[]): boolean };
    };
    close: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    loadURL: ReturnType<typeof vi.fn>;
  }[],
  writeText: vi.fn(),
  ipcSend: vi.fn(),
  showErrorBox: vi.fn(),
  setPermissionRequestHandler: vi.fn(),
  setPermissionCheckHandler: vi.fn(),
  onBeforeRequest: vi.fn(),
  buildFromTemplate: vi.fn((items: MenuItemConstructorOptions[]) => items),
}));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    app: { isPackaged: true },
    clipboard: { writeText: native.writeText },
    ipcRenderer: { send: native.ipcSend },
    dialog: { showErrorBox: native.showErrorBox },
    Menu: { buildFromTemplate: native.buildFromTemplate, setApplicationMenu: vi.fn() },
    session: {
      fromPartition: () => ({
        setPermissionRequestHandler: native.setPermissionRequestHandler,
        setPermissionCheckHandler: native.setPermissionCheckHandler,
        webRequest: { onBeforeRequest: native.onBeforeRequest },
      }),
    },
    BrowserWindow: class extends EventEmitter {
      destroyed = false;
      webContents = Object.assign(new EventEmitter(), {
        setWindowOpenHandler: vi.fn(),
        ipc: new EventEmitter(),
        mainFrame: {},
      });
      show = vi.fn();
      focus = vi.fn();
      loadURL = vi.fn(async () => {});
      isMinimized = () => false;
      restore = vi.fn();
      isDestroyed = () => this.destroyed;
      close = vi.fn(() => {
        this.destroyed = true;
        this.emit('closed');
      });
      constructor(public options: BrowserWindowConstructorOptions) {
        super();
        native.windows.push(this);
      }
    },
  };
});

beforeEach(() => {
  native.windows.length = 0;
});
const report = '# Viewer report\n\n- Edition: direct\n\n> Failed ~/…/….pdf\n';

describe('report review window', () => {
  it('binds Copy without exposing report data or a callable page API', async () => {
    document.documentElement.innerHTML = reportPage(report, 'dark');
    await import('../src/report-preload');
    window.dispatchEvent(new Event('DOMContentLoaded'));
    document.querySelector('button')!.click();
    expect(native.ipcSend).toHaveBeenCalledExactlyOnceWith(reportCopyChannel);
    expect(Reflect.get(window, 'viewer')).toBeUndefined();
  });

  it('accepts copy only from this window main frame with no arguments', async () => {
    const owner = new ReportWindow(
      async () => report,
      () => 'dark',
    );
    await owner.open();
    const contents = native.windows[0]!.webContents;
    contents.ipc.emit(reportCopyChannel, { sender: {}, senderFrame: contents.mainFrame });
    contents.ipc.emit(reportCopyChannel, { sender: contents, senderFrame: {} });
    contents.ipc.emit(
      reportCopyChannel,
      { sender: contents, senderFrame: contents.mainFrame },
      'read',
    );
    expect(native.writeText).not.toHaveBeenCalled();
  });
  it.each(['light', 'dark'] as const)(
    'shows the sentence, exact report and one Copy action in %s',
    (look) => {
      document.documentElement.innerHTML = reportPage(report, look);
      expect(document.getElementById('privacy')?.textContent).toBe(reportDisclosure);
      const preview = document.querySelector('pre')!;
      expect(preview.textContent).toBe(report);
      expect(
        document.getElementById('privacy')!.compareDocumentPosition(preview) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(preview.getAttribute('role')).toBe('document');
      expect(preview.getAttribute('tabindex')).toBe('0');
      const buttons = document.querySelectorAll('button');
      expect(buttons).toHaveLength(1);
      expect(buttons[0]?.textContent).toBe('Copy');
      expect(document.querySelector('footer')?.textContent).toContain('Help → Report an Issue…');
      expect(document.querySelector('script, iframe, img, a, [autofocus]')).toBeNull();
    },
  );

  it('escapes untrusted Markdown so the shown text is exactly what Copy will share', () => {
    const text = '</pre><script>fetch("https://example.invalid")</script>&\n';
    document.documentElement.innerHTML = reportPage(text, 'dark');
    expect(document.querySelector('pre')?.textContent).toBe(text);
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('meta[http-equiv]')?.getAttribute('content')).toContain(
      "connect-src 'none'",
    );
  });

  it('copies the immutable reviewed report by button navigation or default Enter, then closes', async () => {
    for (const method of ['button', 'Enter'] as const) {
      const make = vi.fn(async () => report);
      const owner = new ReportWindow(make, () => 'dark');
      await owner.open();
      const window = native.windows.at(-1)!;
      const event = { preventDefault: vi.fn() };
      if (method === 'button')
        window.webContents.ipc.emit(reportCopyChannel, {
          sender: window.webContents,
          senderFrame: window.webContents.mainFrame,
        });
      else
        window.webContents.emit('before-input-event', event, {
          type: 'keyDown',
          key: 'Enter',
        } satisfies Partial<Input>);
      if (method === 'Enter') expect(event.preventDefault).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(window.close).toHaveBeenCalledOnce());
      expect(native.writeText).toHaveBeenLastCalledWith(report);
      expect(window.close).toHaveBeenCalledOnce();
      expect(owner.window).toBeUndefined();
      expect(make).toHaveBeenCalledOnce();
    }
  });

  it('Escape closes without reading or writing the clipboard', async () => {
    const owner = new ReportWindow(
      async () => report,
      () => 'dark',
    );
    await owner.open();
    const window = native.windows.at(-1)!;
    window.webContents.emit(
      'before-input-event',
      { preventDefault: vi.fn() },
      { type: 'keyDown', key: 'Escape' },
    );
    expect(window.close).toHaveBeenCalledOnce();
    expect(native.writeText).not.toHaveBeenCalled();
  });

  it('keeps the report open and offers recovery if copying fails', async () => {
    const owner = new ReportWindow(
      async () => report,
      () => 'dark',
    );
    await owner.open();
    native.writeText.mockImplementationOnce(() => {
      throw new Error('clipboard unavailable');
    });
    const contents = native.windows[0]!.webContents;
    contents.ipc.emit(reportCopyChannel, { sender: contents, senderFrame: contents.mainFrame });
    expect(native.windows[0]!.close).not.toHaveBeenCalled();
    expect(native.showErrorBox).toHaveBeenCalledWith('Report not copied', 'Try Copy again.');
  });

  it('coalesces opens and retains the same reviewed snapshot until closed', async () => {
    const make = vi.fn(async () => report);
    const owner = new ReportWindow(make, () => 'light');
    await Promise.all([owner.open(), owner.open()]);
    await owner.open();
    expect(native.windows).toHaveLength(1);
    expect(make).toHaveBeenCalledOnce();
    expect(native.windows[0]!.focus).toHaveBeenCalledOnce();
  });

  it('has only its private preload, denies permissions and navigation, and blocks every network request', async () => {
    const owner = new ReportWindow(
      async () => report,
      () => 'dark',
      false,
    );
    await owner.open();
    const window = native.windows[0]!;
    expect(window.options.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
      webSecurity: true,
    });
    expect(window.options.webPreferences?.preload).toMatch(/report-preload\.cjs$/);
    expect(window.show).not.toHaveBeenCalled();
    const check = native.setPermissionCheckHandler.mock.calls[0]![0] as () => boolean;
    expect(check()).toBe(false);
    const request = native.onBeforeRequest.mock.calls[0]![0] as (
      detail: { url: string },
      callback: (answer: { cancel: boolean }) => void,
    ) => void;
    for (const url of [
      'https://example.invalid',
      'http://localhost',
      'file:///private',
      'viewer-app://app/index.html',
      'ws://localhost',
    ]) {
      const callback = vi.fn();
      request({ url }, callback);
      expect(callback).toHaveBeenCalledWith({ cancel: true });
      const event = { preventDefault: vi.fn() };
      window.webContents.emit('will-navigate', event, url);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }
    expect(native.writeText).not.toHaveBeenCalled();
    const popup = window.webContents.setWindowOpenHandler.mock.calls[0]![0] as () => {
      action: string;
    };
    expect(popup()).toEqual({ action: 'deny' });
  });
});

describe('report menu boundary', () => {
  it.each([false, true])(
    'opens directly from Help alongside Report an Issue, including Store (%s)',
    (store) => {
      const previous = Object.getOwnPropertyDescriptor(process, 'mas');
      Object.defineProperty(process, 'mas', { configurable: true, value: store });
      const copy = vi.fn();
      const command = vi.fn(() => vi.fn());
      try {
        installApplicationMenu(
          undefined,
          command,
          '/Private/Viewer/Logs/diagnostics.log',
          vi.fn(),
          false,
          copy,
        );
      } finally {
        if (previous) Object.defineProperty(process, 'mas', previous);
        else Reflect.deleteProperty(process, 'mas');
      }
      const items = native.buildFromTemplate.mock.calls
        .at(-1)![0]
        .find((item) => item.role === 'help')!.submenu as MenuItemConstructorOptions[];
      const index = items.findIndex((item) => item.label === 'Copy Report…');
      expect(items[index + 1]?.label).toBe('Report an Issue…');
      const click = items[index]!.click as () => void;
      click();
      expect(copy).toHaveBeenCalledOnce();
      expect(command).not.toHaveBeenCalledWith('copy-report');
    },
  );

  it('keeps menu editing in the report window instead of dispatching a workspace action', async () => {
    const copy = vi.fn();
    const window = {
      webContents: {
        copy,
        undo: vi.fn(),
        redo: vi.fn(),
        cut: vi.fn(),
        paste: vi.fn(),
        selectAll: vi.fn(),
      },
    };
    const workspaceCommand = vi.fn();
    await dispatchApplicationCommand('copy', {
      openSettings: vi.fn(),
      newWindow: vi.fn(),
      checkForUpdates: vi.fn(),
      acknowledgements: vi.fn(),
      focusedWindow: () => window,
      settingsWindow: () => null,
      reportWindow: () => window,
      workspaceCommand,
    });
    expect(copy).toHaveBeenCalledOnce();
    expect(workspaceCommand).not.toHaveBeenCalled();
  });
});
