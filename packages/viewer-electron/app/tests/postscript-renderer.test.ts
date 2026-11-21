import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { open, readFile, writeFile, realpath, readdir, stat, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fileStat } from '../src/desktop/files/stats';
import type * as Coordination from '../src/desktop/files/file-coordination';
import type * as Processes from 'node:child_process';
import { DerivedPreviews } from '../src/desktop/previews/derived';
import {
  Ghostscript,
  ghostscriptLocations,
  postscriptMemoryKiB,
} from '../src/desktop/previews/postscript-renderer';
import { Resources } from '../src/desktop/previews/resources';
import { createResourceHandlers } from '../src/desktop/ipc/resource-handlers';
import { schemas, methodWindows } from '../src/desktop/ipc/schemas';
import { agentConfigurationPath } from '../src/domain/agents/safety';
import { settingsSchema } from '../src/desktop/preferences/settings-schema';
import { defaultSettings } from '../src/domain/services';
import { temporaryRoot } from '../tools/temporary';
import {
  binaryEPSSample,
  pdfSample,
  postscriptSample,
  unusableEPSBoxes,
  epsCropSample,
} from './support/postscript';
import { guardTestTrash } from '../src/desktop/native/test-removal-policy';
import { recordingPostScriptStage } from './support/postscript-runtime';
import {
  PostScriptStageError,
  withPostScriptStage,
} from '../src/desktop/previews/postscript-stage';

type FakeMode =
  'success' | 'timeout' | 'failure' | 'oversized' | 'impostor' | 'scratch' | 'wrapper' | 'tree';
