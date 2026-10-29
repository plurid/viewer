import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readSQLite } from '../src/desktop/previews/sqlite';
import { Resources } from '../src/desktop/previews/resources';
import { methodWindows, schemas } from '../src/desktop/ipc/schemas';
import { createResourceHandlers } from '../src/desktop/ipc/resource-handlers';
import { sqliteCellText, sqliteHeader, sqliteLimits } from '../src/domain/previews/data/sqlite';
import type {
  SQLiteObject,
  SQLiteReply,
  SQLiteRequest,
  SQLiteRows,
  SQLiteTables,
} from '../src/domain/previews/data/sqlite';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-sqlite-');
});
afterEach(async () => {
  await trashTemporary(root);
});

function create(name: string, sql: string): string {
  const file = path.join(root, name);
  const database = new DatabaseSync(file);
  try {
    database.exec(sql);
  } finally {
    database.close();
  }
  return file;
}

function tables(reply: SQLiteReply): SQLiteTables {
  if (reply.kind !== 'tables') throw new Error(`Expected tables, received ${reply.kind}.`);
  return reply;
}

function rows(reply: SQLiteReply): SQLiteRows {
  if (reply.kind !== 'rows') throw new Error(`Expected rows, received ${reply.kind}.`);
  return reply;
}

function object(listing: SQLiteTables, name: string): SQLiteObject {
  const found = listing.objects.find((item) => item.name === name);
  if (!found) throw new Error(`No object named ${name}.`);
  return found;
}

function page(table: string, offset = 0, limit = 200): SQLiteRequest {
  return { kind: 'rows', table, offset, limit };
}

const tablesRequest: SQLiteRequest = { kind: 'tables' };

describe('SQLite listing', () => {
  it('lists tables, virtual tables and views with columns and exact counts', async () => {
    const file = create(
      'library.sqlite',
      `
      CREATE TABLE books(
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        added DATE DEFAULT '1970-01-01'
      );
      INSERT INTO books(title) VALUES ('Dune'), ('Emma'), ('Ulysses');
      CREATE TABLE empty(value);
      CREATE VIEW titles AS SELECT title FROM books;
      CREATE VIRTUAL TABLE notes USING fts5(body);
      INSERT INTO notes VALUES ('alpha'), ('beta');
      `,
    );
    const listing = tables(await readSQLite(file, tablesRequest));
    expect(listing).toMatchObject({ kind: 'tables', limited: false, wal: false });
    expect(listing.objects[0]!.name).toBe('books');
    expect(object(listing, 'books')).toEqual({
      name: 'books',
      kind: 'table',
      columns: [
        { name: 'id', type: 'INTEGER', notNull: false, primaryKey: 1 },
        { name: 'title', type: 'TEXT', notNull: true, primaryKey: 0 },
        {
          name: 'added',
          type: 'DATE',
          notNull: false,
          primaryKey: 0,
          defaultValue: "'1970-01-01'",
        },
      ],
      columnCount: 3,
      count: { kind: 'exact', rows: 3 },
      definition: expect.stringContaining('CREATE TABLE books'),
    });
    expect(object(listing, 'empty').count).toEqual({ kind: 'exact', rows: 0 });
    expect(object(listing, 'titles')).toMatchObject({
      kind: 'view',
      columns: [{ name: 'title' }],
      count: { kind: 'not-counted', reason: 'view' },
    });
    expect(object(listing, 'notes')).toMatchObject({
      kind: 'virtual',
      count: { kind: 'exact', rows: 2 },
    });
    expect(object(listing, 'notes').problem).toBeUndefined();
  });

  it('bounds counts, reads saved estimates and stops counting at its deadline', async () => {
    const file = create(
      'large.sqlite',
      `
      CREATE TABLE numbers(value INTEGER);
      CREATE INDEX numbers_value ON numbers(value);
      WITH RECURSIVE sequence(value) AS (
        SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < 150000
      )
      INSERT INTO numbers SELECT value FROM sequence;
      ANALYZE;
      CREATE TABLE small(value);
      `,
    );
    const listing = tables(await readSQLite(file, tablesRequest));
    expect(object(listing, 'numbers').count).toEqual({
      kind: 'at-least',
      rows: sqliteLimits.countRows,
      estimate: 150000,
    });
    expect(object(listing, 'sqlite_stat1').count).toEqual({ kind: 'exact', rows: 1 });
    expect(listing.objects.at(-1)!.name).toBe('sqlite_stat1');
    const hurried = tables(await readSQLite(file, tablesRequest, { countMilliseconds: -1 }));
    for (const item of hurried.objects)
      expect(item.count).toEqual({ kind: 'not-counted', reason: 'time' });
    expect(object(hurried, 'numbers').columns).toEqual([
      { name: 'value', type: 'INTEGER', notNull: false, primaryKey: 0 },
    ]);
  });
});

