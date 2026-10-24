import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import {
  applyLensOps,
  diffLensOps,
  emptyLens,
  formatLens,
  lensFileName,
  lensSchema,
  matchGlob,
  matchLensMembers,
  normalizeLens,
  resolveLens,
  type Lens,
  type LensGroup,
} from '../src/domain/files/lenses';
import { decodeDefinition } from '../src/desktop/persistence/definition-files';

const id = '0b6c3f3e-2a5e-4a8e-9a43-0d1c2b3a4f5e';
const entry = (name: string, extra: Partial<FileEntry> = {}): FileEntry => ({
  path: `/Clients/${name}`,
  name,
  parent: '/Clients',
  extension: name.includes('.') ? name.split('.').pop()!.toLowerCase() : '',
  kind: extra.directory === false ? 'file' : 'directory',
  directory: true,
  size: 0,
  modified: new Date(2026, 2, 4).getTime(),
  created: new Date(2025, 5, 1).getTime(),
  hidden: name.startsWith('.'),
  mime: '',
  identity: `1:${name}`,
  ...extra,
});
const group = (gid: string, name: string, extra: Partial<LensGroup> = {}): LensGroup => ({
  id: gid,
  name,
  order: 0,
  ...extra,
});
const lens = (extra: Partial<Lens> = {}): Lens => ({ ...emptyLens(id, 'By year'), ...extra });

describe('lens files', () => {
  it('writes the same bytes for the same lens, one item per line, and reads them back', () => {
    const value = lens({
      groups: [group('gbbbbb', '2026', { order: 1 }), group('gaaaaa', '2025', { order: 0 })],
      members: [
        { name: 'Zeta', group: 'gbbbbb', at: [8, 16] },
        { name: 'Acme', group: 'gaaaaa' },
        { name: 'Émile' },
      ],
    });
    const text = formatLens(value);
    const shuffled = formatLens({
      ...value,
      groups: value.groups.toReversed(),
      members: value.members.toReversed(),
    });
    expect(shuffled).toBe(text);
    const lines = text.split('\n');
    expect(lines.filter((line) => line.includes('"name":"Acme"'))).toHaveLength(1);
    expect(text.indexOf('"2025"')).toBeLessThan(text.indexOf('"2026"'));
    expect(text.indexOf('"Acme"')).toBeLessThan(text.indexOf('"Zeta"'));
    expect(decodeDefinition(text, lensSchema, 'Lens')).toEqual(
      lensSchema.parse(JSON.parse(text.replace(/^\/\/.*$/gm, ''))),
    );
  });
  it('refuses names outside the folder and date rules without dates', () => {
    for (const name of ['../x', 'a/b', '.', '..', '.viewer', ''])
      expect(lensSchema.safeParse(lens({ members: [{ name }] })).success).toBe(false);
    expect(
      lensSchema.safeParse(
        lens({ groups: [group('gaaaaa', 'Old', { rules: [{ kind: 'modified' }] })] }),
      ).success,
    ).toBe(false);
    // An item may be called __proto__; members are a list and lookups use maps.
    expect(lensSchema.safeParse(lens({ members: [{ name: '__proto__' }] })).success).toBe(true);
  });
  it('repairs duplicates, loops and missing groups instead of rejecting the file', () => {
    const { lens: repaired, repairs } = normalizeLens(
      lens({
        groups: [
          group('gaaaaa', 'A', { parent: 'gbbbbb' }),
          group('gbbbbb', 'B', { parent: 'gaaaaa' }),
          group('gccccc', 'C', { parent: 'gmissing' }),
          group('gaaaaa', 'A again'),
        ],
        members: [
          { name: 'One', group: 'gzzzzz' },
          { name: 'Two', group: 'gaaaaa' },
          { name: 'Two', group: 'gbbbbb' },
        ],
      }),
    );
    expect(repairs.length).toBeGreaterThanOrEqual(4);
    expect(repaired.groups.map((item) => item.id)).toEqual(['gaaaaa', 'gbbbbb', 'gccccc']);
    expect(repaired.groups.find((item) => item.id === 'gccccc')?.parent).toBeUndefined();
    expect(repaired.members).toEqual([{ name: 'Two', group: 'gaaaaa' }]);
    const parents = new Map(repaired.groups.map((item) => [item.id, item.parent]));
    // No loop remains.
    expect(parents.get('gaaaaa') === 'gbbbbb' && parents.get('gbbbbb') === 'gaaaaa').toBe(false);
  });
  it('names new lens files from their titles without collisions', () => {
    expect(lensFileName('By Year', [])).toBe('by-year.lens.jsonc');
    expect(lensFileName('By year', ['by-year.lens.jsonc'])).toBe('by-year-2.lens.jsonc');
    expect(lensFileName('Sous-assemblées', [])).toBe('sous-assemblees.lens.jsonc');
    expect(lensFileName('✦✦', [])).toBe('lens.lens.jsonc');
  });
});

