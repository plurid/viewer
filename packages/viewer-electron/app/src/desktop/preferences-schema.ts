import { z } from 'zod';
const localPath = z
  .string()
  .max(32768)
  .refine(
    (value) => (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) && !value.includes('\0'),
  );
const sections = z.enum(['locations', 'favorites', 'recents']);
const fields = z.enum(['name', 'modified', 'created', 'kind', 'extension', 'size']);
const boolean = z.boolean();
export const preferencesSchema = z
  .object({
    version: z.literal(3),
    sidebar: z
      .object({
        visible: boolean,
        inNewPlanes: boolean,
        width: z.number().int().min(160).max(360),
        order: z
          .array(sections)
          .length(3)
          .refine((items) => new Set(items).size === 3),
        collapsed: z.array(sections).max(3),
        locations: z.array(localPath).max(200),
        hidden: z.array(localPath).max(200),
        labels: z.record(localPath, z.string().min(1).max(200)),
      })
      .strict(),
    space: z
      .object({
        toolbar: boolean,
        minimap: boolean,
        viewcube: boolean,
        origin: boolean,
        planeHeaders: boolean,
        dragging: boolean,
        resizing: boolean,
        opening: z.enum(['face-on', 'pair', 'dock']),
        headerControls: z
          .object({
            parent: boolean.default(true),
            sidebar: boolean,
            back: boolean,
            forward: boolean,
            view: boolean,
            search: boolean,
            frame: boolean,
            dock: boolean,
            actions: boolean,
            close: boolean,
          })
          .strict(),
      })
      .strict(),
    list: z
      .object({
        visible: z
          .object({
            modified: boolean,
            created: boolean,
            kind: boolean,
            extension: boolean,
            size: boolean,
          })
          .strict(),
        widths: z
          .object({
            name: z.number().min(0).max(1600),
            modified: z.number().min(60).max(600),
            created: z.number().min(60).max(600),
            kind: z.number().min(60).max(600),
            extension: z.number().min(60).max(600),
            size: z.number().min(60).max(600),
          })
          .strict(),
        wrapNames: boolean,
        order: z
          .array(fields)
          .max(6)
          .refine((items) => items[0] === 'name' && new Set(items).size === items.length)
          .optional(),
      })
      .strict(),
    recentCommands: z.array(z.string().max(200)).max(30),
  })
  .strict();
