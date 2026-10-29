/** Waits for every piece of work, then throws the first failure, so nothing is left running. */
export async function settleAll(work: readonly unknown[]): Promise<void> {
  const results = await Promise.allSettled(work);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failure) throw failure.reason;
}
