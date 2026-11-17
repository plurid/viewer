import { describe, expect, it, vi } from 'vitest';
import { readFile, readlink, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { temporaryRoot } from '../tools/temporary';
import { JsoncConfiguration } from '../src/desktop/preferences/configuration';

const schema = z.object({ count: z.number(), other: z.string().optional() });
async function fixture() {
  const root = await temporaryRoot('viewer-configuration-file-');
  const configuration = new JsoncConfiguration(root, (value) => schema.parse(value), undefined, {
    name: 'workspaces.jsonc',
    schemaName: 'workspaces.schema.json',
  });
  return { root, configuration, file: configuration.file };
}

describe('generalized JSONC configuration', () => {
  it.each(['config.jsonc', 'workspaces.jsonc'])('preserves a dangling %s link and creates only its target file', async (name) => {
    const root = await temporaryRoot('viewer-dangling-configuration-');
    const configuration = new JsoncConfiguration(root, (value) => schema.parse(value), undefined, { name, schemaName: 'sample.schema.json' });
    await symlink('target.jsonc', configuration.file);
    await configuration.update(() => ({ count: 2 }));
    expect(await readlink(configuration.file)).toBe('target.jsonc');
    expect(JSON.parse(await readFile(path.join(root, 'target.jsonc'), 'utf8'))).toEqual({ count: 2 });
  });
  it.each(['config.jsonc', 'workspaces.jsonc'])('refuses a dangling %s target whose folder is missing', async (name) => {
    const root = await temporaryRoot('viewer-dangling-folder-');
    const configuration = new JsoncConfiguration(root, (value) => schema.parse(value), undefined, { name, schemaName: 'sample.schema.json' });
    await symlink('missing/target.jsonc', configuration.file);
    await expect(configuration.update(() => ({ count: 2 }))).rejects.toThrow('missing');
    expect(await readlink(configuration.file)).toBe('missing/target.jsonc');
    await expect(readFile(path.join(root, 'missing/target.jsonc'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('preserves comments in another named file and writes its own schema', async () => {
    const f = await fixture();
    await writeFile(f.file, '// hand edited\n{"count":1}');
    await f.configuration.read();
    await f.configuration.update((current) => ({ ...current!, count: 2 }));
    expect(await readFile(f.file, 'utf8')).toContain('// hand edited');
    expect(JSON.parse(await readFile(f.file + '.last-valid', 'utf8')).count).toBe(2);
    await f.configuration.schema({ title: 'workspaces' });
    expect(
      JSON.parse(await readFile(path.join(f.root, 'workspaces.schema.json'), 'utf8')).title,
    ).toBe('workspaces');
  });
  it('names the file in errors and refuses to overwrite invalid JSONC', async () => {
    const f = await fixture();
    await writeFile(f.file, '{broken}');
    await f.configuration.read();
    await expect(f.configuration.write({ count: 2 })).rejects.toThrow('workspaces.jsonc');
    await expect(f.configuration.update(() => ({ count: 3 }))).rejects.toThrow('workspaces.jsonc');
    expect(await readFile(f.file, 'utf8')).toBe('{broken}');
  });
  it('retries once against the latest disk contents on a compare-and-swap conflict', async () => {
    const f = await fixture();
    await writeFile(f.file, '{"count":1}');
    const original = f.configuration.write.bind(f.configuration);
    const write = vi.spyOn(f.configuration, 'write').mockImplementationOnce(async (value) => {
      await writeFile(f.file, '// external\n{"count":4,"other":"kept"}');
      await original(value);
    });
    const changed = await f.configuration.update((current) => ({
      ...current!,
      count: current!.count + 1,
    }));
    expect(changed).toEqual({ count: 5, other: 'kept' });
    expect(write).toHaveBeenCalledTimes(2);
    expect(await readFile(f.file, 'utf8')).toContain('// external');
  });
  it('writes through an existing symbolic link without replacing it', async () => {
    const f = await fixture();
    const target = path.join(f.root, 'dotfile.jsonc');
    await writeFile(target, '// portable\n{"count":1}');
    await symlink(target, f.file);
    await f.configuration.update((current) => ({ ...current!, count: 2 }));
    expect(await readFile(target, 'utf8')).toContain('"count":2');
    expect(await readFile(target, 'utf8')).toContain('// portable');
  });
});