describe('SQLite pages', () => {
  it('pages rows by offset and limit and says whether more follow', async () => {
    const file = create(
      'paged.sqlite',
      `
      CREATE TABLE items(id INTEGER PRIMARY KEY, label TEXT);
      WITH RECURSIVE sequence(value) AS (
        SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < 450
      )
      INSERT INTO items SELECT value, 'item ' || value FROM sequence;
      `,
    );
    const first = rows(await readSQLite(file, page('items')));
    expect(first).toMatchObject({
      table: 'items',
      columns: ['id', 'label'],
      offset: 0,
      more: true,
    });
    expect(first.rows).toHaveLength(200);
    expect(first.rows[0]).toEqual([
      { kind: 'integer', text: '1' },
      { kind: 'text', text: 'item 1' },
    ]);
    const last = rows(await readSQLite(file, page('items', 400)));
    expect(last.rows).toHaveLength(50);
    expect(last.more).toBe(false);
    expect(last.rows.at(-1)![1]).toEqual({ kind: 'text', text: 'item 450' });
    // The last 200 rows exactly: nothing follows them.
    const exact = rows(await readSQLite(file, page('items', 250)));
    expect(exact.rows).toHaveLength(200);
    expect(exact.more).toBe(false);
    const beyond = rows(await readSQLite(file, page('items', 1000)));
    expect(beyond).toMatchObject({ rows: [], more: false });
    await expect(readSQLite(file, page('missing'))).rejects.toThrow('no longer in the database');
  });

  it('bounds text and blobs and keeps large integers, reals and NULL exact', async () => {
    const file = path.join(root, 'values.sqlite');
    const writer = new DatabaseSync(file);
    writer.exec(`
      CREATE TABLE cells(
        id INTEGER PRIMARY KEY,
        value,
        doubled TEXT GENERATED ALWAYS AS (value || value) VIRTUAL,
        stored TEXT GENERATED ALWAYS AS (typeof(value)) STORED
      )
    `);
    const insert = writer.prepare('INSERT INTO cells(value) VALUES (?)');
    const long = 'x'.repeat(2000);
    const emoji = '😀'.repeat(600);
    const oversized = 'y'.repeat(300 * 1024);
    for (const value of [
      long,
      emoji,
      oversized,
      new Uint8Array(70000),
      9007199254740993n,
      1,
      0.1,
      null,
      'short',
    ])
      insert.run(value);
    writer.exec('UPDATE cells SET value = CAST(value AS REAL) WHERE id = 6');
    writer.close();
    const reply = rows(await readSQLite(file, page('cells')));
    expect(reply.columns).toEqual(['id', 'value', 'doubled', 'stored']);
    const values = reply.rows.map((row) => row[1]!);
    expect(values[0]).toEqual({ kind: 'text', text: 'x'.repeat(500), bytes: 2000 });
    expect(sqliteCellText(values[0]!)).toBe('x'.repeat(500) + '…');
    expect(values[1]).toEqual({ kind: 'text', text: '😀'.repeat(500), bytes: 2400 });
    expect(values[2]).toEqual({ kind: 'text', text: '', bytes: 300 * 1024 });
    expect(sqliteCellText(values[2]!)).toBe(`<text ${300 * 1024} bytes>`);
    expect(values[3]).toEqual({ kind: 'blob', bytes: 70000 });
    expect(sqliteCellText(values[3]!)).toBe('<blob 70000 bytes>');
    expect(values[4]).toEqual({ kind: 'integer', text: '9007199254740993' });
    expect(values[5]).toEqual({ kind: 'real', text: '1.0' });
    expect(values[6]).toEqual({ kind: 'real', text: '0.1' });
    expect(values[7]).toEqual({ kind: 'null' });
    expect(sqliteCellText(values[7]!)).toBe('NULL');
    expect(values[8]).toEqual({ kind: 'text', text: 'short' });
    // The virtual generated column is never computed; the stored one is read.
    expect(reply.rows[8]![2]).toEqual({ kind: 'generated' });
    expect(reply.rows[8]![3]).toEqual({ kind: 'text', text: 'text' });
    const listing = tables(await readSQLite(file, tablesRequest));
    expect(object(listing, 'cells').columns.map((column) => column.generated)).toEqual([
      undefined,
      undefined,
      'virtual',
      'stored',
    ]);
  });

  it('ends a page early rather than exceed its text budget', async () => {
    const columns = Array.from({ length: 30 }, (_, index) => `c${index}`);
    const file = create(
      'wide.sqlite',
      `
      CREATE TABLE wide(${columns.join(', ')});
      WITH RECURSIVE sequence(value) AS (
        SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < 200
      )
      INSERT INTO wide SELECT ${columns.map(() => "printf('%.*c', 500, 'z')").join(', ')}
      FROM sequence;
      `,
    );
    const reply = rows(await readSQLite(file, page('wide')));
    const characters = reply.rows.flat().reduce((total, cell) => {
      return total + ('text' in cell ? cell.text.length : 0);
    }, 0);
    expect(reply.rows.length).toBeGreaterThan(0);
    expect(reply.rows.length).toBeLessThan(200);
    expect(characters).toBeLessThanOrEqual(sqliteLimits.pageCharacters);
    expect(reply.more).toBe(true);
    const next = rows(await readSQLite(file, page('wide', reply.rows.length)));
    expect(next.offset).toBe(reply.rows.length);
  });
});

