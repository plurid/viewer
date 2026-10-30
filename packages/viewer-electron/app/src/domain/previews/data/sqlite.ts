/** Read-only SQLite previews: what a renderer may ask of a granted database file and the
 * bounded answers it receives. Nothing here runs SQL; the desktop reader does. */
import { z } from 'zod';

export const sqliteLimits = {
  /** Larger files are not opened. */
  fileBytes: 2_000_000_000,
  /** Tables and views listed. */
  objects: 500,
  /** Columns listed per table and read into a page. */
  columns: 100,
  /** Rows in one page. */
  pageRows: 200,
  /** The furthest row a page can start after: skipping rows costs a step each. */
  offset: 10_000_000,
  /** Rows counted per table; a larger table shows this as a lower bound. */
  countRows: 100_000,
  /** Milliseconds a listing spends counting rows before it leaves the rest uncounted. */
  countMilliseconds: 1500,
  /** Text up to this many stored bytes is read and shortened; longer text shows its size. */
  textBytes: 256 * 1024,
  /** Characters kept from each text value. */
  textCharacters: 500,
  /** Characters of text one page carries; a page ends early rather than exceed them. */
  pageCharacters: 1_000_000,
  /** Characters kept from each stored CREATE statement. */
  definitionCharacters: 4000,
  /** Longest table name a request may carry. */
  nameCharacters: 1024,
} as const;

/** A name the reader can quote: SQL text ends at a NUL, so such a name is never read. */
export function sqliteReadableName(name: string): boolean {
  return name.length > 0 && name.length <= sqliteLimits.nameCharacters && !name.includes('\0');
}

export const sqliteRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tables') }).strict(),
  z
    .object({
      kind: z.literal('rows'),
      table: z.string().refine(sqliteReadableName),
      offset: z.number().int().min(0).max(sqliteLimits.offset),
      limit: z.number().int().min(1).max(sqliteLimits.pageRows),
    })
    .strict(),
]);
export type SQLiteRequest = z.infer<typeof sqliteRequestSchema>;
export type SQLiteRowsRequest = Extract<SQLiteRequest, { kind: 'rows' }>;

export const sqliteObjectKinds = ['table', 'virtual', 'view'] as const;
export type SQLiteObjectKind = (typeof sqliteObjectKinds)[number];
/** A virtual generated column is computed from SQL stored in the file, so it is never read. */
export type SQLiteGenerated = 'virtual' | 'stored';
/** Why a table's rows were not counted. */
export type SQLiteUncounted = 'view' | 'time' | 'unreadable';
export type SQLiteUnreadableReason = 'not-sqlite' | 'too-large' | 'damaged';

export interface SQLiteColumn {
  name: string;
  /** The declared type as written; SQLite stores any value in any column. */
  type: string;
  notNull: boolean;
  /** The column's position in the primary key, from 1, or 0. */
  primaryKey: number;
  /** The default value's expression as written. */
  defaultValue?: string;
  generated?: SQLiteGenerated;
}

export type SQLiteRowCount =
  | { kind: 'exact'; rows: number }
  | {
      kind: 'at-least';
      rows: number;
      /** The row count ANALYZE saved in the file, when it exceeds the counted rows. */
      estimate?: number;
    }
  | { kind: 'not-counted'; reason: SQLiteUncounted };

export interface SQLiteObject {
  name: string;
  kind: SQLiteObjectKind;
  /** The first columns, up to `sqliteLimits.columns`. */
  columns: SQLiteColumn[];
  columnCount: number;
  count: SQLiteRowCount;
  /** The stored CREATE statement, shortened to `sqliteLimits.definitionCharacters`. */
  definition: string;
  /** Why the rows cannot be read, when they cannot. */
  problem?: string;
}

export type SQLiteCell =
  | { kind: 'null' }
  | { kind: 'integer'; text: string }
  | { kind: 'real'; text: string }
  | {
      kind: 'text';
      text: string;
      /** Present when the value was shortened: its stored size. Text too long to read has no
       * text at all. */
      bytes?: number;
    }
  | { kind: 'blob'; bytes: number }
  | { kind: 'generated' };

export interface SQLiteTables {
  kind: 'tables';
  /** The file's size and modification time when it was read. */
  version: string;
  objects: SQLiteObject[];
  /** More tables and views exist than the listing carries. */
  limited: boolean;
  /** The database uses a write-ahead log, whose changes the preview does not read. */
  wal: boolean;
}

export interface SQLiteRows {
  kind: 'rows';
  version: string;
  table: string;
  /** The names of the columns each row carries, up to `sqliteLimits.columns`. */
  columns: string[];
  columnCount: number;
  offset: number;
  rows: SQLiteCell[][];
  /** Rows follow this page. */
  more: boolean;
}

export interface SQLiteUnreadable {
  kind: 'unreadable';
  reason: SQLiteUnreadableReason;
  message: string;
}

export type SQLiteReply = SQLiteTables | SQLiteRows | SQLiteUnreadable;

export type SQLiteHeader =
  { kind: 'database'; wal: boolean } | { kind: 'damaged' } | { kind: 'other' };

const magic = 'SQLite format 3\0';

/** Reads the 100-byte database header. Encrypted databases have none, so they read as other. */
export function sqliteHeader(bytes: Uint8Array): SQLiteHeader {
  if (bytes.length < 100) return { kind: 'other' };
  for (let index = 0; index < magic.length; index++)
    if (bytes[index] !== magic.charCodeAt(index)) return { kind: 'other' };
  // A power of two from 512 to 32768, or 1 for 65536.
  const pageSize = (bytes[16]! << 8) | bytes[17]!;
  const power = pageSize >= 512 && pageSize <= 32768 && (pageSize & (pageSize - 1)) === 0;
  if (pageSize !== 1 && !power) return { kind: 'damaged' };
  // File format versions: 1 is a rollback journal, 2 a write-ahead log.
  return { kind: 'database', wal: bytes[18] === 2 || bytes[19] === 2 };
}

/** How a bounded value reads in a table cell. */
export function sqliteCellText(cell: SQLiteCell): string {
  switch (cell.kind) {
    case 'null':
      return 'NULL';
    case 'integer':
    case 'real':
      return cell.text;
    case 'text':
      if (cell.bytes === undefined) return cell.text;
      return cell.text ? cell.text + '…' : `<text ${cell.bytes} bytes>`;
    case 'blob':
      return `<blob ${cell.bytes} bytes>`;
    case 'generated':
      return '<generated>';
  }
}
