import path from 'node:path';
import { z } from 'zod';
import type { FileEntry, FileKind } from '../domain/contracts';

/** An absolute path on this platform, without NUL characters. */
export const localPath = z
  .string()
  .min(1)
  .max(32768)
  .refine((value) => path.isAbsolute(value) && !value.includes('\0'));
/** Identifiers of workspaces, panes, clients and the like. */
export const id = z.string().min(1).max(200);

const fileKinds = ['directory', 'file', 'symlink', 'other'] as const satisfies readonly FileKind[];
/** A file entry from a renderer or a saved plan: `FileEntry`'s shape, with bounds on its text. */
export const fileEntrySchema = z.object({
  path: localPath,
  name: z.string().max(1024),
  parent: localPath,
  extension: z.string().max(255),
  kind: z.enum(fileKinds),
  directory: z.boolean(),
  size: z.number().min(0),
  modified: z.number(),
  created: z.number(),
  hidden: z.boolean(),
  mime: z.string().max(255),
  identity: z.string().max(300),
  linkTarget: z.string().max(32768).optional(),
  error: z.string().max(4000).optional(),
}) satisfies z.ZodType<FileEntry>;
