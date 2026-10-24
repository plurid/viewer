import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

vi.mock('electron', () => ({ utilityProcess: {} }));
const { UtilityClient } = await import('../src/desktop/workers/utility-client');

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
