import path from 'node:path';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeclaredCommands } from '../src/desktop/terminals/declared-commands';
import type { FolderProbeResult, FolderRead } from '../src/domain/workspaces/folder-facts';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import { lstat } from '../src/desktop/files/stats';
import { FolderFacts } from '../src/desktop/workspaces/folder-facts';
import type { OwnedWorker } from '../src/desktop/workers/utility-client';
import type { FolderFactsReply } from '../src/domain/workspaces/folder-facts';
import { DocumentStore } from '../src/desktop/persistence/document-store';

vi.mock('../src/desktop/workers/utility-client', () => ({ launchWorker: vi.fn() }));

let dataPath: string;
beforeEach(async () => {
  dataPath = await temporaryRoot('viewer-declared-reader-');
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await trashTemporary(dataPath);
});

function fixture(initial: Record<string, Record<string, string>>, roots: string[] = []) {
  const files = new Map(Object.entries(initial));
  const probes: string[] = [];
  const reads: string[] = [];
  let now = 100;
  const facts = {
    pass: () => ({ relaunches: 0, exhausted: false }),
    probe: vi.fn(async (folder: string): Promise<FolderProbeResult> => {
      probes.push(folder);
      const entries = files.get(folder) ?? {};
      return {
        ok: true,
        path: folder,
        identity: { dev: 1n, ino: 2n },
        markers: Object.keys(entries),
        git: Object.hasOwn(entries, '.git') ? 'directory' : undefined,
        package: entries['package.json'] ? JSON.parse(entries['package.json']) : undefined,
        capped: false,
      };
    }),
    read: vi.fn(async (file: string): Promise<FolderRead> => {
      reads.push(file);
      const text = files.get(path.dirname(file))?.[path.basename(file)];
      return text === undefined
        ? { ok: false, reason: 'missing' }
        : { ok: true, path: file, bytes: Buffer.from(text) };
    }),
  };
  const service = new DeclaredCommands({
    facts,
    roots: () => roots,
    dataPath,
    now: () => now,
    home: '/Users/sample',
  });
  return {
    service,
    facts,
    files,
    roots,
    probes,
    reads,
    advance: (time: number) => {
      now += time;
    },
  };
}
const scripts = (scripts: Record<string, string>, packageManager?: string) =>
  JSON.stringify({ scripts, packageManager });

