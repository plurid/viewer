import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomAction } from '../src/domain/automation/actions';
import { agentCommandID } from '../src/domain/agents/safety';
import { normalizePreferences } from '../src/domain/preferences/ui';
import { defaultSettings } from '../src/domain/services';
import { programCommands } from '../src/renderer/commands/programs';
import { CommandRegistry } from '../src/renderer/commands/registry';
import type { CommandContext } from '../src/renderer/commands/registry';
import { runLine } from '../src/renderer/command-line/run';
import type { LineHost } from '../src/renderer/command-line/host';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { executeAgentNavigation } from '../src/renderer/workspace/agent-navigation';
import type { ViewerState } from '../src/renderer/state/core';
import { replaceState } from '../src/renderer/state/core';

function action(id: string, executor: CustomAction['executor']): CustomAction {
  return {
    id,
    name: id,
    aliases: [],
    icon: 'command',
    shortcut: '',
    order: 0,
    pinned: false,
    when: { target: 'any', extensions: [], min: 0, max: 10000 },
    executor,
  };
}

function sequence(id: string, commands: string[]): CustomAction {
  return action(id, { kind: 'sequence', commands });
}

describe('bounded agent sequence policy', () => {
  it.each([
    { name: 'direct step', actions: [sequence('outer', ['frame-all', 'trash'])] },
    {
      name: 'alias',
      actions: [
        sequence('outer', ['custom.remove']),
        action('remove', { kind: 'builtin', command: 'trash' }),
      ],
    },
    {
      name: 'nested alias',
      actions: [
        sequence('outer', ['custom.inner']),
        sequence('inner', ['custom.remove']),
        action('remove', { kind: 'builtin', command: 'trash' }),
      ],
    },
  ])('requires a separate exact-path proposal for Trash reached through a $name', ({ actions }) => {
    expect(() => agentCommandID('custom.outer', actions)).toThrow(
      /separate exact-path Trash proposal/i,
    );
  });

  it('preserves a direct Trash alias so the caller can capture exact paths and content proofs', () => {
    expect(
      agentCommandID('custom.remove', [action('remove', { kind: 'builtin', command: 'trash' })]),
    ).toBe('trash');
  });

  it('accepts safe sequences and repeated references without mistaking a shared child for a cycle', () => {
    const actions = [
      sequence('outer', ['custom.inner', 'custom.inner', 'profile.focus']),
      sequence('inner', ['frame-all', 'copy-path']),
    ];
    expect(agentCommandID('custom.outer', actions)).toBe('custom.outer');
  });

  it.each([
    { name: 'self', actions: [sequence('outer', ['custom.outer'])] },
    {
      name: 'mutual',
      actions: [sequence('outer', ['custom.inner']), sequence('inner', ['custom.outer'])],
    },
  ])('reports a $name cycle before JavaScript recursion is exhausted', ({ actions }) => {
    expect(() => agentCommandID('custom.outer', actions)).toThrow(/cycle|recursive/i);
  });

  it('rejects more than ten nested sequences', () => {
    const actions = Array.from({ length: 11 }, (_, index) =>
      sequence(`step-${index}`, [index === 10 ? 'frame-all' : `custom.step-${index + 1}`]),
    );
    expect(() => agentCommandID('custom.step-0', actions)).toThrow(/nested|deep/i);
  });

  it('accepts ten nested sequences', () => {
    const actions = Array.from({ length: 10 }, (_, index) =>
      sequence(`step-${index}`, [index === 9 ? 'frame-all' : `custom.step-${index + 1}`]),
    );
    expect(agentCommandID('custom.step-0', actions)).toBe('custom.step-0');
  });

  it('bounds expansion work even when a shallow acyclic graph repeats many children', () => {
    const actions = Array.from({ length: 4 }, (_, index) =>
      sequence(
        `step-${index}`,
        Array<string>(20).fill(index === 3 ? 'frame-all' : `custom.step-${index + 1}`),
      ),
    );
    expect(() => agentCommandID('custom.step-0', actions)).toThrow(/expanded|1000/i);
  });
});

