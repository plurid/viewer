import { z } from 'zod';
import type { SavedState } from '../contracts';
import type { SettingsSnapshot } from '../services';

export const backupRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('prepare-export') }).strict(),
  z.object({ kind: z.literal('choose-import') }).strict(),
  z.object({ kind: z.literal('write'), id: z.uuid() }).strict(),
  z
    .object({ kind: z.literal('relink'), id: z.uuid(), root: z.string().min(1).max(32768) })
    .strict(),
  z.object({ kind: z.literal('restore'), id: z.uuid(), preferences: z.boolean() }).strict(),
  z.object({ kind: z.literal('release'), id: z.uuid() }).strict(),
]);
export type BackupRequest = z.infer<typeof backupRequestSchema>;
export interface BackupReview {
  id: string;
  mode: 'export' | 'import';
  created: string;
  bytes: number;
  workspaces: string[];
  documents: {
    notes: number;
    drafts: number;
    media: number;
    conversations: number;
    receipts: number;
  };
  roots: { source: string; destination?: string }[];
  warnings: string[];
}
export type BackupReply =
  | { kind: 'review'; review: BackupReview }
  | { kind: 'written'; name: string }
  | { kind: 'restored'; state: SavedState; settings: SettingsSnapshot }
  | { kind: 'cancelled' };
