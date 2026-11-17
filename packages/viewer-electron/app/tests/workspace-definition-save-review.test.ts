import { afterEach, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'jsonc-parser';
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
  const text =
    '{\n  "version": 1,\n  "sources": { "projectManager": { "enabled": false } },\n  "workspaces": {\n    "sample": ' +
    entry +
    '\n  }\n}\n';
  await writeFile(service.configuration.file, text);
  await service.load();
  let next = 0;
  const workspace = buildDefinition(service.entry('sample')!, {
    id: () => 'plane-' + ++next,
    home: '/home/sample',
    terminalProfile: settings.terminals.profileID,
    folder: (folder) => ({ id: 'plane-' + ++next, type: 'folder', path: folder }) as never,
    scratch: (folder) =>
      ({
        id: 'plane-' + ++next,
        type: 'scratch',
        path: folder,
        bufferID: 'buffer-' + next,
      }) as never,
  });
  return { service, text, workspace, order: workspace.panes.map((pane) => pane.id) };
}

describe('saving preserves the written workspace recipe', () => {
  it.each([false, true])(
    'F2/F3: Save as keeps the root folder, including on a second Save (terminal: %s)',
    async (terminal) => {
      const f = await fixture('{ "root": "/projects/sample" }');
      const { definition: _definition, ...workspace } = f.workspace;
      if (terminal) {
        workspace.panes.push({
          id: 'new-terminal',
          type: 'terminal',
          path: '/projects/sample',
          profileID: defaultSettings('/home/sample').terminals.profileID,
        });
        workspace.roots.push('new-terminal');
      }
      const order = workspace.panes.map((pane) => pane.id);
      const saved = await f.service.save(workspace, order, true, {
        key: 'sample-room',
        name: 'Sample room',
      });
      if (saved.kind !== 'saved') throw new Error('Save as did not save the definition.');
      expect(saved.planes[order[0]!]).toBe(0);
      const linked = {
        ...workspace,
        definition: { key: saved.key, basis: saved.basis, planes: saved.planes },
      };
      expect(await f.service.save(linked, order, false)).toMatchObject({ kind: 'saved' });
      expect(f.service.entry(saved.key)!.planes.map(({ plane }) => plane.kind)).toEqual(
        terminal ? ['folder', 'terminal'] : ['folder'],
      );
      expect(f.service.entry(saved.key)!.planes[0]!.plane).toEqual({
        kind: 'folder',
        path: '/projects/sample',
      });
    },
  );
  it('F4: Save as keeps the root folder when overriding a plain project', async () => {
    const f = await fixture('{ "root": "/projects/sample" }');
    const source = path.join(
      await temporaryRoot('viewer-definition-project-source-'),
      'projects.json',
    );
    await writeFile(
      source,
      JSON.stringify([{ name: 'Sample > Site', rootPath: '/projects/sample' }]),
    );
    await writeFile(
      f.service.configuration.file,
      JSON.stringify({
        version: 1,
        sources: { projectManager: { enabled: true, path: source } },
      }),
    );
    await f.service.reload();
    const project = f.service.snapshot().definitions[0]!;
    const { definition: _definition, ...workspace } = f.workspace;
    const saved = await f.service.save(workspace, f.order, true, {
      key: project.key,
      name: 'Sample room',
    });
    if (saved.kind !== 'saved') throw new Error('Save as did not save the project override.');
    expect(saved.planes[f.order[0]!]).toBe(0);
    expect(f.service.entry(saved.key)).toMatchObject({
      source: 'override',
      planes: [{ index: 0, plane: { kind: 'folder', path: '/projects/sample' } }],
    });
    const linked = {
      ...workspace,
      definition: { key: saved.key, basis: saved.basis, planes: saved.planes },
    };
    expect(await f.service.save(linked, f.order, false)).toMatchObject({ kind: 'saved' });
  });
  it.each(['insert', 'delete'] as const)(
    'J: a stale confirmed Save matches written folders after a disk %s',
    async (change) => {
      const a = '{ "kind": "folder", "path": "a" }';
      const b = '// keep surviving folder\n{ "kind": "folder", "path": "b" }';
      const c = '// keep inserted folder\n{ "kind": "folder", "path": "c" }';
      const f = await fixture('{ "root": "/projects/sample", "planes": [' + a + ', ' + b + '] }');
      const edited = f.text.replace(
        a + ', ' + b,
        change === 'insert' ? c + ', ' + a + ', ' + b : b,
      );
      await writeFile(f.service.configuration.file, edited);
      await f.service.reload();
      expect(await f.service.save(f.workspace, f.order, false)).toMatchObject({
        kind: 'needs-confirmation',
        changed: true,
        dropsCommands: false,
      });
      const saved = await f.service.save(f.workspace, f.order, true);
      if (saved.kind !== 'saved')
        throw new Error('The confirmed save did not save the definition.');
      const expected = (change === 'insert' ? ['c', 'a', 'b'] : ['a', 'b']).map(
        (name) => '/projects/sample/' + name,
      );
      const resolved = f.service
        .entry('sample')!
        .planes.map(({ plane }) => ('path' in plane ? plane.path : undefined));
      expect(resolved).toEqual(expected);
      expect(new Set(resolved).size).toBe(expected.length);
      const text = await readFile(f.service.configuration.file, 'utf8');
      expect(text).toContain('// keep surviving folder');
      if (change === 'insert') expect(text).toContain('// keep inserted folder');
      expect(parse(text).workspaces.sample.planes).toHaveLength(expected.length);
      const linked = {
        ...f.workspace,
        definition: { key: saved.key, basis: saved.basis, planes: saved.planes },
      };
      expect(await f.service.save(linked, f.order, false)).toMatchObject({ kind: 'saved' });
      expect(await readFile(f.service.configuration.file, 'utf8')).toBe(text);
    },
  );
  it('Save as after a removed definition writes a former synthetic root plane', async () => {
    const f = await fixture(
      '{ "root": "/projects/sample", "planes": [{ "kind": "folder", "path": "{{ROOT:library}}" }] }',
    );
    expect(f.workspace.definition!.planes).toEqual({ [f.order[0]!]: -1 });
    await writeFile(
      f.service.configuration.file,
      JSON.stringify({
        version: 1,
        sources: { projectManager: { enabled: false } },
        workspaces: {},
      }),
    );
    await f.service.reload();
    expect(f.service.snapshot().file.state).toBe('read');
    expect(f.service.entry('sample')).toBeUndefined();
    const saved = await f.service.save(f.workspace, f.order, true, {
      key: 'sample-room',
      name: 'Sample room',
    });
    if (saved.kind !== 'saved') throw new Error('Save as did not save the replacement definition.');
    expect(saved.planes).toEqual({ [f.order[0]!]: 0 });
    expect(f.service.entry(saved.key)!.planes).toEqual([
      { index: 0, plane: { kind: 'folder', path: '/projects/sample' } },
    ]);
    const text = await readFile(f.service.configuration.file, 'utf8');
    const linked = {
      ...f.workspace,
      definition: { key: saved.key, basis: saved.basis, planes: saved.planes },
    };
    expect(await f.service.save(linked, f.order, false)).toMatchObject({ kind: 'saved' });
    expect(await readFile(f.service.configuration.file, 'utf8')).toBe(text);
  });
  it('K2: a stale Save keeps file-only planes even if they were closed here before an unrelated edit', async () => {
    const f = await fixture(
      '{ "root": "/projects/sample", "planes": [\n// file-only plane\n{ "kind": "folder", "path": "a" },\n{ "kind": "folder", "path": "b" }\n] }',
    );
    f.workspace.panes = f.workspace.panes.slice(1);
    f.workspace.roots = f.workspace.panes.map((pane) => pane.id);
    f.workspace.activePane = f.workspace.roots[0];
    const order = [...f.workspace.roots];
    const edited = f.text.replace(
      '"root": "/projects/sample"',
      '"root": "/projects/sample", "focus": 1',
    );
    await writeFile(f.service.configuration.file, edited);
    await f.service.reload();
    expect(await f.service.save(f.workspace, order, false)).toMatchObject({
      kind: 'needs-confirmation',
      changed: true,
      dropsCommands: false,
    });
    expect(await f.service.save(f.workspace, order, true)).toMatchObject({ kind: 'saved' });
    expect(f.service.entry('sample')!.planes.map(({ plane }) => plane)).toEqual([
      { kind: 'folder', path: '/projects/sample/a' },
      { kind: 'folder', path: '/projects/sample/b' },
    ]);
    expect(await readFile(f.service.configuration.file, 'utf8')).toContain('// file-only plane');
  });
  it.each([false, true])(
    'J2: keeps a shifted command and its comment after a disk deletion (close live folder: %s)',
    async (closeFolder) => {
      const a = '// keep a\n{ "kind": "folder", "path": "a" }';
      const b = '{ "kind": "folder", "path": "b" }';
      const c = '// keep c\n{ "kind": "terminal", "path": "c", "command": "npm run dev" }';
      const f = await fixture(
        '{ "root": "/projects/sample", "planes": [' + [a, b, c].join(', ') + '] }',
      );
      if (closeFolder) {
        f.workspace.panes = f.workspace.panes.filter((pane) => pane.path !== '/projects/sample/b');
        f.workspace.roots = f.workspace.panes.map((pane) => pane.id);
      }
      const order = f.workspace.panes.map((pane) => pane.id);
      const terminal = f.workspace.panes.find((pane) => pane.type === 'terminal')!;
      await writeFile(
        f.service.configuration.file,
        f.text.replace([a, b, c].join(', '), [a, c].join(', ')),
      );
      await f.service.reload();
      expect(await f.service.save(f.workspace, order, false)).toMatchObject({
        kind: 'needs-confirmation',
        changed: true,
        dropsCommands: false,
      });
      const saved = await f.service.save(f.workspace, order, true);
      if (saved.kind !== 'saved')
        throw new Error('The confirmed save did not save the definition.');
      const writtenIndex = closeFolder ? 1 : 2;
      expect(saved.planes[terminal.id]).toBe(writtenIndex);
      expect(saved.commandPlanes).toEqual([terminal.id]);
      expect(
        f.service
          .entry('sample')!
          .planes.map(({ plane }) => ('path' in plane ? plane.path : undefined)),
      ).toEqual(
        (closeFolder ? ['a', 'c'] : ['a', 'b', 'c']).map((name) => '/projects/sample/' + name),
      );
      const text = await readFile(f.service.configuration.file, 'utf8');
      expect(text).toContain(c);
      expect(parse(text).workspaces.sample.planes[writtenIndex]).toEqual({
        kind: 'terminal',
        path: 'c',
        command: 'npm run dev',
      });
      const linked = {
        ...f.workspace,
        definition: { key: saved.key, basis: saved.basis, planes: saved.planes },
        panes: f.workspace.panes.map((pane) =>
          pane.type === 'terminal' ? { ...pane, definitionPlane: saved.planes[pane.id] } : pane,
        ),
      };
      expect(await f.service.save(linked, order, false)).toMatchObject({ kind: 'saved' });
      expect(await readFile(f.service.configuration.file, 'utf8')).toBe(text);
    },
  );
  it('asks for a stale basis alone without curated content or a dropped command', async () => {
    const f = await fixture(
      '{ "root": "/projects/sample", "planes": [{"kind":"folder","path":"."}] }',
    );
    const edited = f.text.replace(
      '"root": "/projects/sample"',
      '"root": "/projects/sample", "tiling": {"layout":"even-horizontal"}',
    );
    await writeFile(f.service.configuration.file, edited);
    await f.service.reload();
    expect(await f.service.save(f.workspace, f.order, false)).toEqual({
      kind: 'needs-confirmation',
      changed: true,
      curated: false,
      dropsCommands: false,
    });
    expect(await readFile(f.service.configuration.file, 'utf8')).toBe(edited);
  });
  it('omits the inherited profile of a newly added terminal', async () => {
    const f = await fixture(
      '{ "root": "/projects/sample", "planes": [{"kind":"folder","path":"."}] }',
    );
    f.workspace.panes.push({
      id: 'added-terminal',
      type: 'terminal',
      path: '/projects/sample/api',
      profileID: defaultSettings('/home/sample').terminals.profileID,
    });
    f.workspace.roots.push('added-terminal');
    expect(await f.service.save(f.workspace, [...f.order, 'added-terminal'], false)).toMatchObject({
      kind: 'saved',
    });
    const terminal = parse(await readFile(f.service.configuration.file, 'utf8')).workspaces.sample
      .planes[1];
    expect(terminal).toMatchObject({ kind: 'terminal' });
    expect(Object.hasOwn(terminal, 'profileID')).toBe(false);
  });
  it('M1: keeps a written unknown profile that still resolves to the inherited profile', async () => {
    const f = await fixture(
      '{ "root": "/projects/sample", "planes": [\n// profile comment\n{"kind":"terminal","path":".","profileID":"unavailable"}\n]}',
    );
    expect(await f.service.save(f.workspace, f.order, false)).toMatchObject({ kind: 'saved' });
    expect(await readFile(f.service.configuration.file, 'utf8')).toBe(f.text);
  });
  it('rechecks the person inside the disk update callback before any write', async () => {
    const f = await fixture('{ "root": "/projects/sample" }');
    await expect(
      f.service.save(f.workspace, f.order, true, undefined, () => {
        throw new Error('Only the person can save.');
      }),
    ).rejects.toThrow('Only the person');
    expect(await readFile(f.service.configuration.file, 'utf8')).toBe(f.text);
  });
  it('refuses a Project Manager source changed on disk until validation', async () => {
    const f = await fixture('{ "root": "/projects/sample" }');
    const edited = f.text.replace(
      '"enabled": false',
      '"enabled": true, "path": "~/Other/projects.json"',
    );
    await writeFile(f.service.configuration.file, edited);
    await expect(f.service.save(f.workspace, f.order, true)).rejects.toThrow(
      'project source changed',
    );
    expect(await readFile(f.service.configuration.file, 'utf8')).toBe(edited);
  });
  it('M1: preserves an implicit folder recipe without adding planes or focus', async () => {
    const f = await fixture('{ "root": "/projects/sample" }');
    expect(await f.service.save(f.workspace, f.order, false)).toMatchObject({ kind: 'saved' });
    expect(await readFile(f.service.configuration.file, 'utf8')).toBe(f.text);
  });
  it('M3: preserves a skipped split branch and its written focus on an unchanged save', async () => {
    const f = await fixture(`{
      "root": "/projects/sample",
      "planes": [
        // currently unavailable
        {"kind":"folder","path":"{{ROOT:library}}"},
        {"kind":"terminal","path":"."}
      ],
      "focus": 0,
      "tiling": {"layout":"even-horizontal","split":{"axis":"x","ratio":0.4,"first":{"plane":0},"second":{"plane":1}}}
    }`);
    expect(await f.service.save(f.workspace, f.order, false)).toMatchObject({ kind: 'saved' });
    expect(await readFile(f.service.configuration.file, 'utf8')).toBe(f.text);
  });
  it('M3: remaps retained focus and split indexes when an earlier open plane was deliberately closed', async () => {
    const f = await fixture(`{
      "root": "/projects/sample",
      "planes": [
        {"kind":"folder","path":"."},
        {"kind":"folder","path":"src"},
        // Keep the unavailable shared library.
        {"kind":"folder","path":"{{ROOT:library}}"}
      ],
      "focus": 2,
      "tiling": {"layout":"even-horizontal","split":{"axis":"x","ratio":0.5,"first":{"plane":1},"second":{"plane":2}}}
    }`);
    const kept = f.workspace.panes[0]!;
    f.workspace.panes = [kept];
    f.workspace.roots = [kept.id];
    f.workspace.activePane = kept.id;
    f.workspace.tiling = { ...f.workspace.tiling!, panes: [kept.id], tree: undefined };
    expect(await f.service.save(f.workspace, [kept.id], false)).toMatchObject({ kind: 'saved' });
    const entry = JSON.parse(
      (await readFile(f.service.configuration.file, 'utf8')).replace(/\/\/[^\n]*/g, ''),
    ).workspaces.sample;
    expect(entry.planes).toHaveLength(2);
    expect(entry.focus).toBe(1);
    expect(entry.tiling.split).toEqual({ plane: 1 });
    expect(f.service.entry('sample')!.planes).toHaveLength(1);
    expect(await readFile(f.service.configuration.file, 'utf8')).toContain(
      '// Keep the unavailable shared library.',
    );
  });
  it('keeps the written name and aliases, including surrounding spaces', async () => {
    const f = await fixture(
      '{ "root": "/projects/sample", "name": "Sample ", "aliases": [" sample "] , "planes": [{"kind":"folder","path":"."}] }',
    );
    expect(await f.service.save(f.workspace, f.order, false)).toMatchObject({ kind: 'saved' });
    expect(await readFile(f.service.configuration.file, 'utf8')).toBe(f.text);
  });
  it('names the line of a schema issue instead of exposing Zod JSON', async () => {
    const f = await fixture('{ "root": "/projects/sample" }');
    const invalid = f.text.replace(
      '"root": "/projects/sample"',
      '"root": "/projects/sample",\n      "nmae": "Sample"',
    );
    await writeFile(f.service.configuration.file, invalid);
    const line = invalid.slice(0, invalid.indexOf('"nmae"')).split('\n').length;
    await expect(f.service.save(f.workspace, f.order, false)).rejects.toThrow(
      `Fix line ${line} of workspaces.jsonc first.`,
    );
    expect(await readFile(f.service.configuration.file, 'utf8')).toBe(invalid);
  });
  it('refuses a written duplicate key and names both lines without editing either', async () => {
    const f = await fixture('{ "root": "/projects/sample" }');
    const duplicate = f.text.replace(
      '"sample":',
      '"sample": {"root":"/projects/other"},\n    "sample":',
    );
    await writeFile(f.service.configuration.file, duplicate);
    await expect(f.service.save(f.workspace, f.order, false)).rejects.toThrow('lines 5 and 6');
    expect(await readFile(f.service.configuration.file, 'utf8')).toBe(duplicate);
  });
  it.each([false, true])(
    'M3: unresolved written planes and their comments survive Save (all skipped: %s)',
    async (all) => {
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
      const first = await f.service.save(f.workspace, f.order, false);
      if (first.kind !== 'saved') throw new Error('The definition was not saved.');
      f.workspace.definition!.planes = first.planes;
      expect(await f.service.save(f.workspace, f.order, false)).toMatchObject({ kind: 'saved' });
      expect(await readFile(f.service.configuration.file, 'utf8')).toBe(f.text);
    },
  );
  it('M2/J3: a stale definition needs confirmation and keeps swapped commands with their own folders', async () => {
    const a =
      '// command a\n{ "kind": "terminal", "path": "packages/a", "command": "npm run dev" }';
    const b = '// command b\n{ "kind": "terminal", "path": "packages/b", "command": "make clean" }';
    const f = await fixture(
      '{ "root": "/projects/sample", "planes": [\n' + a + ',\n' + b + '\n] }',
    );
    const edited = f.text.replace(a + ',\n' + b, b + ',\n' + a);
    await writeFile(f.service.configuration.file, edited);
    await f.service.reload();
    expect(await f.service.save(f.workspace, f.order, false)).toMatchObject({
      kind: 'needs-confirmation',
      changed: true,
      dropsCommands: false,
    });
    expect(await readFile(f.service.configuration.file, 'utf8')).toBe(edited);
    const saved = await f.service.save(f.workspace, f.order, true);
    if (saved.kind !== 'saved') throw new Error('The confirmed save did not save the definition.');
    expect(saved.commandPlanes).toEqual(f.order);
    for (const [index, id] of f.order.entries()) expect(saved.planes[id]).toBe(index);
    expect(f.service.entry('sample')!.planes.map(({ plane }) => plane)).toEqual([
      { kind: 'terminal', path: '/projects/sample/packages/a', command: 'npm run dev' },
      { kind: 'terminal', path: '/projects/sample/packages/b', command: 'make clean' },
    ]);
    const text = await readFile(f.service.configuration.file, 'utf8');
    expect(text).toContain(a);
    expect(text).toContain(b);
    const linked = {
      ...f.workspace,
      definition: { key: saved.key, basis: saved.basis, planes: saved.planes },
      panes: f.workspace.panes.map((pane) =>
        pane.type === 'terminal' ? { ...pane, definitionPlane: saved.planes[pane.id] } : pane,
      ),
    };
    expect(await f.service.save(linked, f.order, false)).toMatchObject({ kind: 'saved' });
    expect(await readFile(f.service.configuration.file, 'utf8')).toBe(text);
  });
  it('prefers the old index when several written terminals still match the same folder', async () => {
    const one =
      '// command one\n{ "kind": "terminal", "path": "shared", "command": "npm run dev" }';
    const two =
      '// command two\n{ "kind": "terminal", "path": "./shared", "command": "make clean" }';
    const f = await fixture(
      '{ "root": "/projects/sample", "planes": [\n' + one + ',\n' + two + '\n] }',
    );
    const edited = f.text.replace(
      '"root": "/projects/sample"',
      '"root": "/projects/sample", "focus": 1',
    );
    await writeFile(f.service.configuration.file, edited);
    await f.service.reload();
    expect(await f.service.save(f.workspace, f.order, false)).toMatchObject({
      kind: 'needs-confirmation',
      changed: true,
      dropsCommands: false,
    });
    const saved = await f.service.save(f.workspace, f.order, true);
    expect(saved).toMatchObject({ kind: 'saved', commandPlanes: f.order });
    const text = await readFile(f.service.configuration.file, 'utf8');
    expect(parse(text).workspaces.sample.planes).toEqual([
      { kind: 'terminal', path: 'shared', command: 'npm run dev' },
      { kind: 'terminal', path: './shared', command: 'make clean' },
    ]);
    expect(text).toContain(one);
    expect(text).toContain(two);
  });
  it('asks before dropping ambiguous commands when the old index no longer matches the folder', async () => {
    const one = '{ "kind": "terminal", "path": "shared", "command": "npm run dev" }';
    const two = '{ "kind": "terminal", "path": "./shared", "command": "make clean" }';
    const folder = '{ "kind": "folder", "path": "other" }';
    const f = await fixture(
      '{ "root": "/projects/sample", "planes": [' + one + ', ' + folder + '] }',
    );
    const edited = f.text.replace(one + ', ' + folder, [folder, one, two].join(', '));
    await writeFile(f.service.configuration.file, edited);
    await f.service.reload();
    expect(await f.service.save(f.workspace, f.order, false)).toMatchObject({
      kind: 'needs-confirmation',
      changed: true,
      dropsCommands: true,
    });
    expect(await readFile(f.service.configuration.file, 'utf8')).toBe(edited);
    expect(await f.service.save(f.workspace, f.order, true)).toMatchObject({
      kind: 'saved',
      commandPlanes: [],
    });
    expect(f.service.entry('sample')!.planes.map(({ plane }) => plane)).toEqual([
      { kind: 'terminal', path: '/projects/sample/shared' },
      { kind: 'folder', path: '/projects/sample/other' },
    ]);
  });
  it.each([false, true])(
    'M1: an unchanged rich workspace saves byte for byte without pinning defaults (explicit defaults: %s)',
    async (explicit) => {
      const f = await fixture(`{
      "root": "/projects/sample",
      ${explicit ? '"terminalProfile": "login", "focus": 0,' : ''}
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
        { "kind": "search", "query": "todo", "name": "Todos", "root": "src"${explicit ? ', "recursive": true, "content": false' : ''} }
      ],
      "tiling": { "layout": "even-horizontal"${explicit ? ', "main": 0.6, "split": {"axis":"x","ratio":0.5,"first":{"plane":0},"second":{"plane":1}}' : ''} }
    }`);
      expect(await f.service.save(f.workspace, f.order, false)).toMatchObject({ kind: 'saved' });
      expect(await readFile(f.service.configuration.file, 'utf8')).toBe(f.text);
    },
  );
});
