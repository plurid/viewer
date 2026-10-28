import { expect, it } from 'vitest';
import { taskLineDraft } from '../src/domain/command-line/task';
import { expandPath } from '../src/domain/command-line/lex';
import { parseCommandLine } from '../src/domain/command-line/verbs';
import { promptLineProblem } from '../src/domain/command-line/prompt';

const draft = (line: string) =>
  taskLineDraft(parseCommandLine(line)[0]!.words, (word) =>
    expandPath(word, { home: '/home/person', folder: '/projects/repo' }),
  );
it('fills typed editable task parameters and resolves paths from the captured folder', () => {
  expect(
    draft(
      'task-new "Ship the feature" --repo . --branch feature/ship --path "../Feature worktree" --base main --workspace "Studio"',
    ),
  ).toEqual({
    name: 'Ship the feature',
    repo: '/projects/repo',
    branch: 'feature/ship',
    path: '/projects/Feature worktree',
    base: 'main',
    workspace: 'Studio',
  });
  expect(draft('task-new')).toEqual({});
  expect(draft('task-new Review --branch existing --existing')).toEqual({
    name: 'Review',
    branch: 'existing',
    existing: true,
  });
});
it.each([
  ['task-new X --branch', 'needs a value'],
  ['task-new X --shell command', 'Unknown task option'],
  ['task-new X --path /one --path /two', 'repeated'],
  ['task-new X --branch bad..branch', 'valid value'],
  ['task-new X --existing --base main', 'not both'],
  ['task-new --branch feature misplaced-name', 'task name before'],
])('rejects ambiguous or invalid parameters in %s', (line, message) => {
  expect(() => draft(line)).toThrow(message);
});
it('allows Ask to propose the form but forbids repeated or sequenced task requests', () => {
  const check = (line: string) =>
    promptLineProblem(line, new Set(['frame-all']), [], new Map([['Task', ['task-new X']]]));
  expect(check('task-new "Ship it" --branch feature/ship')).toBeUndefined();
  for (const line of ['2task-new X', 'frame-all | task-new X', 'task-new X | frame-all', 'Task'])
    expect(check(line)).toMatch(/alone/);
  expect(check('task-new X --shell command')).toMatch(/Unknown task option/);
});
