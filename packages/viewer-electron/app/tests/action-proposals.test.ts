import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  mergeApproval,
  publicationName,
  reviewModelRows,
  stoppedStatus,
} from '../src/desktop/actions/proposals';
import { builtInRecipes } from '../src/domain/services';
import type { FileEntry } from '../src/domain/contracts';
import type { ModelReview } from '../src/desktop/actions/proposals';
import type { ProposedChange } from '../src/domain/services';
const folder = path.resolve('/fixture');
const file = (name: string): FileEntry => ({
  path: path.join(folder, name),
  name,
  parent: folder,
  extension: path.extname(name).slice(1),
  kind: 'file',
  directory: false,
  size: 1,
  modified: 1,
  created: 1,
  hidden: false,
  mime: 'text/plain',
  identity: name,
});
const change = (id: string, patch: Partial<ProposedChange> = {}): ProposedChange => ({
  id,
  kind: 'rename',
  destination: path.join(folder, id + '.txt'),
  evidence: [],
  approved: true,
  ...patch,
});
const modelRow = (sourceID: string, destination: string) => ({
  sourceID,
  destination,
  summary: '',
  fields: { year: null, authors: null, title: null, publisher: null },
  evidence: [],
});
describe('action proposals', () => {
  it('fills a publication template, keeping unknown fields as their bracketed names', () => {
    expect(
      publicationName(
        '{year}, {authors}, {title}, {publisher}{extension}',
        { year: '2000', authors: null, title: '' },
        '.pdf',
      ),
    ).toBe('2000, [authors], [title], [publisher].pdf');
  });
  it('yields each reviewed model row before refusing a later one', () => {
    const rename = builtInRecipes.find((recipe) => recipe.id === 'rename')!;
    const reviews: ModelReview[] = [];
    const rows = [modelRow('0', 'C.txt'), modelRow('0', 'D.txt')];
    expect(() => {
      for (const review of reviewModelRows(rows, [file('A.txt'), file('B.txt')], new Map(), rename))
        reviews.push(review);
    }).toThrow('The model proposed the same file twice.');
    expect(reviews).toMatchObject([
      { kind: 'destination', destination: path.join(folder, 'C.txt') },
    ]);
  });
  it('merges an approval: an edit clears the issue, a row left out is not approved', () => {
    const rows = [
      change('a', { issue: 'Kept issue.' }),
      change('b', { issue: 'Cleared issue.' }),
      change('c'),
    ];
    const merged = mergeApproval(rows, {
      id: 'plan',
      revision: 1,
      rows: [
        { id: 'a', destination: rows[0]!.destination, approved: true },
        { id: 'b', destination: path.join(folder, 'edited.txt'), approved: true },
      ],
    });
    expect(merged.rows.map((row) => [row.id, row.issue, row.approved])).toEqual([
      ['a', 'Kept issue.', true],
      ['b', undefined, true],
      ['c', undefined, false],
    ]);
    expect(merged.selected).toEqual([merged.rows[0], merged.rows[1]]);
    expect(merged.selected[0]).toBe(merged.rows[0]);
  });
  it('refuses a relative destination before an unknown row, and an unknown row before an empty selection', () => {
    const rows = [change('a')];
    const merge = (edits: { id: string; destination: string; approved: boolean }[]) => () =>
      mergeApproval(rows, { id: 'plan', revision: 1, rows: edits });
    expect(
      merge([
        { id: 'a', destination: 'relative.txt', approved: true },
        { id: 'x', destination: rows[0]!.destination, approved: true },
      ]),
    ).toThrow('An absolute local path is required.');
    expect(merge([{ id: 'x', destination: rows[0]!.destination, approved: false }])).toThrow(
      'Unknown proposal row.',
    );
    expect(merge([{ id: 'a', destination: rows[0]!.destination, approved: false }])).toThrow(
      'Select at least one change.',
    );
  });
  it('ends a stopped apply as partial while any row is completed or staged', () => {
    expect(stoppedStatus([change('a', { completed: true })], false)).toBe('partial');
    expect(stoppedStatus([change('a', { stagedPath: '/staged' })], true)).toBe('partial');
    expect(stoppedStatus([change('a')], true)).toBe('cancelled');
    expect(stoppedStatus([change('a')], false)).toBe('failed');
  });
});
