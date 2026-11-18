import { expect, it } from 'vitest';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { globExpression, readSSHConfigHosts } from '../src/desktop/remote/ssh-config';
import { temporaryRoot } from '../tools/temporary';
import { remoteLimits } from '../src/domain/remote/limits';

it('reads bounded in-folder Includes, ignoring wildcard and Match hosts and external links', async () => {
  const root = await temporaryRoot('viewer-ssh-config-');
  const ssh = path.join(root, '.ssh');
  await mkdir(path.join(ssh, 'conf.d'), { recursive: true });
  await writeFile(path.join(root, 'outside'), 'Host forbidden\n');
  await symlink(path.join(root, 'outside'), path.join(ssh, 'linked'));
  await writeFile(
    path.join(ssh, 'config'),
    'Host build-box *.example !negated\n  HostName ignored.example\nInclude conf.d/*.conf linked ../outside\nMatch host private\n Include matched\nHost final\n',
  );
  // Only OpenSSH can tell whether a Match block applies, so its Include stays unread.
  await writeFile(path.join(ssh, 'matched'), 'Host matched-only\n');
  await writeFile(path.join(ssh, 'conf.d', 'one.conf'), 'Host included\nInclude two\n');
  await writeFile(path.join(ssh, 'two'), 'Host second\nInclude three\n');
  await writeFile(path.join(ssh, 'three'), 'Host third\nInclude four\n');
  await writeFile(path.join(ssh, 'four'), 'Host fourth\nInclude five\n');
  await writeFile(path.join(ssh, 'five'), 'Host too-deep\n');
  expect(await readSSHConfigHosts(ssh)).toEqual([
    'build-box',
    'final',
    'fourth',
    'included',
    'second',
    'third',
  ]);
});

it('never follows a link, even one that stays inside the folder', async () => {
  const ssh = await temporaryRoot('viewer-ssh-config-link-');
  await writeFile(path.join(ssh, 'real'), 'Host behind-link\n');
  await symlink(path.join(ssh, 'real'), path.join(ssh, 'alias'));
  await writeFile(path.join(ssh, 'config'), 'Host direct\nInclude alias\n');
  expect(await readSSHConfigHosts(ssh)).toEqual(['direct']);
});

it('reads glob classes and treats an unclosed bracket as a character', async () => {
  const ssh = await temporaryRoot('viewer-ssh-config-glob-');
  await writeFile(path.join(ssh, 'conf1'), 'Host one\n');
  await writeFile(path.join(ssh, 'conf2'), 'Host two\n');
  await writeFile(path.join(ssh, 'conf['), 'Host bracket\n');
  await writeFile(path.join(ssh, 'config'), 'Include conf[!2] conf[ conf[z-a]\n');
  expect(await readSSHConfigHosts(ssh)).toEqual(['bracket', 'one']);
  expect(globExpression('conf[')!.test('conf[')).toBe(true);
  expect(globExpression('a[]b]c')!.test('a]c')).toBe(true);
  expect(globExpression('a[]')!.test('a[]')).toBe(true);
  expect(globExpression('*.conf')!.test('x.conf')).toBe(true);
  expect(globExpression('*.conf')!.test('xconf')).toBe(false);
  expect(globExpression('[z-a]')).toBeUndefined();
});

it('caps the combined configuration bytes at 1 MiB', async () => {
  const root = await temporaryRoot('viewer-ssh-config-size-');
  await writeFile(
    path.join(root, 'config'),
    'Include extra\n' + '#'.repeat(remoteLimits.sshConfigBytes - 100),
  );
  await writeFile(path.join(root, 'extra'), '#'.repeat(200));
  await expect(readSSHConfigHosts(root)).rejects.toThrow('1 MiB');
});
