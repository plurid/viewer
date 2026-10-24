import { z } from 'zod';
import { defaultKeymap, validKeymapKey, type KeymapBinding } from '../domain/keymap';
import { validShortcut } from '../domain/shortcuts';

/** A command id as commands name themselves: `palette`, `setting.ui.space.grid=false`, `custom.zip`. */
const commandID = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:=@/-]+$/);
const key = z.string().max(40).refine(validKeymapKey, 'Not a key a binding can name.');
/** A binding: a command, up to 20 commands in order, or a chord, at most four keys deep. */
const binding = (depth: number): z.ZodType<KeymapBinding> =>
  depth > 4
    ? z.never()
    : z.union([
        commandID,
        z.array(commandID).min(1).max(20),
        z.lazy(() =>
          z.record(key, binding(depth + 1)).refine((map) => Object.keys(map).length <= 100),
        ),
      ]);
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
    bindings: z
      .record(key, binding(1))
      .refine((map) => Object.keys(map).length <= 200)
      .default(() => structuredClone(defaultKeymap.bindings) as Record<string, KeymapBinding>),
  })
  .strict()
  .default(() => structuredClone(defaultKeymap));
