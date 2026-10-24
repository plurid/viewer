import { lstat, mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { temporaryRoot } from '../tools/temporary';
import { adoptGeneratedProfile, prepareOwnedApplication } from './native/runtime/owned-application';

async function fixture(program?: string) {
  const root = await realpath(await temporaryRoot('viewer-owned-launch-'));
  const binary = path.join(root, 'synthetic-viewer');
  await writeFile(
    binary,
    `#!${process.execPath}\n` +
      (program ??
        `process.stdout.write(JSON.stringify({
          args: process.argv.slice(2),
          profile: process.env.VIEWER_DATA_DIRECTORY,
          render: process.env.VIEWER_RENDER_TEST,
          background: process.env.VIEWER_BACKGROUND_TEST,
          preserve: process.env.VIEWER_TEST_PRESERVE,
          noRemoval: process.env.VIEWER_TEST_NO_REMOVAL
        }) + '\\n');
        process.stderr.write('DevTools listening on ws://127.0.0.1:43127/devtools/browser/generated\\n');
        process.on('SIGTERM', () => process.exit(0));
        setInterval(() => {}, 1000);\n`),
    { flag: 'wx', mode: 0o700 },
  );
  return {
    root,
    binary,
    profile: path.join(root, 'profile'),
    evidenceRoot: path.join(root, 'evidence'),
  };
}

describe('owned native application launcher', () => {
  it.each(['hidden', 'foreground'] as const)(
    'uses explicit %s mode and the port announced by that process, preserving cold-start evidence',
    async (mode) => {
      const files = await fixture();
      const owned = await prepareOwnedApplication({
        ...files,
        mode,
        label: 'launcher-contract',
        environment: {
          VIEWER_DATA_DIRECTORY: '/must-not-use',
          VIEWER_RENDER_TEST: '0',
          VIEWER_BACKGROUND_TEST: mode === 'hidden' ? '0' : '1',
          VIEWER_TEST_PRESERVE: '0',
        },
      });
      const sentinel = path.join(owned.profile, 'Generated.txt');
      await writeFile(sentinel, 'Generated retained profile fixture.\n');
      const starting = owned.launch();
      await expect(owned.launch()).rejects.toThrow('already running');
      const launched = await starting;
      try {
        expect(launched.port).toBe(43127);
        expect(launched.debuggerOrigin).toBe('http://127.0.0.1:43127');
        const output = JSON.parse(
          launched
            .output()
            .split('\n')
            .find((line) => line.startsWith('{'))!,
        );
        expect(output).toMatchObject({
          profile: files.profile,
          render: '1',
          background: mode === 'hidden' ? '1' : '0',
          preserve: '1',
          noRemoval: '1',
        });
        expect(output.args).toContain('--remote-debugging-port=0');
        expect(output.args).toContain('--remote-debugging-address=127.0.0.1');
        await expect(owned.launch()).rejects.toThrow('already running');
      } finally {
        await launched.stop();
      }
      const recorded = JSON.parse(
        await readFile(path.join(launched.evidenceDirectory, 'process.json'), 'utf8'),
      );
      expect(recorded).toMatchObject({ mode, noRemoval: true, port: 43127, code: 0, signal: null });
      expect(recorded.finished).toBeTypeOf('string');
      expect(await readFile(path.join(launched.evidenceDirectory, 'stdout.log'), 'utf8')).toContain(
        files.profile,
      );
      expect(await readFile(path.join(launched.evidenceDirectory, 'stderr.log'), 'utf8')).toContain(
        'DevTools listening',
      );
      expect(await readFile(sentinel, 'utf8')).toBe('Generated retained profile fixture.\n');
      const restarted = await owned.launch();
      await restarted.stop();
      expect(restarted.evidenceDirectory).not.toBe(launched.evidenceDirectory);
      expect(await readdir(owned.evidenceDirectory)).toHaveLength(3);
    },
  );

  it('retains startup failures and can retry without reusing a process log', async () => {
    const files = await fixture(
      "process.stderr.write('Generated startup failure\\n'); process.exit(17);\n",
    );
    const owned = await prepareOwnedApplication({
      ...files,
      mode: 'hidden',
      label: 'launcher-failure',
    });
    await expect(owned.launch()).rejects.toThrow('exited before startup (17)');
    const [launch] = (await readdir(owned.evidenceDirectory)).filter((name) =>
      name.startsWith('launch-'),
    );
    expect(
      await readFile(path.join(owned.evidenceDirectory, launch!, 'stderr.log'), 'utf8'),
    ).toContain('Generated startup failure');
    await expect(owned.launch()).rejects.toThrow('exited before startup (17)');
    expect(
      (await readdir(owned.evidenceDirectory)).filter((name) => name.startsWith('launch-')),
    ).toHaveLength(2);
    expect((await lstat(owned.profile)).isDirectory()).toBe(true);
  });

  it('bounds startup waits and stops only its owned synthetic process', async () => {
    const files = await fixture('setInterval(() => {}, 1000);\n');
    const owned = await prepareOwnedApplication({
      ...files,
      mode: 'hidden',
      label: 'launcher-timeout',
      startupTimeoutMs: 50,
    });
    await expect(owned.launch()).rejects.toThrow('did not announce');
    const [launch] = (await readdir(owned.evidenceDirectory)).filter((name) =>
      name.startsWith('launch-'),
    );
    const record = JSON.parse(
      await readFile(path.join(owned.evidenceDirectory, launch!, 'process.json'), 'utf8'),
    );
    expect(record).toMatchObject({ signal: 'SIGTERM' });
    expect(record.finished).toBeTypeOf('string');
    expect((await lstat(owned.profile)).isDirectory()).toBe(true);
  });

  it('refuses to claim an existing directory or a linked profile', async () => {
    const files = await fixture();
    await mkdir(files.profile);
    const sentinel = path.join(files.profile, 'sentinel.txt');
    await writeFile(sentinel, 'Kept existing profile.\n');
    const options = { ...files, mode: 'hidden' as const, label: 'existing-profile' };
    await expect(prepareOwnedApplication(options)).rejects.toMatchObject({ code: 'EEXIST' });
    const linked = path.join(files.root, 'linked-profile');
    await symlink(files.profile, linked, 'dir');
    await expect(prepareOwnedApplication({ ...options, profile: linked })).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(await readFile(sentinel, 'utf8')).toBe('Kept existing profile.\n');
    expect(await readdir(files.profile)).toEqual(['sentinel.txt']);
    expect(await readdir(files.evidenceRoot)).toHaveLength(2);
  });

  it('adopts only an intact generated fixture without writing or overwriting profile contents', async () => {
    const files = await fixture();
    await mkdir(files.profile);
    const sentinel = path.join(files.profile, 'settings-v1.json');
    await writeFile(sentinel, '{"generated":"kept"}\n');
    const before = await readdir(files.profile);
    const options = { ...files, mode: 'hidden' as const, label: 'adopted-fixture' };
    const owned = await adoptGeneratedProfile(options);
    const launched = await owned.launch();
    await launched.stop();
    expect(await readFile(sentinel, 'utf8')).toBe('{"generated":"kept"}\n');
    expect(await readdir(files.profile)).toEqual(before);
    const cold = await adoptGeneratedProfile(options);
    expect(cold.evidenceDirectory).not.toBe(owned.evidenceDirectory);
    const restarted = await cold.launch();
    await restarted.stop();
    expect(await readdir(files.profile)).toEqual(before);
  });

  it('refuses normal user directories and symlinks anywhere inside an adopted fixture path', async () => {
    const files = await fixture();
    const options = { ...files, mode: 'hidden' as const, label: 'refused-adoption' };
    await expect(adoptGeneratedProfile({ ...options, profile: os.homedir() })).rejects.toThrow(
      'not inside a generated fixture',
    );
    const actual = path.join(files.root, 'actual');
    await mkdir(actual);
    await mkdir(path.join(actual, 'profile'));
    const linked = path.join(files.root, 'linked');
    await symlink(actual, linked, 'dir');
    await expect(
      adoptGeneratedProfile({ ...options, profile: path.join(linked, 'profile') }),
    ).rejects.toThrow('ordinary directories');
    expect(await readdir(path.join(actual, 'profile'))).toEqual([]);
    expect((await lstat(linked)).isSymbolicLink()).toBe(true);
  });

  it('refuses an explicit removal override in a hidden session', async () => {
    const files = await fixture();
    await expect(
      prepareOwnedApplication({
        ...files,
        mode: 'hidden',
        label: 'refused-removal-override',
        environment: { VIEWER_TEST_NO_REMOVAL: '0' },
      }),
    ).rejects.toThrow('requires a foreground session');
    await expect(lstat(files.profile)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