describe('SQLite safety', () => {
  it('refuses files without the SQLite header and explains encrypted ones', async () => {
    const thumbs = path.join(root, 'Thumbs.db');
    await writeFile(thumbs, Buffer.from('d0cf11e0a1b11ae1'.repeat(64), 'hex'));
    expect(await readSQLite(thumbs, tablesRequest)).toEqual({
      kind: 'unreadable',
      reason: 'not-sqlite',
      message: expect.stringContaining('may be encrypted'),
    });
    const empty = path.join(root, 'empty.sqlite');
    await writeFile(empty, '');
    expect(await readSQLite(empty, tablesRequest)).toMatchObject({ reason: 'not-sqlite' });
    await expect(readSQLite(thumbs, page('anything'))).resolves.toMatchObject({
      kind: 'unreadable',
      reason: 'not-sqlite',
    });
  });

  it('reports a damaged database or header as unreadable instead of failing', async () => {
    const source = create('source.sqlite', 'CREATE TABLE t(a); INSERT INTO t VALUES (1);');
    const bytes = await readFile(source);
    const garbage = Buffer.from(bytes);
    garbage.fill(0xa5, 100);
    const damaged = path.join(root, 'damaged.sqlite');
    await writeFile(damaged, garbage);
    expect(await readSQLite(damaged, tablesRequest)).toMatchObject({
      kind: 'unreadable',
      reason: 'damaged',
      message: expect.stringContaining('damaged or encrypted'),
    });
    const header = Buffer.from(bytes);
    header.writeUInt16BE(1000, 16);
    const badHeader = path.join(root, 'header.sqlite');
    await writeFile(badHeader, header);
    expect(await readSQLite(badHeader, tablesRequest)).toMatchObject({
      kind: 'unreadable',
      reason: 'damaged',
    });
  });

  it('creates and changes no -wal, -shm or journal file, even beside a live writer', async () => {
    const file = create(
      'logged.sqlite',
      `
      PRAGMA journal_mode = WAL;
      CREATE TABLE entries(value);
      INSERT INTO entries VALUES (1), (2);
      `,
    );
    const quiet = await readdir(root);
    const listing = tables(await readSQLite(file, tablesRequest));
    expect(listing.wal).toBe(true);
    expect(rows(await readSQLite(file, page('entries'))).rows).toHaveLength(2);
    expect(await readdir(root)).toEqual(quiet);

    const writer = new DatabaseSync(file);
    try {
      writer.exec('PRAGMA wal_autocheckpoint = 0; INSERT INTO entries VALUES (3);');
      const sideFiles = [`${file}-wal`, `${file}-shm`, file];
      const before = await Promise.all(
        sideFiles.map(async (side) => ({
          bytes: await readFile(side),
          modified: (await stat(side)).mtimeMs,
        })),
      );
      const entries = await readdir(root);
      // Immutable reading sees the main file only, not changes still in the log.
      expect(object(tables(await readSQLite(file, tablesRequest)), 'entries').count).toEqual({
        kind: 'exact',
        rows: 2,
      });
      await readSQLite(file, page('entries'));
      const after = await Promise.all(
        sideFiles.map(async (side) => ({
          bytes: await readFile(side),
          modified: (await stat(side)).mtimeMs,
        })),
      );
      expect(after).toEqual(before);
      expect(await readdir(root)).toEqual(entries);
    } finally {
      writer.close();
    }
  });

  it('quotes names with quotes, brackets and SQL so they stay one identifier', async () => {
    const name = `we"ird ] name'; DROP TABLE kept; --`;
    const column = `a"b`;
    const quotedName = '"' + name.replaceAll('"', '""') + '"';
    const quotedColumn = '"' + column.replaceAll('"', '""') + '"';
    const file = create(
      'names.sqlite',
      `
      CREATE TABLE kept(value);
      INSERT INTO kept VALUES ('still here');
      CREATE TABLE ${quotedName}(${quotedColumn}, "select");
      INSERT INTO ${quotedName} VALUES ('quoted', 'keyword');
      `,
    );
    const listing = tables(await readSQLite(file, tablesRequest));
    expect(object(listing, name)).toMatchObject({
      columns: [{ name: column }, { name: 'select' }],
      count: { kind: 'exact', rows: 1 },
    });
    expect(rows(await readSQLite(file, page(name))).rows).toEqual([
      [
        { kind: 'text', text: 'quoted' },
        { kind: 'text', text: 'keyword' },
      ],
    ]);
    expect(rows(await readSQLite(file, page('kept'))).rows).toEqual([
      [{ kind: 'text', text: 'still here' }],
    ]);
  });

  it('never runs a view, a recursive query or a view behind a virtual table', async () => {
    const file = create(
      'stored-sql.sqlite',
      `
      CREATE TABLE source(a INTEGER PRIMARY KEY, b TEXT);
      INSERT INTO source(b) VALUES ('one');
      CREATE VIEW forever AS
        WITH RECURSIVE counter(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM counter)
        SELECT x FROM counter WHERE x < 0;
      CREATE VIEW plain AS SELECT a, b FROM source;
      CREATE VIRTUAL TABLE indirect USING fts5(b, content='plain', content_rowid='a');
      `,
    );
    const listing = tables(await readSQLite(file, tablesRequest));
    expect(object(listing, 'forever')).toMatchObject({
      kind: 'view',
      columns: [{ name: 'x' }],
      count: { kind: 'not-counted', reason: 'view' },
    });
    expect(object(listing, 'indirect')).toMatchObject({
      kind: 'virtual',
      count: { kind: 'not-counted', reason: 'unreadable' },
      problem: expect.stringContaining('run a query stored in the database'),
    });
    await expect(readSQLite(file, page('forever'))).rejects.toThrow('does not run views');
    await expect(readSQLite(file, page('indirect'))).rejects.toThrow();
  });
});

