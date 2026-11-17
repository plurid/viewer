import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import base from '../vitest.config.ts';

interface MutationEdit {
  file: string;
  before: string;
  after: string;
}

const file = process.env.VIEWER_DECLARED_COMMAND_MUTATIONS;
const probes: Record<string, MutationEdit[]> = file ? JSON.parse(readFileSync(file, 'utf8')) : {};
const name = process.env.VIEWER_DECLARED_COMMAND_MUTATION;
const edits = name ? probes[name] : undefined;
if (name && !edits) throw new Error('Choose a known declared command mutation.');

/** Source transforms keep concurrent work intact while a review removes one guard at a time. */
export default defineConfig({
  ...base,
  resolve: { alias: { '@declared-review': process.cwd() } },
  server: {
    fs: {
      allow: [
        path.resolve('../../..'),
        process.env.VIEWER_DECLARED_REVIEW_DIRECTORY ?? process.cwd(),
      ],
    },
  },
  plugins: [
    ...(base.plugins ?? []),
    {
      name: 'declared-command-regression-probe',
      enforce: 'pre',
      transform(code, id) {
        let changed = code;
        for (const edit of edits ?? []) {
          if (!id.endsWith(edit.file)) continue;
          if (!changed.includes(edit.before))
            throw new Error('The mutation no longer matches its source.');
          changed = changed.replace(edit.before, edit.after);
        }
        return changed === code ? undefined : changed;
      },
    },
  ],
  test: {
    ...base.test,
    fsModuleCache: false,
    include: process.env.VIEWER_DECLARED_REVIEW_TESTS?.split(',') ?? [
      'tests/declared-commands.test.ts',
      'tests/declared-commands-reader.test.ts',
      'tests/folder-facts.test.ts',
      'tests/run-command-declared.test.tsx',
      'tests/folder-history-checks.test.ts',
      'tests/preload-events.test.ts',
    ],
  },
});