describe('declared reader review regressions', () => {
  it('offers only reachable ancestor declarations and labels sources from the captured folder', async () => {
    const f = fixture({
      '/site': {
        '.git': '',
        'package.json': scripts({ lint: 'eslint .' }, 'pnpm@10'),
        justfile: 'outer:\n  echo outer',
        'deno.json': '{"tasks":{"outer":"echo outer"}}',
        Makefile: 'deploy:\n\techo deploy',
        Procfile: 'web: node server.js',
      },
      '/site/packages/app': {
        'package.json': scripts({ dev: 'vite' }),
        justfile: 'dev:\n  serve',
        'deno.jsonc': '{"tasks":{"dev":"serve"}}',
      },
      '/site/packages/app/src': {},
    });
    const value = await f.service.list('/site/packages/app/src');
    expect(value.commands.map((item) => [item.line, item.relativeSource])).toEqual([
      ['pnpm run dev', '../package.json'],
      ['just dev', '../justfile'],
      ['deno task dev', '../deno.jsonc'],
      ['make -C ../../.. deploy', '../../../Makefile'],
    ]);
    expect(f.reads).not.toContain('/site/Procfile');
  });

  it('uses the first Makefile in GNUmakefile, makefile, Makefile order in each folder', async () => {
    const f = fixture({
      '/site': {
        '.git': '',
        GNUmakefile: 'gnu:\n\techo gnu',
        makefile: 'lower:\n\techo lower',
        Makefile: 'upper:\n\techo upper',
      },
    });
    expect((await f.service.list('/site')).commands.map((item) => item.line)).toEqual(['make gnu']);
    delete f.files.get('/site')!.GNUmakefile;
    f.advance(10_001);
    expect((await f.service.list('/site')).commands.map((item) => item.line)).toEqual([
      'make lower',
    ]);
  });

  it('never uses home or its ancestors as a root and stops probing below home', async () => {
    const tree = {
      '/Users/sample': { '.git': '', Makefile: 'install:\n\techo dotfiles' },
      '/Users/sample/Documents/notes': { Procfile: 'local: local' },
    };
    for (const roots of [[], ['/Users/sample'], ['/']]) {
      const f = fixture(tree, roots);
      expect(
        (await f.service.list('/Users/sample/Documents/notes')).commands.map((item) => item.line),
      ).toEqual(['local']);
      expect(f.probes).not.toContain('/Users/sample');
      expect(f.probes).not.toContain('/Users');
      expect(f.probes).not.toContain('/');
    }
  });

  it('does not climb past a Git marker on the target folder itself', async () => {
    const f = fixture({ '/projects/site': { '.git': '', Procfile: 'local: local' } });
    await f.service.list('/projects/site');
    expect(f.probes).toEqual(['/projects/site']);
  });

  it('does no new discovery for an obsolete Run revision, even after the list is opened again', async () => {
    const f = fixture({ '/site': { '.git': '', Procfile: 'web: serve' } });
    const revision = f.service.revision;
    await f.service.clearHistory();
    await f.service.list('/site');
    f.facts.probe.mockClear();
    await f.service.record('/site', 'serve', revision);
    expect(f.facts.probe).not.toHaveBeenCalled();
  });

  it('never publishes a queued reference after Clear has invalidated its revision', async () => {
    const f = fixture({
      '/one': { '.git': '', Procfile: 'web: one' },
      '/two': { '.git': '', Procfile: 'web: two' },
    });
    await Promise.all([f.service.list('/one'), f.service.list('/two')]);
    let release!: () => void;
    const save = vi.spyOn(DocumentStore.prototype, 'save').mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = resolve; }),
    ).mockResolvedValue(undefined);
    const first = f.service.record('/one', 'one');
    await vi.waitFor(() => expect(release).toBeDefined());
    const second = f.service.record('/two', 'two');
    await vi.waitFor(() => expect(f.reads.filter((file) => file === '/two/Procfile')).toHaveLength(2));
    const clearing = f.service.clearHistory();
    release();
    await Promise.all([first, second, clearing]);
    expect(save.mock.calls.some(([document]) => JSON.stringify(document).includes('/two'))).toBe(false);
  });

  it('does not derive again for an unrelated line or without a cached declaration', async () => {
    const f = fixture({ '/site': { '.git': '', Procfile: 'web: serve' } });
    await f.service.record('/site', 'unrelated');
    expect(f.probes).toEqual([]);
    await f.service.list('/site');
    f.facts.probe.mockClear();
    await f.service.record('/site', 'unrelated');
    expect(f.facts.probe).not.toHaveBeenCalled();
  });

  it('clears the cached declaration and refreshes root recency before eviction', async () => {
    const f = fixture({
      '/old/0': { '.git': '', Procfile: 'web: serve' },
      '/new': { '.git': '', Procfile: 'web: new' },
    });
    const file = path.join(dataPath, 'declared-commands-v1.json');
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        roots: Array.from({ length: 200 }, (_, index) => ({
          root: '/old/' + index,
          reference: { source: 'Procfile', name: 'web', at: index },
        })),
      }),
    );
    await f.service.list('/old/0');
    await f.service.record('/old/0', 'serve');
    await f.service.list('/new');
    await f.service.record('/new', 'new');
    const saved = JSON.parse(await readFile(file, 'utf8'));
    expect(saved.roots.some((item: { root: string }) => item.root === '/old/0')).toBe(true);
    expect(saved.roots.some((item: { root: string }) => item.root === '/old/1')).toBe(false);
    await f.service.clearHistory();
    const before = f.reads.length;
    await f.service.list('/new');
    expect(f.reads.length).toBeGreaterThan(before);
  });

  it('preserves a non-file store in place', async () => {
    const file = path.join(dataPath, 'declared-commands-v1.json');
    await mkdir(file);
    const f = fixture({ '/site': { '.git': '', Procfile: 'web: serve' } });
    await f.service.list('/site');
    await f.service.record('/site', 'serve');
    expect((await lstat(file)).isDirectory()).toBe(true);
    expect(await readdir(dataPath)).toEqual(['declared-commands-v1.json']);
  });

  it('marks Last run by source as well as name and keeps the nearest duplicate literal', async () => {
    const f = fixture({
      '/site': {
        '.git': '',
        'package.json': scripts({ web: 'serve' }),
        Procfile: 'web: serve\nother: npm run web',
      },
    });
    await f.service.list('/site');
    await f.service.record('/site', 'serve');
    const items = (await f.service.list('/site')).commands;
    expect(items.map((item) => [item.source, item.name, item.lastRun])).toEqual([
      ['package.json', 'web', false],
      ['Procfile', 'web', true],
    ]);
  });

  it('uses only locks at or above the source file, while Corepack uses the nearest ancestor manager', async () => {
    const f = fixture({
      '/site/src': { 'yarn.lock': '' },
      '/site': { '.git': '', 'package.json': scripts({ dev: 'serve' }), 'pnpm-lock.yaml': '' },
    });
    expect((await f.service.list('/site/src')).commands[0]!.line).toBe('pnpm run dev');
    f.files.get('/site')!['package.json'] = scripts({ dev: 'serve' }, 'bun@1');
    f.advance(10_001);
    expect((await f.service.list('/site/src')).commands[0]!.line).toBe('bun run dev');
  });

  it('keeps moved parent probes outside the root out of both reading and further traversal', async () => {
    const f = fixture(
      {
        '/site/src': { Procfile: 'local: local' },
        '/elsewhere/moved': { Makefile: 'outside:\n\techo outside' },
      },
      ['/site'],
    );
    const probe = f.facts.probe.getMockImplementation()!;
    f.facts.probe.mockImplementation((folder) =>
      probe(folder === '/site' ? '/elsewhere/moved' : folder),
    );
    expect((await f.service.list('/site/src')).commands.map((item) => item.line)).toEqual([
      'local',
    ]);
    expect(f.reads).not.toContain('/elsewhere/moved/Makefile');
    expect(f.probes).not.toContain('/elsewhere');
  });

  it('does no discovery for denied Store access and rechecks folder authority while a list settles', async () => {
    const f = fixture({ '/site': { '.git': '', Procfile: 'web: serve' } });
    let allowed = false;
    const access = (file: string) =>
      file === '/site' && !allowed ? undefined : { allows: () => true };
    const service = new DeclaredCommands({ facts: f.facts, roots: () => [], dataPath, access });
    expect(await service.list('/site')).toEqual({ commands: [] });
    expect(f.probes).toEqual([]);
    allowed = true;
    const pending = service.list('/site');
    allowed = false;
    expect(await pending).toEqual({ commands: [] });
  });
});

