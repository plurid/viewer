import { z } from 'zod';
import { defaultKeymap, rootKey, validKeymapKey, type KeymapBinding } from '../domain/keymap';
import { lineLimits } from '../domain/command-line/lex';
import { parseCommandLine } from '../domain/command-line/verbs';
import { errorMessage } from '../domain/errors';
import { validShortcut } from '../domain/shortcuts';

/**
 * A line, as the command line runs it (2026-10-23): a command id (`palette`,
 * `setting.ui.space.grid=false`, `custom.zip`), or steps with words (`vs ~/Documents | set grid!`).
 * Its syntax is checked here; its names when it runs, where the commands are.
 */
export const lineSchema = z
  .string()
  .min(1)
  .max(lineLimits.length)
  .superRefine((text, context) => {
    try {
      if (!parseCommandLine(text).length)
        context.addIssue({ code: 'custom', message: 'An empty line.' });
    } catch (error) {
      context.addIssue({ code: 'custom', message: errorMessage(error) });
    }
  });
const key = z.string().max(40).refine(validKeymapKey, 'Not a key a binding can name.');
/** A binding: a line, up to 20 lines in order, or a chord, at most four keys deep. */
const binding = (depth: number): z.ZodType<KeymapBinding> =>
  depth > 4
    ? z.never()
    : z.union([
        lineSchema,
        z.array(lineSchema).min(1).max(20),
        z.lazy(() =>
          z.record(key, binding(depth + 1)).refine((map) => Object.keys(map).length <= 100),
        ),
      ]);
const table = (keys: z.ZodType<string> = key) =>
  z.record(keys, binding(1)).refine((map) => Object.keys(map).length <= 200);
/** `settings.keymap` (2026-10-23): the prefix, the leader and their bindings. */
export const keymapSchema = z
  .object({
    // each field defaults: `"keymap": { "prefix": "Ctrl+A" }` alone is a whole keymap, as one line
    // of .tmux.conf is (2026-10-23)
    prefix: z
      .string()
      .max(80)
      .refine((value) => !value || validShortcut(value), 'The prefix needs ⌃ or ⌘ and one key.')
      .default(defaultKeymap.prefix),
    leader: z
      .string()
      .max(40)
      .refine((value) => !value || validKeymapKey(value), 'Not a key.')
      .default(defaultKeymap.leader),
    inTerminals: z.boolean().default(defaultKeymap.inTerminals),
    inTextFields: z.boolean().default(defaultKeymap.inTextFields),
    whichKey: z.boolean().default(defaultKeymap.whichKey),
    timeout: z.number().int().min(300).max(10000).default(defaultKeymap.timeout),
    bindings: table().default(
      () => structuredClone(defaultKeymap.bindings) as Record<string, KeymapBinding>,
    ),
    // keys without the prefix: a chord, so typing is never taken (tmux's bind -n)
    root: table(
      z
        .string()
        .max(40)
        .refine(rootKey, 'A key without the prefix needs ⌃, ⌥ or ⌘, or is an F-key.'),
    ).default({}),
    repeat: z
      .array(key)
      .max(50)
      .default(() => [...defaultKeymap.repeat]),
    repeatTime: z.number().int().min(100).max(3000).default(defaultKeymap.repeatTime),
    modes: z
      .record(
        z.string().regex(/^[a-z][a-z0-9-]{0,30}$/, 'A mode’s name is lowercase: resize, panes.'),
        z.object({ bindings: table() }).strict(),
      )
      .refine((modes) => Object.keys(modes).length <= 20, 'At most 20 modes.')
      .default(() => structuredClone(defaultKeymap.modes)),
  })
  .strict()
  .default(() => structuredClone(defaultKeymap));
