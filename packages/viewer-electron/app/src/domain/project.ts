import { z } from 'zod';
import type { FolderOverride } from './folder-presentation';

const id = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._-]+$/);
const relative = z
  .string()
  .min(1)
  .max(32768)
  .refine(
    (value) =>
      !value.includes('\\') &&
      !value.includes('\0') &&
      !value.startsWith('/') &&
      !/^[A-Za-z]:/.test(value) &&
      value.split('/').every((part) => part !== '..'),
    'Use a relative path inside the project or a named external binding.',
  );
export const projectPathSchema = z.object({ path: relative, binding: id.optional() }).strict();
export type ProjectPath = z.infer<typeof projectPathSchema>;
const finite = z.number().finite().min(-1e8).max(1e8);
export const planePlacementSchema = z
  .object({
    id,
    parent: id.optional(),
    location: z
      .object({
        translateX: finite,
        translateY: finite,
        translateZ: finite,
        rotateX: finite,
        rotateY: finite,
      })
      .strict(),
    width: z.number().finite().min(100).max(16000),
    height: z.number().finite().min(100).max(16000),
    show: z.boolean(),
    bridge: z
      .object({
        length: finite.optional(),
        side: z.enum(['start', 'end']).optional(),
        offset: finite.optional(),
        angle: finite.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type PlanePlacement = z.infer<typeof planePlacementSchema>;
export const layoutSchema = z
  .object({
    placements: z.array(planePlacementSchema).max(200),
    active: id.optional(),
    docked: id.optional(),
  })
  .strict()
  .superRefine((layout, context) => {
    const ids = new Set(layout.placements.map((plane) => plane.id));
    if (ids.size !== layout.placements.length)
      context.addIssue({ code: 'custom', message: 'Layout plane IDs must be unique.' });
    for (const plane of layout.placements) {
      const seen = new Set([plane.id]);
      let parent = plane.parent;
      while (parent) {
        if (!ids.has(parent) || seen.has(parent)) {
          context.addIssue({
            code: 'custom',
            message: 'Layout parents must exist without cycles.',
          });
          break;
        }
        seen.add(parent);
        parent = layout.placements.find((item) => item.id === parent)?.parent;
      }
    }
    for (const target of [layout.active, layout.docked])
      if (target && !ids.has(target))
        context.addIssue({ code: 'custom', message: 'The layout target is missing.' });
  });
export type ProjectLayout = z.infer<typeof layoutSchema>;

/** JSON-only view state; DOM nodes, decoded buffers and GPU objects never persist. */
export type JSONValue =
  null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };
export const jsonValueSchema: z.ZodType<JSONValue> = z
  .lazy(() =>
    z.union([
      z.null(),
      z.boolean(),
      z.number().finite(),
      z.string().max(100000),
      z.array(jsonValueSchema).max(5000),
      z.record(z.string().max(200), jsonValueSchema),
    ]),
  )
  .refine((value) => JSON.stringify(value).length <= 256000, 'View state exceeds its size limit.');
export const previewValuesSchema = z
  .record(z.string().max(200), jsonValueSchema)
  .refine((value) => JSON.stringify(value).length <= 256000);

// Shared presentation validation lives in the domain, including partial list fields.
export const folderOverrideSchema = z
  .object({
    mode: z.enum(['list', 'grid', 'columns', 'gallery', 'map']).optional(),
    sort: z.enum(['name', 'modified', 'created', 'size', 'kind', 'extension']).optional(),
    descending: z.boolean().optional(),
    showHidden: z.boolean().optional(),
    density: z.enum(['comfortable', 'compact']).optional(),
    foldersFirst: z.boolean().optional(),
    group: z.enum(['none', 'kind', 'modified', 'lens']).optional(),
    /** The lens grouping this folder when `group` is `lens`. */
    lens: z.uuid().optional(),
    columnWidth: z.number().int().min(160).max(1600).optional(),
    list: z
      .object({
        visible: z
          .object({
            modified: z.boolean(),
            created: z.boolean(),
            kind: z.boolean(),
            extension: z.boolean(),
            size: z.boolean(),
            git: z.boolean(),
          })
          .partial()
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
            git: z.number().min(60).max(600),
          })
          .partial()
          .strict()
          .optional(),
        wrapNames: z.boolean().optional(),
        order: z
          .array(z.enum(['name', 'modified', 'created', 'kind', 'extension', 'size', 'git']))
          .max(7)
          .refine((items) => items[0] === 'name' && new Set(items).size === items.length)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const planeBase = { id, target: projectPathSchema, state: previewValuesSchema.optional() };
const portableDiffSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file'), target: projectPathSchema }).strict(),
  z
    .object({
      kind: z.literal('git'),
      target: projectPathSchema,
      commit: z.string().regex(/^[0-9a-f]{40,64}$/),
      path: z.string().min(1).max(32768),
    })
    .strict(),
  z.object({ kind: z.literal('empty'), name: z.string().max(255) }).strict(),
]);
export type PortableDiffSource = z.infer<typeof portableDiffSourceSchema>;
const projectPlaneSchema = z.discriminatedUnion('type', [
  z.object({ ...planeBase, type: z.literal('git-changes') }).strict(),
  z
    .object({
      ...planeBase,
      type: z.literal('diff'),
      left: portableDiffSourceSchema,
      right: portableDiffSourceSchema,
      mode: z.enum(['split', 'unified', 'slider', 'onion', 'side', 'difference']).optional(),
    })
    .strict(),
  z.object({ ...planeBase, type: z.literal('folder') }).strict(),
  z
    .object({ ...planeBase, type: z.literal('preview'), state: previewValuesSchema.optional() })
    .strict(),
  z
    .object({
      ...planeBase,
      type: z.literal('search'),
      query: z.string().max(300),
      name: z.string().max(100),
      recursive: z.boolean(),
      content: z.boolean(),
    })
    .strict(),
  // This is a terminal location, never shell input. Imports always require Start.
  z.object({ ...planeBase, type: z.literal('terminal'), profileID: id }).strict(),
  z.object({ ...planeBase, type: z.literal('collection'), collectionID: z.uuid() }).strict(),
]);
export const projectDefinitionSchema = z
  .object({
    version: z.literal(1),
    id,
    name: z.string().trim().min(1).max(100),
    bindings: z
      .array(z.object({ name: id, label: z.string().max(200) }).strict())
      .max(100)
      .default([]),
    planes: z.array(projectPlaneSchema).max(200),
    folders: z
      .array(z.object({ target: projectPathSchema, view: folderOverrideSchema }).strict())
      .max(2000)
      .default([]),
    layout: layoutSchema,
    arrangements: z.record(z.string().min(1).max(100), layoutSchema).default({}),
    collections: z
      .array(
        z
          .object({
            id: z.uuid(),
            name: z.string().min(1).max(100),
            kind: z.enum(['explicit', 'query', 'tag']),
            sources: z.array(projectPathSchema).min(1).max(10000),
            query: z.string().max(300).optional(),
            tag: z.string().trim().min(1).max(255).optional(),
            recursive: z.boolean().optional(),
            content: z.boolean().optional(),
          })
          .strict(),
      )
      .max(200)
      .optional(),
  })
  .strict()
  .superRefine((project, context) => {
    const ids = new Set(project.planes.map((plane) => plane.id));
    const bindings = new Set(project.bindings.map((binding) => binding.name));
    if (ids.size !== project.planes.length || bindings.size !== project.bindings.length)
      context.addIssue({
        code: 'custom',
        message: 'Project plane and binding IDs must be unique.',
      });
    for (const item of [...project.planes, ...project.folders])
      if (item.target.binding && !bindings.has(item.target.binding))
        context.addIssue({ code: 'custom', message: 'Declare every external binding by name.' });
    const collections = new Set(project.collections?.map((collection) => collection.id));
    if (collections.size !== (project.collections?.length ?? 0))
      context.addIssue({ code: 'custom', message: 'Collection IDs must be unique.' });
    for (const collection of project.collections ?? [])
      for (const target of collection.sources)
        if (target.binding && !bindings.has(target.binding))
          context.addIssue({
            code: 'custom',
            message: 'Declare every collection binding by name.',
          });
    for (const plane of project.planes)
      if (plane.type === 'collection' && !collections.has(plane.collectionID))
        context.addIssue({
          code: 'custom',
          message: 'Collection planes must reference an existing collection.',
        });
    for (const layout of [project.layout, ...Object.values(project.arrangements)])
      for (const plane of layout.placements)
        if (!ids.has(plane.id))
          context.addIssue({
            code: 'custom',
            message: 'An arrangement references an unknown plane.',
          });
  });
export type ProjectDefinition = z.infer<typeof projectDefinitionSchema>;
export interface ProjectDocument {
  file: string;
  root: string;
  revision: string;
  definition: ProjectDefinition;
}
export interface ProjectAssociation extends ProjectDocument {
  bindings: Record<string, string>;
  /** Private draft views use resolved paths; Save Project makes portable references. */
  folders: Record<string, FolderOverride>;
  dirty: boolean;
}
export type ProjectRequest =
  | { kind: 'choose'; mode: 'open' | 'create'; defaultPath?: string }
  | { kind: 'read'; file: string }
  | { kind: 'save'; file: string; revision: string; definition: ProjectDefinition };
export type ProjectReply = string | ProjectDocument | null;

/** Pure path mapping works in browser previews and on Windows as well as macOS. */
const parts = (value: string) => value.replace(/\\/g, '/').replace(/\/$/, '').split('/');
export function relativeProjectPath(root: string, file: string): string | undefined {
  const base = parts(root),
    path = parts(file);
  if (!base.every((part, index) => part === path[index])) return;
  return path.slice(base.length).join('/') || '.';
}
export function projectReference(
  root: string,
  file: string,
  bindings: Record<string, string>,
): ProjectPath {
  const local = relativeProjectPath(root, file);
  if (local !== undefined) return { path: local };
  const match = Object.entries(bindings)
    .sort((a, b) => b[1].length - a[1].length)
    .find(([, location]) => relativeProjectPath(location, file) !== undefined);
  if (!match) throw new Error('Bind the external folder before saving this project: ' + file);
  return { binding: match[0], path: relativeProjectPath(match[1], file)! };
}
export function resolveProjectPath(
  root: string,
  target: ProjectPath | undefined,
  bindings: Record<string, string>,
): string | undefined {
  // A reference to an input that is not defined resolves to nothing, like an unbound one.
  if (!target) return;
  projectPathSchema.parse(target);
  const base = target.binding
    ? Object.hasOwn(bindings, target.binding)
      ? bindings[target.binding]
      : undefined
    : root;
  if (!base) return;
  return target.path === '.' ? base : base.replace(/[\\/]$/, '') + '/' + target.path;
}
