import { expect, it } from 'vitest';
import {
  copyDataValue,
  inspectStructured,
  visibleDataRows,
} from '../src/domain/previews/data/structured';

it('shares tree navigation across JSON, JSONC, JSON5 and multi-document YAML', () => {
  for (const [extension, text] of [
    ['json', '{"a":{"b":7}}'],
    ['jsonc', '{/* note */ "a":{"b":7,},}'],
    ['json5', '{a:{b:7,},}'],
    ['yaml', 'a:\n  b: 7'],
  ]) {
    const tree = inspectStructured(text!, extension!);
    expect(tree.error).toBeUndefined();
    expect(
      visibleDataRows(tree, { all: true, open: [], closed: [] }).map((node) => node.path),
    ).toEqual(['', '/a', '/a/b']);
    expect(visibleDataRows(tree, { all: false, open: [], closed: [] })).toHaveLength(1);
    expect(
      visibleDataRows(tree, { all: false, open: [], closed: [] }, '7').map((node) => node.path),
    ).toEqual(['', '/a', '/a/b']);
  }
  expect(inspectStructured('first: 1\n---\nsecond: 2', 'yaml').roots).toEqual(['/0', '/1']);
});
it('bounds expansion and handles aliases, cycles, unusual keys and invalid syntax', () => {
  const cyclic = inspectStructured('root: &root\n  child: *root', 'yaml');
  expect(cyclic.error).toBeUndefined();
  expect(cyclic.nodes.at(-1)?.kind).toBe('reference');
  expect(copyDataValue(cyclic.nodes[0]?.value)).toContain('[Reference]');
  const strange = inspectStructured('{"__proto__":{"x":1},"a/b~c":true}', 'json');
  expect(strange.nodes.some((node) => node.path === '/a~1b~0c')).toBe(true);
  const bounded = inspectStructured(
    JSON.stringify(Array.from({ length: 1000 }, (_, i) => ({ i }))),
    'json',
    100,
  );
  expect(bounded.nodes.length).toBeLessThanOrEqual(100);
  expect(bounded.limited).toBe(true);
  expect(inspectStructured('a: [', 'yaml').error).toContain('line');
  expect(inspectStructured('{ "a": nope }', 'jsonc').error).toContain('line 1');
});
