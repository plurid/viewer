import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();

describe('type import policy', () => {
  it.each([
    'src/domain/import-policy-fixture.ts',
    'tests/import-policy-fixture.test.ts',
    'tests/import-policy-fixture.test.tsx',
    'tools/import-policy-fixture.ts',
    'import-policy-fixture.ts',
  ])('requires top-level type imports in %s', async (filePath) => {
    const [inline] = await eslint.lintText('export type Entry = import("./types").Entry;', {
      filePath,
    });
    expect(inline?.messages).toContainEqual(
      expect.objectContaining({
        ruleId: 'no-restricted-syntax',
        message: 'Use a top-level import type declaration.',
      }),
    );

    const [declared] = await eslint.lintText(
      'import type { Entry } from "./types"; export type Result = Entry;',
      { filePath },
    );
    expect(declared?.messages).toEqual([]);
  });
});

describe('import order', () => {
  const filePath = 'src/domain/import-policy-fixture.ts';

  it('refuses an import after other statements', async () => {
    const [late] = await eslint.lintText(
      'import { a } from "./a"; export const b = a; import { c } from "./c"; export const d = c;',
      { filePath },
    );
    expect(late?.messages).toContainEqual(
      expect.objectContaining({
        ruleId: 'no-restricted-syntax',
        message: 'Place imports before other statements.',
      }),
    );
  });

  it('allows re-exports among the imports', async () => {
    const [ordered] = await eslint.lintText(
      'import { a } from "./a"; export { e } from "./e"; import { c } from "./c"; export const d = [a, c];',
      { filePath },
    );
    expect(ordered?.messages).toEqual([]);
  });
});
