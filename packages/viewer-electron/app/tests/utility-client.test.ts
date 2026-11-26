import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { shellQuote } from '../src/desktop/terminals/terminal-launch';
import { DiagnosticLog } from '../src/desktop/diagnostics/diagnostics';
import { DiagnosticBudget, WorkerOutput } from '../src/desktop/diagnostics/failures';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const forked = vi.hoisted(() => [] as { worker: string; args: string[] }[]);
const forkDetails = vi.hoisted(
  () =>
    [] as {
      options?: Record<string, unknown>;
      stderr: {
        pipe: ReturnType<typeof vi.fn>;
        on: ReturnType<typeof vi.fn>;
        resume: ReturnType<typeof vi.fn>;
      };
    }[],
);
vi.mock('electron', () => ({
  utilityProcess: {
    fork: (worker: string, args: string[], options?: Record<string, unknown>) => {
      const stderr = { pipe: vi.fn(), on: vi.fn(), resume: vi.fn() };
      forked.push({ worker, args });
      forkDetails.push({ options, stderr });
      return { stderr, on: () => {}, once: () => {}, postMessage: () => {} };
    },
  },
}));
const { UtilityClient, launchWorker } = await import('../src/desktop/workers/utility-client');
const { setAssetRoot } = await import('../src/desktop/native/assets');

let root: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-utility-client-');
});
afterEach(async () => {
  await trashTemporary(root);
});

// A worker whose first initialization fails, as an index that cannot open yet does.
const worker = `
const { parentPort } = require('node:worker_threads');
let attempts = 0;
parentPort.on('message', (request) => {
  if (request.method === 'init') {
    attempts += 1;
    parentPort.postMessage(attempts === 1 ? { id: request.id, error: 'Not ready yet.' } : { id: request.id, value: true });
  } else parentPort.postMessage({ id: request.id, value: attempts });
});
`;

describe('background worker client', () => {
  it('tries a failed initialization again on the next call, with the same worker', async () => {
    const file = path.join(root, 'worker.cjs');
    await writeFile(file, worker);
    const client = new UtilityClient(file, {
      name: 'Viewer test worker',
      backend: 'thread',
      initialize: (client) => client.post('init', []),
    });
    try {
      await expect(client.call('attempts')).rejects.toThrow('Not ready yet.');
      await expect(client.call('attempts')).resolves.toBe(2);
    } finally {
      await client.close();
    }
  });
});

// A worker that answers with the arguments it was launched with.
const echo = `
const { parentPort } = require('node:worker_threads');
parentPort.on('message', (request) => parentPort.postMessage({ id: request.id, value: process.argv }));
`;

describe('launching a worker', () => {
  afterEach(() => setAssetRoot(true, '/Source/app'));
  it('tells it the source tree’s assets in development, and nothing when packaged', async () => {
    const file = path.join(root, 'echo.cjs');
    await writeFile(file, echo);
    setAssetRoot(false, '/Source/app');
    launchWorker(file, 'Viewer test worker');
    expect(forked.at(-1)).toEqual({
      worker: file,
      args: ['--viewer-asset-root=/Source/app/assets'],
    });
    const client = new UtilityClient(file, { name: 'Viewer test worker', backend: 'thread' });
    try {
      expect(await client.call('argv')).toContain('--viewer-asset-root=/Source/app/assets');
    } finally {
      await client.close();
    }
    setAssetRoot(true, '/Source/app');
    launchWorker(file, 'Viewer test worker');
    expect(forked.at(-1)!.args).toEqual([]);
  });

  it('ignores worker stdout and drains unread stderr when no diagnostics sink is attached', async () => {
    const noisy = `
const { parentPort } = require('node:worker_threads');
parentPort.on('message', (request) => {
  process.stdout.write('a'.repeat(131072));
  process.stderr.write('b'.repeat(131072));
  parentPort.postMessage({ id: request.id, value: 'done' });
});
`;
    const file = path.join(root, 'noisy.cjs');
    await writeFile(file, noisy);
    launchWorker(file, 'Viewer test worker');
    const detail = forkDetails.at(-1)!;
    expect(detail.options).toMatchObject({ stdio: ['ignore', 'ignore', 'pipe'] });
    expect(detail.stderr.resume).toHaveBeenCalledOnce();

    const launched = launchWorker<{ id: string; value: string }>(
      file,
      'Viewer test worker',
      'thread',
    );
    try {
      const reply = new Promise<string>((resolve) => {
        launched.message((message) => {
          if (message.id === 'ping') resolve(message.value);
        });
      });
      launched.postMessage({ id: 'ping' });
      expect(await reply).toBe('done');
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(launched.thread!.stdout?.readableLength ?? 0).toBe(0);
      expect(launched.thread!.stderr?.readableLength ?? 0).toBe(0);
      if (launched.thread!.stdout) expect(launched.thread!.stdout.readableFlowing).toBe(true);
      if (launched.thread!.stderr) expect(launched.thread!.stderr.readableFlowing).toBe(true);
    } finally {
      await launched.thread?.terminate();
    }
  });
});

