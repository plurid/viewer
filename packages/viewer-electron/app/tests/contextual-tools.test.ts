import { expect, it, vi } from 'vitest';
import { CommandRegistry, rankCommands } from '../src/renderer/commands/registry';
import type { CommandContext } from '../src/renderer/commands/registry';
import {
  toolbarsSchema,
  toolbarCommands,
  moveToolbarCommand,
} from '../src/domain/preferences/toolbars';
import { settingsSchema } from '../src/desktop/preferences/settings';
import { defaultSettings } from '../src/domain/services';
import { workspaceMayChange } from '../src/domain/preferences/catalog';

it('retires scoped revisions when successive views close', () => {
  const registry = new CommandRegistry();
  for (let index = 0; index < 1000; index++) {
    const id = 'ephemeral-' + index;
    const close = registry.register('folder:' + id, {
      context: () => ({
        scope: 'folder',
        paneID: id,
        workspaceID: 'one',
        selection: [],
        jobs: [],
        clipboard: null,
      }),
      definitions: () => [],
    });
    expect(registry.scopedSnapshot(id)).toBeGreaterThan(0);
    close();
    expect(registry.scopedSnapshot(id)).toBe(0);
  }
  expect(registry.ids()).toEqual([]);
});

it('discovers the same available source that menus invoke when another source is unavailable', async () => {
  const context: CommandContext = {
    scope: 'folder',
    workspaceID: 'one',
    paneID: 'folder',
    selection: [],
    clipboard: null,
    jobs: [],
  };
  const registry = new CommandRegistry(),
    run = vi.fn();
  registry.register('window', {
    context: () => context,
    definitions: () => [
      {
        id: 'shared',
        label: 'Window action',
        group: 'View',
        when: (context) => context.scope === 'window',
        run: vi.fn(),
      },
    ],
  });
  registry.register('folder:folder', {
    context: () => context,
    definitions: () => [
      {
        id: 'shared',
        label: 'Folder action',
        group: 'View',
        when: (context) => context.scope === 'folder',
        run,
      },
    ],
  });
  const menu = registry.list({ paneID: 'folder' })[0]!;
  const discovered = registry.discover({ paneID: 'folder' })[0]!;
  expect(discovered.source).toBe(menu.source);
  expect(discovered.available).toBe(true);
  expect(await registry.run(discovered)).toBe(true);
  expect(run).toHaveBeenCalledOnce();
});

it('discovers disabled actions without weakening invocation and retains the captured selection', async () => {
  let context: CommandContext = {
    scope: 'folder',
    workspaceID: 'one',
    paneID: 'folder',
    selection: [],
    clipboard: null,
    jobs: [],
  };
  const run = vi.fn(),
    registry = new CommandRegistry();
  registry.register('folder:folder', {
    context: () => context,
    valid: (captured, live) => captured.workspaceID === live.workspaceID,
    definitions: () => [
      {
        id: 'git-init',
        label: 'Git init',
        group: 'Git',
        aliases: ['initialize repository'],
        unavailable: 'Select a folder to initialize.',
        when: (context) => context.selection.length === 1,
        run,
      },
    ],
  });
  expect(registry.list({ paneID: 'folder' })).toHaveLength(0);
  expect(registry.discover({ paneID: 'folder' })[0]).toMatchObject({
    available: false,
    unavailable: 'Select a folder to initialize.',
  });
  expect(await registry.run(registry.discover({ paneID: 'folder' })[0]!)).toBe(false);
  context = { ...context, selection: [{ path: '/fixtures/first' } as never] };
  const captured = registry.discover({ paneID: 'folder' })[0]!;
  context = { ...context, selection: [{ path: '/fixtures/second' } as never] };
  expect(await registry.run(captured)).toBe(true);
  expect(run.mock.calls[0]?.[0].selection[0].path).toBe('/fixtures/first');
  context = { ...context, workspaceID: 'two' };
  expect(await registry.run(captured)).toBe(false);
  expect(rankCommands([captured], 'git iint', [])).toEqual([captured]);
  expect(run).toHaveBeenCalledTimes(1);
});

it('persists ordered tools, intentional empty choices and missing identities', () => {
  const settings = defaultSettings('/fixtures');
  settings.toolbars = { folder: ['missing:plugin', 'new-folder'], 'preview:image': [] };
  const restored = settingsSchema.parse(JSON.parse(JSON.stringify(settings)));
  expect(toolbarCommands(restored.toolbars, 'preview:image')).toEqual([]);
  expect(moveToolbarCommand(restored.toolbars.folder!, 'new-folder', -1)).toEqual([
    'new-folder',
    'missing:plugin',
  ]);
  expect(toolbarsSchema.safeParse({ folder: ['rename', 'rename'] }).success).toBe(false);
  expect(toolbarsSchema.safeParse({ folder: Array(9).fill('rename') }).success).toBe(false);
  expect(workspaceMayChange(['settings', 'toolbars'])).toBe(true);
  expect(restored.browsing.scrollbars).toBe('system');
});
