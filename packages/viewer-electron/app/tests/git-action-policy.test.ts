import { describe, expect, it } from 'vitest';
import type { CustomAction } from '../src/domain/automation/actions';
import {
  agentCommandID,
  agentDispatchRefusal,
  modelLineCommandProblem,
} from '../src/domain/agents/safety';
import { promptLineProblem } from '../src/domain/command-line/prompt';
import { gitActionKinds } from '../src/domain/comparison/git-actions';

const custom = (id: string, executor: CustomAction['executor']): CustomAction => ({
  id,
  name: id,
  aliases: [],
  icon: 'command',
  shortcut: '',
  order: 0,
  pinned: false,
  when: { target: 'any', extensions: [], min: 0, max: 1000 },
  executor,
});

describe('human Git commands remain unavailable to agents and models', () => {
  it.each(gitActionKinds)(
    'denies %s directly, through a builtin and through nested sequences',
    (kind) => {
      const command = `git-action.${kind}`;
      const actions = [
        custom('alias', { kind: 'builtin', command }),
        custom('sequence', { kind: 'sequence', commands: ['frame-all | custom.alias'] }),
        custom('nested', { kind: 'sequence', commands: ['custom.sequence'] }),
      ];
      const commands = new Set([
        'frame-all',
        command,
        ...actions.map((action) => `custom.${action.id}`),
      ]);
      for (const id of [command, 'custom.alias', 'custom.sequence', 'custom.nested']) {
        expect(() => agentCommandID(id, actions)).toThrow(/only to the person/i);
        expect(modelLineCommandProblem(id, actions)).toMatch(/only to the person/i);
        expect(promptLineProblem(id, commands, actions)).toMatch(/only to the person/i);
      }
      expect(
        promptLineProblem(
          'Publish',
          commands,
          actions,
          new Map([['Publish', ['frame-all | custom.nested']]]),
        ),
      ).toMatch(/only to the person/i);
      expect(agentDispatchRefusal({ command, deadline: 1000 }, actions, 1)).toMatch(
        /only to the person/i,
      );
    },
  );

  it('still allows safe command sequences and refuses cycles, arguments and program aliases', () => {
    const safe = custom('safe', { kind: 'sequence', commands: ['2frame-all | copy-path'] });
    expect(agentCommandID('custom.safe', [safe])).toBe('custom.safe');
    expect(modelLineCommandProblem('custom.safe', [safe])).toBeUndefined();
    const cycle = custom('cycle', { kind: 'sequence', commands: ['custom.cycle'] });
    expect(() => agentCommandID('custom.cycle', [cycle])).toThrow('recursive');
    expect(modelLineCommandProblem('custom.cycle', [cycle])).toMatch('recursively');
    const injected = custom('injected', {
      kind: 'sequence',
      commands: ['frame-all "| git-action.push"'],
    });
    expect(() => agentCommandID('custom.injected', [injected])).toThrow('without arguments');
    expect(modelLineCommandProblem('custom.injected', [injected])).toMatch('unsupported arguments');
    for (const executor of [
      { kind: 'terminal', profileID: 'git' },
      { kind: 'shell', executable: '/bin/zsh', script: 'git push', perItem: false },
      { kind: 'executable', executable: '/usr/bin/git', args: ['push'], perItem: false },
    ] satisfies CustomAction['executor'][]) {
      const action = custom('program', executor);
      expect(() => agentCommandID('custom.program', [action])).toThrow('bypass Trash');
      expect(modelLineCommandProblem('custom.program', [action])).toBe('it runs a program');
    }
  });
});
