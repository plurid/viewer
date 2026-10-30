import { expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { temporaryRoot } from '../tools/temporary';

vi.mock('electron', () => ({ utilityProcess: {} }));
const { layoutImageProcess } = await import('../src/desktop/transforms/image-process');

// Answers each layout request with its kind and how many came before; a canvas never finishes.
const worker = `
const { parentPort } = require('node:worker_threads');
let count = 0;
parentPort.on('message', ({ id, layout }) => {
  count += 1;
  if (layout.kind === 'canvas-end') return;
  if (layout.kind === 'text') parentPort.postMessage({ id, error: 'No fonts here.' });
  else parentPort.postMessage({ id, value: { kind: layout.kind, count } });
});
`;

it('keeps one worker for a layout and ends it when the layout is cancelled', async () => {
  const root = await temporaryRoot('viewer-layout-process-');
  const file = path.join(root, 'worker.cjs');
  await writeFile(file, worker, { flag: 'wx' });
  const imaging = layoutImageProcess(file, root, 'thread');
  const signal = new AbortController().signal;
  try {
    const canvas = { kind: 'canvas', width: 10, height: 10, scale: 1 } as const;
    await expect(imaging.run(canvas, signal)).resolves.toEqual({ kind: 'canvas', count: 1 });
    await expect(imaging.run({ kind: 'canvas-marks', items: [] }, signal)).resolves.toEqual({
      kind: 'canvas-marks',
      count: 2,
    });
    await expect(imaging.run({ kind: 'text', items: [], scale: 1 }, signal)).rejects.toThrow(
      'No fonts here.',
    );
    const cancel = new AbortController();
    const end = imaging.run(
      { kind: 'canvas-end', format: 'png', quality: 90, dpi: 72 },
      cancel.signal,
    );
    cancel.abort(new Error('Cancelled.'));
    await expect(end).rejects.toThrow('Cancelled.');
    // The cancelled worker is gone: a new request starts a fresh one.
    await expect(imaging.run(canvas, signal)).resolves.toEqual({ kind: 'canvas', count: 1 });
  } finally {
    imaging.close();
  }
  console.warn('Retained layout process fixture:', root);
});
