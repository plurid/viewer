import { describe, expect, it, vi } from 'vitest';
import type { CanvasState } from '../src/domain/canvases/document';
import { canvasInputWriter, flushCanvasWrites } from '../src/renderer/canvases/writes';
import { deferred } from './support/deferred';

describe('canvas input persistence', () => {
  it('retains the last input and other changed controls while a save is delayed', async () => {
    const gate = deferred();
    let saved: CanvasState = {};
    const save = vi.fn(async (patch: CanvasState) => {
      await gate.promise;
      saved = { ...saved, ...patch };
    });
    const recover = vi.fn(async () => {});
    const update = canvasInputWriter(save, recover);
    update({ quantity: 1 });
    await Promise.resolve();
    for (let quantity = 2; quantity <= 241; quantity++) update({ quantity });
    update({ camera: [1, 2, 3], checked: true });
    update({ checked: false });
    expect(saved).toEqual({});
    let flushed = false;
    const flush = flushCanvasWrites().then(() => (flushed = true));
    await Promise.resolve();
    expect(flushed).toBe(false);
    gate.resolve();
    await flush;
    expect(saved).toEqual({ quantity: 241, camera: [1, 2, 3], checked: false });
    expect(save).toHaveBeenCalledTimes(2);
    expect(recover).not.toHaveBeenCalled();
    await update({ quantity: 300 });
    expect(saved.quantity).toBe(300);
  });

  it('waits for recovery after a failed save and permits a new input afterwards', async () => {
    const failure = new Error('Storage unavailable');
    const gate = deferred();
    const recovered = deferred();
    const save = vi.fn(async (_patch: CanvasState) => gate.promise);
    const recover = vi.fn(async (_error: unknown) => recovered.promise);
    const update = canvasInputWriter(save, recover);
    update({ quantity: 1 });
    await Promise.resolve();
    update({ quantity: 2 });
    gate.reject(failure);
    let flushed = false;
    const flush = flushCanvasWrites().then(() => (flushed = true));
    await vi.waitFor(() => expect(recover).toHaveBeenCalledWith(failure));
    expect(flushed).toBe(false);
    recovered.resolve();
    await flush;
    expect(save).toHaveBeenCalledTimes(1);
    save.mockResolvedValue(undefined);
    await update({ quantity: 3 });
    expect(save).toHaveBeenLastCalledWith({ quantity: 3 });
  });

  it('bounds accumulated input without replacing the pending valid values', async () => {
    const save = vi.fn(async (_patch: CanvasState) => {});
    const update = canvasInputWriter(save, async () => {});
    const valid = { text: 'a'.repeat(70_000) };
    const written = update(valid);
    expect(() => update({ more: 'b'.repeat(70_000) })).toThrow();
    expect(() => update({ constructor: 'invalid' })).toThrow();
    await written;
    expect(save).toHaveBeenCalledWith(valid);
  });
});