describe('lens edits', () => {
  const base = lens({
    groups: [group('gaaaaa', '2025'), group('gbbbbb', 'Q1', { parent: 'gaaaaa' })],
    members: [
      { name: 'Acme', group: 'gbbbbb', at: [0, 0] },
      { name: 'Borel', group: 'gaaaaa' },
    ],
  });
  it('places, renames and forgets items', () => {
    const { lens: next } = applyLensOps(base, [
      { kind: 'place', name: 'Cobalt', group: 'gaaaaa', at: [16, 8] },
      { kind: 'rename-member', from: 'Acme', to: 'Acme Corp' },
      { kind: 'forget', name: 'Borel' },
    ]);
    expect(next.members.toSorted((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'Acme Corp', group: 'gbbbbb', at: [0, 0] },
      { name: 'Cobalt', group: 'gaaaaa', at: [16, 8] },
    ]);
  });
  it('deleting a group moves subgroups and items up, or back to automatic placement', () => {
    const nested = applyLensOps(base, [{ kind: 'delete-group', id: 'gbbbbb' }]).lens;
    expect(nested.members).toContainEqual({ name: 'Acme', group: 'gaaaaa' });
    const top = applyLensOps(base, [{ kind: 'delete-group', id: 'gaaaaa' }]).lens;
    expect(top.groups).toEqual([group('gbbbbb', 'Q1')]);
    expect(top.members).toEqual([{ name: 'Acme', group: 'gbbbbb', at: [0, 0] }]);
  });
  it('skips edits whose target was removed by someone else, and refuses loops', () => {
    const { lens: next, dropped } = applyLensOps(base, [
      { kind: 'place', name: 'Delta', group: 'gremoved' },
      { kind: 'set-group', group: group('gaaaaa', '2025', { parent: 'gbbbbb' }) },
    ]);
    expect(dropped).toHaveLength(2);
    expect(next).toEqual(base);
  });
  it('undo edits restore exactly what changed and nothing else', () => {
    const { lens: after } = applyLensOps(base, [
      { kind: 'place', name: 'Acme', group: null },
      { kind: 'delete-group', id: 'gbbbbb' },
      { kind: 'set-lens', name: 'Years' },
    ]);
    const undo = diffLensOps(after, base);
    // Someone else meanwhile placed Eon; undo must keep that.
    const remote = applyLensOps(after, [{ kind: 'place', name: 'Eon', group: 'gaaaaa' }]).lens;
    const restored = applyLensOps(remote, undo).lens;
    expect(restored.name).toBe('By year');
    expect(restored.groups).toEqual(base.groups);
    expect(restored.members).toContainEqual({ name: 'Acme', group: 'gbbbbb', at: [0, 0] });
    expect(restored.members).toContainEqual({ name: 'Eon', group: 'gaaaaa' });
  });
});

describe('lens matching', () => {
  it('matches renamed items by case and normalization only when unambiguous', () => {
    const found = matchLensMembers([{ name: 'acme' }, { name: 'Café' }], ['Acme', 'Café']);
    expect(found.missing).toEqual([]);
    expect(found.renames).toEqual([
      { from: 'acme', to: 'Acme' },
      { from: 'Café', to: 'Café' },
    ]);
    const ambiguous = matchLensMembers([{ name: 'acme' }, { name: 'ACME' }], ['Acme']);
    expect(ambiguous.missing).toEqual(['acme', 'ACME']);
  });
  it('heals a Finder rename by remembered identity, never when two items could fit', () => {
    const hints = new Map([['Acme', '1:9']]);
    const healed = matchLensMembers([{ name: 'Acme' }], ['Acme Corp', 'Borel'], {
      hints,
      of: new Map([
        ['Acme Corp', '1:9'],
        ['Borel', '1:3'],
      ]),
    });
    expect(healed.renames).toEqual([{ from: 'Acme', to: 'Acme Corp' }]);
    const twice = matchLensMembers([{ name: 'Acme' }], ['A', 'B'], {
      hints,
      of: new Map([
        ['A', '1:9'],
        ['B', '1:9'],
      ]),
    });
    expect(twice.missing).toEqual(['Acme']);
  });
});

