import { z } from 'zod';

/** An absolute POSIX or Windows path, checked without `node:path` so the renderer can
 * use it too. The desktop process validates paths for its own platform as well. */
export const portablePath = z
  .string()
  .min(1)
  .max(32768)
  .refine(
    (value) => (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) && !value.includes('\0'),
    'Use an absolute local path.',
  );
