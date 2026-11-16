// @vitest-environment jsdom
import type { BrowserWindowConstructorOptions, MenuItemConstructorOptions } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportWindow, reportDisclosure, reportPage } from '../src/desktop/windows/report-window';
import {
  reportCloseChannel,
  reportCopyChannel,
  reportOptionsChannel,
  reportUpdateChannel,
  reportShownChannel,
  reportReadyChannel,
} from '../src/domain/diagnostics/report-window';
import { installApplicationMenu } from '../src/desktop/windows/application-menu';
import { dispatchApplicationCommand } from '../src/desktop/windows/application-dispatch';

const native = vi.hoisted(() => ({
  windows: [] as {
    options: BrowserWindowConstructorOptions;
    webContents: {
      emit(name: string, ...args: unknown[]): boolean;
      setWindowOpenHandler: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
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
  ipcOn: vi.fn(),
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
    ipcRenderer: { send: native.ipcSend, on: native.ipcOn },
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
        send: vi.fn(),
        ipc: new EventEmitter(),
        mainFrame: {},
      });
      show = vi.fn();
      focus = vi.fn();
      loadURL = vi.fn(async () => {
        this.webContents.emit('did-start-loading');
        this.webContents.ipc.emit(reportReadyChannel, {
          sender: this.webContents,
          senderFrame: this.webContents.mainFrame,
        });
      });
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
function reviewWindow(
  make: (include: boolean) => Promise<string>,
  look: () => 'dark' | 'light',
  present = true,
): ReportWindow {
  return new ReportWindow(async () => ({
    report: await make(false),
    withMessageText: () => make(true),
  }), look, present);
}

const report = '# Viewer report\n\n- Edition: direct\n\n> Failed ~/…/….pdf\n';

describe('report review window', () => {
  it('binds Copy without exposing report data or a callable page API', async () => {
    document.documentElement.innerHTML = reportPage(report, 'dark');
    await import('../src/report-preload');
    window.dispatchEvent(new Event('DOMContentLoaded'));
    expect(native.ipcSend).toHaveBeenCalledWith(reportReadyChannel);
    native.ipcSend.mockClear();
    document.querySelector('button')!.click();
    expect(native.ipcSend).toHaveBeenCalledExactlyOnceWith(reportCopyChannel);
    for (const [key, channel] of [
      ['Enter', reportCopyChannel],
      ['Escape', reportCloseChannel],
    ]) {
      const event = new KeyboardEvent('keydown', { key, cancelable: true });
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(native.ipcSend).toHaveBeenLastCalledWith(channel);
    }
    expect(native.ipcSend).toHaveBeenCalledTimes(3);
    expect(Reflect.get(window, 'viewer')).toBeUndefined();
    const checkbox = document.querySelector<HTMLInputElement>('#include-message-text')!;
    const warning = document.getElementById('message-warning')!;
    const button = document.querySelector('button')!;
    expect(checkbox.checked).toBe(false);
    expect(warning.hidden).toBe(true);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(warning.hidden).toBe(false);
    expect(button.disabled).toBe(true);
    expect(native.ipcSend).toHaveBeenLastCalledWith(reportOptionsChannel, 1, true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(native.ipcSend).toHaveBeenCalledTimes(4);
    const update = native.ipcOn.mock.calls.find(([channel]) => channel === reportUpdateChannel)![1];
    update({}, { revision: 1, report: 'Optional <quoted text>', includeMessageText: true });
    expect(document.querySelector('pre')!.textContent).toBe('Optional <quoted text>');
    expect(button.disabled).toBe(false);
    expect(native.ipcSend).toHaveBeenLastCalledWith(reportShownChannel, 1);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(warning.hidden).toBe(true);
    update({}, { revision: 1, report: 'Late private excerpt', includeMessageText: true });
    expect(checkbox.checked).toBe(false);
    expect(document.querySelector('pre')!.textContent).toBe('Optional <quoted text>');
    expect(button.disabled).toBe(true);
    update({}, { revision: 2, report, includeMessageText: false });
    expect(document.querySelector('pre')!.textContent).toBe(report);
    update({}, { revision: 3, report: 'Unrequested excerpt', includeMessageText: true });
    expect(checkbox.checked).toBe(false);
    expect(document.querySelector('pre')!.textContent).toBe(report);
  });

  it('accepts copy only from this window main frame with no arguments', async () => {
    const owner = reviewWindow(
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

  it('copies only the report acknowledged as shown after the person opts in', async () => {
    const make = vi.fn(async (include: boolean) => (include ? 'Optional message text' : report));
    const owner = reviewWindow(make, () => 'dark');
    await owner.open();
    const contents = native.windows[0]!.webContents;
    const event = { sender: contents, senderFrame: contents.mainFrame };
    expect(make).toHaveBeenCalledExactlyOnceWith(false);
    contents.ipc.emit(reportOptionsChannel, event, 1, true);
    contents.ipc.emit(reportCopyChannel, event);
    expect(native.writeText).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(contents.send).toHaveBeenCalled());
    const update = contents.send.mock.calls[0]![1];
    expect(update.report).toBe('Optional message text');
    contents.ipc.emit(reportShownChannel, event, update.revision + 1);
    contents.ipc.emit(reportCopyChannel, event);
    expect(native.writeText).not.toHaveBeenCalled();
    contents.ipc.emit(reportShownChannel, event, update.revision);
    contents.ipc.emit(reportCopyChannel, event);
    await vi.waitFor(() => expect(native.writeText).toHaveBeenCalledWith(update.report));
  });

  it('does not replace the default with an excerpt that finishes after opting out', async () => {
    let complete: (text: string) => void = () => {};
    const excerpt = new Promise<string>((resolve) => {
      complete = resolve;
    });
    const owner = reviewWindow(
      async (include) => (include ? excerpt : report),
      () => 'dark',
    );
    await owner.open();
    const contents = native.windows[0]!.webContents;
    const event = { sender: contents, senderFrame: contents.mainFrame };
    contents.ipc.emit(reportOptionsChannel, event, 1, true);
    contents.ipc.emit(reportOptionsChannel, event, 2, false);
    const update = contents.send.mock.calls[0]![1];
    contents.ipc.emit(reportShownChannel, event, update.revision);
    complete('Late optional excerpt');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(contents.send).toHaveBeenCalledTimes(1);
    contents.ipc.emit(reportCopyChannel, event);
    expect(native.writeText).toHaveBeenCalledExactlyOnceWith(report);
  });

  it('restores the default and explains when optional message preparation fails', async () => {
    const owner = reviewWindow(
      async (include) => {
        if (include) throw new Error('Private lookup details');
        return report;
      },
      () => 'dark',
    );
    await owner.open();
    const contents = native.windows[0]!.webContents;
    const event = { sender: contents, senderFrame: contents.mainFrame };
    contents.ipc.emit(reportOptionsChannel, event, 1, true);
    await vi.waitFor(() => expect(contents.send).toHaveBeenCalled());
    const update = contents.send.mock.calls[0]![1];
    expect(update).toMatchObject({ report, includeMessageText: false });
    expect(update.error).toBe('Message text could not be prepared. The default report is shown.');
    contents.ipc.emit(reportShownChannel, event, update.revision);
    contents.ipc.emit(reportCopyChannel, event);
    expect(native.writeText).toHaveBeenCalledExactlyOnceWith(report);
  });

  it('resets Copy to the default on every page load and waits for the new document', async () => {
    const owner = reviewWindow(async (include) => include ? 'Optional private excerpt' : report, () => 'dark');
    await owner.open();
    const contents = native.windows[0]!.webContents;
    const event = { sender: contents, senderFrame: contents.mainFrame };
    contents.ipc.emit(reportOptionsChannel, event, 1, true);
    await vi.waitFor(() => expect(contents.send).toHaveBeenCalled());
    contents.ipc.emit(reportShownChannel, event, contents.send.mock.calls[0]![1].revision);
    contents.emit('did-start-loading');
    contents.ipc.emit(reportCopyChannel, event);
    expect(native.writeText).not.toHaveBeenCalled();
    contents.ipc.emit(reportReadyChannel, event);
    contents.ipc.emit(reportCopyChannel, event);
    expect(native.writeText).toHaveBeenCalledExactlyOnceWith(report);
  });

  it('cuts long reports at a whole line and discloses shortening in the copied text', async () => {
    const line = '- assets/renderer.js:123:45\n';
    const owner = reviewWindow(async () => '# Viewer report\n\n' + line.repeat(5000), () => 'dark');
    await owner.open();
    const window = native.windows[0]!;
    document.documentElement.innerHTML = decodeURIComponent(window.loadURL.mock.calls[0]![0].slice('data:text/html,'.length));
    const shown = document.querySelector('pre')!.textContent!;
    expect(new TextEncoder().encode(shown).length).toBeLessThanOrEqual(65536);
    expect(shown).toMatch(/:123:45\n\nReport shortened to fit this window\.\n$/);
    window.webContents.ipc.emit(reportCopyChannel, { sender: window.webContents, senderFrame: window.webContents.mainFrame });
    expect(native.writeText).toHaveBeenCalledExactlyOnceWith(shown);
  });

  it('opens after an emoji crosses the report limit and copies the same complete scalars', async () => {
    const owner = reviewWindow(
      async () => 'a'.repeat(65535) + '😀private',
      () => 'dark',
    );
    await expect(owner.open()).resolves.toBeUndefined();
    const window = native.windows[0]!;
    const page = decodeURIComponent(
      window.loadURL.mock.calls[0]![0].slice('data:text/html,'.length),
    );
    document.documentElement.innerHTML = page;
    const shown = document.querySelector('pre')!.textContent;
    expect(shown).toBe('Report shortened to fit this window.\n');
    window.webContents.ipc.emit(reportCopyChannel, {
      sender: window.webContents,
      senderFrame: window.webContents.mainFrame,
    });
    expect(native.writeText).toHaveBeenCalledExactlyOnceWith(shown);
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

  it('copies the immutable reviewed report from its private control, then closes', async () => {
    const make = vi.fn(async () => report);
    const owner = reviewWindow(make, () => 'dark');
    await owner.open();
    const window = native.windows.at(-1)!;
    window.webContents.ipc.emit(reportCopyChannel, {
      sender: window.webContents,
      senderFrame: window.webContents.mainFrame,
    });
    await vi.waitFor(() => expect(window.close).toHaveBeenCalledOnce());
    expect(native.writeText).toHaveBeenLastCalledWith(report);
    expect(window.close).toHaveBeenCalledOnce();
    expect(owner.window).toBeUndefined();
    expect(make).toHaveBeenCalledOnce();
  });

  it('Escape closes without reading or writing the clipboard', async () => {
    const owner = reviewWindow(
      async () => report,
      () => 'dark',
    );
    await owner.open();
    const window = native.windows.at(-1)!;
    window.webContents.ipc.emit(reportCloseChannel, {
      sender: window.webContents,
      senderFrame: window.webContents.mainFrame,
    });
    expect(window.close).toHaveBeenCalledOnce();
    expect(native.writeText).not.toHaveBeenCalled();
  });

  it('keeps the report open and offers recovery if copying fails', async () => {
    const owner = reviewWindow(
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
    const owner = reviewWindow(make, () => 'light');
    await Promise.all([owner.open(), owner.open()]);
    await owner.open();
    expect(native.windows).toHaveLength(1);
    expect(make).toHaveBeenCalledOnce();
    expect(native.windows[0]!.focus).toHaveBeenCalledOnce();
  });

  it('has only its private preload, denies permissions and navigation, and blocks every network request', async () => {
    const owner = reviewWindow(
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
