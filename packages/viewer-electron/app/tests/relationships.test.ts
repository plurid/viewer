import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Relationships } from '../src/desktop/relationships';
import { Operations } from '../src/desktop/operations';
import { entry } from '../src/desktop/filesystem';
import { sourceVersion } from '../src/domain/inspection';
import {
  declaredReferences,
  type FileRelation,
  type RelationshipsResult,
} from '../src/domain/relationships';
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'viewer-relations-')),
    profile = path.join(root, 'Profile'),
    destination = path.join(root, 'Destination');
  await mkdir(destination);
  const source = path.join(root, 'Source.txt');
  await writeFile(source, 'Original source');
  let denied = '';
  const access = async (files: readonly string[]) => {
    if (denied && files.includes(denied)) throw new Error('Folder access was revoked.');
  };
  let operations = new Operations(
    (file) => rename(file, path.join(root, 'Trash-' + path.basename(file))),
    () => {},
    undefined,
    undefined,
    access,
    profile,
  );
  const deps = {
    access,
    operations: async () => {
      await operations.load();
      return operations.observedLinks();
    },
    recipes: async () => [],
    workflows: async () => [],
  };
  let relationships = new Relationships(profile, deps);
  return {
    root,
    source,
    destination,
    get operations() {
      return operations;
    },
    get relationships() {
      return relationships;
    },
    deny: (file: string) => {
      denied = file;
    },
    reopen: async () => {
      await relationships.close();
      await operations.close();
      operations = new Operations(
        async () => {},
        () => {},
        undefined,
        undefined,
        access,
        profile,
      );
      relationships = new Relationships(profile, deps);
    },
    close: async () => {
      await relationships.close();
      await operations.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
describe('recorded and declared file relationships', () => {
  it('rejects remote/encoded paths and ignores Markdown code examples without following any target', () => {
    const result = declaredReferences(
      'md',
      '[Local](Model%20one.stl) [URL](https://example.test/a) [Encoded](file%3A%2F%2F%2Fetc%2Fpasswd)\n```\n[Example](wrong.stl)\n```\n`[Example](also-wrong.stl)`',
    );
    expect(result.paths).toEqual(['Model one.stl']);
    expect(
      declaredReferences(
        'ts',
        `import x from './model'; require('./local'); import 'external'; fetch('https://outside')`,
      ).paths,
    ).toEqual(['./model', './local']);
    expect(declaredReferences('step', 'anything').supported).toBe(false);
    expect(declaredReferences('md', '['.repeat(200000) + '] malformed').paths).toEqual([]);
  });
  it('derives a real copy relationship from durable receipts, marks changed outputs and restores after a cold service', async () => {
    const f = await fixture();
    try {
      f.operations.start({
        kind: 'copy',
        sources: [f.source],
        destination: f.destination,
        expectedSources: [{ path: f.source, version: sourceVersion(await entry(f.source)) }],
      });
      await f.operations.exclusive(async () => {});
      const target = path.join(f.destination, 'Source.txt');
      let result = (await f.relationships.request({
        kind: 'read',
        file: f.source,
        content: false,
      })) as RelationshipsResult;
      expect(result.relations).toMatchObject([
        { basis: 'observed', kind: 'copy', from: { path: f.source }, to: { path: target } },
      ]);
      expect(JSON.stringify(result)).not.toMatch(/bookmark|staging|private key/);
      await writeFile(target, 'A later edit');
      result = (await f.relationships.request({
        kind: 'read',
        file: f.source,
        content: false,
      })) as RelationshipsResult;
      expect(result.files.find((file) => file.path === target)?.status).toBe('changed');
      await f.reopen();
      expect(
        await f.relationships.request({ kind: 'read', file: target, content: false }),
      ).toMatchObject({ relations: [{ basis: 'observed', kind: 'copy' }] });
    } finally {
      await f.close();
    }
  });
  it('keeps user notes separate and never reads reference contents without an explicit request', async () => {
    const f = await fixture();
    try {
      const file = path.join(f.root, 'Links.md'),
        target = path.join(f.destination, 'Model.stl');
      await writeFile(file, '[Model](Destination/Model.stl)');
      await writeFile(target, 'Generated model reference');
      expect(
        (
          (await f.relationships.request({
            kind: 'read',
            file,
            content: false,
          })) as RelationshipsResult
        ).relations,
      ).toEqual([]);
      const scanned = (await f.relationships.request({
        kind: 'read',
        file,
        content: true,
      })) as RelationshipsResult;
      expect(scanned.relations[0]).toMatchObject({ basis: 'declared', to: { path: target } });
      const note = (await f.relationships.request({
        kind: 'note',
        from: file,
        to: target,
        note: 'Source for this model',
      })) as FileRelation;
      expect(note.basis).toBe('reported');
      await f.reopen();
      const restored = (await f.relationships.request({
        kind: 'read',
        file,
        content: false,
      })) as RelationshipsResult;
      expect(restored.relations).toMatchObject([{ id: note.id, basis: 'reported' }]);
      f.deny(target);
      expect(
        (
          (await f.relationships.request({
            kind: 'read',
            file,
            content: false,
          })) as RelationshipsResult
        ).files.find((item) => item.path === target)?.status,
      ).toBe('unavailable');
      await f.relationships.request({ kind: 'remove-note', id: note.id });
      expect(
        JSON.parse(
          await readFile(path.join(f.root, 'Profile', 'file-relationships-v1.json'), 'utf8'),
        ),
      ).toEqual([]);
    } finally {
      await f.close();
    }
  });
});
