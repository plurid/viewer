/**
 * One bounded schema checks a file entry wherever it crosses a boundary: a captured selection,
 * a custom action's selection and a saved action plan. The routes once disagreed, so an entry
 * with a 250-character identity passed one and failed another.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import { fileEntrySchema } from '../src/desktop/schemas';
import { schemas } from '../src/desktop/ipc/schemas';

const entry: FileEntry = {
  path: '/Users/me/Notes.md',
  name: 'Notes.md',
  parent: '/Users/me',
  extension: 'md',
  kind: 'file',
  directory: false,
  size: 12,
  modified: 1,
  created: 1,
  hidden: false,
  mime: 'text/markdown',
  identity: 'x'.repeat(250),
};

describe('a file entry crossing a boundary', () => {
  it('accepts what the desktop lists and rejects what it never would', () => {
    expect(fileEntrySchema.safeParse(entry).success).toBe(true);
    for (const invalid of [
      { ...entry, path: 'Notes.md' },
      { ...entry, parent: '/Users/me\0' },
      { ...entry, name: 'n'.repeat(1025) },
      { ...entry, identity: 'x'.repeat(301) },
      { ...entry, size: -1 },
      { ...entry, kind: 'socket' },
    ])
      expect(fileEntrySchema.safeParse(invalid).success).toBe(false);
  });

  it('is the same on every route', () => {
    const target = {
      workspaceID: 'space',
      rootID: 'root',
      paneID: 'pane',
      directory: '/Users/me',
      selection: [entry],
    };
    expect(schemas.customExecute.safeParse(['action', target]).success).toBe(true);
    expect(schemas.commandsPublish.safeParse([target, []]).success).toBe(true);
    const planner = readFileSync(
      new URL('../src/desktop/actions/planner.ts', import.meta.url),
      'utf8',
    );
    expect(planner).toContain("import { fileEntrySchema } from '../schemas';");
    expect(planner).not.toMatch(/identity: z\.string\(\)/);
  });
});
