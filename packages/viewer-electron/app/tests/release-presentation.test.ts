import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';
import { EventEmitter } from 'node:events';
import type { DialogPrompt } from '../src/domain/dialogs';
import { attachWindowDialogs, WindowDialogs } from '../src/desktop/native/window-dialogs';
import { applicationUpdates } from '../src/desktop/updates/native';
import { temporaryRoot } from '../tools/temporary';
import { describe, expect, it, vi } from 'vitest';
import { installAboutPanel, installedRelease } from '../src/desktop/windows/about';
import { guide, installApplicationMenu } from '../src/desktop/windows/application-menu';

const native = vi.hoisted(() => ({
  focused: vi.fn<() => BrowserWindow | null>(),
  about: vi.fn(),
  menu: vi.fn((template: MenuItemConstructorOptions[]) => template),
  open: vi.fn(async () => {}),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: native.focused },
  app: {
    isPackaged: false,
    getVersion: () => '0.1.0-0',
    setAboutPanelOptions: native.about,
  },
  Menu: { buildFromTemplate: native.menu, setApplicationMenu: vi.fn() },
  shell: { openExternal: native.open },
}));

describe('About Viewer', () => {
  it('supplies the alpha version and the separate native build suffix', () => {
    installAboutPanel({ version: '0.1.0-0', build: 584 });
    expect(native.about).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ applicationVersion: '0.1.0-0', version: '584' }),
    );
  });

  it('labels a development run without inventing a build', () => {
    const release = installedRelease();
    expect(release).toEqual({ version: '0.1.0-0' });
    installAboutPanel(release);
    expect(native.about).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ applicationVersion: '0.1.0-0', version: 'development' }),
    );
  });
});

describe('Help guide links', () => {
  it.each(['guides/getting-started.md', 'reference/shortcuts.md'])(
    'opens %s at the alpha release tag, or master during development',
    (page) => {
      expect(guide(page, { version: '0.1.0-0', build: 584 })).toBe(
        `https://github.com/plurid/viewer/blob/v0.1.0-0/docs/${page}`,
      );
      expect(guide(page, { version: '0.1.0-0', build: 600 })).toBe(
        `https://github.com/plurid/viewer/blob/v0.1.0-0/docs/${page}`,
      );
      expect(guide(page, { version: '0.1.0-0' })).toBe(
        `https://github.com/plurid/viewer/blob/master/docs/${page}`,
      );
    },
  );

  it('uses the installed release when a person opens a guide from Help', () => {
    installApplicationMenu(undefined, () => () => {}, 'diagnostics.log', vi.fn());
    const template = native.menu.mock.calls[0]![0];
    const help = template.find((item) => item.role === 'help')!
      .submenu as MenuItemConstructorOptions[];
    for (const label of ['Getting Started', 'Keyboard Shortcuts']) {
      const click = help.find((item) => item.label === label)!.click as () => void;
      click();
    }
    expect(native.open.mock.calls).toEqual([
      ['https://github.com/plurid/viewer/blob/master/docs/guides/getting-started.md'],
      ['https://github.com/plurid/viewer/blob/master/docs/reference/shortcuts.md'],
    ]);
  });
});

it('keeps a queued update eligible when the renderer stops before displaying it', async () => {
  const root = await temporaryRoot('viewer-queued-update-');
  const window = Object.assign(new EventEmitter(), {
    webContents: new EventEmitter(),
    isDestroyed: () => false,
  });
  const parent = window as unknown as BrowserWindow;
  const prompts: DialogPrompt[] = [];
  const dialogs = new WindowDialogs({
    home: root,
    places: async () => [],
    access: async () => {},
    publish: (prompt) => {
      if (prompt) prompts.push(prompt);
    },
  });
  attachWindowDialogs(parent, dialogs);
  native.focused.mockReturnValue(parent);
  vi.stubGlobal('process', Object.create(process, { getSystemVersion: { value: () => '15.0' } }));
  try {
    await dialogs.request({ kind: 'current' });
    const blocker = dialogs.message({ message: 'Existing notice', buttons: ['OK'] });
    const messages = vi.spyOn(dialogs, 'message');
    const updates = applicationUpdates(root, () => true);
    vi.spyOn(updates, 'check').mockResolvedValue({
      kind: 'available',
      feed: {
        version: '0.1.0-1',
        build: 600,
        notes: 'Changes',
        url: 'https://example.invalid/update.dmg',
        sha256: 'a'.repeat(64),
        minimumSystemVersion: '14.0',
      },
    });
    const first = updates.checkFromMenu();
    await vi.waitFor(() => expect(messages).toHaveBeenCalledOnce());
    expect(prompts.at(-1)).toMatchObject({ message: 'Existing notice' });
    window.webContents.emit('render-process-gone');
    await expect(first).resolves.toBeUndefined();
    await blocker;
    await dialogs.request({ kind: 'current' });
    const retry = updates.checkAtLaunch();
    await vi.waitFor(() =>
      expect(prompts.at(-1)).toMatchObject({ message: 'Viewer 0.1.0-1 is available' }),
    );
    await dialogs.request({ kind: 'answer', id: prompts.at(-1)!.id, button: 1 });
    await expect(retry).resolves.toMatchObject({ kind: 'available' });
    expect(native.open).not.toHaveBeenCalled();
  } finally {
    dialogs.stop();
    native.focused.mockReset();
    vi.unstubAllGlobals();
  }
});
