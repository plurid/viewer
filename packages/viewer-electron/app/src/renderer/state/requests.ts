/**
 * Loads a snapshot and follows the events that update it. An event that arrives while the
 * snapshot is loading is applied on top of it, so the older snapshot never overwrites it.
 * `reload` loads again the same way; only the latest load counts.
 */
export function followSnapshot<Value, Event>(source: {
  load: () => Promise<Value>;
  subscribe: (listener: (event: Event) => void) => () => void;
  apply: (value: Value, event: Event) => Value;
  set: (update: (value: Value) => Value) => void;
  failed: (error: unknown) => void;
}): { reload(): void; stop(): void } {
  const pending: Event[] = [];
  let latest = 0;
  let loading = false;
  let live = true;
  const unsubscribe = source.subscribe((event) => {
    if (loading) pending.push(event);
    else source.set((value) => source.apply(value, event));
  });
  /** Ends a load: the events that waited for it are applied to its snapshot, or, when it
   * failed, to the value already shown. */
  const settle = (ticket: number, loaded?: { snapshot: Value }) => {
    if (!live || ticket !== latest) return false;
    const events = pending.splice(0);
    loading = false;
    source.set((value) => events.reduce(source.apply, loaded ? loaded.snapshot : value));
    return true;
  };
  const reload = () => {
    const ticket = ++latest;
    loading = true;
    source.load().then(
      (snapshot) => {
        settle(ticket, { snapshot });
      },
      (error: unknown) => {
        if (settle(ticket)) source.failed(error);
      },
    );
  };
  reload();
  return {
    reload,
    stop() {
      live = false;
      unsubscribe();
    },
  };
}

/** Applies only the reply to the most recent request, so an older reply never overwrites a newer one. */
export function latestReplies() {
  let latest = 0;
  return function request<Value>(
    work: Promise<Value>,
    apply: (value: Value) => void,
    failed: (error: unknown) => void,
  ): void {
    const ticket = ++latest;
    work.then(
      (value) => {
        if (ticket === latest) apply(value);
      },
      (error: unknown) => {
        if (ticket === latest) failed(error);
      },
    );
  };
}