describe('lens resolution', () => {
  const entries = [
    entry('2025-acme'),
    entry('2026-borel'),
    entry('cobalt'),
    entry('notes.pdf', { directory: false, kind: 'file' }),
    entry('.viewer'),
    entry('.DS_Store', { directory: false }),
  ];
  const value = lens({
    groups: [
      group('gaaaaa', '2025', { order: 0, rules: [{ kind: 'name', glob: '2025-*' }] }),
      group('gbbbbb', '2026', { order: 1, rules: [{ kind: 'name', glob: '2026-*' }] }),
      group('gccccc', 'Active', {
        parent: 'gbbbbb',
        rules: [{ kind: 'name', glob: '2026-b*' }],
      }),
      group('gddddd', 'Documents', { order: 2, rules: [{ kind: 'type', value: 'pdf' }] }),
    ],
    members: [
      { name: '2025-acme', group: 'gbbbbb', at: [8, 8] },
      { name: 'cobalt' },
      { name: 'gone' },
    ],
  });
  it('lets manual places beat rules, prefers the most specific rule, and puts Unsorted last', () => {
    const resolved = resolveLens(value, entries);
    const section = (gid: string | null) =>
      resolved.sections.find((item) => item.id === gid)?.entries.map((item) => item.name);
    expect(section('gaaaaa')).toEqual([]);
    expect(section('gbbbbb')).toEqual(['2025-acme']);
    expect(section('gccccc')).toEqual(['2026-borel']);
    expect(section('gddddd')).toEqual(['notes.pdf']);
    // Explicitly Unsorted: the rules cannot claim it.
    expect(section(null)).toEqual(['cobalt']);
    expect(resolved.sections.at(-1)?.name).toBe('Unsorted');
    expect(resolved.sections.map((item) => item.depth)).toEqual([0, 0, 1, 0, 0]);
    expect(resolved.sections.find((item) => item.id === 'gccccc')?.path).toEqual(['2026']);
    expect(resolved.placements.get('/Clients/2025-acme')).toEqual({
      group: 'gbbbbb',
      at: [8, 8],
      manual: true,
    });
    expect(resolved.placements.get('/Clients/.viewer')).toBeUndefined();
    expect(resolved.missing).toEqual(['gone']);
  });
  it('matches dates on the local calendar', () => {
    const dated = lens({
      groups: [
        group('gaaaaa', 'Made in 2025', { rules: [{ kind: 'created', year: 2025 }] }),
        group('gbbbbb', 'March', {
          rules: [{ kind: 'modified', from: '2026-03-01', to: '2026-03-31' }],
          match: 'any',
        }),
      ],
    });
    const resolved = resolveLens(dated, [entry('x'), entry('y', { created: 0 })]);
    expect(resolved.sections[0]?.entries.map((item) => item.name)).toEqual(['x']);
    expect(resolved.sections[1]?.entries.map((item) => item.name)).toEqual(['y']);
  });
});

describe('glob', () => {
  it('matches names case-insensitively with stars, single characters and classes', () => {
    expect(matchGlob('2025-*', '2025-Acme')).toBe(true);
    expect(matchGlob('*.STEP', 'bracket.step')).toBe(true);
    expect(matchGlob('part-??', 'part-12')).toBe(true);
    expect(matchGlob('part-??', 'part-123')).toBe(false);
    expect(matchGlob('[a-c]*', 'Borel')).toBe(true);
    expect(matchGlob('[!a-c]*', 'Borel')).toBe(false);
    expect(matchGlob('*a*b*', 'xaxxbx')).toBe(true);
  });
  it('stays fast on hostile patterns', () => {
    const started = performance.now();
    expect(matchGlob('*a'.repeat(100) + '*b', 'a'.repeat(255))).toBe(false);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