it.each(['thread', 'process'] as const)(
  'keeps multiline credentials out of the stored %s worker output',
  async (backend) => {
    vi.resetModules();
    const { launchWorker, reportWorkers } = await import('../src/desktop/workers/utility-client');
    const log = new DiagnosticLog(path.join(root, 'worker.log'));
    const records: Promise<void>[] = [];
    reportWorkers({
      output(name) {
        return new WorkerOutput(
          name,
          (detail, source) => {
            records.push(log.record('worker-output', detail, undefined, source));
          },
          new DiagnosticBudget(),
        );
      },
      stopped: vi.fn(),
    });
    const shellCommand = [
      'viewer',
      '--db-password',
      "SAMPLE_FIVE's\nSAMPLE_SIX\nSAMPLE_SEVEN",
      'done',
    ]
      .map(shellQuote)
      .join(' ');
    const environment =
      'exec /usr/bin/env DB_PASSWORD=' + shellQuote("SAMPLE_NINE's\nSAMPLE_TEN\\") + " 'viewer'";
    const chunks = [
      'first warning\n{"db_password":\r\n   "SAMPLE_ONE"}\n',
      '{"client_se',
      'cret"\n : \n [\n {"value":"SAMPLE_TWO"}\n ]}\n',
      '"password":\n',
      '   "SAMP',
      'LE_THREE"\n',
      'DB_PASSWORD=' + 'x'.repeat(2300),
      'SAMPLE_FOUR',
      '\n',
      ...shellCommand.match(/[\s\S]{1,5}/g)!,
      '\n',
      ...environment.match(/[\s\S]{1,5}/g)!,
      '\nunsupported viewer-license-10 format\n',
      '--db-password= viewer --version\n',
      'env _DB_PASSWORD= viewer --version\n',
      '{"token":"SAMPLE_EIGHT","state":"ready"}\n',
      'second ordinary diagnostic\n',
      'worker resumed\n',
      'schema path /schemas/viewer-license-1.d/default.json\n',
      'last message viewer-license-1.',
    ];
    const file = path.join(root, 'sample.cjs');
    await writeFile(
      file,
      'for (const chunk of ' + JSON.stringify(chunks) + ') process.stderr.write(chunk);',
    );
    const worker = launchWorker(file, 'Fixture', backend);
    if (worker.thread) {
      await new Promise<void>((resolve) => worker.exit(() => resolve(), true));
    } else {
      const onData = forkDetails.at(-1)!.stderr.on.mock.calls.find(([name]) => name === 'data')![1];
      for (const chunk of chunks) onData(Buffer.from(chunk));
      const onClose = forkDetails
        .at(-1)!
        .stderr.on.mock.calls.find(([name]) => name === 'close')![1];
      onClose();
    }
    await Promise.all(records);
    const stored = await readFile(log.file, 'utf8');
    const details = stored
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line).detail);
    expect(details.slice(-2)).toEqual([
      'Fixture: schema path /schemas/viewer-license-1.d/default.json',
      'Fixture: last message viewer-license-1.',
    ]);
    expect(details).toContain('Fixture: --db-password= viewer --version');
    expect(details).toContain('Fixture: unsupported viewer-license-10 format');
    expect(details).toContain('Fixture: env _DB_PASSWORD= [redacted]');
    expect(details).toContain('Fixture: {"token":[redacted],"state":"ready"}');
    expect(stored).toContain('Fixture: first warning');
    expect(stored).toContain('Fixture: worker resumed');
    expect(stored).toContain('Fixture: second ordinary diagnostic');
    expect(stored).not.toContain('SAMPLE_');
  },
);
