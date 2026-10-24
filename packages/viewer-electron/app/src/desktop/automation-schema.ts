import { z } from 'zod';
import { reservedEnvironment } from './process-environment';
import { lineSchema } from './keymap-schema';
import { parseCommandLine } from '../domain/command-line/verbs';
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
      z
        .object({
          kind: z.literal('sequence'),
          commands: z
            .array(
              // a line (2026-10-23): a command id as before, or `vs ~/Documents | set grid!`
              lineSchema.refine(
                // a sequence runs built-in commands and verbs, not another custom action or
                // a person's named command, so none runs itself
                (line) => {
                  try {
                    return parseCommandLine(line).every(
                      (step) => !step.name.startsWith('custom.') && !/^[A-Z]/.test(step.name),
                    );
                  } catch {
                    return true;
                  }
                },
                'A sequence cannot run a custom action.',
              ),
            )
            .min(1)
            .max(50),
          // the name it runs by on the command line, capitalised as vim's :command requires
          command: z
            .string()
            .regex(
              /^[A-Z][A-Za-z0-9]{0,30}$/,
              'A command’s name starts with a capital: Dev, OpenDocs.',
            )
            .optional(),
        })
        .strict(),
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
// One definition, shared with portable project files.
export { folderOverrideSchema } from '../domain/project';
