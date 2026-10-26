import { afterEach, expect, it, vi } from 'vitest';
import { PreviewWorker } from '../src/renderer/previews/worker-client';

class ControlledWorker {
  onmessage?: (event: MessageEvent) => void;
  onerror?: (event: ErrorEvent) => void;
  onmessageerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  reply(id: number, value: unknown) {
    this.onmessage?.({ data: { id, value } } as MessageEvent);
  }
}
afterEach(() => vi.useRealTimers());

it('cancels only its subscriber and ignores a late reply without losing another request', async () => {
  const worker = new ControlledWorker();
  const client = new PreviewWorker(() => worker as unknown as Worker, 'Table processing');
  const abort = new AbortController();
  const first = client.request({ query: 'first' }, abort.signal);
  const rejection = expect(first).rejects.toThrow('Changed query');
  const second = client.request({ query: 'second' });
  abort.abort(new Error('Changed query'));
  await rejection;
  worker.reply(1, 'stale');
  worker.reply(2, 'current');
  expect(await second).toBe('current');
  expect(worker.terminate).not.toHaveBeenCalled();
  client.close();
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it('terminates an unanswered worker at its deadline and clears every outstanding timer', async () => {
  vi.useFakeTimers();
  const worker = new ControlledWorker();
  const client = new PreviewWorker(() => worker as unknown as Worker, 'Mesh parsing', 20);
  const a = expect(client.request({ source: 'a' })).rejects.toThrow('took too long');
  const b = expect(client.request({ source: 'b' })).rejects.toThrow('took too long');
  await vi.advanceTimersByTimeAsync(21);
  await Promise.all([a, b]);
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  await expect(client.request({ source: 'c' })).rejects.toThrow('has closed');
});

it('rejects all outstanding work on owner close and does not restart from a late result', async () => {
  const worker = new ControlledWorker();
  const client = new PreviewWorker(() => worker as unknown as Worker, 'Mesh parsing');
  const result = client.request({ source: 'a' });
  const rejected = expect(result).rejects.toThrow('Preview closed');
  client.close();
  worker.reply(1, 'late');
  client.close();
  await rejected;
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it('handles a worker crash and a failed message send as recoverable errors', async () => {
  const worker = new ControlledWorker();
  const client = new PreviewWorker(() => worker as unknown as Worker, 'Table processing');
  worker.postMessage.mockImplementationOnce(() => {
    throw new Error('Could not clone');
  });
  await expect(client.request({ source: 'a' })).rejects.toThrow('Could not clone');
  const failed = expect(client.request({ source: 'b' })).rejects.toThrow('stopped');
  worker.onerror?.({ preventDefault() {} } as ErrorEvent);
  await failed;
  expect(worker.terminate).toHaveBeenCalledOnce();
});
