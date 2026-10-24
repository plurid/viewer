type ResponseProblem = 'size' | 'empty' | 'json' | 'read';

const responseProblems: Record<ResponseProblem, string> = {
  size: 'Provider response exceeded its size limit.',
  empty: 'The provider returned an empty response.',
  json: 'The provider returned invalid JSON.',
  read: 'The provider response could not be read.',
};

export class ProviderResponseError extends Error {
  constructor(readonly problem: ResponseProblem) {
    super(responseProblems[problem]);
  }
}

/** Neither network errors nor JSON parser excerpts may expose request or response text. */
export function providerAbort(signal: AbortSignal): DOMException {
  const timeout = signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError';
  return new DOMException(
    timeout ? 'The provider request timed out.' : 'The provider request was cancelled.',
    timeout ? 'TimeoutError' : 'AbortError',
  );
}

export async function requestProvider(
  request: typeof fetch,
  url: string,
  options: RequestInit & { signal: AbortSignal },
): Promise<Response> {
  if (options.signal.aborted) throw providerAbort(options.signal);
  try {
    return await request(url, options);
  } catch {
    if (options.signal.aborted) throw providerAbort(options.signal);
    throw new Error('Provider connection failed. Check your connection and endpoint in Settings.');
  }
}

/** Bound streamed JSON independently of Content-Length, including stalled or cancelled bodies. */
export async function providerResponseJSON(
  response: Response,
  signal: AbortSignal,
  limit = 4_000_000,
): Promise<unknown> {
  if (signal.aborted) {
    void response.body?.cancel().catch(() => {});
    throw providerAbort(signal);
  }
  if (Number(response.headers.get('content-length')) > limit) {
    void response.body?.cancel().catch(() => {});
    throw new ProviderResponseError('size');
  }
  if (!response.body) throw new ProviderResponseError('empty');
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  let chunks = 0;
  let rejectAbort!: (error: DOMException) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  const onAbort = () => {
    rejectAbort(providerAbort(signal));
    cancel();
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), aborted]);
      if (signal.aborted) throw providerAbort(signal);
      if (done) break;
      size += value.byteLength;
      if (size > limit || ++chunks > 16_384) {
        cancel();
        throw new ProviderResponseError('size');
      }
      parts.push(value);
    }
  } catch (error) {
    if (signal.aborted) throw providerAbort(signal);
    if (error instanceof ProviderResponseError) throw error;
    cancel();
    throw new ProviderResponseError('read');
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(parts, size).toString('utf8'));
  } catch {
    throw new ProviderResponseError(size ? 'json' : 'empty');
  }
}
