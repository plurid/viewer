import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../vitest.config.ts';

type SharingMutation = 'none' | 'path-recheck' | 'batch-cache';
const selected = process.env.VIEWER_SHARING_MUTATION ?? 'none';
const choices: SharingMutation[] = ['none', 'path-recheck', 'batch-cache'];
if (!choices.includes(selected as SharingMutation)) throw new Error('Choose a sharing mutation.');
const changes = {
  'path-recheck': {
    file: '/src/desktop/files/network-sharing.ts',
    before: 'snapshot.shares.some((share) => containsPath(share.path, target.canonical))',
    after: 'false',
  },
  'batch-cache': {
    file: '/src/desktop/workers/worker.ts',
    before: 'await index?.update(file, false, visibility)',
    after: 'await index?.update(file, false)',
  },
};
const config = mergeConfig(
  base,
  defineConfig({
    plugins: [
      {
        name: 'sharing-regression-mutation',
        enforce: 'pre',
        transform(source, id) {
          if (selected === 'none') return;
          const change = changes[selected as keyof typeof changes];
          if (!id.split('?')[0]?.endsWith(change.file)) return;
          if (!source.includes(change.before))
            throw new Error('The sharing mutation target changed.');
          return { code: source.replace(change.before, change.after), map: null };
        },
      },
    ],
    test: {
      // A transformed counterfactual must never reuse the ordinary module's disk cache.
      fsModuleCache: false,
    },
  }),
);
// mergeConfig concatenates arrays, so replace the base suite's include after merging.
config.test!.include = [
  'tests/network-sharing-recovery.test.ts',
  'tests/index-worker-visibility.test.ts',
];
export default config;
