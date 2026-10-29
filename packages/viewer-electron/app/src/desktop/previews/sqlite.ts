/**
 * Reads SQLite databases for previews without changing them. A database opens read-only and
 * immutable, so SQLite takes no locks and neither creates nor reads its -wal, -shm or journal
 * files. Only Viewer's own statements run: names from the file are bound or quoted, and SQL the
 * file stores (views, triggers, generated columns) never executes.
 *
 * node:sqlite cannot interrupt a running statement, so each statement is bounded by rows
 * instead, and a listing stops counting at a deadline.
 */
import type { Stats } from 'node:fs';
import { constants as fileFlags } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { SQLOutputValue } from 'node:sqlite';
import { DatabaseSync, constants } from 'node:sqlite';
import { errorMessage } from '../../domain/errors';
import type {
  SQLiteCell,
  SQLiteColumn,
  SQLiteObject,
  SQLiteObjectKind,
  SQLiteReply,
  SQLiteRequest,
  SQLiteRowCount,
  SQLiteRows,
  SQLiteRowsRequest,
  SQLiteTables,
  SQLiteUnreadable,
  SQLiteUnreadableReason,
} from '../../domain/previews/data/sqlite';
import { sqliteHeader, sqliteLimits, sqliteReadableName } from '../../domain/previews/data/sqlite';

export interface SQLiteReadOptions {
  signal?: AbortSignal;
  /** Milliseconds a listing may spend counting rows. */
  countMilliseconds?: number;
}

type Row = Record<string, SQLOutputValue>;
interface StoredObject {
  type: string;
  name: string;
  sql: string;
}
interface Columns {
  listed: SQLiteColumn[];
  count: number;
}

const changed = 'The database changed while Viewer read it. Try again.';
const notSQLite = [
  'This file does not start with a SQLite header.',
  'It may be encrypted, or it may not be a SQLite database.',
].join(' ');
// SQLite's primary result codes for a damaged file and for a file that is not a database.
const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;
const SQLITE_AUTH = 23;

export async function readSQLite(
  file: string,
  request: SQLiteRequest,
  options: SQLiteReadOptions = {},
): Promise<SQLiteReply> {
  const before = await lstat(file);
  if (!before.isFile()) throw new Error('Choose a regular file to preview.');
  if (before.size > sqliteLimits.fileBytes)
    return unreadable('too-large', 'Viewer previews SQLite databases up to 2 GB.');
  const header = sqliteHeader(await readHeader(file, before));
  if (header.kind === 'other') return unreadable('not-sqlite', notSQLite);
  if (header.kind === 'damaged')
    return unreadable('damaged', 'The SQLite header of this file is damaged.');
  options.signal?.throwIfAborted();
  const version = `${before.size}:${before.mtimeMs}`;
  const budget = options.countMilliseconds ?? sqliteLimits.countMilliseconds;
  const deadline = performance.now() + budget;
  const reply = withDatabase(file, (database) => {
    switch (request.kind) {
      case 'tables':
        return listTables(database, version, header.wal, deadline);
      case 'rows':
        return readRows(database, version, request);
    }
  });
  const after = await lstat(file);
  if (!sameFile(before, after)) throw new Error(changed);
  return reply;
}

function unreadable(reason: SQLiteUnreadableReason, message: string): SQLiteUnreadable {
  return { kind: 'unreadable', reason, message };
}

