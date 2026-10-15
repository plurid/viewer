import path from 'node:path';
import { z } from 'zod';

/** An absolute path on this platform, without NUL characters. */
export const localPath = z
  .string()
  .min(1)
  .max(32768)
  .refine((value) => path.isAbsolute(value) && !value.includes('\0'));
/** Identifiers of workspaces, panes, clients and the like. */
export const id = z.string().min(1).max(200);
