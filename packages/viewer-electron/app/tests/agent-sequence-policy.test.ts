import { describe, expect, it } from 'vitest';
import type { CustomAction } from '../src/domain/automation/actions';
import { agentCommandID } from '../src/domain/agents/safety';

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
