import { restoreReaderError } from '../domain/previews/reader-problem';
function restoredError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string')
    return restoreReaderError(value.message, {
      code: 'code' in value ? value.code : undefined,
      readerProblem: 'readerProblem' in value ? value.readerProblem : undefined,
    });
  return new Error(String(value));
}

/** Keep wire failures cloneable across contextBridge and restore Error in the
 * renderer world. Synchronous helpers and event cleanup retain their contracts. */
export function restoreApiErrors<T extends object>(api: T): T {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(api).map(([name, operation]) => [
        name,
        typeof operation === 'function'
          ? (...args: unknown[]) => {
              try {
                const result: unknown = Reflect.apply(operation, api, args);
                return result instanceof Promise
                  ? result.catch((error: unknown) => {
                      throw restoredError(error);
                    })
                  : result;
              } catch (error) {
                throw restoredError(error);
              }
            }
          : operation,
      ]),
    ),
  ) as T;
}
