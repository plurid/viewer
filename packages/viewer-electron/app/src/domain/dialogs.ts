import { z } from 'zod';
import type { FolderListing } from './contracts';

export interface DialogPlace {
  name: string;
  path: string;
  group: 'Locations' | 'Favorites' | 'Recent';
}
export interface FileDialogPrompt {
  id: string;
  kind: 'file';
  mode: 'open' | 'save';
  title: string;
  message?: string;
  buttonLabel: string;
  directory: boolean;
  files: boolean;
  multiple: boolean;
  hidden: boolean;
  folder: string;
  separator: string;
  name: string;
  filters: { name: string; extensions: string[] }[];
  places: DialogPlace[];
}
export interface MessageDialogPrompt {
  id: string;
  kind: 'message';
  title: string;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
  destructiveId?: number;
}
export type DialogPrompt = FileDialogPrompt | MessageDialogPrompt;

const localPath = z
  .string()
  .min(1)
  .max(32768)
  .refine((value) => !value.includes('\0'));
export const dialogRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('current') }).strict(),
  z.object({ kind: z.literal('browse'), id: z.uuid(), path: localPath }).strict(),
  z
    .object({
      kind: z.literal('new-folder'),
      id: z.uuid(),
      parent: localPath,
      name: z.string().min(1).max(255),
    })
    .strict(),
  z
    .object({
      kind: z.literal('choose'),
      id: z.uuid(),
      paths: z.array(localPath).min(1).max(10000),
      replace: z.boolean().optional(),
    })
    .strict(),
  z
    .object({ kind: z.literal('answer'), id: z.uuid(), button: z.number().int().min(0).max(20) })
    .strict(),
  z.object({ kind: z.literal('cancel'), id: z.uuid() }).strict(),
  z.object({ kind: z.literal('system'), id: z.uuid() }).strict(),
]);
export type DialogRequest = z.infer<typeof dialogRequestSchema>;
export interface DialogReply {
  prompt?: DialogPrompt | null;
  listing?: FolderListing;
  conflict?: string;
}

export function matchesDialogFilter(name: string, extensions: readonly string[]): boolean {
  return (
    !extensions.length ||
    extensions.includes('*') ||
    extensions.some((extension) => name.toLowerCase().endsWith('.' + extension.toLowerCase()))
  );
}