async function readHeader(file: string, expected: Stats): Promise<Uint8Array> {
  const handle = await open(
    file,
    fileFlags.O_RDONLY | (fileFlags.O_NOFOLLOW || 0) | (fileFlags.O_NONBLOCK || 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || !sameFile(expected, info)) throw new Error(changed);
    const header = Buffer.alloc(100);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return header.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function sameFile(before: Stats, after: Stats): boolean {
  return (
    after.isFile() &&
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs
  );
}

/** Opens, reads and closes: a damaged or encrypted database becomes a readable reply. */
function withDatabase(file: string, read: (database: DatabaseSync) => SQLiteReply): SQLiteReply {
  let database: DatabaseSync | undefined;
  try {
    database = openReadOnly(file);
    return read(database);
  } catch (error) {
    if (!damaged(error)) throw error;
    const message = [
      'Viewer could not read this database. It may be damaged or encrypted.',
      `SQLite reported: ${errorMessage(error)}`,
    ].join(' ');
    return unreadable('damaged', message);
  } finally {
    database?.close();
  }
}

function openReadOnly(file: string): DatabaseSync {
  const location = pathToFileURL(file);
  location.searchParams.set('mode', 'ro');
  location.searchParams.set('immutable', '1');
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(location, { readOnly: true });
  } catch (error) {
    if (damaged(error)) throw error;
    throw new Error(`Viewer could not open this database. SQLite reported: ${errorMessage(error)}`);
  }
  try {
    database.setAuthorizer(authorize);
  } catch (error) {
    database.close();
    throw error;
  }
  return database;
}

// FTS5 reads `data_version` for its own statements.
const allowedPragmas = new Set(['table_xinfo', 'data_version']);

/**
 * Viewer's statements and the virtual-table modules they use may read tables, but nothing the
 * file defines runs: a statement compiled inside a view or trigger, a recursive query and an
 * attached file are refused as they compile. Writes already fail on the read-only connection.
 */
function authorize(
  action: number,
  first: string | null,
  _second: string | null,
  _database: string | null,
  inner: string | null,
): number {
  if (inner !== null) return constants.SQLITE_DENY;
  switch (action) {
    case constants.SQLITE_ATTACH:
    case constants.SQLITE_DETACH:
    case constants.SQLITE_RECURSIVE:
      return constants.SQLITE_DENY;
    case constants.SQLITE_PRAGMA:
      return first !== null && allowedPragmas.has(first)
        ? constants.SQLITE_OK
        : constants.SQLITE_DENY;
    default:
      return constants.SQLITE_OK;
  }
}

function resultCode(error: unknown): number | undefined {
  const code = (error as { errcode?: unknown } | null)?.errcode;
  return typeof code === 'number' ? code & 0xff : undefined;
}

function damaged(error: unknown): boolean {
  const code = resultCode(error);
  return code === SQLITE_CORRUPT || code === SQLITE_NOTADB;
}

/** Why one table cannot be read, while the rest of the database can. */
function problem(error: unknown): string {
  if (damaged(error)) return 'This table is damaged.';
  if (resultCode(error) === SQLITE_AUTH)
    return 'Reading this table would run a query stored in the database, which Viewer does not do.';
  return `Viewer cannot read this table. SQLite reported: ${errorMessage(error)}`;
}

/** A name as one SQL identifier: doubling its quotes keeps any name a single identifier. */
function quoted(name: string): string {
  if (!sqliteReadableName(name)) throw new Error('This table name cannot be read safely.');
  return '"' + name.replaceAll('"', '""') + '"';
}

function text(value: SQLOutputValue | undefined): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return '';
}

function count(value: SQLOutputValue | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return 0;
}

function stored(row: Row): StoredObject {
  return { type: text(row.type), name: text(row.name), sql: text(row.sql) };
}

function objectKind(object: StoredObject): SQLiteObjectKind {
  if (object.type === 'view') return 'view';
  return /^\s*create\s+virtual\s+table\b/i.test(object.sql) ? 'virtual' : 'table';
}

const schemaObjects = `
  SELECT type, name, sql
  FROM sqlite_schema
  WHERE type IN ('table', 'view')
`;

function listTables(
  database: DatabaseSync,
  version: string,
  wal: boolean,
  deadline: number,
): SQLiteTables {
  // In stored order, sorted here: an ORDER BY could need a temporary file.
  const rows = database
    .prepare(`${schemaObjects} LIMIT ?`)
    .all(sqliteLimits.objects + 1)
    .map(stored);
  const statistics = rows.some((row) => row.type === 'table' && row.name === 'sqlite_stat1');
  const objects = rows
    .slice(0, sqliteLimits.objects)
    .map((row) => describe(database, row, deadline, statistics))
    .sort(listingOrder);
  return {
    kind: 'tables',
    version,
    objects,
    limited: rows.length > sqliteLimits.objects,
    wal,
  };
}

