import { describe, expect, it } from 'vitest';
import { promptLineProblem } from '../src/domain/command-line/prompt';
import type { CustomAction } from '../src/domain/automation';
import { CommandRegistry, type CommandContext } from '../src/renderer/commands/registry';
import { agentCatalog } from '../src/renderer/commands/agent-catalog';

describe('expanded model commands', () => {
  const ids = new Set(['frame-all', 'trash', 'custom.hidden', 'custom.nested']);
  const actions = [
    { id: 'hidden', executor: { kind: 'builtin', command: 'trash' } },
    { id: 'nested', executor: { kind: 'sequence', commands: ['custom.hidden'] } },
  ] as unknown as CustomAction[];
  it('checks nested aliases, custom builtins and sequences before any step runs', () => {
    const names = new Map([
      ['Clean', ['frame-all | custom.nested']],
      ['Indirect', ['Clean']],
    ]);
    expect(promptLineProblem('Indirect', ids, actions, names)).toMatch(/trash/i);
    expect(promptLineProblem('custom.hidden', ids, actions)).toMatch(/trash/i);
    expect(
      promptLineProblem('Safe', ids, actions, new Map([['Safe', ['frame-all']]])),
    ).toBeUndefined();
    expect(promptLineProblem('Loop', ids, actions, new Map([['Loop', ['Loop']]]))).toMatch(
      /deeply/,
    );
  });
  it('does not let an argument become another command', () => {
    const names = new Map([['Safe', ['frame-all $1']]]);
    expect(promptLineProblem("Safe 'trash | send-keys x'", ids, actions, names)).toBeDefined();
  });
});

it('publishes window actions beside file actions and retains invocation scopes', () => {
  const registry = new CommandRegistry();
  const context = {
    scope: 'files',
    workspaceID: 'space',
    paneID: 'pane',
    selection: [],
    jobs: [],
    clipboard: null,
  } as CommandContext;
  registry.register('window', {
    context: () => ({ ...context, scope: 'window' }),
    definitions: () =>
      ['focus-mode', 'profile.focus', 'setting.ui.space.grid'].map((id) => ({
        id,
        label: id,
        group: 'View',
        when: (c) => c.scope === 'window',
        run() {},
      })),
  });
  registry.register('folder:pane', {
    context: () => context,
    definitions: () => [
      { id: 'info', label: 'Info', group: 'Files', when: (c) => c.scope === 'files', run() {} },
    ],
  });
  const selected = {
    ...context,
    selection: [
      {
        path: '/fixture',
        name: 'fixture',
        parent: '/',
        extension: '',
        kind: 'file' as const,
        directory: false,
        size: 0,
        modified: 0,
        created: 0,
        hidden: false,
        mime: '',
        identity: 'fixture',
      },
    ],
  };
  const catalog = agentCatalog(registry, selected);
  expect(catalog.map((c) => c.id)).toEqual([
    'info',
    'focus-mode',
    'profile.focus',
    'setting.ui.space.grid',
  ]);
  expect(catalog.find((c) => c.id === 'focus-mode')?.context.scope).toBe('window');
});
