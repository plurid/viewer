import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, lstat, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  FileInformationService,
  informationPatchSchema,
} from '../src/desktop/files/file-information';
import { informationChanges } from '../src/domain/files/information';
import { macFiles } from '../src/desktop/native/macos-files';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const roots: string[] = [];
async function fixture() {
  const root = await temporaryRoot('viewer-info-');
  roots.push(root);
  const file = path.join(root, 'Unicode ș 日本語.txt');
  await writeFile(file, 'Keep this content intact.');
  return { root, file };
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    // The tests may have deliberately locked owned fixtures.
    if (process.platform === 'darwin') execFileSync('/usr/bin/chflags', ['-R', 'nouchg', root]);
    await chmod(root, 0o700);
    await trashTemporary(root);
  }
});
describe('metadata input boundary', () => {
  it('rejects duplicate/control-character tags, invalid colors, privileged mode bits and unknown fields', () => {
    for (const patch of [
      {
        tags: [
          { name: 'é', color: 1 },
          { name: 'e\u0301', color: 2 },
        ],
      },
      { tags: [{ name: 'bad\nname', color: 0 }] },
      { tags: [{ name: 'tag', color: 8 }] },
      { mode: 0o4777 },
      { owner: 'root' },
      {},
      { locked: 'false' },
      { comment: 'a\0b' },
    ])
      expect(informationPatchSchema.safeParse(patch).success).toBe(false);
    expect(informationPatchSchema.parse({ tags: [{ name: ' Project ', color: 4 }] })).toEqual({
      tags: [{ name: 'Project', color: 4 }],
    });
  });
});
describe.skipIf(process.platform !== 'darwin')('real native file information', () => {
  it('round-trips Finder plist tags/comments, mode and lock while preserving content and unrelated attributes', async () => {
    const { file } = await fixture(),
      changed = vi.fn();
    execFileSync('/usr/bin/xattr', ['-w', 'com.viewer.test', 'preserve-me', file]);
    const service = new FileInformationService(async () => {}, changed);
    try {
      const before = await service.get(file);
      const edited = await service.update(file, before.revision, {
        tags: [
          { name: 'Hopper', color: 4 },
          { name: 'ș 日本語', color: 6 },
        ],
        comment: 'Fabrication drawing\nReview before cutting.',
        mode: 0o640,
        locked: true,
      });
      expect(edited).toMatchObject({
        tags: [
          { name: 'Hopper', color: 4 },
          { name: 'ș 日本語', color: 6 },
        ],
        comment: 'Fabrication drawing\nReview before cutting.',
        mode: 0o640,
        locked: true,
      });
      expect(changed.mock.calls[0][0].normalize('NFC')).toBe(file.normalize('NFC'));
      expect(edited.systemTagNames).toEqual(['Hopper', 'ș 日本語']);
      const encoded = execFileSync('/usr/bin/xattr', [
        '-px',
        'com.apple.metadata:_kMDItemUserTags',
        file,
      ]);
      const decoded = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], {
        input: Buffer.from(encoded.toString().replace(/\s/g, ''), 'hex'),
        encoding: 'utf8',
      });
      expect(JSON.parse(decoded)).toEqual(['Hopper\n4', 'ș 日本語\n6']);
      expect(
        execFileSync('/usr/bin/xattr', ['-p', 'com.viewer.test', file], {
          encoding: 'utf8',
        }).trim(),
      ).toBe('preserve-me');
      expect(await readFile(file, 'utf8')).toBe('Keep this content intact.');
      await expect(
        service.update(file, before.revision, { comment: 'Stale editor' }),
      ).rejects.toThrow('changed');
      await expect(
        service.update(file, edited.revision, { comment: 'Still locked' }),
      ).rejects.toThrow('Unlock');
      const unlocked = await service.update(file, edited.revision, {
        locked: false,
        comment: '',
        tags: [],
      });
      expect(unlocked).toMatchObject({ tags: [], comment: '', locked: false });
      expect(informationChanges(unlocked, unlocked)).toEqual({});
    } finally {
      await service.close();
    }
  });
  it('can read and restore owner permissions after mode zero, without following a symbolic link', async () => {
    const { root, file } = await fixture();
    const service = new FileInformationService(
      async () => {},
      () => {},
    );
    try {
      const before = await service.get(file);
      await service.update(file, before.revision, { mode: 0 });
      const restricted = await service.get(file);
      expect(restricted.mode).toBe(0);
      await service.update(file, restricted.revision, { mode: 0o600 });
      const alias = path.join(root, 'symlink');
      await symlink(file, alias);
      await expect(service.update(alias, before.revision, { tags: [] })).rejects.toThrow(
        'original',
      );
      await expect(macFiles().information(alias)).rejects.toThrow();
      expect(await readFile(file, 'utf8')).toBe('Keep this content intact.');
    } finally {
      await service.close();
    }
  });
  it('rejects a replacement, native edits from a stale editor and revoked folder access before mutation', async () => {
    const { file } = await fixture();
    let allowed = true;
    const service = new FileInformationService(
      async () => {
        if (!allowed) throw new Error('Folder access revoked.');
      },
      () => {},
    );
    try {
      const original = await service.get(file);
      await rename(file, file + '.original');
      await writeFile(file, 'Replacement');
      await expect(
        service.update(file, original.revision, { comment: 'Wrong item' }),
      ).rejects.toThrow('changed');
      const replacement = await service.get(file);
      execFileSync('/usr/bin/xattr', ['-w', 'com.viewer.external-edit', 'another process', file]);
      await expect(
        service.update(file, replacement.revision, { comment: 'Stale edit' }),
      ).rejects.toThrow('changed');
      const latest = await service.get(file);
      allowed = false;
      await expect(
        service.update(file, latest.revision, { comment: 'Denied edit' }),
      ).rejects.toThrow('revoked');
      expect(JSON.parse(await macFiles().information(file)).comment).toBe('');
    } finally {
      await service.close();
    }
  });
  it('recognizes native packages and writes a real Finder alias without replacing an existing destination', async () => {
    const { root, file } = await fixture();
    const bundle = path.join(root, 'Example.app');
    await mkdir(path.join(bundle, 'Contents'), { recursive: true });
    expect(JSON.parse(await macFiles().information(bundle)).package).toBe(true);
    const alias = path.join(root, 'Example alias');
    await macFiles().alias(file, alias);
    expect((await lstat(alias)).isSymbolicLink()).toBe(false);
    expect((await lstat(alias)).size).toBeGreaterThan(0);
    expect(JSON.parse(await macFiles().information(alias)).alias).toBe(true);
    const before = await readFile(alias);
    await expect(macFiles().alias(file, alias)).rejects.toThrow('exists');
    expect(await readFile(alias)).toEqual(before);
    expect(
      execFileSync('/usr/bin/xattr', ['-p', 'com.apple.FinderInfo', alias]).length,
    ).toBeGreaterThan(0);
  });
});
