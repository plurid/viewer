// @vitest-environment jsdom
/**
 * A ROOT TERMINAL PLANE (2026-10-23): Open terminal plane links a terminal to the folder it was
 * opened from; New terminal plane is a plane of its own, a root, from anywhere, starting where new
 * planes start (Settings → Browsing).
 */
import { beforeEach, expect, it, vi } from 'vitest';
import { programCommands } from '../src/renderer/commands/programs';
import type { CommandContext } from '../src/renderer/commands/registry';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { activeWorkspace, initialize } from '../src/renderer/state/store';
import { agentCommandID } from '../src/domain/agent-safety';

const newTerminal = vi.fn();
const workspace = { newTerminal, rootID: () => 'root' } as unknown as WorkspaceController;
beforeEach(() => {
  newTerminal.mockClear();
  Object.assign(window, { viewer: { save: vi.fn(async () => {}) } });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
const find = (id: string) => programCommands(workspace, vi.fn())!.find((item) => item.id === id)!;
const folder = () => {
  const pane = activeWorkspace().panes[0]!;
  return {
    scope: 'folder',
    workspaceID: activeWorkspace().id,
    paneID: pane.id,
    directory: '/fixtures/project',
    path: pane.path,
    selection: [],
  } as unknown as CommandContext;
};

it('opens a root terminal plane from anywhere, where new planes start', async () => {
  const command = find('new-terminal-plane');
  expect(command.label).toBe('New terminal plane');
  const window = { scope: 'window', workspaceID: activeWorkspace().id, selection: [] };
  expect(command.when(window as unknown as CommandContext)).toBe(true);
  await command.run(window as unknown as CommandContext);
  expect(newTerminal).toHaveBeenLastCalledWith(
    expect.objectContaining({ paneID: '', directory: '/fixtures' }),
  );
  // from a folder, by default in that folder, still a root
  await command.run(folder());
  expect(newTerminal).toHaveBeenLastCalledWith(
    expect.objectContaining({ paneID: '', directory: '/fixtures/project' }),
  );
});
it('keeps Open terminal plane linked to its folder', async () => {
  await find('open-terminal-plane').run(folder());
  expect(newTerminal).toHaveBeenLastCalledWith(
    expect.objectContaining({
      paneID: activeWorkspace().panes[0]!.id,
      directory: '/fixtures/project',
    }),
  );
});
it("is no agent's to open: a terminal can bypass the Trash", () => {
  expect(() => agentCommandID('new-terminal-plane', [])).toThrow(/terminal/);
});
