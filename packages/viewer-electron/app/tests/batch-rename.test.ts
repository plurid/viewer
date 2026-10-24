import { describe, expect, it } from 'vitest';
import { renameNames } from '../src/domain/operations/batch-rename';
describe('reviewed naming policy', () => {
  it('preserves extensions and dotted folder names while transforming case and padded numbering', () => {
    expect(
      renameNames({
        names: [
          { name: 'First File.PDF', extension: '.PDF' },
          { name: 'Folder.v1', extension: '' },
        ],
        options: { case: 'lower', padding: 3, start: 7 },
        template: '{number}-{name}{extension}',
      }),
    ).toEqual(['007-first file.PDF', '008-folder.v1']);
  });
  it('supports bounded regex preview substitutions and explicit document fields', () => {
    expect(
      renameNames({
        names: [{ name: 'Panel 02.dxf', extension: '.dxf' }],
        options: { find: '^Panel (\\d+)$', replace: 'Cut-$1', regex: true },
        template: '{name}{extension}',
      }),
    ).toEqual(['Cut-02.dxf']);
    expect(
      renameNames({
        names: [
          {
            name: 'Book.pdf',
            extension: '.pdf',
            metadata: { title: 'Original title', pages: '7' },
          },
        ],
        options: { metadata: true },
        template: '{title}-{pages}{extension}',
      }),
    ).toEqual(['Original title-7.pdf']);
  });
  it('keeps unknown metadata and invalid regex unresolved, without inventing a value', () => {
    expect(() =>
      renameNames({
        names: [{ name: 'Book.pdf', extension: '.pdf' }],
        options: {},
        template: '{title}{extension}',
      }),
    ).toThrow('Missing');
    expect(() =>
      renameNames({
        names: [{ name: 'File.txt', extension: '.txt' }],
        options: { regex: true, find: '[' },
        template: '{name}{extension}',
      }),
    ).toThrow();
    expect(() =>
      renameNames({
        names: [{ name: 'File.txt', extension: '.txt' }],
        options: {},
        template: '{constructor}{extension}',
      }),
    ).toThrow('Missing');
  });
});
