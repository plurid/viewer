import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CommandRegistry, rankCommands } from '../src/renderer/commands/registry';
import type { CommandContext } from '../src/renderer/commands/registry';
import type { FileEntry, Pane } from '../src/domain/contracts';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { programCommands } from '../src/renderer/commands/programs';
import { toolFiles } from '../src/renderer/commands/target';
import { initialize } from '../src/renderer/state/store';
import {
  toolbarsSchema,
  toolbarCommands,
  moveToolbarCommand,
} from '../src/domain/preferences/toolbars';
import { settingsSchema } from '../src/desktop/preferences/settings-schema';
import { defaultSettings } from '../src/domain/services';
import { workspaceMayChange } from '../src/domain/preferences/catalog';
import { toolbarRequest } from '../src/renderer/commands/toolbar';

it('does not borrow another plane’s folder, resource or selection for an inactive toolbar', () => {
  const context: CommandContext = {
    scope: 'folder',
    workspaceID: 'one',
    paneID: 'other',
    folder: { id: 'other', type: 'folder', path: '/other' } as never,
    resourceID: 'other-resource',
    rootID: 'other-root',
    directory: '/other',
    sidebar: { section: 'favorites' },
    selection: [{ path: '/other/secret.txt' } as never],
    clipboard: null,
    jobs: [],
  };
  const request = toolbarRequest(
    { id: 'browser', type: 'browser', path: '/wanted', url: 'http://localhost/' },
    context,
    'preview',
  );
  expect(request.scope).toBe('preview');
  expect(request.context).toMatchObject({ paneID: 'browser', path: '/wanted', selection: [] });
  for (const key of ['folder', 'resourceID', 'rootID', 'directory', 'sidebar'] as const)
    expect(request.context?.[key]).toBeUndefined();
});

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

describe('a preview plane’s file', () => {
  beforeAll(() =>
    initialize({
      home: '/fixtures',
      platform: 'darwin',
      state: null,
      locations: [],
      openPaths: [],
    }),
  );
  const pdf = {
    path: '/Jobs/Bracket.pdf',
    name: 'Bracket.pdf',
    extension: 'pdf',
    kind: 'file',
    size: 2048,
  } as FileEntry;
  const preview = (subject?: FileEntry): CommandContext => ({
    scope: 'preview',
    workspaceID: 'one',
    paneID: 'preview',
    path: pdf.path,
    selection: [],
    subject,
    clipboard: null,
    jobs: [],
  });
  const registry = (context: CommandContext, pdfTools = vi.fn()) => {
    const commands = new CommandRegistry();
    commands.register('preview:preview', { context: () => context, definitions: () => [] });
    commands.register('window', {
      context: () => ({ ...context, scope: 'window', paneID: 'folder', subject: undefined }),
      definitions: () =>
        programCommands(
          {} as WorkspaceController,
          async () => true,
          undefined,
          undefined,
          undefined,
          {
            pdfTools,
            optimizeFiles: vi.fn(),
          },
        ),
    });
    return commands;
  };
  it('is what its PDF tools and Optimize act on while nothing is selected', async () => {
    const pdfTools = vi.fn();
    const commands = registry(preview(pdf), pdfTools);
    const request = toolbarRequest(
      { id: 'preview', type: 'preview', path: pdf.path } as Pane,
      commands.context('preview'),
      'preview',
    );
    const [tools] = commands.discover({ ...request, ids: ['pdf-tools'] });
    expect(tools?.available).toBe(true);
    expect(commands.list({ ...request, ids: ['optimize-files'] })).toHaveLength(1);
    await commands.run(tools!);
    expect(pdfTools).toHaveBeenCalledWith([pdf], 'preview');
    expect(toolFiles({ selection: [{ ...pdf, name: 'Other.pdf' }], subject: pdf })).toEqual([
      { ...pdf, name: 'Other.pdf' },
    ]);
  });
  it('is never borrowed by another plane’s toolbar', () => {
    const commands = registry(preview(pdf));
    const request = toolbarRequest(
      { id: 'another', type: 'preview', path: '/Jobs/Other.pdf' } as Pane,
      commands.context('preview'),
      'preview',
    );
    expect(request.context?.subject).toBeUndefined();
    expect(commands.discover({ ...request, ids: ['pdf-tools'] })[0]?.available).toBe(false);
    expect(toolFiles(preview())).toEqual([]);
  });
  it('has no pinned tools of a PDF or an image by default; a text plane keeps Edit text', () => {
    expect(toolbarCommands({}, 'preview:pdf')).toEqual([]);
    expect(toolbarCommands({}, 'preview:image')).toEqual([]);
    expect(toolbarCommands({}, 'folder')).toEqual([]);
    expect(toolbarCommands({}, 'preview:text')).toEqual(['edit-file']);
    expect(toolbarCommands({ folder: ['new-folder'] }, 'folder')).toEqual(['new-folder']);
  });
});
