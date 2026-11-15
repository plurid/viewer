import { macFiles } from '../native/macos-files';

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
    signal?.throwIfAborted();
    // The retry must itself receive an unsupported exclusive rename before reserving anything.
    // An older helper ignores the extra argument and continues to fail without replacing items.
    await native.renameExclusive(source, destination, purpose, true);
  }
}
