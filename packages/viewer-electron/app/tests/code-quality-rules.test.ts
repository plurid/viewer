import { readFileSync } from 'node:fs';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Lint as `pnpm lint` and editors do. Under CI=true typescript-eslint infers a single run, and in a
// Vitest worker that program made TypeScript 6 crash writing a module path for a type
// (getLocalModuleSpecifier); the rules under test do not depend on it.
process.env.TSESTREE_SINGLE_RUN = 'false';
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

describe('em dashes in text', () => {
  const filePath = 'src/renderer/text-policy-fixture.tsx';

  it.each([
    ['a string', 'export const a = "Saved \u2014 now";'],
    ['a template', 'export const b = (n: number) => `${n} files \u2014 done`;'],
    ['JSX text', 'export const C = () => <p>Saved \u2014 now</p>;'],
  ])('refuses one in %s', async (_kind, code) => {
    const [result] = await eslint.lintText(code, { filePath });
    expect(result?.messages).toContainEqual(
      expect.objectContaining({
        ruleId: 'no-restricted-syntax',
        message: 'Use a full stop, comma or colon instead of an em dash.',
      }),
    );
  });

  it('allows one in a comment', async () => {
    const [result] = await eslint.lintText('// Saved \u2014 now\nexport const a = "Saved. Now.";', {
      filePath,
    });
    expect(result?.messages).toEqual([]);
  });
});

describe('filler words in text', () => {
  const filePath = 'src/renderer/text-policy-fixture.tsx';

  it.each([
    ['a string', 'export const a = "Useful for short phrases.";'],
    ['a template', 'export const b = (n: number) => `${n} files, rather than one`;'],
    ['JSX text', 'export const C = () => <p>Simply press Save.</p>;'],
  ])('refuses one in %s', async (_kind, code) => {
    const [result] = await eslint.lintText(code, { filePath });
    expect(result?.messages).toContainEqual(
      expect.objectContaining({
        ruleId: 'no-restricted-syntax',
        message: 'Cut the filler word; say what it means.',
      }),
    );
  });

  it('allows one in a comment and a longer word', async () => {
    const [result] = await eslint.lintText(
      '// a useful note\nexport const a = "Usefulness is measured.";',
      { filePath },
    );
    expect(result?.messages).toEqual([]);
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

describe('typed page code', () => {
  const migrated = 'tests/native/runtime/interactions.ts';
  const message = 'Pass page code to evaluate through pageCall or tests/native/runtime/page.ts.';

  it.each([
    ['a string', "await connection.evaluate('document.title');"],
    ['a typed string', "await connection!.evaluate<string>('document.title');"],
    ['a template', 'await evaluate(`document.title`);'],
    ['a tagged template', 'await evaluate(String.raw`document.title`);'],
    ['a concatenation', "await evaluate('document.' + name);"],
  ])('refuses %s in a migrated file', async (_kind, code) => {
    const [result] = await eslint.lintText(code, { filePath: migrated });
    expect(result?.messages).toContainEqual(
      expect.objectContaining({ ruleId: 'no-restricted-syntax', message }),
    );
  });

  it('accepts a page function', async () => {
    const [result] = await eslint.lintText(
      'await connection.evaluate(pageCall(() => document.title));',
      { filePath: migrated },
    );
    expect(result?.messages).toEqual([]);
  });

  it.each([
    'tests/native/page-policy-fixture.ts',
    'tests/page-policy-fixture.ts',
    'tools/page-policy-fixture.ts',
  ])('covers %s', async (filePath) => {
    const [result] = await eslint.lintText("await connection.evaluate('document.title');", {
      filePath,
    });
    expect(result?.messages).toContainEqual(expect.objectContaining({ message }));
  });
});

describe('sandboxed preload', () => {
  const preload = readFileSync('src/preload.ts', 'utf8');

  it('refuses Node built-ins and the globals Electron 45 removed from sandboxed preloads', async () => {
    const [result] = await eslint.lintText(
      "import { readFileSync as read } from 'node:fs';\n" +
        preload +
        "\nexport const probe = [Buffer.byteLength('x'), setImmediate, clearImmediate, read];\n",
      { filePath: 'src/preload.ts' },
    );
    const rules = result?.messages.map((message) => message.message) ?? [];
    expect(rules).toContainEqual(expect.stringContaining('can require only electron'));
    for (const name of ['Buffer', 'setImmediate', 'clearImmediate'])
      expect(rules).toContainEqual(expect.stringContaining(`have no ${name} since Electron 45`));
  });

  it('accepts the preload as it is', async () => {
    const [result] = await eslint.lintText(preload, { filePath: 'src/preload.ts' });
    expect(result?.messages).toEqual([]);
  });
});
