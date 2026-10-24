/** Concurrent requests for the same workspace join one native window creation. */
export class WindowCreationRequests<Window> {
  private readonly pending = new Map<string, Promise<Window>>();

  create(key: string, factory: () => Promise<Window>): Promise<Window> {
    const current = this.pending.get(key);
    if (current) return current;
    const work = Promise.resolve()
      .then(factory)
      .finally(() => {
        if (this.pending.get(key) === work) this.pending.delete(key);
      });
    this.pending.set(key, work);
    return work;
  }
}
