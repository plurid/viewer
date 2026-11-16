import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inspectImports } from '../tools/architecture/imports';
import { inspectStatIdentity } from '../tools/architecture/file-identity';

describe('application module seams', () => {
  it('keeps numeric Node stats out of identity consumers', () => {
    const app = fileURLToPath(new URL('..', import.meta.url));
    expect(inspectStatIdentity(app)).toEqual([]);
  });
  it('detects reverted namespace, imported and descriptor stat consumers', () => {
    const app = fileURLToPath(new URL('..', import.meta.url));
    const file = path.join(app, 'src/desktop/actions/executions.ts');
    const source = [
      "import fs, { lstat, open } from 'node:fs/promises';",
      "import { itemIdentity, sameDevice } from '../../domain/files/item-identity';",
      'export async function probe(file: string) {',
      '  const first = await fs.stat(file);',
      '  itemIdentity(first);',
      '  itemIdentity(await lstat(file));',
      '  sameDevice(first, await (await open(file)).stat());',
      '}',
    ].join('\n');
    const violations = inspectStatIdentity(app, new Map([[file, source]]));
    expect(violations).toHaveLength(4);
    expect(violations.every((value) => value.reason.includes('BigInt stat'))).toBe(true);
  });
  it('keeps platform adapters out of the domain and native services out of the renderer', async () => {
    const root = fileURLToPath(new URL('../src', import.meta.url));
    const report = await inspectImports(path.resolve(root));
    expect(report.files).toBeGreaterThan(100);
    expect(report.violations).toEqual([]);
    expect(report.cycles).toEqual([]);
  });
});
