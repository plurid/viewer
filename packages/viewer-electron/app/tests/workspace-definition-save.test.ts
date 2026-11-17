import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { WorkspaceDefinitions } from '../src/desktop/workspaces/definitions';
import { defaultSettings } from '../src/domain/services';
import { temporaryRoot } from '../tools/temporary';
import { sampleWorkspace } from './workspace-definition-fixtures';

const services: WorkspaceDefinitions[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
});
async function fixture(text?: string) {
  const root = await temporaryRoot('viewer-definition-save-');
  const service = new WorkspaceDefinitions(root, '/home/sample', {
    access: async () => {},
    checkRoot: async () => ({ directory: true }),
    settings: () => defaultSettings('/home/sample'),
    emit: () => {},
  });
  services.push(service);
  const original =
    text ??
    '{\n  "version": 1,\n  "sources": { "projectManager": { "enabled": false } },\n  "workspaces": {\n    // sample stays\n    "sample": { "root": "/projects/sample", "aliases": ["alias"], "planes": [\n      // keep folder\n      { "kind": "folder", "path": "./src" },\n      { "kind": "scratch" }\n    ] },\n    // other stays\n    "other": { "root": "/projects/other" }\n  }\n}\n';
  await writeFile(service.configuration.file, original);
  await service.load();
  const definition = service.entry('sample')!;
  const workspace = sampleWorkspace('sample-space', {
    definition: { key: definition.key, basis: definition.basis },
    panes: [
      { id: 'folder', type: 'folder', path: '/projects/sample/src' } as never,
      { id: 'terminal', type: 'terminal', path: '/projects/sample', profileID: 'default' },
    ],
    roots: ['folder', 'terminal'],
    activePane: 'folder',
  });
  return { service, root, original, workspace, file: service.configuration.file };
}
describe('saving a workspace definition', () => {
  it('writes only its entry, keeps unchanged plane comments and writes through a link', async () => {
    const f = await fixture();
    const target = path.join(f.root, 'dotfile.jsonc');
    await writeFile(target, f.original);
    const linkedRoot = await temporaryRoot('viewer-definition-save-link-');
    const service = new WorkspaceDefinitions(linkedRoot, '/home/sample', {
      access: async () => {},
      checkRoot: async () => ({ directory: true }),
      settings: () => defaultSettings('/home/sample'),
      emit: () => {},
    });
    services.push(service);
    await symlink(target, service.configuration.file);
    await service.load();
    expect(await service.save(f.workspace, ['folder', 'terminal'], false)).toMatchObject({
      kind: 'saved',
      key: 'sample',
    });
    const result = await readFile(target, 'utf8');
    expect(result.slice(0, result.indexOf('"sample":'))).toBe(
      f.original.slice(0, f.original.indexOf('"sample":')),
    );
    expect(result.slice(result.indexOf('    // other stays'))).toBe(
      f.original.slice(f.original.indexOf('    // other stays')),
    );
    expect(result).toContain('// keep folder');
    expect(parse(result).workspaces.sample.aliases).toEqual(['alias']);
  });
  it('asks once for curated entries and keeps the marker on a forced save', async () => {
    const f = await fixture(
      '{"version":1,"sources":{"projectManager":{"enabled":false}},"workspaces":{"sample":{"root":"/projects/sample","curated":true,"planes":[{"kind":"folder","path":"."}]}}}',
    );
    expect(await f.service.save(f.workspace, ['folder', 'terminal'], false)).toEqual({
      kind: 'needs-confirmation',
      curated: true,
      dropsCommands: false,
    });
    expect(await readFile(f.file, 'utf8')).toBe(f.original);
    expect(await f.service.save(f.workspace, ['folder', 'terminal'], true)).toMatchObject({
      kind: 'saved',
    });
    expect(parse(await readFile(f.file, 'utf8')).workspaces.sample.curated).toBe(true);
  });
  it('asks when a written command would be dropped', async () => {
    const f = await fixture(
      '{"version":1,"sources":{"projectManager":{"enabled":false}},"workspaces":{"sample":{"root":"/projects/sample","planes":[{"kind":"terminal","path":".","command":"echo sample"}]}}}',
    );
    expect(await f.service.save(f.workspace, ['folder', 'terminal'], false)).toEqual({
      kind: 'needs-confirmation',
      curated: false,
      dropsCommands: true,
    });
    expect(await readFile(f.file, 'utf8')).toBe(f.original);
  });
  it('retries an outside edit once and captures against the new metadata', async () => {
    const f = await fixture();
    const original = f.service.configuration.write.bind(f.service.configuration);
    const write = vi
      .spyOn(f.service.configuration, 'write')
      .mockImplementationOnce(async (value) => {
        await writeFile(f.file, f.original.replace('["alias"]', '["outside"]'));
        await original(value);
      });
    await f.service.save(f.workspace, ['folder', 'terminal'], false);
    expect(write).toHaveBeenCalledTimes(2);
    expect(parse(await readFile(f.file, 'utf8')).workspaces.sample.aliases).toEqual(['outside']);
  });
  it('saves an ad-hoc workspace under a new key and refuses an existing entry', async () => {
    const f = await fixture();
    const { definition: _link, ...workspace } = f.workspace;
    const saved = await f.service.save(workspace, ['folder', 'terminal'], true, {
      key: 'new-room',
      name: 'New room',
    });
    expect(saved).toMatchObject({
      kind: 'saved',
      key: 'new-room',
      planes: { folder: 0, terminal: 1 },
    });
    expect(f.service.entry('new-room')!.name).toBe('New room');
    await expect(
      f.service.save(workspace, ['folder', 'terminal'], true, { key: 'new-room', name: 'Again' }),
    ).rejects.toThrow('Save to definition');
  });
});