describe('SQLite resource leases', () => {
  let resources: Resources;
  beforeEach(() => {
    resources = new Resources();
  });
  afterEach(async () => {
    await resources.quiesce();
  });

  it('reads only through the lease that authorized the file', async () => {
    const file = create('leased.sqlite', "CREATE TABLE t(a); INSERT INTO t VALUES ('leased');");
    const access = vi.fn(async () => {});
    const checked = new Resources(access);
    try {
      const resource = await checked.grant(file);
      const listing = tables(await checked.sqlite(resource.id, tablesRequest));
      expect(object(listing, 't').count).toEqual({ kind: 'exact', rows: 1 });
      expect(rows(await checked.sqlite(resource.id, page('t'))).rows).toEqual([
        [{ kind: 'text', text: 'leased' }],
      ]);
      expect(access).toHaveBeenCalledWith([await realpath(file)]);
      checked.release(resource.id);
      await expect(checked.sqlite(resource.id, tablesRequest)).rejects.toThrow('expired');
    } finally {
      await checked.quiesce();
    }
    const text = path.join(root, 'notes.db');
    await writeFile(text, 'plain text that only borrows the extension');
    const granted = await resources.grant(text);
    expect(await resources.sqlite(granted.id, tablesRequest)).toMatchObject({
      reason: 'not-sqlite',
    });
  });

  it('validates requests at the IPC boundary and hands them to the lease', async () => {
    expect(methodWindows.sqlite).toBe('viewer');
    expect(schemas.sqlite.safeParse(['resource', { kind: 'tables' }]).success).toBe(true);
    expect(schemas.sqlite.safeParse(['resource', page('t', 400, 200)]).success).toBe(true);
    for (const request of [
      { kind: 'rows', table: 't', offset: 0, limit: 201 },
      { kind: 'rows', table: 't', offset: -1, limit: 10 },
      { kind: 'rows', table: 't', offset: sqliteLimits.offset + 1, limit: 10 },
      { kind: 'rows', table: 't', offset: 0.5, limit: 10 },
      { kind: 'rows', table: '', offset: 0, limit: 10 },
      { kind: 'rows', table: 'a\0b', offset: 0, limit: 10 },
      { kind: 'rows', table: 'x'.repeat(sqliteLimits.nameCharacters + 1), offset: 0, limit: 1 },
      { kind: 'rows', table: 't', offset: 0, limit: 10, path: '/other.sqlite' },
      { kind: 'tables', table: 't' },
      { kind: 'query', sql: 'SELECT 1' },
    ])
      expect(schemas.sqlite.safeParse(['resource', request]).success).toBe(false);
    const reply: SQLiteReply = { kind: 'unreadable', reason: 'too-large', message: 'Too large.' };
    const sqlite = vi.fn(async () => reply);
    const handlers = createResourceHandlers({
      resources: { sqlite } as unknown as Parameters<typeof createResourceHandlers>[0]['resources'],
      thumbnails: { get: vi.fn() },
      webPreviews: { releaseResource: vi.fn() },
      files: { extract: vi.fn() },
      fileAccess: { require: vi.fn() },
      forgetGitResource: vi.fn(),
      warmOffice: vi.fn(),
    });
    await expect(handlers.sqlite(['resource', { kind: 'tables' }], 1)).resolves.toBe(reply);
    expect(sqlite).toHaveBeenCalledWith('resource', { kind: 'tables' });
  });
});

