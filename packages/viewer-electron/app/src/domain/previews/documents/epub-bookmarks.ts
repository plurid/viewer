import { z } from 'zod';

const bookmarkSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(80),
    chapter: z.number().int().min(0).max(10000),
    path: z.string().max(1024),
    top: z.number().finite().min(0).max(1e7),
    left: z.number().finite().min(0).max(1e7),
  })
  .strict();
export type EPUBBookmark = z.infer<typeof bookmarkSchema>;
const encoder = new TextEncoder();

/** Keep personal reading markers small enough to recall with the file's other view state. */
export function saveEPUBBookmark(
  bookmarks: readonly EPUBBookmark[],
  value: EPUBBookmark,
): EPUBBookmark[] {
  const bookmark = bookmarkSchema.parse(value);
  const next = [...bookmarks.filter((item) => item.id !== bookmark.id), bookmark];
  if (next.length > 32 || encoder.encode(JSON.stringify(next)).byteLength > 4096)
    throw new Error('The saved bookmarks are full. Remove a bookmark or use a shorter name.');
  return next;
}
export function readEPUBBookmarks(value: unknown): EPUBBookmark[] {
  if (!Array.isArray(value)) return [];
  let result: EPUBBookmark[] = [];
  for (const item of value.slice(0, 32)) {
    const parsed = bookmarkSchema.safeParse(item);
    if (parsed.success) {
      try {
        result = saveEPUBBookmark(result, parsed.data);
      } catch {
        break;
      }
    }
  }
  return result;
}
