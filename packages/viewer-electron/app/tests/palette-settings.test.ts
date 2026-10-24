// @vitest-environment jsdom
/**
 * SETTINGS APART IN THE PALETTE (2026-10-23): a setting's command is listed in a Settings section
 * after the commands, found only by its name's words and a few at a time; `,` searches the settings
 * alone; and a setting's row shows its value.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement, useState } from 'react';
import {
  moreSettingsID,
  paletteRows,
  settingRows,
} from '../src/renderer/commands/palette-sections';
import { CommandPalette } from '../src/renderer/commands/CommandPalette';
import { CommandsContext } from '../src/renderer/commands/context';
import {
  CommandRegistry,
  type CommandContext,
  type CommandDefinition,
  type ResolvedCommand,
} from '../src/renderer/commands/registry';
import { WorkspaceContext, type WorkspaceController } from '../src/renderer/workspace/context';
import { activeWorkspace, initialize } from '../src/renderer/state/store';

const context = {} as CommandContext;
const command = (id: string, label: string, extra: Partial<ResolvedCommand> = {}) =>
  ({
    id,
    label,
    group: 'Files',
    aliases: [],
    primary: false,
    source: 'window',
    context,
    ...extra,
  }) as ResolvedCommand;
const setting = (
  id: string,
  label: string,
  name: string,
  value?: boolean | string,
  category = 'Space',
  workspace = false,
) =>
  command(id, label, {
    group: 'Settings',
    detail: category,
    aliases: [id.slice('setting.'.length), category],
    setting: {
      name,
      ...(value === undefined ? {} : { value }),
      ...(workspace ? { workspace } : {}),
    },
  });
const commands = [
  command('new-folder', 'New folder…', { primary: true }),
  command('open', 'Open', { primary: true }),
  command('view-grid', 'View as grid'),
  setting('setting.ui.space.minimap', 'Hide minimap', 'Show minimap', true),
  setting(
    'setting.ui.space.minimap@workspace',
    'This workspace: Hide minimap',
    'Show minimap',
    true,
    'Space',
    true,
  ),
  setting('setting.ui.space.grid', 'Hide background grid', 'Show background grid', true),
  setting(
    'setting.settings.editor.wrap',
    'Turn off: Editor › Wrap long lines',
    'Editor › Wrap long lines',
    true,
    'Editor',
  ),
  ...(['Solid', 'Blur', 'Clear'] as const).map((choice) =>
    command(`setting.ui.space.backdrop=${choice.toLowerCase()}`, `Space background: ${choice}`, {
      group: 'Settings',
      detail: 'Space',
      aliases: [],
      setting: { name: 'Space background', choice, current: choice === 'Solid' },
    }),
  ),
  setting(
    'setting.ui.space.backdropOpacity',
    'Change space background opacity…',
    'Space background opacity',
    '60',
  ),
];
const ids = (rows: readonly ResolvedCommand[]) => rows.map((row) => row.id);

describe('the palette’s rows', () => {
  it('leave settings out of a short or verb-only query', () => {
    for (const query of ['o', 't', 's', 'h', 'turn', 'show', 'hide', 'turn off', 'change'])
      expect(
        ids(paletteRows(commands, query, []).rows).filter((id) => id.startsWith('setting.')),
      ).toEqual([]);
  });
  it('list a setting by its name, in a Settings section, without the workspace’s own', () => {
    const view = paletteRows(commands, 'minimap', []);
    expect(ids(view.rows)).toEqual(['setting.ui.space.minimap']);
    expect(view.headings.get('setting.ui.space.minimap')).toBe('Settings');
  });
  it('put the commands first, unless a setting is the better match', () => {
    expect(ids(paletteRows(commands, 'grid', []).rows)).toEqual([
      'view-grid',
      'setting.ui.space.grid',
    ]);
    expect(ids(paletteRows(commands, 'hide mini', []).rows)[0]).toBe('setting.ui.space.minimap');
  });
  it('offer the workspace’s own when asked for', () => {
    expect(ids(paletteRows(commands, 'this workspace minimap', []).rows)).toContain(
      'setting.ui.space.minimap@workspace',
    );
  });
  it('show a few settings and a row for the rest', () => {
    const many = [
      command('view-grid', 'View as grid'),
      ...Array.from({ length: 9 }, (_, index) =>
        setting(`setting.ui.grid${index}`, `Hide grid ${index}`, `Show grid ${index}`, true),
      ),
    ];
    const view = paletteRows(many, 'grid', []);
    expect(ids(view.rows).filter((id) => id.startsWith('setting.'))).toHaveLength(4);
    const more = view.rows.at(-1)!;
    expect(more.id).toBe(moreSettingsID);
    expect(more.label).toBe('All 9 matching settings');
  });
  it('keep a recently used setting among Recent, and list no other with no query', () => {
    expect(ids(paletteRows(commands, '', ['setting.ui.space.grid']).rows)).toEqual([
      'setting.ui.space.grid',
      'new-folder',
      'open',
    ]);
  });
});

describe('a setting with choices', () => {
  const folded = 'palette:choices:setting.ui.space.backdrop';
  it('is one row with its value, until a choice is typed', () => {
    const [row] = paletteRows(commands, 'space background', []).rows;
    expect(row).toMatchObject({
      id: folded,
      label: 'Space background',
      setting: { value: 'Solid' },
    });
    expect(ids(paletteRows(commands, 'background blur', []).rows)).toEqual([
      'setting.ui.space.backdrop=blur',
    ]);
    // a choice's name finds it from the palette too
    expect(ids(paletteRows(commands, 'clear', []).rows)).toEqual([
      'setting.ui.space.backdrop=clear',
    ]);
  });
  it('lists its choices after its name and a colon', () => {
    expect(ids(settingRows(commands, 'Space background: ').rows)).toEqual([
      'setting.ui.space.backdrop=solid',
      'setting.ui.space.backdrop=blur',
      'setting.ui.space.backdrop=clear',
    ]);
  });
});

describe('the settings search', () => {
  it('lists every setting under its category, and nothing else', () => {
    const view = settingRows(commands, '');
    expect(view.rows.every((row) => row.setting)).toBe(true);
    expect(view.rows).toHaveLength(6);
    expect(view.headings.get('setting.ui.space.minimap')).toBe('Space');
    expect(view.headings.get('setting.settings.editor.wrap')).toBe('Editor');
    // the heading names the category: the rows do not again
    expect(view.rows.every((row) => !row.detail)).toBe(true);
  });
  it('finds settings loosely, as the palette finds commands', () => {
    expect(ids(settingRows(commands, 'wrap').rows)).toEqual(['setting.settings.editor.wrap']);
    // by its name beside its switch, not by what choosing it does
    expect(settingRows(commands, 'wrap').rows[0]!.label).toBe('Editor › Wrap long lines');
    expect(ids(settingRows(commands, 'opac').rows)).toEqual(['setting.ui.space.backdropOpacity']);
    // the group's name finds nothing: every row is a setting here
    expect(settingRows(commands, 'settings').rows).toHaveLength(0);
  });
});

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
};
describe('the palette', () => {
  beforeEach(() => {
    Object.assign(window, { viewer: { save: vi.fn(async () => {}), list: vi.fn() } });
    initialize({
      home: '/fixtures',
      platform: 'darwin',
      state: null,
      locations: [],
      openPaths: [],
    });
  });
  afterEach(cleanup);
  const show = () => {
    const toggle = vi.fn();
    const registry = new CommandRegistry();
    const live = {
      scope: 'window',
      workspaceID: activeWorkspace().id,
      directory: '/fixtures',
      selection: [],
      jobs: [],
      clipboard: null,
    } as unknown as CommandContext;
    const definitions: CommandDefinition[] = [
      { id: 'open', label: 'Open', group: 'Files', primary: true, when: () => true, run: vi.fn() },
      {
        id: 'setting.settings.editor.wrap',
        label: 'Turn off: Editor › Wrap long lines',
        group: 'Settings',
        detail: 'Editor',
        setting: { name: 'Editor › Wrap long lines', value: true },
        when: () => true,
        run: toggle,
      },
    ];
    registry.register('window', { context: () => ({ ...live }), definitions: () => definitions });
    const Harness = () => {
      const [mode, setMode] = useState<'commands' | 'files' | 'workspaces' | 'settings'>(
        'commands',
      );
      return createElement(CommandPalette, { mode, onMode: setMode, onClose: vi.fn() });
    };
    const view = render(
      createElement(
        CommandsContext.Provider,
        { value: registry },
        createElement(
          WorkspaceContext.Provider,
          { value: {} as WorkspaceController },
          createElement(Harness),
        ),
      ),
    );
    return { view, toggle };
  };
  it('searches settings after a comma, showing each one’s value, and goes back', async () => {
    const { view, toggle } = show();
    fireEvent.change(view.getByRole('combobox', { name: 'Search commands' }), {
      target: { value: ',wr' },
    });
    const search = await waitFor(() => view.getByRole('combobox', { name: 'Search settings' }));
    expect((search as HTMLInputElement).value).toBe('wr');
    const row = view.getByRole('option', { name: /Wrap long lines/ });
    expect(row.querySelector('.command-switch')?.getAttribute('data-on')).toBe('true');
    expect(view.queryByRole('option', { name: /Open/ })).toBeNull();
    // Backspace in an empty search is back to the commands
    fireEvent.change(search, { target: { value: '' } });
    fireEvent.keyDown(search, { key: 'Backspace' });
    await waitFor(() => view.getByRole('combobox', { name: 'Search commands' }));
    fireEvent.change(view.getByRole('combobox', { name: 'Search commands' }), {
      target: { value: ',' },
    });
    fireEvent.click(await waitFor(() => view.getByRole('option', { name: /Wrap long lines/ })));
    await waitFor(() => expect(toggle).toHaveBeenCalled());
  });
});
