import { z } from 'zod';

/** What the bundled Office engine lays out, by the application that edits each format. */
export const officeFamilies = {
  doc: 'word',
  docx: 'word',
  docm: 'word',
  dot: 'word',
  dotx: 'word',
  dotm: 'word',
  odt: 'word',
  fodt: 'word',
  ott: 'word',
  rtf: 'word',
  xls: 'workbook',
  xlsx: 'workbook',
  xlsm: 'workbook',
  xlt: 'workbook',
  xltx: 'workbook',
  xltm: 'workbook',
  ods: 'workbook',
  fods: 'workbook',
  ots: 'workbook',
  ppt: 'presentation',
  pptx: 'presentation',
  pptm: 'presentation',
  pps: 'presentation',
  ppsx: 'presentation',
  pot: 'presentation',
  potx: 'presentation',
  potm: 'presentation',
  odp: 'presentation',
  fodp: 'presentation',
  otp: 'presentation',
  odg: 'drawing',
  fodg: 'drawing',
  // the engine imports these into its drawing application; its Visio import fails on most files
  pub: 'drawing',
  emf: 'drawing',
  wmf: 'drawing',
} as const;
export type OfficeFormat = keyof typeof officeFamilies;
export type OfficeFamily = (typeof officeFamilies)[OfficeFormat];
export const officeFormats = Object.keys(officeFamilies) as OfficeFormat[];
export function isOfficeFormat(value: string): value is OfficeFormat {
  return Object.hasOwn(officeFamilies, value);
}
export function officeFamily(extension: string): OfficeFamily | undefined {
  const format = extension.toLowerCase();
  return isOfficeFormat(format) ? officeFamilies[format] : undefined;
}
/** Extensions another format shares: `.pub` names Publisher documents and public keys. One written
 * as text is no Office document. */
export const sharedOfficeExtensions: readonly string[] = ['pub'];

/**
 * The picture of its first page an OpenDocument package carries: a PNG, at most 256 pixels a side
 * by the format's convention. Flat XML documents carry none.
 */
export const openDocumentThumbnail = {
  name: 'Thumbnails/thumbnail.png',
  bytes: 512 * 1024,
  side: 1024,
} as const;
const openDocumentPackages: readonly OfficeFormat[] = [
  'odt',
  'ods',
  'odp',
  'odg',
  'ott',
  'ots',
  'otp',
];
export function carriesThumbnail(extension: string): boolean {
  const format = extension.toLowerCase();
  return isOfficeFormat(format) && openDocumentPackages.includes(format);
}

/**
 * The Word and Excel packages Viewer reads itself, for the Reading and Sheet views and search, with
 * the content type each declares for its main part. Macro and template variants are the same
 * packages: their macros are never read.
 */
export const officeContentTypes = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  docm: 'application/vnd.ms-word.document.macroEnabled.main+xml',
  dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml',
  dotm: 'application/vnd.ms-word.template.macroEnabledTemplate.main+xml',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
  xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml',
  xltm: 'application/vnd.ms-excel.template.macroEnabled.main+xml',
} as const;
export type OfficeContentFormat = keyof typeof officeContentTypes;
export function readsOfficeContent(extension: string): extension is OfficeContentFormat {
  return Object.hasOwn(officeContentTypes, extension.toLowerCase());
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