describe('SQLite header and cells', () => {
  it('recognizes the header, its page sizes and write-ahead logging', () => {
    const header = new Uint8Array(100);
    header.set(new TextEncoder().encode('SQLite format 3\0'));
    header[16] = 0x10;
    header[18] = 1;
    header[19] = 1;
    expect(sqliteHeader(header)).toEqual({ kind: 'database', wal: false });
    header[18] = 2;
    header[19] = 2;
    expect(sqliteHeader(header)).toEqual({ kind: 'database', wal: true });
    header[16] = 0;
    header[17] = 1;
    expect(sqliteHeader(header)).toEqual({ kind: 'database', wal: true });
    header[16] = 0x03;
    header[17] = 0xe8;
    expect(sqliteHeader(header)).toEqual({ kind: 'damaged' });
    expect(sqliteHeader(header.subarray(0, 50))).toEqual({ kind: 'other' });
    expect(sqliteHeader(new Uint8Array(100))).toEqual({ kind: 'other' });
  });

  it('reads bounded cells as text', () => {
    expect(sqliteCellText({ kind: 'generated' })).toBe('<generated>');
    expect(sqliteCellText({ kind: 'text', text: '' })).toBe('');
    expect(sqliteCellText({ kind: 'integer', text: '-3' })).toBe('-3');
  });
});
