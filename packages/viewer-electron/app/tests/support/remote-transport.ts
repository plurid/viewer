import path from 'node:path';
import { chmod, writeFile } from 'node:fs/promises';
import { build } from 'vite';
import type { Plugin } from 'vite';
import { temporaryRoot } from '../../tools/temporary';

export interface FakeSSHFixture {
  root: string;
  /** The bundled fake ssh; run it through `fakeSSHExecutable`, which tells it where to log. */
  script: string;
  worker: string;
}

/** A mutation run names a Vite plugin module, so its edits reach the bundled worker too. */
async function buildPlugins(): Promise<Plugin[]> {
  const module = process.env.VIEWER_TEST_BUILD_PLUGIN;
  return module ? [((await import(module)) as { default: Plugin }).default] : [];
}

export async function buildFakeSSH(): Promise<FakeSSHFixture> {
  const root = await temporaryRoot('viewer-ssh-');
  const plugins = await buildPlugins();
  const entries = [
    ['tests/support/fake-ssh.ts', 'fake-ssh.cjs'],
    ['src/desktop/remote/remote-worker.ts', 'remote-worker.cjs'],
  ];
  for (const [entry, fileName] of entries) {
    await build({
      configFile: false,
      logLevel: 'silent',
      plugins,
      resolve: { alias: { vitest: path.resolve('tests/support/ssh-test-assertions.ts') } },
      build: {
        emptyOutDir: false,
        outDir: root,
        target: 'node22',
        minify: false,
        lib: { entry: path.resolve(entry!), formats: ['cjs'], fileName: () => fileName! },
        rollupOptions: {
          external: (id) => id.startsWith('node:') || id === 'electron',
        },
      },
    });
  }
  return {
    root,
    script: path.join(root, 'fake-ssh.cjs'),
    worker: path.join(root, 'remote-worker.cjs'),
  };
}

const quoted = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

/**
 * Viewer passes ssh only an allowlisted environment, so the fake ssh learns its log file from a
 * wrapper in `folder` rather than from the test's environment.
 */
export async function fakeSSHExecutable(
  fixture: FakeSSHFixture,
  folder: string,
  log: string,
): Promise<string> {
  const executable = path.join(folder, 'ssh');
  await writeFile(
    executable,
    [
      '#!/bin/sh',
      'VIEWER_FAKE_SSH_LOG=' +
        quoted(log) +
        ' exec ' +
        quoted(process.execPath) +
        ' ' +
        quoted(fixture.script) +
        ' "$@"',
      '',
    ].join('\n'),
    { mode: 0o700 },
  );
  await chmod(executable, 0o700);
  return executable;
}
