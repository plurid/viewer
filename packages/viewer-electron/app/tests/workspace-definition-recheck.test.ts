import { describe, expect, it, vi } from 'vitest';
import { schemas } from '../src/desktop/ipc/schemas';
import { rankWorkspaceChoices } from '../src/domain/workspaces/definitions/query';
import { sampleDefinition } from './workspace-definition-fixtures';
import { definitionEntrySchema } from '../src/domain/workspaces/definitions/schema';

describe('definition recheck regressions', () => {
  it('normalizes search data once per catalog revision', () => {
    const definitions = Array.from({ length: 32 }, (_, index) =>
      sampleDefinition(`sample/project-${index}`),
    );
    rankWorkspaceChoices([], definitions, 'project');
    const normalize = vi.spyOn(String.prototype, 'normalize');
    try {
      rankWorkspaceChoices([], definitions, 'sample');
      expect(normalize).toHaveBeenCalledTimes(1);
      normalize.mockClear();
      rankWorkspaceChoices([], [...definitions], 'sample');
      expect(normalize).toHaveBeenCalledTimes(1);
      normalize.mockClear();
      rankWorkspaceChoices([], definitions.map((item, index) => index ? { ...item } : { ...item, name: 'Changed name', aliases: ['alternate'], projectName: 'Sample > Renamed' }), 'alternate');
      expect(normalize.mock.calls.length).toBeGreaterThan(1);
      expect(normalize.mock.calls.length).toBeLessThan(10);
    } finally {
      normalize.mockRestore();
    }
    const split = vi.spyOn(String.prototype, 'split');
    try {
      rankWorkspaceChoices([], definitions, 'clinet');
      expect(split.mock.calls.length).toBeLessThan(4);
    } finally {
      split.mockRestore();
    }
  });
  it('rejects an open request that contains any command-start flag', () => {
    expect(
      schemas.workspaceDefinitions.safeParse([{ kind: 'open', key: 'sample/site', start: true }])
        .success,
    ).toBe(false);
    expect(
      schemas.workspaceDefinitions.safeParse([{ kind: 'open', key: 'sample/site' }]).success,
    ).toBe(true);
  });
  it('keeps renderer-provided paths, snapshots and commands out of every save request', () => {
    const valid = { kind: 'save', workspaceID: 'sample', order: ['pane'] };
    expect(schemas.workspaceDefinitions.safeParse([valid]).success).toBe(true);
    for (const extra of [
      { command: 'echo sample' },
      { workspace: {} },
      { path: '/projects/sample' },
    ])
      expect(schemas.workspaceDefinitions.safeParse([{ ...valid, ...extra }]).success).toBe(false);
    expect(
      definitionEntrySchema.safeParse({
        planes: [{ kind: 'terminal', path: '.', command: 'echo sample' }],
      }).success,
    ).toBe(true);
  });
});
