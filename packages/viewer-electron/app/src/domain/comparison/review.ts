import { z } from 'zod';
import { gitRelativePath } from './git';
import type { CapturedTarget } from '../automation/actions';

export const reviewModes = ['unstaged', 'staged', 'branch'] as const;
export type ReviewMode = (typeof reviewModes)[number];
export const reviewStateSchema = z
  .object({
    mode: z.enum(reviewModes),
    baseCommit: z
      .string()
      .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/)
      .optional(),
    baseName: z.string().max(300).optional(),
    selectedPath: z.string().refine(gitRelativePath).optional(),
  })
  .strict();
export type ReviewState = z.infer<typeof reviewStateSchema>;
export interface ReviewBranch {
  id: string;
  name: string;
  commit: string;
}
export interface ReviewFileEntry {
  id: string;
  path: string;
  status: string;
  untracked?: boolean;
}
export interface ReviewSnapshot {
  id: string;
  mode: ReviewMode;
  root: string;
  branch: string;
  head?: string;
  baseCommit?: string;
  files: ReviewFileEntry[];
}
export interface ReviewHunk {
  id: string;
  heading: string;
  lines: string[];
}
export interface ReviewFile {
  id: string;
  snapshotID: string;
  path: string;
  hunks: ReviewHunk[];
  problem?: string;
}
export type GitReviewRequest =
  | { kind: 'open'; target: CapturedTarget }
  | { kind: 'read'; reviewID: string; mode: ReviewMode; baseID?: string; baseCommit?: string }
  | { kind: 'file'; reviewID: string; snapshotID: string; fileID: string }
  | { kind: 'apply'; reviewID: string; fileID: string; hunks: string[] }
  | { kind: 'release'; reviewID: string };
export type GitReviewReply =
  | { kind: 'opened'; reviewID: string; branches: ReviewBranch[]; defaultBaseID?: string }
  | { kind: 'snapshot'; snapshot: ReviewSnapshot }
  | { kind: 'file'; file: ReviewFile }
  | { kind: 'applied' }
  | { kind: 'released' };

export interface ParsedPatch {
  header: string;
  hunks: { heading: string; lines: string[]; patch: string }[];
}
/** Keep Git's quoted paths and no-newline markers literal; no renderer supplies patch bytes. */
export function parseReviewPatch(patch: string): ParsedPatch {
  if (patch.length > 4 * 1024 * 1024 || patch.includes('\0'))
    throw new Error('The patch exceeds the text review limit.');
  const lines = patch.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const starts = lines.flatMap((line, index) =>
    /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(line) ? [index] : [],
  );
  if (starts.length > 2000) throw new Error('The file exceeds the 2,000-hunk review limit.');
  return {
    header: lines.slice(0, starts[0] ?? lines.length).join(''),
    hunks: starts.map((start, index) => {
      const end = starts[index + 1] ?? lines.length;
      return {
        heading: lines[start]!.trimEnd(),
        lines: lines.slice(start + 1, end).map((line) => line.replace(/\n$/, '')),
        patch: lines.slice(start, end).join(''),
      };
    }),
  };
}
