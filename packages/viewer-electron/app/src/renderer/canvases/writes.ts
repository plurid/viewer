const pending = new Set<Promise<void>>();

/** A plane can unmount while its ordered input writes are still reaching the desktop. */
export function trackCanvasWrite(write: Promise<void>) {
  pending.add(write);
  void write.then(
    () => pending.delete(write),
    () => pending.delete(write),
  );
}

export async function flushCanvasWrites(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}
