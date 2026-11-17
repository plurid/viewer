import path from 'node:path';
import { chmod } from 'node:fs/promises';
import { build } from 'vite';
import { temporaryRoot } from '../../tools/temporary';

export async function buildFakeSSH(): Promise<{
  root: string;
  sshExecutable: string;
  worker: string;
}> {
  const root = await temporaryRoot('viewer-ssh-');
  const entries = [
    ['tests/support/fake-ssh.ts', 'fake-ssh.cjs'],
    ['src/desktop/remote/remote-worker.ts', 'remote-worker.cjs'],
  ];
  for (const [entry, fileName] of entries)
    await build({
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { vitest: path.resolve('tests/support/ssh-test-assertions.ts') } },
      build: {
        emptyOutDir: false,
        outDir: root,
        target: 'node22',
        minify: false,
        lib: { entry: path.resolve(entry!), formats: ['cjs'], fileName: () => fileName! },
        rollupOptions: {
          external: (id) => id.startsWith('node:') || id === 'electron',
          output: { banner: fileName === 'fake-ssh.cjs' ? '#!/usr/bin/env node' : '' },
        },
      },
    });
  const sshExecutable = path.join(root, 'fake-ssh.cjs');
  await chmod(sshExecutable, 0o700);
  return { root, sshExecutable, worker: path.join(root, 'remote-worker.cjs') };
}
