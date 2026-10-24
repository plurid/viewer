import { z } from 'zod';
import { portablePath as localPath } from '../../schemas';
const sections = z.enum(['locations', 'favorites', 'recents']);
const fields = z.enum(['name', 'modified', 'created', 'kind', 'extension', 'size', 'git']);
const boolean = z.boolean();
/** A space colour; empty follows the appearance. */
const color = z.union([z.literal(''), z.string().regex(/^#[0-9a-f]{6}$/i)]);
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
    titlebar: z.object({ visible: boolean }).strict().default({ visible: true }),
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
        backdrop: z.enum(['opaque', 'blur', 'clear']).default('opaque'),
        backdropOpacity: z.number().int().min(0).max(100).default(60),
        grid: boolean.default(true),
        color: color.default(''),
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
            git: z.boolean().default(false),
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
            git: z.number().min(60).max(600).default(80),
          })
          .strict(),
        wrapNames: boolean,
        order: z
          .array(fields)
          .max(7)
          .refine((items) => items[0] === 'name' && new Set(items).size === items.length)
          .optional(),
      })
      .strict(),
    recentCommands: z.array(z.string().max(200)).max(30),
  })
  .strict();
