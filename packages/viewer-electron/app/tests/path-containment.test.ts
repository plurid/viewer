/**
 * "Is this file inside that folder?" has one answer in the desktop and one in the renderer.
 * Thirteen local copies once disagreed: some hard-coded `/`, missed `..` or failed on `/` itself,
 * among them the checks that bound what an agent may read.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { containsPath } from '../src/desktop/files/containment';
import { pathContains } from '../src/domain/files/paths';

describe('containment in the desktop', () => {
  it('compares whole segments and resolves `..`', () => {
    expect(containsPath('/Users/me', '/Users/me')).toBe(true);
    expect(containsPath('/Users/me', '/Users/me/Notes/a.md')).toBe(true);
    expect(containsPath('/Users/me/', '/Users/me/a.md')).toBe(true);
    expect(containsPath('/', '/Users/me')).toBe(true);
    expect(containsPath('/Users/me', '/Users/meg/a.md')).toBe(false);
    expect(containsPath('/Users/me', '/Users/me/../you/a.md')).toBe(false);
    expect(containsPath('/Users/me/a', '/Users/me')).toBe(false);
  });
});

describe('containment in the renderer and domain', () => {
  it('accepts either separator and whole segments only', () => {
    expect(pathContains('/Users/me', '/Users/me/a.md')).toBe(true);
    expect(pathContains('/', '/Users')).toBe(true);
    expect(pathContains('C:\\Users\\me', 'C:\\Users\\me\\a.md')).toBe(true);
    expect(pathContains('C:\\Users\\me\\', 'C:\\Users\\me\\a.md')).toBe(true);
    expect(pathContains('/Users/me', '/Users/meg')).toBe(false);
    expect(pathContains('/Users/me/a', '/Users/me')).toBe(false);
  });

  it('has no hand-written copies left in the desktop', () => {
    const files = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? files(path.join(directory, entry.name))
          : entry.name.endsWith('.ts')
            ? [path.join(directory, entry.name)]
            : [],
      );
    const desktop = path.resolve(import.meta.dirname, '../src/desktop');
    const copies = files(desktop).filter((file) => {
      const text = readFileSync(file, 'utf8');
      // `startsWith(root.replace(/\/$/, '') + '/')`; the index's SQL prefixes end in `;`
      return (
        /const (within|inside|contains) = \(/.test(text) ||
        text.includes(".replace(/\\/$/, '') + '/')")
      );
    });
    expect(copies.map((file) => path.relative(desktop, file))).toEqual([]);
  });
});
