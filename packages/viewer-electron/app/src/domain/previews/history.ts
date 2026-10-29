import { z } from 'zod';
import { previewValuesSchema, type JSONValue } from '../workspaces/project';
const utf8 = new TextEncoder();

export const fileViewSchema = z
  .object({
    path: z.string().min(1).max(32768),
    updated: z.number().finite().min(0),
    values: previewValuesSchema,
  })
  .strict()
  .refine((entry) => utf8.encode(JSON.stringify(entry)).byteLength <= 8192);
export type FileView = z.infer<typeof fileViewSchema>;
export type PreviewHistory = Record<string, FileView[]>;
export const previewHistorySchema = z
  .record(z.string().max(200), z.array(fileViewSchema).max(50))
  .refine(
    (history) =>
      Object.values(history).reduce((count, entries) => count + entries.length, 0) <= 200,
  );

const recalledKeys = new Set([
  '_sourceVersion',
  'pdf.page',
  'pdf.view',
  'pdf.sidebar',
  'djvu.page',
  'djvu.view',
  'epub.chapter',
  'epub.size',
  'epub.contents',
  'epub.bookmarks',
  'office.formatted',
  'office.mode',
  'office.sheet',
  'office.rows',
  'table.views',
  'sqlite.table',
  'sqlite.view',
  'sqlite.offset',
  'text.source',
  'text.scale',
  'text.wrap',
  'image.zoom',
  'image.pan',
  'media.position',
  'model.camera',
  'model.appearance',
  'model.wire',
  'model.unit',
  'dxf.view',
  'dxf.units',
  'dxf.grid',
  'dxf.snap',
  'tree.expansion',
  'tree.scroll',
  'tree.query',
]);
/** Reading markers and private notes survive a source revision; transient coordinates reset. */
export function preservePreviewValue(key: string): boolean {
  return key.startsWith('notes.') || key === 'epub.bookmarks';
}

/** Reading markers, positions and presentation. Private edits and capabilities stay with their owners. */
export function fileViewValues(values: Record<string, JSONValue>): Record<string, JSONValue> {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([key]) => recalledKeys.has(key) || /^scroll\.[a-z-]+$/.test(key),
    ),
  );
}

export function rememberFileView(
  history: PreviewHistory | undefined,
  owner: string,
  path: string,
  values: Record<string, JSONValue>,
): PreviewHistory {
  const entry = fileViewSchema.safeParse({
    path,
    values: fileViewValues(values),
    updated: Date.now(),
  });
  if (!entry.success) return history ?? {};
  const next = {
    ...history,
    [owner]: [entry.data, ...(history?.[owner] ?? []).filter((item) => item.path !== path)].slice(
      0,
      50,
    ),
  };
  return boundPreviewHistory(next);
}

export function boundPreviewHistory(
  history: PreviewHistory,
  owners?: ReadonlySet<string>,
): PreviewHistory {
  const entries = Object.entries(history)
    .flatMap(([owner, values]) =>
      owners && !owners.has(owner) ? [] : values.map((entry) => ({ owner, entry })),
    )
    .sort((left, right) => right.entry.updated - left.entry.updated)
    .slice(0, 200);
  const result: PreviewHistory = {};
  for (const { owner, entry } of entries) {
    const list = (result[owner] ??= []);
    if (list.length < 50 && !list.some((item) => item.path === entry.path)) list.push(entry);
  }
  return result;
}
