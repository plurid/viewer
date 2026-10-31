import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const forked = vi.hoisted(() => [] as { worker: string; args: string[] }[]);
vi.mock('electron', () => ({
  utilityProcess: {
    fork: (worker: string, args: string[]) => {
      forked.push({ worker, args });
      return { stderr: null, on: () => {}, once: () => {}, postMessage: () => {} };
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
});
