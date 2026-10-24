import { describe, expect, it, vi } from 'vitest';
import type { FileEntry, FolderPane } from '../src/domain/contracts';
import { localServerCommands } from '../src/renderer/local-servers/commands';
import { CommandRegistry, type CommandContext } from '../src/renderer/commands/registry';
import { contextMenuSections } from '../src/renderer/commands/menu';

const folder: FolderPane = {
  id: 'folder-pane',
  type: 'folder',
  path: '/fixture',
  mode: 'list',
  sort: 'name',
  descending: false,
  showHidden: false,
  history: ['/fixture'],
  historyIndex: 0,
};
const entry = (directory: boolean): FileEntry => ({
  path: directory ? '/fixture/site' : '/fixture/index.html',
  name: directory ? 'site' : 'index.html',
  parent: '/fixture',
  extension: directory ? '' : 'html',
  kind: directory ? 'directory' : 'file',
  directory,
  size: 20,
  created: 1,
  modified: 1,
  hidden: false,
  mime: 'text/plain',
  identity: '1:2',
});
const context = (selection: FileEntry[] = []): CommandContext => ({
  scope: selection.length ? 'files' : 'folder',
  workspaceID: 'workspace',
  rootID: folder.id,
  paneID: folder.id,
  path: folder.path,
  directory: folder.path,
  folder,
  selection,
  clipboard: null,
  jobs: [],
});

describe('Start local server folder command', () => {
  it('is discoverable in the real folder context menu and invokes the captured folder', async () => {
    const newServer = vi.fn(async () => {});
    const workspace = { newServer, rootID: () => folder.id };
    const registry = new CommandRegistry();
    registry.register('window', {
      context: () => context(),
      definitions: () => localServerCommands(workspace),
    });
    const commands = registry.list();
    const sections = contextMenuSections(commands, []);
    expect(JSON.stringify(sections)).toContain('Start local server');
    expect(await registry.invoke('start-local-server', {})).toBe(true);
    expect(newServer).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        workspaceID: 'workspace',
        paneID: folder.id,
        rootID: folder.id,
        panePath: '/fixture',
        directory: '/fixture',
        selection: [],
      }),
    );
  });

  it('serves one selected folder and freezes its identity before asynchronous creation', async () => {
    const selected = entry(true);
    const newServer = vi.fn(async () => {});
    const [command] = localServerCommands({ newServer, rootID: () => folder.id });
    const captured = context([selected]);
    expect(command!.when(captured)).toBe(true);
    await command!.run(captured);
    selected.identity = 'replacement';
    expect(newServer).toHaveBeenCalledWith(
      expect.objectContaining({
        directory: '/fixture/site',
        selection: [expect.objectContaining({ identity: '1:2' })],
      }),
    );
  });

  it('does not offer ambiguous selections, files, symlink folders or unrelated scopes', () => {
    const [command] = localServerCommands({
      newServer: vi.fn(async () => {}),
      rootID: () => folder.id,
    });
    for (const target of [
      context([entry(false)]),
      context([entry(true), entry(true)]),
      context([{ ...entry(true), kind: 'symlink' }]),
      { ...context(), scope: 'preview' as const },
      { ...context(), paneID: undefined },
      { ...context(), folder: undefined },
    ])
      expect(command!.when(target)).toBe(false);
  });
});
