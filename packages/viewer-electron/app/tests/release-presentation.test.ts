import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { installAboutPanel, installedRelease } from '../src/desktop/windows/about';
import { guide, installApplicationMenu } from '../src/desktop/windows/application-menu';

const native = vi.hoisted(() => ({
  about: vi.fn(),
  menu: vi.fn((template: MenuItemConstructorOptions[]) => template),
  open: vi.fn(async () => {}),
}));

vi.mock('electron', () => ({
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
