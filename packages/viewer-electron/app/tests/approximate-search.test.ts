import { expect, it } from 'vitest';
import { boundedEditDistance, typoScore } from '../src/domain/search/approximate';
import { didYouMean } from '../src/domain/command-line/verbs';
import { rankFiles, commandScore } from '../src/renderer/commands/registry';
import type { FileEntry } from '../src/domain/contracts';
import type { ResolvedCommand } from '../src/renderer/commands/registry';

it('recognizes adjacent transpositions without rewriting a command', () => {
  expect(boundedEditDistance('iint', 'init', 1)).toBe(1);
  expect(didYouMean('iint', ['commit', 'init', 'status'])).toBe('init');
  expect(typoScore('git init', 'git iint')).toBeGreaterThan(0);
  expect(typoScore('close plane', 'q')).toBe(0);
  expect(typoScore('delete file', 'delicate')).toBe(0);
  expect(typoScore('init git', 'git iint')).toBe(0);
});
it('ranks exact files ahead of typo candidates and keeps command discovery explicit', () => {
  const entries = ['budget.xlsx', 'bugdet.xlsx', 'meeting.pdf'].map((name) => ({
    name,
  })) as FileEntry[];
  expect(rankFiles(entries, 'bugdet').map((entry) => entry.name)).toEqual([
    'bugdet.xlsx',
    'budget.xlsx',
  ]);
  const command = { label: 'Git init', aliases: [], group: 'Git' } as unknown as ResolvedCommand;
  expect(commandScore(command, 'git iint')).toBeGreaterThan(0);
  expect(command.label).toBe('Git init');
  expect(boundedEditDistance('x'.repeat(10000), 'a', 2)).toBe(3);
});