describe('declared command reader roots and cache', () => {
  it('chooses the deepest real root when a longer alias spells an outer definition root', async () => {
    const f = fixture(
      {
        '/repo/nested/src': { Procfile: 'local: local' },
        '/repo/nested': { Makefile: 'nested:\n\techo nested' },
        '/repo': { Makefile: 'outside:\n\techo outside' },
      },
      ['/long-definition-alias', '/repo/nested'],
    );
    const probe = f.facts.probe.getMockImplementation()!;
    f.facts.probe.mockImplementation((folder) =>
      probe(folder.replace('/long-definition-alias', '/repo')),
    );
    const value = await f.service.list('/long-definition-alias/nested/src');
    expect(value.commands.map((item) => item.line)).toEqual(['local', 'make -C .. nested']);
    expect(f.reads).not.toContain('/repo/Makefile');
  });

  it('walks nearest files first to the deepest definition root and deduplicates literal lines', async () => {
    const f = fixture(
      {
        '/projects/root/site/src': {
          'package.json': scripts({ dev: 'local', test: 'local checks' }),
        },
        '/projects/root/site': {
          'package.json': scripts({ dev: 'parent', build: 'build' }),
          'pnpm-lock.yaml': '',
        },
        '/projects/root': { Procfile: 'outside: forbidden' },
      },
      ['/projects/root', '/projects/root/site'],
    );
    const result = await f.service.list('/projects/root/site/src');
    expect(result.commands.map((item) => [item.line, item.source, item.detail])).toEqual([
      ['pnpm run dev', 'src/package.json', 'local'],
      ['pnpm run test', 'src/package.json', 'local checks'],
    ]);
    expect(f.reads).toEqual(['/projects/root/site/src/package.json']);
    expect(f.probes).not.toContain('/projects/root');
    expect(await readdir(dataPath)).toEqual([]);
  });

  it('uses the nearest git root within six levels and never reads beyond it', async () => {
    const f = fixture({
      '/projects/site/src': { Makefile: 'dev:\n\tbuild' },
      '/projects/site': { '.git': '', Makefile: 'root:\n\tserve' },
      '/projects': { Procfile: 'outside: outside' },
    });
    expect((await f.service.list('/projects/site/src')).commands.map((item) => item.line)).toEqual([
      'make dev',
      'make -C .. root',
    ]);
    expect(f.probes).toEqual(['/projects/site/src', '/projects/site']);
    const none = fixture({
      '/a/b/c/d/e/f/g': { Procfile: 'local: local' },
      '/a': { '.git': '', Procfile: 'far: far' },
    });
    expect((await none.service.list('/a/b/c/d/e/f/g')).commands.map((item) => item.line)).toEqual([
      'local',
    ]);
    expect(none.probes).toHaveLength(6);
    expect(none.reads).toEqual(['/a/b/c/d/e/f/g/Procfile']);
  });

  it('prefers the nearest lockfile, with packageManager taking precedence', async () => {
    const f = fixture({
      '/project/site': { 'package.json': scripts({ dev: 'serve' }), 'yarn.lock': '' },
      '/project': { '.git': '', 'pnpm-lock.yaml': '' },
    });
    expect((await f.service.list('/project/site')).commands[0]!.line).toBe('yarn run dev');
    f.files.get('/project/site')!['package.json'] = scripts({ dev: 'serve' }, 'bun@1');
    f.advance(10_001);
    expect((await f.service.list('/project/site')).commands[0]!.line).toBe('bun run dev');
  });

  it('caches ten seconds, shares concurrent work and invalidates when catalog roots change', async () => {
    const f = fixture({ '/project': { '.git': '', Procfile: 'web: serve' } });
    await Promise.all([f.service.list('/project'), f.service.list('/project')]);
    expect(f.facts.read).toHaveBeenCalledOnce();
    await f.service.list('/project');
    expect(f.facts.read).toHaveBeenCalledOnce();
    f.advance(10_001);
    await f.service.list('/project');
    expect(f.facts.read).toHaveBeenCalledTimes(2);
    f.roots.push('/project');
    await f.service.list('/project');
    expect(f.facts.read).toHaveBeenCalledTimes(3);
  });

  it('respects worker timeouts and volume quarantine without blocking other volumes', async () => {
    vi.useFakeTimers();
    const postMessage = vi.fn();
    const terminate = vi.fn(async () => 0);
    const worker = {
      postMessage,
      message: vi.fn(),
      exit: vi.fn(),
      thread: { on: vi.fn(), terminate },
    } as unknown as OwnedWorker<FolderFactsReply>;
    const facts = new FolderFacts('worker.cjs', { worker: () => worker });
    const service = new DeclaredCommands({ facts, roots: () => [], dataPath });
    const pending = service.list('/Volumes/Sleeping/project');
    await vi.advanceTimersByTimeAsync(151);
    expect(await pending).toEqual({ commands: [] });
    expect(terminate).toHaveBeenCalledOnce();
    expect(await service.list('/Volumes/Sleeping/other')).toEqual({ commands: [] });
    expect(postMessage).toHaveBeenCalledOnce();
    facts.close();
  });

  it('rechecks Store access for cached sources and drops parent files after a scope narrows', async () => {
    const f = fixture({
      '/project/site': { Procfile: 'local: local' },
      '/project': { '.git': '', Makefile: 'parent:\n\tparent' },
    });
    let allowed = '/project';
    const access = (file: string) =>
      file === allowed || file.startsWith(allowed + '/')
        ? { allows: (actual: string) => actual === allowed || actual.startsWith(allowed + '/') }
        : undefined;
    const service = new DeclaredCommands({ facts: f.facts, roots: () => [], dataPath, access });
    expect((await service.list('/project/site')).commands.map((item) => item.line)).toEqual([
      'local',
      'make -C .. parent',
    ]);
    allowed = '/project/site';
    expect((await service.list('/project/site')).commands.map((item) => item.line)).toEqual([
      'local',
    ]);
    allowed = '/other';
    expect(await service.list('/project/site')).toEqual({ commands: [] });
    await service.record('/project/site', 'local');
    expect(await readdir(dataPath)).toEqual([]);
  });

  it.each(['scope', 'timeout', 'quarantined', 'budget'] as const)(
    'silently omits unavailable facts (%s)',
    async (reason) => {
      const f = fixture({});
      f.facts.probe.mockResolvedValue({ ok: false, reason });
      expect(await f.service.list('/project')).toEqual({ commands: [] });
      expect(f.facts.read).not.toHaveBeenCalled();
    },
  );
});