describe('agent sequence deadline and dispatch propagation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts later sequence steps past agentDispatchDeadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const seq = sequence('slow-seq', ['step-one', 'refresh']);
    const settings = defaultSettings('/fixture');
    settings.customActions = [seq];
    replaceState({
      settings: {
        settings,
        ui: normalizePreferences(),
        look: 'dark',
        revision: 1,
        config: { path: '' },
      },
    } as unknown as ViewerState);
    const ran: string[] = [];
    const invoke = vi.fn(async (id: string) => {
      ran.push(id);
      if (id === 'step-one') vi.advanceTimersByTime(25_000);
      return true;
    });
    const commands = programCommands({} as WorkspaceController, invoke);
    const definition = commands.find((item) => item.id === 'custom.slow-seq')!;
    const context: CommandContext = {
      scope: 'workspace',
      workspaceID: 'ws-1',
      selection: [],
      clipboard: null,
      jobs: [],
      agentDispatchID: 'dispatch-1',
      agentDispatchDeadline: Date.now() + 24_000,
    };
    await expect(definition.run(context)).rejects.toThrow(/timed out/i);
    expect(ran).toEqual(['step-one']);
  });

  it('propagates agentDispatchID and checks agentDispatchDeadline across piped and counted command-line steps', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(200_000);
    const activeTags: (string | undefined)[] = [];
    let currentTag: string | undefined;
    vi.stubGlobal('window', {
      viewerDispatch: {
        set: (id: string | undefined) => {
          currentTag = id;
        },
      },
    });
    try {
      const seq = sequence('piped-seq', ['step-one | step-two']);
      const counted = sequence('counted-seq', ['2 step-one']);
      const settings = defaultSettings('/fixture');
      settings.customActions = [seq, counted];
      replaceState({
        settings: {
          settings,
          ui: normalizePreferences(),
          look: 'dark',
          revision: 1,
          config: { path: '' },
        },
      } as unknown as ViewerState);
      const registry = new CommandRegistry();
      let stepOneAdvance = 0;
      const baseContext: CommandContext = {
        scope: 'workspace',
        workspaceID: 'ws-1',
        selection: [],
        clipboard: null,
        jobs: [],
      };
      registry.register('window', {
        context: () => baseContext,
        definitions: () => [
          {
            id: 'step-one',
            label: 'Step One',
            group: 'Test',
            when: () => true,
            run: async (ctx) => {
              activeTags.push(currentTag ?? ctx.agentDispatchID);
              await Promise.resolve();
              if (stepOneAdvance) vi.advanceTimersByTime(stepOneAdvance);
            },
          },
          {
            id: 'step-two',
            label: 'Step Two',
            group: 'Test',
            when: () => true,
            run: async (ctx) => {
              activeTags.push(currentTag ?? ctx.agentDispatchID);
            },
          },
        ],
      });
      const host: LineHost = {
        invoke: (id, remember, agent) =>
          registry.invoke(id, {
            scope: 'workspace',
            context: {
              ...baseContext,
              ...(agent?.id ? { agentDispatchID: agent.id } : {}),
              ...(agent?.deadline !== undefined ? { agentDispatchDeadline: agent.deadline } : {}),
            },
            remember,
          }),
        registry,
        workspace: {} as WorkspaceController,
        context: () => baseContext,
        newWorkspace: async () => {},
        switchWorkspace: async () => {},
        palette: () => {},
      };
      const commands = programCommands(
        {} as WorkspaceController,
        (id, ctx) => registry.invoke(id, { scope: 'workspace', context: ctx }),
        undefined,
        () => baseContext,
        (text, agent) => runLine(text, agent ? { ...host, agent } : host),
      );
      const pipedDef = commands.find((item) => item.id === 'custom.piped-seq')!;
      await pipedDef.run({
        ...baseContext,
        agentDispatchID: 'dispatch-pipe',
        agentDispatchDeadline: Date.now() + 24_000,
      });
      expect(activeTags).toEqual(['dispatch-pipe', 'dispatch-pipe']);

      // When step-one crosses the deadline, step-two must not run.
      activeTags.length = 0;
      stepOneAdvance = 25_000;
      await expect(
        pipedDef.run({
          ...baseContext,
          agentDispatchID: 'dispatch-pipe',
          agentDispatchDeadline: Date.now() + 24_000,
        }),
      ).rejects.toThrow(/timed out/i);
      expect(activeTags).toEqual(['dispatch-pipe']);

      // Counted repetition also stops once the deadline expires.
      activeTags.length = 0;
      const countedDef = commands.find((item) => item.id === 'custom.counted-seq')!;
      await expect(
        countedDef.run({
          ...baseContext,
          agentDispatchID: 'dispatch-count',
          agentDispatchDeadline: Date.now() + 24_000,
        }),
      ).rejects.toThrow(/timed out/i);
      expect(activeTags).toEqual(['dispatch-count']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('aborts open-path agent navigation when stat resolves past agentDispatchDeadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(300_000);
    const open = vi.fn();
    const stat = vi.fn(async (file: string) => {
      vi.advanceTimersByTime(25_000);
      return {
        path: file,
        name: 'report.txt',
        parent: '/fixture',
        extension: 'txt',
        kind: 'file' as const,
        directory: false,
        size: 10,
        modified: 1,
        created: 1,
        hidden: false,
        mime: 'text/plain',
        identity: '1:1',
      };
    });
    vi.stubGlobal('window', {
      viewer: { stat },
      viewerDispatch: { set: vi.fn() },
    });
    replaceState({
      saved: {
        activeWorkspace: 'ws-1',
        workspaces: [
          {
            id: 'ws-1',
            name: 'Main',
            panes: [{ id: 'pane-1', type: 'folder', path: '/fixture', mode: 'list' }],
            roots: ['pane-1'],
            arrangement: {},
          },
        ],
      },
    } as unknown as ViewerState);
    try {
      await expect(
        executeAgentNavigation(
          { kind: 'open-path', path: '/fixture/report.txt', placement: 'linked' },
          {
            workspaceID: 'ws-1',
            rootID: 'pane-1',
            paneID: 'pane-1',
            panePath: '/fixture',
            directory: '/fixture',
            selection: [],
          },
          { rootID: () => 'pane-1', open, focusPane: vi.fn() } as unknown as WorkspaceController,
          async () => {},
          'dispatch-nav',
          Date.now() + 24_000,
        ),
      ).rejects.toThrow(/timed out/i);
      expect(open).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
