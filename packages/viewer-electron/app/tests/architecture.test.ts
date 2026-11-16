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
  it('detects destructured and bracket identity reads in every process project', () => {
    const app = fileURLToPath(new URL('..', import.meta.url));
    const files = [
      'src/desktop/actions/executions.ts',
      'src/renderer/workspace/agent-navigation.ts',
      'src/preload.ts',
    ];
    const source = [
      "import type { Stats } from 'node:fs';",
      'export function probe(info: Stats) {',
      '  const { dev, ino: inode } = info;',
      "  return [dev, inode, info['ino']];",
      '}',
      'export function helper({ dev, ino }: Stats) { return [dev, ino]; }',
    ].join('\n');
    const report = inspectStatIdentity(
      app,
      new Map(files.map((file) => [path.join(app, file), source])),
    );
    for (const file of files) expect(report.filter((value) => value.file === file)).toHaveLength(5);
  });
  it('keeps platform adapters out of the domain and native services out of the renderer', async () => {
    const root = fileURLToPath(new URL('../src', import.meta.url));
    const report = await inspectImports(path.resolve(root));
    expect(report.files).toBeGreaterThan(100);
    expect(report.violations).toEqual([]);
    expect(report.cycles).toEqual([]);
  });
});
