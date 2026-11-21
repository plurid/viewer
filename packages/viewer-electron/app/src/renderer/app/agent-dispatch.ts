let activeDispatch: string | undefined;

export function currentAgentDispatch(): string | undefined {
  return activeDispatch;
}

/** Echoes a desktop-issued agent dispatch ID only for the synchronous IPC call(s) started
 * inside `work`. Restores synchronously before yielding so concurrent timers or user actions
 * in the same window never inherit the agent's tag. */
export function withAgentDispatch<T>(id: string | undefined, work: () => T): T {
  if (!id) return work();
  const previous = activeDispatch;
  activeDispatch = id;
  window.viewerDispatch?.set(id);
  try {
    return work();
  } finally {
    activeDispatch = previous;
    window.viewerDispatch?.set(previous);
  }
}
