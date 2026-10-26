import { z } from 'zod';

export const officeFamilies = {
  doc: 'word',
  docx: 'word',
  xls: 'workbook',
  xlsx: 'workbook',
  ppt: 'presentation',
  pptx: 'presentation',
} as const;
export type OfficeFormat = keyof typeof officeFamilies;
export const officeFormats = Object.keys(officeFamilies) as OfficeFormat[];
export function isOfficeFormat(value: string): value is OfficeFormat {
  return Object.hasOwn(officeFamilies, value);
}
export const officeLayoutRequestSchema = z
  .object({
    requestID: z.string().min(1).max(200),
    sheet: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => !value.includes('\0'))
      .optional(),
  })
  .strict();
export type OfficeLayoutRequest = z.infer<typeof officeLayoutRequestSchema>;
export const officeLayoutMetadataSchema = z
  .object({
    sheets: z.array(z.object({ name: z.string().max(200), hidden: z.boolean() }).strict()).max(256),
    selectedSheet: z.string().max(200).optional(),
    limited: z.boolean(),
  })
  .strict();
export type OfficeLayoutMetadata = z.infer<typeof officeLayoutMetadataSchema>;
