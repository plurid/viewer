import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inspectImports } from '../tools/architecture/imports';

describe('application module seams', () => {
  it('keeps platform adapters out of the domain and native services out of the renderer', async () => {
    const root = fileURLToPath(new URL('../src', import.meta.url));
    const report = await inspectImports(path.resolve(root));
    expect(report.files).toBeGreaterThan(100);
    expect(report.violations).toEqual([]);
    expect(report.cycles).toEqual([]);
  });
});
