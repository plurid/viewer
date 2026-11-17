import { afterEach, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import type { WorkspaceDefinitions } from '../src/desktop/workspaces/definitions';
import { WorkspaceDefinitions as Definitions } from '../src/desktop/workspaces/definitions';
import { buildDefinition } from '../src/domain/workspaces/definitions/build';
import { defaultSettings } from '../src/domain/services';
import { temporaryRoot } from '../tools/temporary';

const services: WorkspaceDefinitions[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
});
async function fixture(entry: string) {
  const root = await temporaryRoot('viewer-definition-save-review-');
  const settings = defaultSettings('/home/sample');
  const service = new Definitions(root, '/home/sample', {
    access: async () => {},
    checkRoot: async () => ({ directory: true }),
    settings: () => settings,
    emit: () => {},
  });
  services.push(service);
  const text = '{\n  "version": 1,\n  "sources": { "projectManager": { "enabled": false } },\n  "workspaces": {\n    "sample": ' + entry + '\n  }\n}\n';
  await writeFile(service.configuration.file, text);
  await service.load();
  let next = 0;
  const workspace = buildDefinition(service.entry('sample')!, {
    id: () => 'plane-' + ++next,
    home: '/home/sample',
    terminalProfile: settings.terminals.profileID,
    folder: (folder) => ({ id: 'plane-' + ++next, type: 'folder', path: folder }) as never,
    scratch: (folder) => ({ id: 'plane-' + ++next, type: 'scratch', path: folder, bufferID: 'buffer-' + next }) as never,
  });
  return { service, text, workspace, order: workspace.panes.map((pane) => pane.id) };
}

describe('saving preserves the written workspace recipe', () => {
  it.each([false, true])('M3: unresolved written planes and their comments survive Save (all skipped: %s)', async (all) => {
    const f = await fixture(`{
      "root": "/projects/sample",
      "planes": [
        ${all ? '' : '{ "kind": "folder", "path": "." },'}
        // shared library comment
        { "kind": "folder", "path": "{{ROOT:library}}" }
      ]
    }`);
    expect(await f.service.save(f.workspace, f.order, false)).toMatchObject({ kind: 'saved' });
    expect(await readFile(f.service.configuration.file, 'utf8')).toBe(f.text);
  });
  it('M2: a stale definition needs confirmation and never moves commands between folders', async () => {
    const a = '{ "kind": "terminal", "path": "packages/a", "command": "npm run dev" }';
    const b = '{ "kind": "terminal", "path": "packages/b", "command": "make clean" }';
    const f = await fixture('{ "root": "/projects/sample", "planes": [' + a + ', ' + b + '] }');
    const edited = f.text.replace(a + ', ' + b, b + ', ' + a);
    await writeFile(f.service.configuration.file, edited);
    await f.service.reload();
    expect(await f.service.save(f.workspace, f.order, false)).toMatchObject({
      kind: 'needs-confirmation', changed: true, dropsCommands: true,
    });
    expect(await readFile(f.service.configuration.file, 'utf8')).toBe(edited);
    expect(await f.service.save(f.workspace, f.order, true)).toMatchObject({ kind: 'saved', commandPlanes: [] });
    expect(f.service.entry('sample')!.planes.every(({ plane }) => plane.kind !== 'terminal' || plane.command === undefined)).toBe(true);
  });
  it('M1: an unchanged rich workspace saves byte for byte without pinning defaults', async () => {
    const f = await fixture(`{
      "root": "/projects/sample",
      "planes": [
        // folder comment
        { "kind": "folder", "path": "." },
        // command comment
        { "kind": "terminal", "path": "api", "command": "npm run dev" },
        // file comment
        { "kind": "file", "path": "readme.txt" },
        // scratch comment
        { "kind": "scratch" },
        // search comment
        { "kind": "search", "query": "todo", "name": "Todos", "root": "src" }
      ],
      "tiling": { "layout": "even-horizontal" }
    }`);
    expect(await f.service.save(f.workspace, f.order, false)).toMatchObject({ kind: 'saved' });
    expect(await readFile(f.service.configuration.file, 'utf8')).toBe(f.text);
  });
});
