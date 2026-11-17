import { describe, expect, it, vi } from 'vitest';
import {
  agentCommandID,
  agentDispatchRefusal,
  modelLineCommandProblem,
} from '../src/domain/agents/safety';
import { agentPlaneCopy, agentWorkspaceCopy } from '../src/domain/agents/requests';
import { spokenRun } from '../src/domain/command-line/spoken';
import { promptLineProblem } from '../src/domain/command-line/prompt';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { agentCatalog } from '../src/renderer/commands/agent-catalog';
import { sampleDefinition, sampleWorkspace } from './workspace-definition-fixtures';
import { catalogCommands } from '../src/renderer/commands/window-commands/catalog';
import { workspacesCommands } from '../src/renderer/commands/window-commands/workspaces';
import { windowScopes } from '../src/renderer/commands/window-commands/scope';
import type { WindowActions } from '../src/renderer/commands/window-commands/scope';
import { initialize } from '../src/renderer/state/store';

describe('definition command safety boundaries', () => {
  it('marks the actual close, reset and save commands human-only and restricts Save as to capturable planes', () => {
    vi.stubGlobal('window', { dispatchEvent: vi.fn(), viewer: { save: vi.fn() } });
    try {
      const definition = sampleDefinition();
      const workspace = sampleWorkspace('sample', {
        definition: { key: definition.key, basis: definition.basis },
      });
      initialize({
        home: '/fixtures',
        platform: 'darwin',
        locations: [],
        openPaths: [],
        state: {
          version: 13,
          look: 'dark',
          activeWorkspace: workspace.id,
          workspaces: [workspace],
          favorites: [],
          recents: [],
        },
      });
      const scopes = windowScopes({ ready: true } as WindowActions);
      const commands = workspacesCommands(scopes);
      for (const id of [
        'close-workspace',
        'reset-workspace',
        'save-workspace-definition',
        'save-workspace-as-definition',
      ])
        expect(commands.find((command) => command.id === id)!.humanOnly).toBe(true);
      expect(
        commands.find((command) => command.id === 'save-workspace-definition')!.aliases,
      ).toContain('sync');
      expect(commands.find((command) => command.id === 'delete-workspace')!.unavailable).toBe(
        'This workspace comes from a definition. Close it instead, or remove the definition with Edit Workspace Definitions.',
      );
      const adhoc = { ...scopes, space: { ...workspace, definition: undefined } };
      const saveAs = workspacesCommands(adhoc).find(
        (command) => command.id === 'save-workspace-as-definition',
      )!;
      expect(saveAs.when({ scope: 'window' } as never)).toBe(false);
      adhoc.space.panes = [
        { id: 'scratch', type: 'scratch', path: '/projects/sample', bufferID: 'scratch' },
      ];
      expect(
        workspacesCommands(adhoc)
          .find((command) => command.id === 'save-workspace-as-definition')!
          .when({ scope: 'window' } as never),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('marks actual defined catalog rows human-only and uses singular plane details', async () => {
    const open = vi.fn();
    vi.stubGlobal('window', {
      viewer: { workspaceDefinitions: open, save: vi.fn() },
      dispatchEvent: vi.fn(),
    });
    try {
      const definition = sampleDefinition();
      initialize({
        home: '/home/sample',
        platform: 'darwin',
        locations: [],
        openPaths: [],
        state: null,
        definitions: {
          revision: 1,
          file: { path: '/data/workspaces.jsonc', state: 'read' },
          projectManager: {
            path: '/source/projects.json',
            state: 'read',
            projects: 1,
            missing: 0,
            disabled: 0,
            remote: 0,
            duplicateKeys: 0,
          },
          definitions: [definition],
          diagnostics: [],
        },
      });
      const scopes = windowScopes({ ready: true } as WindowActions);
      const commands = catalogCommands(scopes).filter((command) =>
        command.id.startsWith('defined:'),
      );
      expect(commands).toHaveLength(1);
      expect(commands[0]!.humanOnly).toBe(true);
      expect(commands[0]!.detail).toBe('sample/site · 1 plane');
      const context = {
        workspaceID: scopes.space.id,
        rootID: 'none',
        paneID: 'none',
        scope: 'window' as const,
        invocation: 'custom-action' as const,
        selection: [],
        jobs: [],
        clipboard: null,
      };
      const registry = new CommandRegistry();
      registry.register('window', { definitions: () => commands, context: () => context });
      await expect(registry.invoke(commands[0]!.id, { context })).rejects.toThrow();
      expect(open).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('publishes only open workspace choices to agents', () => {
    const registry = new CommandRegistry();
    const context = {
      workspaceID: 'open',
      rootID: 'none',
      paneID: 'none',
      scope: 'window' as const,
      selection: [],
      jobs: [],
      clipboard: null,
    };
    registry.register('window', {
      context: () => context,
      definitions: () =>
        ['workspace:open', 'defined:private/key', 'edit-workspace-definitions'].map((id) => ({
          id,
          label: id,
          group: 'Workspaces',
          when: () => true,
          run: () => {},
        })),
    });
    expect(agentCatalog(registry, context).map((command) => command.id)).toEqual([
      'workspace:open',
    ]);
  });
  it.each([
    'defined:sample/site',
    'edit-workspace-definitions',
    'close-workspace',
    'reset-workspace',
    'reset-definition:sample',
    'save-workspace-definition',
    'save-workspace-as-definition',
    'run-workspace-commands',
  ])('refuses %s from agent, model and spoken routes', (id) => {
    expect(() => agentCommandID(id, [])).toThrow('only to the person');
    expect(modelLineCommandProblem(id, [])).toContain('workspace');
    expect(spokenRun(id, []).run).toBe('refused');
    expect(agentDispatchRefusal({ command: id, deadline: Date.now() + 1000 }, [])).toContain(
      'only to the person',
    );
  });
  it.each(['defined:sample/site', 'run-workspace-commands'])(
    'refuses %s in model-authored lines, Ask in words, spoken plans and nested macros',
    (id) => {
      const actions = [
        { id: 'macro', executor: { kind: 'sequence', commands: [id] } },
      ] as unknown as Parameters<typeof modelLineCommandProblem>[1];
      expect(modelLineCommandProblem(id, actions)).toBe("it can start a workspace's commands");
      expect(promptLineProblem(id, new Set([id]), actions)).toContain(
        "it can start a workspace's commands",
      );
      expect(
        promptLineProblem('Macro', new Set([id]), actions, new Map([['Macro', [id]]])),
      ).toContain("it can start a workspace's commands");
      expect(spokenRun(id, actions)).toMatchObject({
        run: 'refused',
        reason: "it can start a workspace's commands",
      });
      expect(() => agentCommandID('custom.macro', actions)).toThrow('only to the person');
    },
  );
  it('strips definition metadata from every echoed workspace and terminal plane', () => {
    const workspace = {
      ...sampleWorkspace('open'),
      definition: { key: 'private/key', basis: 'a'.repeat(64) },
      panes: [
        {
          id: 'terminal',
          type: 'terminal' as const,
          path: '/shared',
          profileID: 'login',
          definitionPlane: 3,
        },
      ],
      roots: ['terminal'],
    };
    expect(agentWorkspaceCopy(workspace)).toEqual({
      id: 'open',
      name: workspace.name,
      roots: ['terminal'],
      panes: [{ id: 'terminal', type: 'terminal', path: '/shared' }],
    });
    expect(agentPlaneCopy(workspace.panes[0]!)).not.toHaveProperty('definitionPlane');
  });
  it('keeps human-only definition actions out of custom-action execution', async () => {
    const registry = new CommandRegistry();
    let calls = 0;
    const context = {
      workspaceID: 'open',
      rootID: 'none',
      paneID: 'none',
      scope: 'window' as const,
      invocation: 'custom-action' as const,
      selection: [],
      jobs: [],
      clipboard: null,
    };
    registry.register('window', {
      definitions: () => [
        {
          id: 'defined:sample/site',
          label: 'Sample',
          group: 'Workspaces',
          humanOnly: true,
          when: () => true,
          run: () => {
            calls++;
          },
        },
      ],
      context: () => context,
    });
    await expect(registry.invoke('defined:sample/site', { context })).rejects.toThrow();
    expect(calls).toBe(0);
  });
});
