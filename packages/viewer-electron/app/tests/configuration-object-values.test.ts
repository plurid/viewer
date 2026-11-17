import { expect, it } from 'vitest';
import { parse } from 'jsonc-parser';
import { applyConfigEdits, configEdits } from '../src/desktop/preferences/configuration-edits';

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
