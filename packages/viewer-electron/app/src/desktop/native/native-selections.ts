import path from 'node:path';
import { FileAccessRequired } from '../files/file-access';
import { containsPath } from '../files/containment';

type Source = 'clipboard' | 'drag';
type Selection = { source: Source; version: number; revision: number; board?: Board };
type Board = { version?: number; roots: Set<string>; bytes: number; all: boolean };

/** Revocation applies to the current native selection. Background rereads must
 * not restore it; a new OS copy/drag or explicit picker grant can authorize again. */
export class NativeSelections {
  private revision = 0;
  private boards = new Map<Source, Board>();
  constructor(private version: (source: Source) => number) {}

  revoke(file: string): void {
    const root = path.resolve(file);
    this.revision++;
    for (const source of ['clipboard', 'drag'] as const) {
      let version: number | undefined;
      try {
        const value = this.version(source);
        if (Number.isSafeInteger(value) && value >= 0) version = value;
      } catch {
        // A failed metadata query cannot silently restore a revoked capability.
      }
      let board = this.boards.get(source);
      if (
        !board ||
        (board.version !== undefined && version !== undefined && board.version !== version)
      ) {
        board = { version, roots: new Set(), bytes: 0, all: false };
        this.boards.set(source, board);
      } else if (version === undefined) board.version = undefined;
      if (board.all || [...board.roots].some((parent) => containsPath(parent, root))) continue;
      for (const previous of board.roots)
        if (containsPath(root, previous)) {
          board.roots.delete(previous);
          board.bytes -= Buffer.byteLength(previous);
        }
      board.roots.add(root);
      board.bytes += Buffer.byteLength(root);
      if (board.roots.size > 10000 || board.bytes > 16 * 1024 * 1024) {
        board.roots.clear();
        board.bytes = 0;
        board.all = true;
      }
    }
  }

  capture(source: Source, version: number): Selection {
    if (!Number.isSafeInteger(version) || version < 0)
      throw new Error('The native selection version is unavailable.');
    const board = this.boards.get(source);
    if (board?.version !== undefined && board.version !== version) {
      this.boards.delete(source);
      return { source, version, revision: this.revision };
    }
    // Keep the old board's deny set with an in-flight read even if a later read
    // observes a new native copy/drag and replaces the current board.
    return { source, version, revision: this.revision, board };
  }

  assertImport(files: readonly string[], selection: Selection): void {
    if (!files.length) return;
    const board = selection.board;
    const denied = files.find((file) => {
      const normalized = path.resolve(file);
      return board?.all || [...(board?.roots ?? [])].some((root) => containsPath(root, normalized));
    });
    if (selection.revision !== this.revision || denied)
      throw new FileAccessRequired(denied ?? files[0] ?? '');
  }
}