const launched = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof Processes>();
  return {
    ...original,
    spawn: (...args: Parameters<typeof original.spawn>) => {
      launched(...args);
      return original.spawn(...args);
    },
  };
});
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
beforeEach(async () => {
  launched.mockClear();
  root = await realpath(await temporaryRoot('viewer-postscript-runner-'));
});
afterEach(async () => {
  await Promise.all(resources.map((resource) => resource.close()));
  resources.length = 0;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

interface FixtureOptions {
  timeout?: number;
  source?: string;
}
async function fixture(mode: FakeMode = 'success', store = false, options: FixtureOptions = {}) {
  const executable = path.join(root, 'fake-gs');
  const log = path.join(root, 'calls.jsonl');
  const signals = path.join(root, 'signals.jsonl');
  const input = path.join(root, 'stdin.bin');
  const descendant = path.join(root, 'descendant.json');
  const source = path.join(root, 'drawing.eps');
  const sourceBytes = binaryEPSSample(options.source ?? postscriptSample);
  await writeFile(source, sourceBytes, { flag: 'wx' });
  const script = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
process.on('SIGTERM', () => {
  fs.appendFileSync(${JSON.stringify(signals)}, JSON.stringify({pid: process.pid, signal: 'SIGTERM'}) + '\\n');
  process.exit(0);
});
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({args, environment: {...process.env}, cwd: process.cwd(), priority: require('node:os').getPriority(0), pid: process.pid}) + '\\n');
if (args.includes('-h')) {
  process.stdout.write(${JSON.stringify(mode === 'impostor' ? 'Another program 1.0' : 'GPL Ghostscript 10.99.1 (generated test program)\n')});
} else {
  fs.writeFileSync(${JSON.stringify(input)}, fs.readFileSync(0));
  if (${JSON.stringify(mode)} === 'timeout') setInterval(() => {}, 1000);
  else if (${JSON.stringify(mode)} === 'failure') process.exitCode = 7;
  else if (${JSON.stringify(mode)} === 'oversized') process.stdout.write(Buffer.alloc(65536));
  else if (${JSON.stringify(mode)} === 'scratch') {
    fs.writeFileSync(require('node:path').join(process.env.TMPDIR, 'gs_fake'), Buffer.alloc(65536));
    setInterval(() => {}, 1000);
  } else {
    if (['wrapper', 'tree'].includes(${JSON.stringify(mode)})) {
      const child = require('node:child_process').spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], {stdio: ['ignore', process.stdout, process.stderr]});
      fs.writeFileSync(${JSON.stringify(descendant)}, JSON.stringify({pid: child.pid}));
    }
    if (${JSON.stringify(mode)} === 'tree') setInterval(() => {}, 1000);
    else process.stdout.write(Buffer.from(${JSON.stringify(pdfSample().toString('base64'))}, 'base64'), () => process.exit(0));
  }
}
`;
  await writeFile(executable, script, { flag: 'wx', mode: 0o700 });
  const recording = recordingPostScriptStage(root);
  const diagnose = vi.fn();
  const resolveExecutable = vi.fn(async (file: string) =>
    realpath(ghostscriptLocations.includes(file) ? executable : file),
  );
  const renderer = new Ghostscript({
    ...recording.options,
    resolveExecutable,
    diagnose,
    store: () => store,
    timeout: options.timeout ?? (mode === 'timeout' ? 400 : 5000),
    outputLimit: mode === 'oversized' ? 1024 : 1_000_000,
    scratchLimit: mode === 'scratch' ? 8192 : undefined,
  });
  const cache = new DerivedPreviews(async () => {}, renderer.decode);
  const service = new Resources(
    async () => {},
    undefined,
    12000,
    undefined,
    undefined,
    undefined,
    undefined,
    { renderer, cache },
  );
  resources.push(service);
  const granted = await service.grant(source);
  const calls = async () =>
    (await readFile(log, 'utf8').catch(() => ''))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(
        (line) =>
          JSON.parse(line) as {
            args: string[];
            priority: number;
            environment: Record<string, string>;
            cwd: string;
            pid: number;
          },
      );
  const signalRecords = async () =>
    (await readFile(signals, 'utf8').catch(() => ''))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { pid: number; signal: string });
  return {
    service,
    renderer,
    source,
    sourceBytes,
    granted,
    calls,
    signalRecords,
    recording,
    resolveExecutable,
    diagnose,
    input,
    descendant,
  };
}
const expectedArgs = [
  '-dSAFER',
  '-dBATCH',
  '-dNOPAUSE',
  '-dNOPROMPT',
  '-dQUIET',
  '-dNumRenderingThreads=1',
  `-K${postscriptMemoryKiB}`,
  '-dEPSCrop',
  '-sDEVICE=pdfwrite',
  '-sOutputFile=%stdout',
  '-sstdout=%stderr',
  '-',
];

describe('explicit, bounded Ghostscript rendering', () => {
  it.each(unusableEPSBoxes)('omits cropping for a %s EPS box', async (_name, comments) => {
    const f = await fixture('success', false, { source: epsCropSample(comments) });
    expect((await f.service.inspectPostscript(f.granted.id, 'inspect')).epsCrop).toBe('page');
    await f.service.renderPostscript(f.granted.id, 'render');
    expect((await f.calls())[1]!.args).toEqual(
      expectedArgs.filter((argument) => argument !== '-dEPSCrop'),
    );
  });
  it.each(['ENOENT', 'ENOTDIR'])('keeps discovery quiet for %s', async (code) => {
    const f = await fixture();
    f.resolveExecutable.mockRejectedValue(
      Object.assign(new Error('Absent test executable.'), { code }),
    );
    expect(await f.service.postscriptStatus()).toEqual({ kind: 'missing' });
    expect(f.diagnose).not.toHaveBeenCalled();
    expect(await f.calls()).toEqual([]);
  });
  it.each(['EACCES', 'EMFILE', undefined])(
    'diagnoses unexpected discovery failures with code %s',
    async (code) => {
      const f = await fixture();
      const error = Object.assign(new TypeError('Generated discovery failure.'), { code });
      const stack = '    at Ghostscript.find (/Applications/Viewer.app/Contents/main.js:12:76)';
      error.stack = 'TypeError: Generated discovery failure.\n' + stack;
      f.resolveExecutable.mockRejectedValue(error);
      expect(await f.service.postscriptStatus()).toEqual({ kind: 'failed' });
      expect(f.diagnose).toHaveBeenCalledWith(
        'Ghostscript discovery failed: Generated discovery failure.',
        expect.objectContaining({ errorClass: 'TypeError', code, stack }),
      );
      await expect(f.renderer.variant()).rejects.toThrow('Ghostscript could not be checked.');
      expect(await f.calls()).toEqual([]);
    },
  );
  it('uses exact safe arguments, a non-inherited environment and only stdin after the action', async () => {
    vi.stubEnv('GS_OPTIONS', '-dNOSAFER');
    const f = await fixture();
    expect(await f.service.postscriptStatus()).toEqual({ kind: 'found' });
    expect((await f.service.inspectPostscript(f.granted.id, 'inspect')).source.text).toBe(
      postscriptSample,
    );
    expect(await f.calls()).toEqual([]);
    const output = await f.service.renderPostscript(f.granted.id, 'render');
    expect(output.derivation).toEqual({ kind: 'postscript', decoder: 'Ghostscript 10.99.1' });
    expect(
      Buffer.from(await (await f.service.response(new Request(output.url))).arrayBuffer()),
    ).toEqual(pdfSample());
    const calls = await f.calls();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.args).toEqual(['-h']);
    expect(calls[1]!.args).toEqual(expectedArgs);
    for (const [index, call] of calls.entries()) {
      const environment = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TMPDIR: call.cwd };
      expect(launched.mock.calls[index]![2].env).toEqual(environment);
      // CoreFoundation appends its own encoding after spawn; it is not inherited from the parent.
      expect(call.environment).toEqual({
        ...environment,
        ...(process.platform === 'darwin'
          ? { __CF_USER_TEXT_ENCODING: `0x${process.getuid!().toString(16).toUpperCase()}:0x0:0x0` }
          : {}),
      });
      expect(call.priority).toBe(19);
      expect(f.recording.stages).toContain(call.cwd);
    }
    expect(await readFile(f.input, 'utf8')).toBe(postscriptSample);
    expect(await readFile(f.source)).toEqual(f.sourceBytes);
    expect(await readdir(calls[1]!.cwd)).toEqual([]);
    expect(f.recording.trash).not.toHaveBeenCalled();
    expect(f.recording.empty).toHaveLength(1);
    await f.service.renderPostscript(f.granted.id, 'again');
    expect(await f.calls()).toHaveLength(2);
  });
  it.each([
    ['timeout', 'time limit'],
    ['failure', 'could not render'],
    ['oversized', 'output size limit'],
    ['impostor', 'did not identify itself'],
    ['scratch', 'scratch-space limit'],
  ] as const)('ends %s and keeps inspection readable', async (mode, message) => {
    const f = await fixture(mode);
    await expect(f.service.renderPostscript(f.granted.id, 'render')).rejects.toThrow(message);
    expect((await f.service.inspectPostscript(f.granted.id, 'inspect')).metadata.title).toBe(
      'Two squares',
    );
    if (mode === 'timeout' || mode === 'scratch')
      expect(await f.signalRecords()).toEqual([
        { pid: (await f.calls())[1]!.pid, signal: 'SIGTERM' },
      ]);
    if (mode === 'scratch') {
      expect(f.recording.trash).toHaveBeenCalledOnce();
      expect(path.basename(f.recording.retained[0]!)).toMatch(/^Viewer Ghostscript scratch /);
      expect(await readdir(f.recording.retained[0]!)).toEqual(['gs_fake']);
    }
  });
  it('signals cancellation and waits for the owned process to exit', async () => {
    const f = await fixture('timeout', false, { timeout: 60_000 });
    const outcome = f.service
      .renderPostscript(f.granted.id, 'render')
      .catch((error: Error) => error);
    await vi.waitFor(async () => expect(await f.calls()).toHaveLength(2));
    f.service.cancelDocument(f.granted.id, 'render');
    expect(await outcome).toBeInstanceOf(Error);
    await vi.waitFor(async () =>
      expect(await f.signalRecords()).toEqual([
        { pid: (await f.calls())[1]!.pid, signal: 'SIGTERM' },
      ]),
    );
    await f.service.close();
    expect(f.recording.empty).toHaveLength(1);
  });
  it('kills descendants whose inherited output pipe outlives the wrapper', async () => {
    const f = await fixture('wrapper');
    const before = Date.now();
    await f.service.renderPostscript(f.granted.id, 'render');
    expect(Date.now() - before).toBeLessThan(3000);
    const { pid } = JSON.parse(await readFile(f.descendant, 'utf8')) as { pid: number };
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 3000 });
  });
  it('cancels the entire process group including a descendant that ignores SIGTERM', async () => {
    const f = await fixture('tree', false, { timeout: 60_000 });
    const outcome = f.service
      .renderPostscript(f.granted.id, 'render')
      .catch((error: Error) => error);
    let pid = 0;
    await vi.waitFor(async () => {
      pid = (JSON.parse(await readFile(f.descendant, 'utf8')) as { pid: number }).pid;
      expect(pid).toBeGreaterThan(0);
    });
    f.service.cancelDocument(f.granted.id, 'render');
    expect(await outcome).toBeInstanceOf(Error);
    await vi.waitFor(async () =>
      expect(await f.signalRecords()).toEqual([
        { pid: (await f.calls())[1]!.pid, signal: 'SIGTERM' },
      ]),
    );
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 3000 });
    await f.service.close();
  });
  it('cancels during discovery before queuing a process', async () => {
    const f = await fixture();
    let finish!: (value: string) => void;
    vi.spyOn(f.renderer, 'variant').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const outcome = f.service
      .renderPostscript(f.granted.id, 'render')
      .catch((error: Error) => error);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    f.service.cancelDocument(f.granted.id, 'render');
    finish('unused');
    expect(await outcome).toBeInstanceOf(Error);
    expect(await f.calls()).toEqual([]);
  });
  it('exercises scratch disposal with a recording adapter when preservation variables are absent', async () => {
    vi.stubEnv('VIEWER_TEST_PRESERVE', '');
    vi.stubEnv('VIEWER_TEST_NO_REMOVAL', '');
    const f = await fixture('scratch');
    await expect(f.service.renderPostscript(f.granted.id, 'render')).rejects.toThrow(
      'scratch-space limit',
    );
    expect(f.recording.trash).toHaveBeenCalledOnce();
    expect(await readdir(f.recording.retained[0]!)).toEqual(['gs_fake']);
  });
  it('preserves unexpected scratch links without sending them to Trash', async () => {
    const recording = recordingPostScriptStage(root);
    await expect(
      withPostScriptStage(recording.options, async (directory) => {
        await symlink(root, path.join(directory, 'unexpected-link'));
        throw new Error('Stopped test process.');
      }),
    ).rejects.toThrow('could not be safely checked and was kept');
    expect(recording.trash).not.toHaveBeenCalled();
    expect(await readdir(recording.stages[0]!)).toEqual(['unexpected-link']);
  });
  it('keeps native automated scratch out of the operating-system Trash', async () => {
    const recording = recordingPostScriptStage(root);
    const trash = guardTestTrash(recording.trash, {
      VIEWER_RENDER_TEST: '1',
      VIEWER_DATA_DIRECTORY: root,
      VIEWER_TEST_NO_REMOVAL: '1',
    });
    await expect(
      withPostScriptStage({ ...recording.options, trash }, async (directory) => {
        await writeFile(path.join(directory, 'gs_scratch'), 'Generated scratch.');
        throw new Error('Stopped test render.');
      }),
    ).rejects.toThrow('could not be moved to Trash and was kept');
    expect(recording.trash).not.toHaveBeenCalled();
    expect(
      (await readdir(root)).some((name) => name.startsWith('Viewer Ghostscript scratch ')),
    ).toBe(true);
  });
  it('propagates PostScriptStageError through Resources.renderPostscript and DerivedPreviews when canceled via cancelDocument', async () => {
    const source = path.join(root, 'stage-fail.eps');
    await writeFile(source, binaryEPSSample(postscriptSample), { flag: 'wx' });
    let finishCleanup!: () => void;
    const decodeStarted = new Promise<void>((resolveStarted) => {
      const cleanupGate = new Promise<void>((resolveCleanup) => {
        finishCleanup = resolveCleanup;
      });
      const cache = new DerivedPreviews(
        async () => {},
        async (_source, _mode, signal) => {
          resolveStarted();
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve();
            else signal.addEventListener('abort', () => resolve(), { once: true });
          });
          await cleanupGate;
          throw new PostScriptStageError(
            'Ghostscript scratch could not be moved to Trash and was kept.',
          );
        },
      );
      const renderer = {
        status: async () => ({ kind: 'found' as const }),
        variant: async () => 'gs-test',
        decode: vi.fn(),
      } as unknown as Ghostscript;
      const service = new Resources(
        async () => {},
        undefined,
        12000,
        undefined,
        undefined,
        undefined,
        undefined,
        { renderer, cache },
      );
      resources.push(service);
      void service;
    });
    const service = resources.at(-1)!;
    const granted = await service.grant(source);
    const pending = service.renderPostscript(granted.id, 'cancel-stage');
    await decodeStarted;
    service.cancelDocument(granted.id, 'cancel-stage');
    finishCleanup();
    await expect(pending).rejects.toThrow('could not be moved to Trash and was kept');
  });
  it('reports a scratch Trash failure even when rendering was canceled', async () => {
    const executable = path.join(root, 'fake-gs-cancel');
    const source = path.join(root, 'cancel.eps');
    const ready = path.join(root, 'scratch-ready');
    await writeFile(source, binaryEPSSample(postscriptSample), { flag: 'wx' });
    const script = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
if (process.argv.slice(2).includes('-h')) {
  process.stdout.write('GPL Ghostscript 10.99.1 (generated test program)\\n');
} else {
  fs.readFileSync(0);
  fs.writeFileSync(path.join(process.env.TMPDIR, 'gs_cancel'), Buffer.alloc(64));
  fs.writeFileSync(${JSON.stringify(ready)}, 'ready');
  setInterval(() => {}, 1000);
}
`;
    await writeFile(executable, script, { flag: 'wx', mode: 0o700 });
    const recording = recordingPostScriptStage(root);
    const diagnose = vi.fn();
    const renderer = new Ghostscript({
      ...recording.options,
      trash: async () => {
        throw new Error('Trash unavailable');
      },
      resolveExecutable: async (file) =>
        realpath(ghostscriptLocations.includes(file) ? executable : file),
      diagnose,
      store: () => false,
      timeout: 5000,
    });
    const variant = await renderer.variant();
    const handle = await open(source, 'r');
    const info = await fileStat(handle);
    const controller = new AbortController();
    let settled = false;
    const outcome = renderer
      .decode(
        { file: source, handle, info, format: 'eps' },
        'postscript',
        controller.signal,
        undefined,
        variant,
      )
      .then(
        () => {
          settled = true;
          return undefined;
        },
        (error: Error) => {
          settled = true;
          return error;
        },
      );
    try {
      for (let attempt = 0; attempt < 200 && !settled; attempt++) {
        const present = await stat(ready).then(
          () => true,
          () => false,
        );
        if (present) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      controller.abort();
      const error = await outcome;
      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toContain('could not be moved to Trash and was kept');
      expect(diagnose).toHaveBeenCalledWith(
        expect.stringContaining('PostScript scratch failure:'),
        expect.anything(),
      );
    } finally {
      await handle.close();
    }
  });
  it('has no discovery or render path in the Store edition', async () => {
    const f = await fixture('success', true);
    expect(await f.service.postscriptStatus()).toEqual({ kind: 'store' });
    await expect(f.service.renderPostscript(f.granted.id, 'render')).rejects.toThrow(
      'Store edition',
    );
    expect(f.resolveExecutable).not.toHaveBeenCalled();
    expect(await f.calls()).toEqual([]);
  });
});

