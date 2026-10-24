/**
 * THE FILE QUERY LANGUAGE (2026-10-24): names, phrases and terms, OR, - and parentheses; sizes and
 * dates, relative and absolute; tags looked up before; errors with their column.
 */
import { describe, expect, it } from 'vitest';
import {
  matchesQuery,
  parseFileQuery,
  QueryError,
  type QueryEntry,
} from '../src/domain/file-query';

const now = new Date(2026, 9, 24, 12).getTime();
const day = 86_400_000;
const entry = (name: string, extra: Partial<QueryEntry> = {}): QueryEntry => {
  const extension = name.includes('.') ? name.split('.').pop()! : '';
  return {
    name,
    path: '/Users/me/Projects/' + name,
    extension,
    directory: false,
    hidden: name.startsWith('.'),
    kind: 'file',
    size: 100,
    modified: now - day,
    created: now - 30 * day,
    mime: extension === 'png' ? 'image/png' : extension === 'md' ? 'text/markdown' : undefined,
    ...extra,
  };
};
const files = [
  entry('Résumé 2026.pdf', { size: 2 * 1024 ** 2 }),
  entry('notes.md'),
  entry('draft notes.md', { modified: now - 40 * day }),
  entry('IMG_0042.png', { size: 12 * 1024 ** 2 }),
  entry('Archive.zip'),
  entry('Projects', { directory: true, extension: '', size: 0 }),
  entry('.env'),
  entry('Viewer.app', { directory: true, extension: 'app' }),
  entry('latest', { kind: 'symlink', linkTarget: '/x' }),
];
const names = (query: string, facts = {}) =>
  files
    .filter((item) => matchesQuery(parseFileQuery(query, now), item, facts))
    .map((item) => item.name);

describe('a query', () => {
  it('matches names by their words, case and accents aside; empty, everything', () => {
    expect(names('resume')).toEqual(['Résumé 2026.pdf']);
    expect(names('notes draft')).toEqual(['draft notes.md']);
    expect(names('"draft notes"')).toEqual(['draft notes.md']);
    expect(names('')).toHaveLength(files.length);
  });
  it('reads terms: extensions, kinds, paths, hidden', () => {
    expect(names('ext:md,pdf')).toEqual(['Résumé 2026.pdf', 'notes.md', 'draft notes.md']);
    expect(names('kind:folders')).toEqual(['Projects']);
    expect(names('kind:app')).toEqual(['Viewer.app']);
    expect(names('kind:image')).toEqual(['IMG_0042.png']);
    expect(names('kind:document')).toEqual(['Résumé 2026.pdf', 'notes.md', 'draft notes.md']);
    expect(names('kind:archive')).toEqual(['Archive.zip']);
    expect(names('is:link')).toEqual(['latest']);
    expect(names('is:hidden')).toEqual(['.env']);
    expect(names('path:projects notes')).toEqual(['notes.md', 'draft notes.md']);
  });
  it('compares sizes, folders having none', () => {
    expect(names('size>1mb')).toEqual(['Résumé 2026.pdf', 'IMG_0042.png']);
    expect(names('size>=12mb')).toEqual(['IMG_0042.png']);
    expect(names('size<1kb kind:file')).toEqual([
      'notes.md',
      'draft notes.md',
      'Archive.zip',
      '.env',
      'latest',
    ]);
    // as the index read sizes before
    expect(names('size:>10mb')).toEqual(['IMG_0042.png']);
  });
  it('reads dates as how long ago, or as days, months and years', () => {
    expect(names('modified<7d ext:md')).toEqual(['notes.md']);
    expect(names('modified>30d')).toEqual(['draft notes.md']);
    expect(names('modified:yesterday ext:md')).toEqual(['notes.md']);
    expect(names('modified>=2026-10-23 ext:md')).toEqual(['notes.md']);
    expect(names('modified<2026-10 ext:md')).toEqual(['draft notes.md']);
    expect(names('created=2026-09 ext:md')).toHaveLength(2);
    expect(names('modified:>2026-10-20 ext:md')).toEqual(['notes.md']);
  });
  it('combines terms with OR, -, and parentheses', () => {
    expect(names('ext:png OR ext:zip')).toEqual(['IMG_0042.png', 'Archive.zip']);
    expect(names('ext:md -draft')).toEqual(['notes.md']);
    expect(names('(ext:png OR ext:zip) -archive')).toEqual(['IMG_0042.png']);
    expect(names('~^img_\\d+')).toEqual(['IMG_0042.png']);
  });
  it('asks about tags from what was looked up', () => {
    const tagged = new Set(['/Users/me/Projects/notes.md']);
    expect(
      names('tag:red', { tagged: (tag: string) => (tag === 'red' ? tagged : undefined) }),
    ).toEqual(['notes.md']);
    expect(parseFileQuery('tag:red tag:"Project X" tag:red').tags).toEqual(['red', 'Project X']);
  });
  it('keeps its words for ranking, and says whether it needs a stat', () => {
    expect(parseFileQuery('draft ext:md -old "a b"')).toMatchObject({
      words: ['draft', 'a b'],
      needsStat: false,
    });
    expect(parseFileQuery('size>1kb').needsStat).toBe(true);
    expect(parseFileQuery('kind:image').needsStat).toBe(true);
    expect(parseFileQuery('kind:folder').needsStat).toBe(false);
  });
  it('lets a quote run to the end while it is typed, and a name with a colon be a name', () => {
    expect(names('"draft no')).toEqual(['draft notes.md']);
    expect(parseFileQuery('http:x').words).toEqual(['http:x']);
  });
  it('says where it does not read, and why', () => {
    const fails = (query: string, at: number, message: RegExp) => {
      try {
        parseFileQuery(query, now);
      } catch (error) {
        expect(error).toBeInstanceOf(QueryError);
        expect((error as QueryError).at).toBe(at);
        expect((error as QueryError).message).toMatch(message);
        return;
      }
      throw new Error(`${query} parsed`);
    };
    fails('one kind:pictures', 4, /kind:file or kind:folder/);
    fails('size>lots', 0, /size>10mb/);
    fails('notes modified<sometime', 6, /modified<7d/);
    fails('(a b', 0, /not closed/);
    fails('a b)', 3, /closes nothing/);
    fails('OR a', 0, /before it/);
    fails('a OR', 2, /after it/);
    fails('~(', 0, /not a pattern/);
    fails('is:big', 0, /is:hidden/);
  });
});
