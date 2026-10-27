import { z } from 'zod';

/** Stable catalog IDs, including missing extensions, survive upgrades without retargeting. */
export const toolbarsSchema = z
  .record(
    z.string().regex(/^[a-z0-9:-]{1,100}$/),
    z
      .array(z.string().min(1).max(200))
      .max(8)
      .refine((ids) => new Set(ids).size === ids.length),
  )
  .refine((value) => Object.keys(value).length <= 64)
  .default({});
export type Toolbars = z.infer<typeof toolbarsSchema>;
export const defaultToolbar: Readonly<Record<string, readonly string[]>> = {
  folder: ['new-folder'],
  'preview:image': ['image-tools', 'optimize-files'],
  'preview:pdf': ['pdf-tools'],
  'preview:text': ['edit-file'],
  scratch: ['save-file'],
};
export const toolbarCommands = (toolbars: Toolbars, kind: string): readonly string[] =>
  toolbars[kind] ?? defaultToolbar[kind] ?? [];
export function moveToolbarCommand(
  ids: readonly string[],
  command: string,
  delta: -1 | 1,
): string[] {
  const index = ids.indexOf(command),
    target = index + delta;
  if (index < 0 || target < 0 || target >= ids.length) return [...ids];
  const next = [...ids];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
