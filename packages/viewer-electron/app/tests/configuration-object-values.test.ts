import { expect, it } from 'vitest';
import { parse } from 'jsonc-parser';
import { applyConfigEdits, configEdits } from '../src/desktop/preferences/configuration-edits';

it('matches nested object values independently of property order and keeps their comments', () => {
  const text =
    '{"planes":[\n// keep plane and nested comment\n{"kind":"folder","path":".","extra":{"first":1,"second":2}}\n]}';
  const next = {
    planes: [{ extra: { second: 2, first: 1 }, path: '.', kind: 'folder' }, { kind: 'scratch' }],
  };
  const edits = configEdits(parse(text), next, [], { objectValues: true });
  expect(edits).toEqual([{ kind: 'insert', path: ['planes', 1], value: { kind: 'scratch' } }]);
  expect(applyConfigEdits(text, edits, { insertSpaces: true, tabSize: 2 })).toContain(
    '// keep plane and nested comment',
  );
});

it('uses object value matching only when requested, preserving existing config.jsonc output', () => {
  const text =
    '{\n  "planes": [\n    // keep\n    { "kind": "folder", "path": "." },\n    { "kind": "scratch" }\n  ]\n}\n';
  const next = {
    planes: [
      { kind: 'folder', path: '.' },
      { kind: 'terminal', path: '.' },
    ],
  };
  const options = { insertSpaces: true, tabSize: 2 };
  const legacy = configEdits(parse(text), next);
  expect(legacy).toEqual([{ kind: 'set', path: ['planes'], value: next.planes }]);
  expect(applyConfigEdits(text, legacy, options)).not.toContain('// keep');
  const valueMatched = applyConfigEdits(
    text,
    configEdits(parse(text), next, [], { objectValues: true }),
    options,
  );
  expect(valueMatched).toContain('// keep');
  expect(parse(valueMatched)).toEqual(next);
});

it('moves unchanged object values with their leading, inner and trailing comments', () => {
  const first = '    // first plane\n    { "kind": "terminal", /* inner first */ "path": "a" }';
  const second = '    // second plane\n    { "kind": "terminal", "path": "b" }';
  const text =
    '{\n  "planes": [\n' +
    first +
    ', // trailing first\n' +
    second +
    ' // trailing second\n  ]\n}\n';
  const before = parse(text);
  const next = { planes: [before.planes[1], before.planes[0]] };
  const result = applyConfigEdits(text, configEdits(before, next, [], { objectValues: true }), {
    insertSpaces: true,
    tabSize: 2,
  });
  expect(parse(result)).toEqual(next);
  expect(result).toBe(
    '{\n  "planes": [\n' +
      second +
      ', // trailing second\n' +
      first +
      ' // trailing first\n  ]\n}\n',
  );
});

it.each(['inline', 'lines', 'crlf'] as const)(
  'reorders several raw object values without losing inner comments (%s)',
  (layout) => {
    const eol = layout === 'inline' ? '' : layout === 'crlf' ? '\r\n' : '\n';
    const values = ['a', 'b', 'c'].map(
      (name) => '{ "kind": "folder", /* keep ' + name + ' */ "path": "' + name + '" }',
    );
    const text = '{"planes":[' + eol + values.join(',' + eol) + eol + ']}';
    const before = parse(text);
    const order = [2, 0, 1];
    const next = { planes: order.map((index) => before.planes[index]) };
    const result = applyConfigEdits(text, configEdits(before, next, [], { objectValues: true }), {
      insertSpaces: true,
      tabSize: 2,
    });
    expect(parse(result)).toEqual(next);
    for (const value of values) expect(result).toContain(value);
  },
);
