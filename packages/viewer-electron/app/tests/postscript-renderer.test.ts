import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { DerivedPreviews } from '../src/desktop/previews/derived';
import { Ghostscript } from '../src/desktop/previews/postscript-renderer';
import { Resources } from '../src/desktop/previews/resources';
import { createResourceHandlers } from '../src/desktop/ipc/resource-handlers';
import { schemas, methodWindows } from '../src/desktop/ipc/schemas';
import { agentCommandID, agentConfigurationPath } from '../src/domain/agents/safety';
import { serviceToolNames } from '../src/desktop/agents/service-catalog';
import { agentToolCatalog } from '../src/desktop/agents/tool-catalog';
import type * as Coordination from '../src/desktop/files/file-coordination';
import { settingsSchema } from '../src/desktop/preferences/settings-schema';
import { defaultSettings } from '../src/domain/services';
import type { CustomAction } from '../src/domain/automation/actions';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import { binaryEPSSample, pdfSample, postscriptSample } from './support/postscript';

type FakeMode = 'success' | 'timeout' | 'failure' | 'oversized' | 'impostor';
vi.mock('../src/desktop/files/file-coordination', async (importOriginal) => {
  const original = await importOriginal<typeof Coordination>();
  return {
    ...original,
    fileCoordination: new original.FileCoordination(() => ({
      coordinateStart: async (_id, intents) => intents.map((intent) => intent.path),
      coordinateEnd: async () => {},
      coordinateCancel: () => {},
      coordinateSameItem: () => false,
    })),
  };
});
let root: string;
const resources: Resources[] = [];
beforeEach(async () => { root = await realpath(await temporaryRoot('viewer-postscript-runner-')); });
afterEach(async () => {
  await Promise.all(resources.map((resource) => resource.close()));
  resources.length = 0;
  await trashTemporary(root);
});

async function fixture(mode: FakeMode = 'success', store = false) {
  const executable = path.join(root, 'fake-gs');
  const log = path.join(root, 'calls.jsonl');
  const source = path.join(root, 'drawing.eps');
  const sourceBytes = binaryEPSSample(postscriptSample);
  await writeFile(source, sourceBytes, { flag: 'wx' });
  const script = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, environment: Object.keys(process.env), cwd: process.cwd() }) + '\\n');
