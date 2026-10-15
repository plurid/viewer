import { z } from 'zod';
import { reservedEnvironment } from './process-environment';
const processString = z
  .string()
  .max(32768)
  .refine((value) => !value.includes('\0'), 'Process arguments cannot contain a null character.');
export const terminalProfileSchema = z
  .object({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(100),
    executable: processString,
    args: z.array(processString).max(100),
    env: z
      .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), processString)
      .refine(
        (env) => !Object.keys(env).some(reservedEnvironment),
        'Reserved process environment variable.',
      ),
  })
  .strict();
export const customActionSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-zA-Z0-9._-]+$/)
      .max(200),
    name: z.string().min(1).max(100),
    aliases: z.array(z.string().max(100)).max(30).default([]),
    icon: z.string().max(100).default('command'),
    shortcut: z.string().max(80).default(''),
    order: z.number().int().default(0),
    pinned: z.boolean().default(false),
    when: z
      .object({
        target: z.enum(['any', 'files', 'folders', 'background']).default('any'),
        extensions: z.array(z.string().max(30)).max(100).default([]),
        min: z.number().int().min(0).max(10000).default(0),
        max: z.number().int().min(0).max(10000).default(10000),
      })
      .strict()
      .default({ target: 'any', extensions: [], min: 0, max: 10000 }),
    executor: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('builtin'), command: z.string().min(1).max(200) }).strict(),
      z.object({ kind: z.literal('recipe'), recipeID: z.string().min(1).max(200) }).strict(),
      z.object({ kind: z.literal('terminal'), profileID: z.string().min(1).max(200) }).strict(),
      z
        .object({
          kind: z.literal('executable'),
          executable: processString.refine((value) => value.length > 0),
          args: z.array(processString).max(100),
          perItem: z.boolean().default(false),
        })
        .strict(),
      z
        .object({
          kind: z.literal('shell'),
          executable: processString.refine((value) => value.length > 0),
          script: z
            .string()
            .min(1)
            .max(16000)
            .refine((value) => !value.includes('\0')),
          perItem: z.boolean().default(false),
        })
        .strict(),
    ]),
  })
  .strict()
  .refine((action) => action.when.min <= action.when.max, 'Selection minimum exceeds maximum.');
export const folderOverrideSchema = z
  .object({
    mode: z.enum(['list', 'grid', 'columns', 'gallery']).optional(),
    sort: z.enum(['name', 'modified', 'created', 'size', 'kind', 'extension']).optional(),
    descending: z.boolean().optional(),
    showHidden: z.boolean().optional(),
    density: z.enum(['comfortable', 'compact']).optional(),
    foldersFirst: z.boolean().optional(),
    group: z.enum(['none', 'kind', 'modified']).optional(),
    columnWidth: z.number().int().min(160).max(1600).optional(),
    list: z
      .object({
        visible: z
          .object({
            modified: z.boolean().optional(),
            created: z.boolean().optional(),
            kind: z.boolean().optional(),
            extension: z.boolean().optional(),
            size: z.boolean().optional(),
          })
          .strict()
          .optional(),
        widths: z
          .object({
            name: z.number().min(0).max(1600),
            modified: z.number().min(60).max(600),
            created: z.number().min(60).max(600),
            kind: z.number().min(60).max(600),
            extension: z.number().min(60).max(600),
            size: z.number().min(60).max(600),
          })
          .partial()
          .strict()
          .optional(),
        wrapNames: z.boolean().optional(),
        order: z
          .array(z.enum(['name', 'modified', 'created', 'kind', 'extension', 'size']))
          .max(6)
          .refine((items) => items[0] === 'name' && new Set(items).size === items.length)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
