import { z } from 'zod';

export const canvasResultFormats = {
  csv: 'csv',
  json: 'json',
  markdown: 'md',
  text: 'txt',
} as const;
export const canvasResultSchema = z
  .object({
    format: z.enum(['csv', 'json', 'markdown', 'text']),
    name: z
      .string()
      .min(1)
      .max(200)
      .refine(
        (name) => !/[\\/\x00-\x1f]/.test(name) && !/^\.+$/.test(name),
        'Choose a filename without folders.',
      ),
    content: z
      .string()
      .refine(
        (text) => new TextEncoder().encode(text).length <= 1_000_000,
        'Keep this result within 1 MB.',
      ),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.format === 'json') {
      try {
        JSON.parse(value.content);
      } catch {
        context.addIssue({ code: 'custom', message: 'The result is not valid JSON.' });
      }
    }
  });
export type CanvasResult = z.infer<typeof canvasResultSchema>;
export const canvasResultName = (result: CanvasResult) => {
  const extension = '.' + canvasResultFormats[result.format];
  return result.name.toLowerCase().endsWith(extension) ? result.name : result.name + extension;
};
