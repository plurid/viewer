export type SaveFailureChoice = 'retry' | 'keep-open';

/** Closing is the result of a successful save, never a finally-handler side effect. */
export async function saveBeforeClose(
  save: () => Promise<void>,
  onFailure: (error: unknown) => Promise<SaveFailureChoice>,
): Promise<boolean> {
  for (;;) {
    try {
      await save();
      return true;
    } catch (error) {
      if ((await onFailure(error)) !== 'retry') return false;
    }
  }
}
