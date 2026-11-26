import { z } from 'zod';

export const flushResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.string().min(1).max(2000),
      code: z.string().min(1).max(100),
    })
    .strict(),
]);

export type FlushResult = z.infer<typeof flushResultSchema>;

export function failedFlush(error: unknown): FlushResult {
  const code = error && typeof error === 'object' && 'code' in error && error.code;
  return {
    ok: false,
    error:
      (error instanceof Error ? error.message : String(error)).slice(0, 2000) ||
      'The changes could not be saved.',
    code:
      typeof code === 'string' && code.length > 0 && code.length <= 100
        ? code
        : 'PERSISTENCE_FAILED',
  };
}