/** Your own tables first, then SQLite's internal ones, each by name. */
function listingOrder(left: SQLiteObject, right: SQLiteObject): number {
  const internal = (object: SQLiteObject) => (object.name.startsWith('sqlite_') ? 1 : 0);
  return (
    internal(left) - internal(right) ||
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  );
}

function describe(
  database: DatabaseSync,
  object: StoredObject,
  deadline: number,
  statistics: boolean,
): SQLiteObject {
  const kind = objectKind(object);
  const described: SQLiteObject = {
    name: object.name,
    kind,
    columns: [],
    columnCount: 0,
    count: { kind: 'not-counted', reason: kind === 'view' ? 'view' : 'time' },
    definition: shortened(object.sql, sqliteLimits.definitionCharacters),
  };
  const unreadableObject = (message: string): SQLiteObject => ({
    ...described,
    count: { kind: 'not-counted', reason: 'unreadable' },
    problem: message,
  });
  if (!sqliteReadableName(object.name))
    return unreadableObject('This table name cannot be read safely.');
  try {
    const columns = readColumns(database, object.name);
    described.columns = columns.listed;
    described.columnCount = columns.count;
  } catch (error) {
    return unreadableObject(problem(error));
  }
  if (kind === 'view') return described;
  if (performance.now() > deadline) return described;
  try {
    described.count = countRows(database, object.name, statistics);
  } catch (error) {
    return unreadableObject(problem(error));
  }
  return described;
}

function shortened(value: string, characters: number): string {
  return value.length > characters ? value.slice(0, characters) + '…' : value;
}

/** Column details through the pragma's table-valued function, so the name is a bound value. */
function readColumns(database: DatabaseSync, name: string): Columns {
  const statement = database.prepare(`
    SELECT name, type, "notnull" AS required, dflt_value AS fallback, pk AS position, hidden
    FROM pragma_table_xinfo(?)
    WHERE hidden <> 1
  `);
  const listed: SQLiteColumn[] = [];
  let total = 0;
  for (const row of statement.iterate(name)) {
    total++;
    if (listed.length < sqliteLimits.columns) listed.push(column(row));
  }
  return { listed, count: total };
}

function column(row: Row): SQLiteColumn {
  const hidden = count(row.hidden);
  const fallback = row.fallback;
  return {
    name: text(row.name),
    type: text(row.type),
    notNull: count(row.required) !== 0,
    primaryKey: count(row.position),
    ...(fallback === null || fallback === undefined ? {} : { defaultValue: text(fallback) }),
    ...(hidden === 2 ? { generated: 'virtual' as const } : {}),
    ...(hidden === 3 ? { generated: 'stored' as const } : {}),
  };
}

/** Counts at most `countRows` + 1 rows, so one statement never scans an unbounded table. */
function countRows(database: DatabaseSync, name: string, statistics: boolean): SQLiteRowCount {
  const counted = count(
    database
      .prepare(`SELECT count(*) AS total FROM (SELECT 1 FROM ${quoted(name)} LIMIT ?)`)
      .get(sqliteLimits.countRows + 1)?.total,
  );
  if (counted <= sqliteLimits.countRows) return { kind: 'exact', rows: counted };
  const estimate = statistics ? savedEstimate(database, name) : undefined;
  return {
    kind: 'at-least',
    rows: sqliteLimits.countRows,
    ...(estimate === undefined ? {} : { estimate }),
  };
}

/** ANALYZE saves each table's and index's row count as the first number of its stat. */
function savedEstimate(database: DatabaseSync, name: string): number | undefined {
  let rows = 0;
  try {
    const statement = database.prepare('SELECT stat FROM sqlite_stat1 WHERE tbl = ? LIMIT 64');
    for (const row of statement.iterate(name)) {
      const first = Number.parseInt(text(row.stat), 10);
      if (Number.isSafeInteger(first) && first > rows) rows = first;
    }
  } catch {
    return undefined;
  }
  return rows > sqliteLimits.countRows ? rows : undefined;
}