describe('desktop authority boundary', () => {
  it('refuses the real render IPC route during an agent dispatch', async () => {
    const f = await fixture();
    const owned = await f.service.grant(f.source, undefined, 2);
    const handler = createResourceHandlers({
      resources: f.service,
      thumbnails: { get: vi.fn() },
      webPreviews: { releaseResource: vi.fn() },
      files: { extract: vi.fn() },
      fileAccess: { require: vi.fn() },
      forgetGitResource: vi.fn(),
      warmOffice: vi.fn(),
      isAgent: (owner) => owner === 1,
    }).renderPostscript;
    expect(() => handler([owned.id, 'agent-render'], 1)).toThrow('never to agents');
    expect(await f.calls()).toEqual([]);
    await handler([owned.id, 'human-render'], 2);
    expect(await f.calls()).toHaveLength(2);
    expect(methodWindows.renderPostscript).toBe('viewer');
    expect(
      schemas.renderPostscript.safeParse([owned.id, 'render', { actor: 'user' }]).success,
    ).toBe(false);
  });
  it('has no custom executable setting and restores ordinary preview configuration for agents', () => {
    const defaults = defaultSettings('/fixtures');
    expect(
      settingsSchema.safeParse({
        ...defaults,
        previews: { ...defaults.previews, ghostscriptPath: '/fixtures/gs' },
      }).success,
    ).toBe(false);
    expect(() => agentConfigurationPath(['settings', 'previews'])).not.toThrow();
  });
});
