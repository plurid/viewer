import { describe, expect, it } from 'vitest';
import { parse } from 'jsonc-parser';
import { applyConfigEdits, configEdits } from '../src/desktop/preferences/configuration-edits';

const options = { insertSpaces: true, tabSize: 2 };
const edit = (text: string, after: unknown) => {
  const result = applyConfigEdits(text, configEdits(parse(text), after), options);
  expect(parse(result)).toEqual(after);
  return result;
};

describe('element-wise configuration edits (2026-10-20)', () => {
  it('inserts between two items without taking the comment on the line before', () => {
    const text = '{\n  "list": [\n    "a", // about a\n    // about c\n    "c"\n  ]\n}\n';
    const result = edit(text, { list: ['a', 'b', 'c'] });
    expect(result).toContain('"a", // about a');
    expect(result).toMatch(/\/\/ about c\s*"c"/);
  });
  it('appends after a last item that carries a comment on its line', () => {
    const text = '{\n  "list": [\n    "a" // about a\n  ]\n}\n';
    const result = edit(text, { list: ['a', 'b'] });
    expect(result).toMatch(/"a", \/\/ about a/);
  });
  it('removes the first property without the comments of the second', () => {
    const text = '{\n  // about one\n  "one": 1,\n  // about two\n  "two": 2\n}\n';
    const result = edit(text, { two: 2 });
    expect(result).not.toContain('about one');
    expect(result).toMatch(/\/\/ about two\s*"two"/);
  });
  it('moves a reordered item with only its own comments lost', () => {
    const text =
      '{\n  "items": [\n    // first\n    { "id": "a" },\n    // second\n    { "id": "b" }\n  ]\n}\n';
    const result = edit(text, { items: [{ id: 'b' }, { id: 'a' }] });
    expect(result).toMatch(/\/\/ second\s*\{\s*"id": "b"/);
  });
  it('keeps Windows line endings', () => {
    const text = '{\r\n  "list": [\r\n    // keep\r\n    "a",\r\n    "b"\r\n  ]\r\n}\r\n';
    const result = edit(text, { list: ['a'] });
    expect(result).toContain('// keep\r\n');
    expect(result).not.toMatch(/[^\r]\n/);
  });
});
