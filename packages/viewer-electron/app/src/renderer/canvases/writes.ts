import { canvasStateSchema } from '../../domain/canvases/document';
import type { CanvasState } from '../../domain/canvases/document';

const pending = new Set<Promise<void>>();

/** Keep the last value of every input while a previous save is still in flight. */
export function canvasInputWriter(
  save: (patch: CanvasState) => Promise<void>,
  recover: (error: unknown) => Promise<void>,
) {
  let patch: CanvasState | undefined;
  let saving: Promise<void> | undefined;
  return (next: CanvasState): Promise<void> => {
    patch = canvasStateSchema.parse({ ...patch, ...next });
    if (!saving) {
      saving = Promise.resolve().then(async () => {
        try {
          while (patch) {
            const batch = patch;
            patch = undefined;
            await save(batch);
          }
        } catch (error) {
          // Recovery reloads durable values. Do not apply a partial tail on top of them.
          patch = undefined;
          await recover(error);
          patch = undefined;
        } finally {
          saving = undefined;
        }
      });
      trackCanvasWrite(saving);
    }
    return saving;
  };
}

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