if (args.includes('-h')) {
  process.stdout.write(${JSON.stringify(mode === 'impostor' ? 'Another program 1.0' : 'GPL Ghostscript 10.99.1 (generated test program)\n')});
} else if (${JSON.stringify(mode)} === 'timeout') {
  setInterval(() => {}, 1000);
} else if (${JSON.stringify(mode)} === 'failure') {
  process.exitCode = 7;
} else if (${JSON.stringify(mode)} === 'oversized') {
  process.stdout.write(Buffer.alloc(65536));
} else {
  const input = fs.readFileSync(args.at(-1));
  if (!input.subarray(0, 4).equals(Buffer.from('%!PS'))) process.exitCode = 9;
  else process.stdout.write(Buffer.from(${JSON.stringify(pdfSample().toString('base64'))}, 'base64'));
}
`;
  await writeFile(executable, script, { flag: 'wx', mode: 0o700 });
  const renderer = new Ghostscript({
    customPath: () => executable,
    store: () => store,
    directory: root,
    timeout: mode === 'timeout' ? 250 : 5000,
    outputLimit: mode === 'oversized' ? 1024 : 1_000_000,
  });
  const cache = new DerivedPreviews(async () => {}, renderer.decode);
  const service = new Resources(async () => {}, undefined, 12000, undefined, undefined, undefined, undefined, { renderer, cache });
  resources.push(service);
  const granted = await service.grant(source);
  const calls = async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as {
    args: string[]; environment: string[]; cwd: string;
  });
  return { service, renderer, source, sourceBytes, granted, calls, executable };
}

describe('explicit, bounded Ghostscript rendering', () => {
  it('does not execute discovery or inspection, then renders an exact private copy on request', async () => {
    const f = await fixture();
    expect(await f.service.postscriptStatus()).toEqual({ kind: 'found' });
    const inspection = await f.service.inspectPostscript(f.granted.id, 'inspect');
    expect(inspection.source.text).toBe(postscriptSample);
    expect(await f.calls()).toEqual([]);
    const output = await f.service.renderPostscript(f.granted.id, 'render');
    expect(output.entry.extension).toBe('pdf');
    expect(output.derivation).toEqual({ kind: 'postscript', decoder: 'Ghostscript 10.99.1' });
    const response = await f.service.response(new Request(output.url));
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pdfSample());
    const calls = await f.calls();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.args).toEqual(['-h']);
    expect(calls[1]!.args).toEqual(expect.arrayContaining([
      '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dNOPROMPT', '-sDEVICE=pdfwrite', '-sOutputFile=%stdout', '--',
    ]));
    expect(calls[1]!.args).not.toContain(f.source);
    expect(path.dirname(calls[1]!.args.at(-1)!)).toBe(calls[1]!.cwd);
    expect(calls[1]!.environment).toEqual(expect.arrayContaining(['PATH', 'LC_ALL', 'LANG']));
    expect(calls[1]!.environment).not.toContain('GS_OPTIONS');
    expect(await readFile(f.source)).toEqual(f.sourceBytes);
    const cached = await f.service.renderPostscript(f.granted.id, 'again');
    expect(await f.calls()).toHaveLength(2);
    f.service.release(f.granted.id);
    await expect(f.service.read(cached.id)).rejects.toThrow('expired');
  });
  it.each([
    ['timeout', 'time limit'], ['failure', 'could not render'], ['oversized', 'output size limit'],
    ['impostor', 'did not identify itself'],
  ] as const)('ends %s in one sentence and leaves the described preview readable', async (mode, message) => {
    const f = await fixture(mode);
    await expect(f.service.renderPostscript(f.granted.id, 'render')).rejects.toThrow(message);
    expect((await f.service.inspectPostscript(f.granted.id, 'inspect')).metadata.title).toBe('Two squares');
    expect(await readFile(f.source)).toEqual(f.sourceBytes);
    if (mode === 'impostor') expect(await f.calls()).toHaveLength(1);
  });
  it('cancels an owned process and leaves the source available', async () => {
    const f = await fixture('timeout');
    const work = f.service.renderPostscript(f.granted.id, 'render');
    const outcome = work.catch((error: Error) => error);
    await vi.waitFor(async () => expect(await f.calls()).toHaveLength(2));
    f.service.cancelDocument(f.granted.id, 'render');
    expect(await outcome).toBeInstanceOf(Error);
    expect((await f.service.inspectPostscript(f.granted.id, 'inspect')).kind).toBe('Encapsulated PostScript');
  });
  it('cancels when the preview closes and refuses late derived resources', async () => {
    const f = await fixture('timeout');
    const outcome = f.service.renderPostscript(f.granted.id, 'render').catch((error: Error) => error);
    await vi.waitFor(async () => expect(await f.calls()).toHaveLength(2));
    f.service.release(f.granted.id);
    expect(await outcome).toBeInstanceOf(Error);
    await expect(f.service.read(f.granted.id)).rejects.toThrow('expired');
  });
  it('never probes or renders in the Store edition, even through a direct service request', async () => {
    const f = await fixture('success', true);
    expect(await f.service.postscriptStatus()).toEqual({ kind: 'store' });
    expect((await f.service.inspectPostscript(f.granted.id, 'inspect')).source.text).toBe(postscriptSample);
    await expect(f.service.renderPostscript(f.granted.id, 'render')).rejects.toThrow('Store edition');
    expect(await f.calls()).toEqual([]);
  });
});

describe('human-only rendering boundary', () => {
  it('refuses an agent-driven IPC call before discovery or any executable starts', async () => {
    const f = await fixture();
    const handlers = createResourceHandlers({
      resources: f.service,
      thumbnails: { get: vi.fn() }, webPreviews: { releaseResource: vi.fn() },
      files: { extract: vi.fn() }, fileAccess: { require: vi.fn() },
      forgetGitResource: vi.fn(), warmOffice: vi.fn(), isAgent: () => true,
    });
    expect(() => handlers.renderPostscript([f.granted.id, 'render'], 1)).toThrow('never to agents');
    expect(await f.calls()).toEqual([]);
    expect(methodWindows.renderPostscript).toBe('viewer');
    expect(schemas.renderPostscript.safeParse([f.granted.id, 'render', { actor: 'user' }]).success).toBe(false);
  });
  it('rejects rendering commands, executable aliases and nested actions on the shared CLI/MCP agent path', () => {
    const actions: CustomAction[] = [
      { id: 'render', name: 'Render', executor: { kind: 'builtin', command: 'postscript-render' } },
      { id: 'nested', name: 'Nested', executor: { kind: 'sequence', commands: ['custom.render'] } },
    ] as CustomAction[];
    for (const command of ['postscript-render', 'preview.postscript-render', 'renderPostscript', 'custom.render', 'custom.nested'])
      expect(() => agentCommandID(command, actions)).toThrow();
    expect(serviceToolNames.has('renderPostscript')).toBe(false);
    expect(Object.keys(agentToolCatalog).some((name) => /postscript|ghostscript/i.test(name))).toBe(false);
    expect(() => agentConfigurationPath(['settings', 'previews', 'ghostscriptPath'])).toThrow('never through agents');
    expect(() => agentConfigurationPath(['settings', 'previews'])).toThrow('never through agents');
    expect(() => agentConfigurationPath(['settings', 'previews', 'textFontSize'])).not.toThrow();
  });
  it('validates the custom setting as an absolute path with no NUL and no shell expansion', () => {
    const defaults = defaultSettings('/fixtures');
    for (const value of ['gs', '~/bin/gs', '/fixtures/gs\0ignored'])
      expect(settingsSchema.safeParse({ ...defaults, previews: { ...defaults.previews, ghostscriptPath: value } }).success).toBe(false);
    for (const value of ['', '/fixtures/gs'])
      expect(settingsSchema.safeParse({ ...defaults, previews: { ...defaults.previews, ghostscriptPath: value } }).success).toBe(true);
  });
});