describe('declared command private references', () => {
  it('re-derives a match rather than trusting cached or renderer-supplied lines and stores no text', async () => {
    const f = fixture({ '/project': { '.git': '', Procfile: 'web: old-secret' } });
    await f.service.list('/project');
    f.files.get('/project')!.Procfile = 'web: current-secret';
    await f.service.record('/project', 'old-secret');
    expect(await readdir(dataPath)).toEqual([]);
    f.advance(10_001);
    await f.service.list('/project');
    await f.service.record('/project', 'current-secret');
    const file = path.join(dataPath, 'declared-commands-v1.json');
    const text = await readFile(file, 'utf8');
    expect(JSON.parse(text)).toEqual({
      version: 1,
      roots: [{ root: '/project', reference: { source: 'Procfile', name: 'web', at: 10101 } }],
    });
    expect(text).not.toContain('secret');
    expect((await lstat(file)).mode & 0o777).toBe(0o600);
    expect((await f.service.list('/project')).commands[0]!.lastRun).toBe(true);
    await f.service.clearHistory();
    expect(JSON.parse(await readFile(file, 'utf8')).roots).toEqual([]);
    expect((await f.service.list('/project')).commands[0]!.lastRun).toBe(false);
  });

  it('does not resurrect a reference when Clear overlaps a command start or a re-read', async () => {
    const f = fixture({ '/project': { '.git': '', Procfile: 'web: serve' } });
    await f.service.list('/project');
    const revision = f.service.revision;
    await f.service.clearHistory();
    await f.service.record('/project', 'serve', revision);
    expect(await readdir(dataPath)).toEqual([]);
    await f.service.list('/project');
    let resume!: () => void;
    f.facts.read.mockImplementationOnce(async (file) => {
      await new Promise<void>((resolve) => {
        resume = resolve;
      });
      return { ok: true, path: file, bytes: Buffer.from('web: serve') };
    });
    const recording = f.service.record('/project', 'serve');
    await vi.waitFor(() => expect(resume).toBeDefined());
    await f.service.clearHistory();
    resume();
    await recording;
    expect(await readdir(dataPath)).toEqual([]);
  });

  it('keeps at most 200 roots and preserves unreadable data beside the new store', async () => {
    const file = path.join(dataPath, 'declared-commands-v1.json');
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        roots: Array.from({ length: 200 }, (_, index) => ({
          root: '/old/' + index,
          reference: { source: 'Procfile', name: 'web', at: index },
        })),
      }),
    );
    const f = fixture({ '/project': { '.git': '', Procfile: 'web: serve' } });
    await f.service.list('/project');
    await f.service.record('/project', 'serve');
    const saved = JSON.parse(await readFile(file, 'utf8'));
    expect(saved.roots).toHaveLength(200);
    expect(saved.roots[0].root).toBe('/old/1');
    await writeFile(file, 'unreadable');
    const recovered = fixture({ '/project': { '.git': '', Procfile: 'web: serve' } });
    await recovered.service.list('/project');
    await recovered.service.record('/project', 'serve');
    const kept = (await readdir(dataPath)).find((name) => name.includes('.unreadable-'))!;
    expect(await readFile(path.join(dataPath, kept), 'utf8')).toBe('unreadable');
    expect(JSON.parse(await readFile(file, 'utf8')).roots).toHaveLength(1);
  });
});
