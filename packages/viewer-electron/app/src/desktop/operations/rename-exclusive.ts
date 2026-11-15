import { macFiles } from '../native/macos-files';
import type { NativeRenameFailure } from '../native/macos-files';
import { disposeRenameRecovery } from './removal';

/** Keep reservation publication inside the native coordinator, including its move notifications. */
export async function renameExclusive(
  source: string,
  destination: string,
  purpose?: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const native = macFiles();
  try {
    if (purpose === undefined) await native.renameExclusive(source, destination);
    else await native.renameExclusive(source, destination, purpose);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code !== 'ENOTSUP' && code !== 'EOPNOTSUPP') throw error;
    if (native.renameRecoveryVersion !== 1) throw error;
    signal?.throwIfAborted();
    // The retry must itself receive an unsupported exclusive rename before reserving anything.
    try {
      await native.renameExclusive(source, destination, purpose, true);
    } catch (error) {
      const failure = error as NativeRenameFailure;
      if (failure.renameRecovery) {
        const notes = await disposeRenameRecovery(failure.renameRecovery, (file) =>
          native.trash(file, purpose),
        );
        failure.message = [failure.renameMessage ?? failure.message, ...notes].join(' ');
      }
      throw error;
    }
  }
}
