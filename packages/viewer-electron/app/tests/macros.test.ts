// @vitest-environment jsdom
/**
 * Command sequences and macros: a custom action may run built-in commands in order, the
 * later ones where the earlier left things; Record macro collects what the person runs; an agent
 * may propose a sequence only if it could propose each step.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentCommandID } from '../src/domain/agents/safety';
import type { CustomAction } from '../src/domain/automation/actions';
import { programCommands } from '../src/renderer/commands/programs';
import type { CommandContext } from '../src/renderer/commands/registry';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { getState, initialize, receiveSettings } from '../src/renderer/state/store';
import { macroRecording, recordCommand, startMacro, stopMacro } from '../src/renderer/keys/macro';

const sequence = (commands: string[]): CustomAction => ({
  id: 'macro',
  name: 'Copy all',
  aliases: [],
  icon: 'command',
  shortcut: '',
  order: 0,
  pinned: false,
  when: { target: 'any', extensions: [], min: 0, max: 10000 },
  executor: { kind: 'sequence', commands },
});
beforeEach(() => {
  Object.assign(window, { viewer: { save: vi.fn(async () => {}) } });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
});

describe('a command sequence', () => {
  const install = (action: CustomAction) => {
    const snapshot = structuredClone(getState().settings);
    snapshot.revision++;
    snapshot.settings.customActions = [action];
    receiveSettings(snapshot);
  };
  const first = { scope: 'window', paneID: 'first', selection: [] } as unknown as CommandContext;
  const later = { scope: 'window', paneID: 'later', selection: [] } as unknown as CommandContext;
  it('runs its commands in order, the later ones in the context as it now is', async () => {
    install(sequence(['select-all', 'copy']));
    const invoke = vi.fn(async () => true);
    const command = programCommands({} as WorkspaceController, invoke, undefined, () => later).find(
      (item) => item.id === 'custom.macro',
    )!;
    // a sequence is available outside a folder plane too
    expect(command.when(first)).toBe(true);
    await command.run(first);
    expect(invoke.mock.calls).toEqual([
      ['select-all', first],
      ['copy', later],
    ]);
  });
  it('stops at a step not available here, and says which', async () => {
    install(sequence(['select-all', 'nothing-here', 'copy']));
    const invoke = vi.fn(async (id: string) => id !== 'nothing-here');
    const command = programCommands({} as WorkspaceController, invoke, undefined, () => later).find(
      (item) => item.id === 'custom.macro',
    )!;
    await expect(command.run(first)).rejects.toThrow('stopped at “nothing-here”');
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it('is an agent’s to propose only if each step is', () => {
    expect(agentCommandID('custom.macro', [sequence(['select-all', 'duplicate'])])).toBe(
      'custom.macro',
    );
    expect(() =>
      agentCommandID('custom.macro', [sequence(['select-all', 'open-terminal-plane'])]),
    ).toThrow(/terminal/);
  });
});

describe('Record macro', () => {
  it('collects the commands run while recording, not the ones that steer it', () => {
    expect(macroRecording()).toBeNull();
    recordCommand('copy');
    startMacro();
    recordCommand('select-all');
    recordCommand('record-macro');
    recordCommand('workspace:other');
    recordCommand('copy');
    expect(stopMacro()).toEqual(['select-all', 'copy']);
    expect(macroRecording()).toBeNull();
  });
});
