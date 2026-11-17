import { describe, expect, it } from 'vitest';
import { fuzzyPathScore } from '../src/domain/search/path-fuzzy';
import { rankWorkspaceChoices } from '../src/domain/workspaces/definitions/query';
import { syntheticDefinitions } from './workspace-definition-fixtures';

describe('bounded path subsequence scoring', () => {
  it('ranks plcli and a path fragment first among 324 synthetic keys', () => {
    const definitions = syntheticDefinitions();
    expect(definitions).toHaveLength(324);
    expect(rankWorkspaceChoices([], definitions, 'plcli').length).toBeGreaterThan(10);
    for (const query of ['plcli', 'tools/plume-cli', 'tools plcli']) {
      expect(rankWorkspaceChoices([], definitions, query)[0]!.key).toBe(
        'plume/technologies/tools/plume-cli',
      );
    }
    expect(fuzzyPathScore(definitions[0]!.key, 'plcli')).toBeGreaterThan(400);
  });
  it('rewards boundaries, consecutive runs and leaves in the Viewer score band', () => {
    expect(fuzzyPathScore('root/project-cli', 'pcli')).toBeGreaterThan(
      fuzzyPathScore('root/poeticclimb', 'pcli'),
    );
    expect(fuzzyPathScore('root/cli', 'cli')).toBeGreaterThan(
      fuzzyPathScore('cli/unrelated', 'cli'),
    );
    expect(fuzzyPathScore('CLI', 'cli')).toBeLessThanOrEqual(850);
    expect(fuzzyPathScore('root/ProjectClient', 'pc')).toBeGreaterThan(100);
  });
  it('ANDs whitespace terms, folds case and accents, and rejects non-subsequences', () => {
    expect(fuzzyPathScore('Nórth/tools/api', 'north api')).toBeGreaterThan(100);
    expect(fuzzyPathScore('north/tools/api', 'north missing')).toBe(0);
    expect(fuzzyPathScore('a', 'alphabet')).toBe(0);
    expect(fuzzyPathScore('anything', '')).toBe(0);
  });
  it('bounds comparisons by the query and path lengths after the subsequence prefilter', () => {
    const work = { prefilter: 0, cells: 0 };
    for (let index = 0; index < 5000; index++) {
      fuzzyPathScore(`family-${index}/tools/package-${index}`, 'doesnotmatch', work);
    }
    expect(work.cells).toBe(0);
    expect(work.prefilter).toBeLessThan(5000 * 200);
    const path = 'family/tools/project-cli';
    const query = 'project cli';
    fuzzyPathScore(path, query, work);
    expect(work.cells).toBeLessThanOrEqual(path.length * query.replace(/\s/g, '').length);
  });
});
