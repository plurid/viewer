// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  discardBuffer,
  flushBuffers,
  heldBuffer,
  keepBuffer,
} from '../src/renderer/editing/buffers';

const write = vi.fn();
const discard = vi.fn();
const ids = new Set<string>();

function edit(id: string, text: string): void {
  ids.add(id);
  keepBuffer({ id, kind: 'scratch', text, title: 'Draft' });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  write.mockReset().mockResolvedValue(undefined);
  discard.mockReset().mockResolvedValue(undefined);
  Object.assign(window, { viewer: { bufferWrite: write, bufferDiscard: discard } });
});

afterEach(async () => {
  for (const id of ids) await discardBuffer(id);
  ids.clear();
});

describe('editor buffer durability', () => {
  it('joins an in-flight write before another flush may acknowledge persistence', async () => {
    const pending = deferred();
    write.mockReturnValueOnce(pending.promise);
    edit('in-flight', 'Irreplaceable draft');
    const first = flushBuffers();
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    let durable = false;
    const second = flushBuffers().then(() => {
      durable = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(durable).toBe(false);
    pending.resolve();
    await Promise.all([first, second]);
    expect(durable).toBe(true);
    expect(write).toHaveBeenCalledOnce();
  });

  it('retains failed work and retries it on the next explicit flush', async () => {
    write.mockRejectedValueOnce(new Error('Disk full'));
    edit('retry', 'Keep this text');
    await expect(flushBuffers()).rejects.toThrow('Disk full');
    expect(heldBuffer('retry')?.text).toBe('Keep this text');
    await flushBuffers();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]?.[0].text).toBe('Keep this text');
  });

  it('includes edits arriving while the preceding revision is being written', async () => {
    const pending = deferred();
    write.mockReturnValueOnce(pending.promise);
    edit('revisions', 'First revision');
    const flush = flushBuffers();
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    edit('revisions', 'Latest revision');
    pending.resolve();
    await flush;
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]?.[0].text).toBe('Latest revision');
  });

  it('waits for an existing write before discarding its private buffer', async () => {
    const pending = deferred();
    write.mockReturnValueOnce(pending.promise);
    edit('discard-order', 'Reviewed discard');
    const flush = flushBuffers();
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    const removal = discardBuffer('discard-order');
    await Promise.resolve();
    expect(discard).not.toHaveBeenCalled();
    pending.resolve();
    await Promise.all([flush, removal]);
    expect(discard).toHaveBeenCalledWith('discard-order');
    expect(heldBuffer('discard-order')).toBeUndefined();
  });

  it('keeps the held text when discarding fails', async () => {
    edit('discard-failure', 'Still recoverable');
    discard.mockRejectedValueOnce(new Error('Private storage unavailable'));
    await expect(discardBuffer('discard-failure')).rejects.toThrow('Private storage unavailable');
    expect(heldBuffer('discard-failure')?.text).toBe('Still recoverable');
  });
});
