export interface CanvasObservation {
  status: 'ready' | 'error' | 'not-observed';
  message?: string;
}

/** Preview observations describe execution, never the correctness of generated results. */
export class CanvasObservations {
  private current = new Map<string, { revision: number; value: CanvasObservation }>();
  private listeners = new Set<() => void>();
  record(id: string, revision: number, value: CanvasObservation) {
    const previous = this.current.get(id);
    if (
      previous &&
      (previous.revision > revision ||
        (previous.revision === revision && previous.value.status === 'error'))
    )
      return;
    this.current.set(id, { revision, value });
    for (const listener of this.listeners) listener();
  }
  forget(id: string) {
    this.current.delete(id);
  }
  read(id: string, revision: number): CanvasObservation {
    const item = this.current.get(id);
    return item?.revision === revision ? item.value : { status: 'not-observed' };
  }
  wait(id: string, revision: number, signal: AbortSignal): Promise<CanvasObservation> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      let settle: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        clearTimeout(timeout);
        clearTimeout(settle);
        this.listeners.delete(check);
        signal.removeEventListener('abort', abort);
        if (signal.aborted) reject(signal.reason);
        else resolve(this.read(id, revision));
      };
      const check = () => {
        const value = this.read(id, revision);
        if (value.status === 'error') finish();
        else if (value.status === 'ready' && !settle) settle = setTimeout(finish, 300);
      };
      const abort = () => finish();
      const timeout = setTimeout(finish, 5000);
      this.listeners.add(check);
      signal.addEventListener('abort', abort, { once: true });
      check();
    });
  }
}