function readRows(database: DatabaseSync, version: string, request: SQLiteRowsRequest): SQLiteRows {
  const row = database.prepare(`${schemaObjects} AND name = ?`).get(request.table);
  if (!row) throw new Error('This table is no longer in the database.');
  const object = stored(row);
  if (objectKind(object) === 'view')
    throw new Error('Viewer does not run views. Their columns and definition are in Schema.');
  const columns = readColumns(database, object.name);
  const read = columns.listed.flatMap((column, index) =>
    column.generated === 'virtual' ? [] : cellExpressions(column.name, index),
  );
  const statement = database.prepare(`
    SELECT ${read.length ? read.join(',\n') : 'NULL'}
    FROM ${quoted(object.name)}
    LIMIT :limit OFFSET :offset
  `);
  const rows: SQLiteCell[][] = [];
  let characters = 0;
  let more = false;
  const page = { limit: request.limit + 1, offset: request.offset };
  // Named parameters the statement lacks are refused, so the value bounds join only when used.
  const parameters = read.length
    ? { ...page, load: sqliteLimits.textBytes, characters: sqliteLimits.textCharacters + 1 }
    : page;
  for (const values of statement.iterate(parameters)) {
    if (rows.length === request.limit) {
      more = true;
      break;
    }
    const cells = columns.listed.map((column, index): SQLiteCell =>
      column.generated === 'virtual' ? { kind: 'generated' } : cell(values, index),
    );
    const size = cells.reduce((total, cell) => total + ('text' in cell ? cell.text.length : 0), 0);
    if (rows.length && characters + size > sqliteLimits.pageCharacters) {
      more = true;
      break;
    }
    characters += size;
    rows.push(cells);
  }
  return {
    kind: 'rows',
    version,
    table: object.name,
    columns: columns.listed.map((column) => column.name),
    columnCount: columns.count,
    offset: request.offset,
    rows,
    more,
  };
}

/**
 * Three results per column: its type, its stored size and a bounded value. `typeof`, `length`
 * of a blob and `octet_length` read only the record header, so a large value is loaded only
 * when it is text within `textBytes`, and then only its first characters are returned.
 */
function cellExpressions(name: string, index: number): string[] {
  const column = quoted(name);
  return [
    `typeof(${column}) AS "type${index}"`,
    `CASE typeof(${column})
      WHEN 'blob' THEN length(${column})
      WHEN 'text' THEN octet_length(${column})
    END AS "bytes${index}"`,
    `CASE typeof(${column})
      WHEN 'integer' THEN CAST(${column} AS TEXT)
      WHEN 'real' THEN ${column}
      WHEN 'text' THEN CASE
        WHEN octet_length(${column}) <= :load THEN substr(${column}, 1, :characters)
      END
    END AS "value${index}"`,
  ];
}

function cell(values: Row, index: number): SQLiteCell {
  const value = values[`value${index}`];
  const bytes = count(values[`bytes${index}`]);
  const type = text(values[`type${index}`]);
  switch (type) {
    case 'integer':
      return { kind: 'integer', text: text(value) };
    case 'real':
      return { kind: 'real', text: realText(value) };
    case 'blob':
      return { kind: 'blob', bytes };
    case 'text': {
      if (typeof value !== 'string') return { kind: 'text', text: '', bytes };
      // substr counts code points, as Array.from does.
      const characters = Array.from(value);
      if (characters.length <= sqliteLimits.textCharacters) return { kind: 'text', text: value };
      return {
        kind: 'text',
        text: characters.slice(0, sqliteLimits.textCharacters).join(''),
        bytes,
      };
    }
    default:
      return { kind: 'null' };
  }
}

/** A real as SQLite prints it: whole numbers keep a decimal place. */
function realText(value: SQLOutputValue | undefined): string {
  if (typeof value !== 'number') return text(value);
  if (!Number.isFinite(value)) return value > 0 ? 'Inf' : '-Inf';
  return Number.isInteger(value) && Math.abs(value) < 1e21 ? value.toFixed(1) : String(value);
}
