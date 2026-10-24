import type { FileEntry } from '../contracts';
export interface ComparisonRow {
  path: string;
  left?: FileEntry;
  right?: FileEntry;
  leftHash?: string;
  rightHash?: string;
  status: 'left-only' | 'right-only' | 'different' | 'same' | 'same-metadata' | 'unknown';
  reason?: string;
}
export interface ComparisonResult {
  id: string;
  left: string;
  right: string;
  rows: ComparisonRow[];
  coverage: 'complete' | 'partial';
  hashes: boolean;
  errors: { path: string; message: string }[];
  created: number;
}
export type ComparisonRequest =
  | { kind: 'run'; id: string; left: string; right: string; hashes: boolean }
  | { kind: 'cancel'; id: string };
/** Metadata agreement is explicitly weaker than verified equal content. */
export function compareEntries(
  left?: FileEntry,
  right?: FileEntry,
  leftHash?: string,
  rightHash?: string,
): ComparisonRow['status'] {
  if (
    left?.error ||
    right?.error ||
    (left && ['other', 'symlink'].includes(left.kind)) ||
    (right && ['other', 'symlink'].includes(right.kind))
  )
    return 'unknown';
  if (!left) return 'right-only';
  if (!right) return 'left-only';
  if (left.kind !== right.kind) return 'different';
  if (left.kind === 'directory') return 'same-metadata';
  if (leftHash && rightHash) return leftHash === rightHash ? 'same' : 'different';
  if (left.size !== right.size || left.modified !== right.modified) return 'different';
  return 'same-metadata';
}
