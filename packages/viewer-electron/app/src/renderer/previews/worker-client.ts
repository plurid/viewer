/** One view owns its worker. Late replies cannot complete a cancelled request. */
export class PreviewWorker {
  private worker: Worker;
  private next = 0;
  private stopped = false;
  private pending = new Map<number, (error?: Error, value?: unknown) => void>();
  constructor(
    create: () => Worker,
    private name: string,
    private timeout = 15000,
  ) {
    this.worker = create();
    this.worker.onmessage = (
      event: MessageEvent<{ id: number; value?: unknown; error?: string }>,
    ) => {
      const reply = event.data;
      this.pending.get(reply.id)?.(reply.error ? new Error(reply.error) : undefined, reply.value);
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.close(new Error(`${this.name} stopped. Retry the preview.`));
    };
    this.worker.onmessageerror = () =>
      this.close(new Error(`${this.name} returned unreadable data. Retry the preview.`));
  }
  request<T>(message: object, signal?: AbortSignal, transfer: Transferable[] = []): Promise<T> {
    if (this.stopped)
      return Promise.reject(new Error(`${this.name} has closed. Retry the preview.`));
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Preview cancelled.'));
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const finish = (error?: Error, value?: unknown) => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        if (error) reject(error);
        else resolve(value as T);
      };
      const cancel = () => finish(signal?.reason ?? new Error('Preview cancelled.'));
      const timer = setTimeout(
        () => this.close(new Error(`${this.name} took too long. Retry the preview.`)),
        this.timeout,
      );
      this.pending.set(id, finish);
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        this.worker.postMessage({ ...message, id }, transfer);
      } catch (error) {
        finish(error as Error);
      }
    });
  }
  close(reason = new Error('Preview closed.')) {
    if (this.stopped) return;
    this.stopped = true;
    this.worker.terminate();
    for (const finish of this.pending.values()) finish(reason);
  }
}
