import {
  matchesQuery,
  parseFileQuery,
  QueryError,
  withoutTopWords,
  foldText,
  type FileQuery,
} from '../../domain/search/query';
import type { QuerySnapshot } from '../../domain/workspaces/collections';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { opendir, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import type { FileEntry } from '../../domain/contracts';
import type { DocumentData } from '../../domain/services';
import { searchEvidence, sourceVersion } from '../../domain/files/inspection';
import type {
  ApplicationSettings,
  IndexedQuery,
  IndexedResult,
  IndexStatus,
} from '../../domain/services';
import { absolute, entry } from '../files/filesystem';
import { searchExclusions, searchExclusionRules } from './exclusions';
import { containsPath } from '../files/containment';
export class FileIndex {
  private db: DatabaseSync;
  /**
   * Each stamp is later than the last, even within one millisecond: a crawl compares its stamp
   * with the rows', and one in the same millisecond as the crawl before could not tell that crawl's
   * rows from its own, so a file that had gone stayed. Still the clock's, so the stamps
   * kept on disk order with a new session's.
   */
  private stamped = 0;
  private stamp(): number {
    return (this.stamped = Math.max(Date.now(), this.stamped + 1));
  }
  private roots: IndexStatus['roots'] = [];
  private generation = 0;
  private count?: number;
  /** Rows changed since the count: a crawl recounts at most every two seconds (`status`). */
  private countStale = false;
  private countedAt = 0;
  private config?: ApplicationSettings['search'];
  private excluded: (file: string) => boolean;
  /** The configuration the last `configure` applied (not the initial scope), to tell a repeat. */
  private applied?: string;
  /** A rebuild extracts every document again; any other crawl keeps text stored for its version. */
  private rebuilding = false;
  private active?: Promise<void>;
  private updates: Promise<void> = Promise.resolve();
  constructor(
    file: string,
    private emit: (value: IndexStatus) => void = () => {},
    private extract?: (file: string) => Promise<string | DocumentData>,
    initialScope?: ApplicationSettings['search'],
  ) {
    this.config = initialScope;
    this.excluded = searchExclusions(initialScope?.exclusions ?? []);
    this.db = new DatabaseSync(file);
    try {
      this.db.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA busy_timeout=2000;
        CREATE TABLE IF NOT EXISTS files(
          path TEXT PRIMARY KEY, root TEXT, name TEXT, extension TEXT, size INTEGER,
          modified REAL, hidden INTEGER, directory INTEGER, data TEXT, seen INTEGER
        );
        CREATE INDEX IF NOT EXISTS files_root ON files(root);
        CREATE INDEX IF NOT EXISTS files_ext ON files(extension);
        CREATE INDEX IF NOT EXISTS files_name ON files(name,path);
        CREATE VIRTUAL TABLE IF NOT EXISTS names
          USING fts5(name, content, path UNINDEXED, tokenize='trigram');
      `);
      this.db.exec(
        'CREATE TABLE IF NOT EXISTS source_documents(path TEXT PRIMARY KEY, version TEXT NOT NULL, document TEXT NOT NULL)',
      );
      this.db.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      const version = Number(
        (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      );
      if (version < 2) {
        // Reconcile the disposable search index without touching any source file.
        this.db.exec(`
          BEGIN;
          CREATE TEMP TABLE previous_content AS SELECT path,content FROM names;
          CREATE INDEX previous_content_path ON previous_content(path);
          DELETE FROM names;
          INSERT INTO names(rowid,name,content,path)
            SELECT files.rowid,files.name,coalesce(previous_content.content,''),files.path
            FROM files LEFT JOIN previous_content ON files.path=previous_content.path;
          DROP TABLE previous_content;
          PRAGMA user_version=2;
          COMMIT;
        `);
      }
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  static async open(
    file: string,
    emit?: (value: IndexStatus) => void,
    extract?: (file: string) => Promise<string | DocumentData>,
    initialScope?: ApplicationSettings['search'],
  ) {
    await mkdir(path.dirname(file), { recursive: true });
    try {
      return new FileIndex(file, emit, extract, initialScope);
    } catch (error) {
      // SQLITE_CORRUPT or SQLITE_NOTADB. The index is derived from the folders, so a damaged one
      // is kept aside with its journal and built again, instead of failing every search until
      // it is removed by hand.
      if (![11, 26].includes(((error as { errcode?: number }).errcode ?? 0) & 0xff)) throw error;
      const kept = `${file}.unreadable-${Date.now()}`;
      for (const suffix of ['', '-wal', '-shm'])
        await rename(file + suffix, kept + suffix).catch((failure: NodeJS.ErrnoException) => {
          if (!suffix || failure.code !== 'ENOENT') throw failure;
        });
      return new FileIndex(file, emit, extract, initialScope);
    }
  }
  put(
    item: FileEntry,
    root: string,
    seen = this.stamp(),
    content: string | DocumentData = '',
  ): void {
    this.putMany([{ item, root, seen, content }]);
  }
  ingest(items: FileEntry[], root: string): void {
    for (let start = 0; start < items.length; start += 100)
      this.putMany(
        items
          .slice(start, start + 100)
          .map((item) => ({ item, root, seen: this.stamp(), content: '' })),
      );
  }
  /** `content` undefined: a document unchanged since its text was stored, which stays as it is. */
  private putMany(
    items: { item: FileEntry; root: string; seen: number; content?: string | DocumentData }[],
  ): void {
    const drop = this.db.prepare(
      'DELETE FROM names WHERE rowid=(SELECT rowid FROM files WHERE path=?)',
    );
    const file = this.db.prepare(
      `INSERT INTO files VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET
        root=excluded.root, name=excluded.name, extension=excluded.extension,
        size=excluded.size, modified=excluded.modified, hidden=excluded.hidden,
        directory=excluded.directory, data=excluded.data, seen=excluded.seen`,
    );
    const name = this.db.prepare(
      'INSERT INTO names(rowid,name,content,path) VALUES((SELECT rowid FROM files WHERE path=?),?,?,?)',
    );
    this.db.exec('BEGIN');
    try {
      for (const { item, root, seen, content } of items) {
        if (content !== undefined) drop.run(item.path);
        file.run(
          item.path,
          root,
          foldText(item.name),
          item.extension,
          item.size,
          item.modified,
          +item.hidden,
          +item.directory,
          JSON.stringify(item),
          seen,
        );
        if (content === undefined) continue;
        const original: DocumentData =
          typeof content === 'string'
            ? {
                path: item.path,
                metadata: {},
                evidence: content ? [{ source: 'text', text: content }] : [],
                text: content,
                truncated: content.length > 150000,
              }
            : content;
        name.run(
          item.path,
          foldText(item.name),
          foldText(original.text.slice(0, 150000)),
          item.path,
        );
        this.db.prepare('DELETE FROM source_documents WHERE path=?').run(item.path);
        if (original.text) {
          let remaining = 150000;
          const evidence = original.evidence.flatMap((part) => {
            const text = part.text.slice(0, remaining);
            remaining -= text.length;
            return text ? [{ ...part, text }] : [];
          });
          this.db.prepare('INSERT INTO source_documents VALUES(?,?,?)').run(
            item.path,
            JSON.stringify(sourceVersion(item)),
            JSON.stringify({
              ...original,
              evidence,
              text: '',
              chapters: undefined,
              epub: undefined,
              office: undefined,
              truncated:
                original.truncated ||
                original.evidence.reduce((n, item) => n + item.text.length, 0) > 150000,
            }),
          );
        }
      }
      this.db.exec('COMMIT');
      this.countStale = true;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  remove(file: string): void {
    const paths = this.db
      .prepare('SELECT path FROM files WHERE path=? OR substr(path,1,?)=?')
      .all(file, file.length + 1, file + '/') as { path: string }[];
    this.db.exec('BEGIN');
    try {
      for (const row of paths) {
        this.db
          .prepare('DELETE FROM names WHERE rowid=(SELECT rowid FROM files WHERE path=?)')
          .run(row.path);
        this.db.prepare('DELETE FROM files WHERE path=?').run(row.path);
        this.db.prepare('DELETE FROM source_documents WHERE path=?').run(row.path);
      }
      this.db.exec('COMMIT');
      this.count = undefined;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private scope(): { where: string[]; params: (string | number)[] } {
    const roots = this.config?.roots;
    const where = [
      roots?.length ? `files.root IN (${roots.map(() => '?').join(',')})` : roots ? '0=1' : '1=1',
    ];
    const params: (string | number)[] = [...(roots || [])];
    const rules = searchExclusionRules(this.config?.exclusions ?? []);
    for (const rule of rules.paths) {
      const prefix = rule.endsWith(path.sep) ? rule : rule + path.sep;
      where.push('NOT (files.path=? OR substr(files.path,1,?)=?)');
      params.push(rule, prefix.length, prefix);
    }
    for (const rule of rules.names) {
      where.push('instr(?||files.path||?,?)=0');
      params.push(path.sep, path.sep, path.sep + rule + path.sep);
    }
    return { where, params };
  }
  status(): IndexStatus {
    const crawling = this.roots.some((root) => root.status === 'indexing');
    if (
      this.count === undefined ||
      (this.countStale && (!crawling || Date.now() - this.countedAt >= 2000))
    ) {
      // Excluded rows are purged when the exclusions change (`configure`), so the roots alone
      // decide what counts. Filtering every path by the exclusions took a second on 2.5 million
      // rows, and a crawl recounted after every flush: previews waited behind it.
      const roots = this.config?.roots;
      const where = roots?.length
        ? `root IN (${roots.map(() => '?').join(',')})`
        : roots
          ? '0=1'
          : '1=1';
      this.count = Number(
        (
          this.db
            .prepare('SELECT count(*) AS n FROM files WHERE ' + where)
            .get(...(roots ?? [])) as {
            n: number;
          }
        ).n,
      );
      this.countStale = false;
      this.countedAt = Date.now();
    }
    return {
      roots: this.roots.map((root) => ({ ...root })),
      count: this.count,
      running: this.roots.some((root) => root.status === 'indexing'),
    };
  }
  query(request: IndexedQuery, limitCap = 500, includeEvidence = true): IndexedResult {
    const root = request.root;
    const indexed =
      !root ||
      !!this.config?.roots.some(
        (indexedRoot) => containsPath(indexedRoot, root) && !this.excluded(root),
      );
    // THE FILE QUERY LANGUAGE: domain/search/query.ts, as the folder filter reads it
    let parsed: FileQuery;
    try {
      parsed = parseFileQuery(request.query.trim());
    } catch (error) {
      if (error instanceof QueryError) throw new Error(error.message);
      throw error;
    }
    const text = parsed.words.join(' ');
    const { where, params } = this.scope();
    // SQL narrows by what every match has, the terms side by side at the top; the query then
    // decides each row, so OR, -, patterns, tags and created dates read as they do elsewhere
    const top = !parsed.root ? [] : parsed.root.kind === 'and' ? parsed.root.nodes : [parsed.root];
    const words: string[] = [];
    // `name:` words: the name column alone, with document text on too
    const named: string[] = [];
    let exact = true;
    for (const node of top) {
      if (node.kind === 'text') words.push(node.text);
      else if (node.kind === 'name') named.push(node.text);
      else if (node.kind === 'ext') {
        where.push(`files.extension IN (${node.extensions.map(() => '?').join(',')})`);
        params.push(...node.extensions);
      } else if (node.kind === 'type' && (node.type === 'file' || node.type === 'folder')) {
        where.push('files.directory=?');
        params.push(node.type === 'folder' ? 1 : 0);
        // an app is a folder on disk and not one here: the query decides
        if (node.type === 'folder') exact = false;
      } else if (node.kind === 'size') {
        where.push('files.directory=0 AND files.size' + node.op + '?');
        params.push(node.bytes);
      } else if (node.kind === 'date' && node.field === 'modified') {
        if (node.from !== undefined) {
          where.push('files.modified>=?');
          params.push(node.from);
        }
        if (node.to !== undefined) {
          where.push('files.modified<?');
          params.push(node.to);
        }
      } else exact = false;
    }
    if (root) {
      const prefix = root.replace(/\/$/, '') + '/';
      if (request.recursive === false) {
        where.push("substr(files.path,1,?)=? AND instr(substr(files.path,?),'/')=0");
        params.push(prefix.length, prefix, prefix.length + 1);
      } else {
        where.push('(files.path=? OR substr(files.path,1,?)=?)');
        params.push(root, prefix.length, prefix);
      }
    }
    if (!request.showHidden) where.push('files.hidden=0');
    let join = '';
    const long = words.filter((word) => word.length >= 3);
    const short = words.filter((word) => word.length < 3);
    const longNamed = named.filter((word) => word.length >= 3);
    const shortNamed = named.filter((word) => word.length < 3);
    const phrase = (word: string) => '"' + word.replace(/"/g, '""') + '"';
    if (long.length || longNamed.length) {
      const term = [
        ...long.map((word) => (request.content ? '' : 'name:') + phrase(word)),
        ...longNamed.map((word) => 'name:' + phrase(word)),
      ].join(' ');
      // Frequent terms should stop at a page, rather than sort hundreds of thousands of hits.
      // Sparse terms keep the FTS-driven plan. The probe is bounded and never copies file data.
      const frequent =
        Number(
          (
            this.db
              .prepare(
                'SELECT count(*) AS n FROM (SELECT rowid FROM names WHERE names MATCH ? LIMIT 16385)',
              )
              .get(term) as { n: number }
          ).n,
        ) > 16384;
      join = frequent
        ? ' INDEXED BY files_name CROSS JOIN names ON names.rowid=files.rowid '
        : ' JOIN names ON names.rowid=files.rowid ';
      where.push('names MATCH ?');
      params.push(term);
    } else if (short.length || shortNamed.length) join = ' JOIN names ON names.rowid=files.rowid ';
    for (const word of shortNamed) {
      where.push('instr(names.name,?)>0');
      params.push(word);
    }
    for (const word of short) {
      where.push(
        request.content
          ? '(instr(names.name,?)>0 OR instr(names.content,?)>0)'
          : 'instr(names.name,?)>0',
      );
      params.push(...(request.content ? [word, word] : [word]));
    }
    // words in document text are SQL's alone: the query checks the rest
    const check = request.content ? withoutTopWords(parsed) : parsed;
    if (request.content && check.root) exact = false;
    const facts = {
      tagged: (tag: string) => (request.tagged?.[tag] ? new Set(request.tagged[tag]) : undefined),
    };
    const limit = Math.max(1, Math.min(limitCap, request.limit ?? 150));
    const offset = Math.max(0, request.offset ?? 0);
    const select = (count: number, from: number) =>
      this.db
        .prepare(
          'SELECT files.data FROM files' +
            join +
            ' WHERE ' +
            where.join(' AND ') +
            ' ORDER BY files.name,files.path LIMIT ? OFFSET ?',
        )
        .all(...params, count, from) as { data: string }[];
    let entries: FileEntry[];
    let more: boolean;
    let scanLimited = false;
    if (exact) {
      const rows = select(limit + 1, offset);
      entries = rows.slice(0, limit).map((row) => JSON.parse(row.data) as FileEntry);
      more = rows.length > limit;
    } else {
      // the query decides each row: read pages until enough match, at most 20,000 rows
      const wanted = offset + limit + 1;
      const matched: FileEntry[] = [];
      let read = 0;
      for (;;) {
        const rows = select(500, read);
        read += rows.length;
        for (const row of rows) {
          const item = JSON.parse(row.data) as FileEntry;
          if (matchesQuery(check, item, facts)) matched.push(item);
        }
        if (rows.length < 500 || matched.length >= wanted || read >= 20000) {
          more = matched.length > offset + limit;
          scanLimited = rows.length === 500 && read >= 20000 && matched.length < wanted;
          break;
        }
      }
      entries = matched.slice(offset, offset + limit);
    }
    const evidence =
      request.content && includeEvidence
        ? entries.flatMap((item) => {
            const source = this.db
              .prepare('SELECT version,document FROM source_documents WHERE path=?')
              .get(item.path) as { version: string; document: string } | undefined;
            if (!source || source.version !== JSON.stringify(sourceVersion(item))) return [];
            return searchEvidence(item, JSON.parse(source.document) as DocumentData, text) ?? [];
          })
        : undefined;
    return {
      entries,
      evidence,
      more,
      indexed,
      scanLimited,
      status: this.status(),
    };
  }
  snapshot(request: IndexedQuery): QuerySnapshot {
    const result = this.query({ ...request, offset: 0, limit: 10000 }, 10000, false);
    if (!result.indexed)
      throw new Error('Index this location before selecting all indexed matches.');
    if (
      result.status.running ||
      result.status.roots.some(
        (root) =>
          (!request.root || containsPath(root.path, request.root)) && root.status !== 'ready',
      )
    )
      throw new Error(
        'Wait for this location to finish indexing before taking a selection snapshot.',
      );
    if (result.scanLimited)
      throw new Error('This query reached its scan limit. Narrow it before selecting all matches.');
    if (result.more)
      throw new Error(
        'This query has more than 10,000 matches. Narrow the query before taking a basket snapshot.',
      );
    return {
      id: randomUUID(),
      // the tags' paths were looked up for this query: the snapshot keeps the query only
      query: { ...request, offset: undefined, limit: undefined, tagged: undefined },
      entries: result.entries,
      created: Date.now(),
      coverage: 'indexed-matches',
    };
  }
  configure(config: ApplicationSettings['search'], rebuild = false): void {
    // An unchanged configuration crawls again only the roots it could not read, which a folder pick
    // may have made readable: every pick configured the index anew, and every configuration crawled
    // every root from the start. A rebuild crawls everything and extracts every document again.
    const applied = JSON.stringify(config);
    if (!rebuild && applied === this.applied) {
      this.retryOffline();
      return;
    }
    this.applied = applied;
    this.rebuilding = rebuild;
    this.config = config;
    this.excluded = searchExclusions(config.exclusions);
    // Each purge reads every row, which takes seconds in a large index, and every launch configured
    // anew: they run only when the folders, their text permission or the exclusions changed.
    const purge = JSON.stringify([
      config.roots,
      config.contentRoots,
      [...config.exclusions].sort(),
    ]);
    if (rebuild || this.meta('purged') !== purge) {
      this.purge(config);
      this.setMeta('purged', purge);
    }
    this.count = undefined;
    this.generation++;
    const generation = this.generation;
    this.active = (this.active ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (generation !== this.generation) return;
        this.roots = config.roots.map((path) => ({
          path,
          status: config.paused ? 'paused' : 'indexing',
          count: 0,
          errors: 0,
        }));
        this.emit(this.status());
        if (config.paused) return;
        for (const root of this.roots) await this.crawl(root, generation);
        // the rebuild is done: a later crawl of a changed folder keeps what it extracted
        if (generation === this.generation) this.rebuilding = false;
      });
  }
  /**
   * Removes what the configuration no longer allows: rows outside the folders, body text outside
   * the text-permitted folders, and rows the exclusions now name. Every row left is searchable,
   * so `status` counts by root alone.
   */
  private purge(config: ApplicationSettings['search']): void {
    // Revoked folder authority must remove names and metadata as well as body text.
    const deniedPaths: string[] = [],
      deniedArgs: (string | number)[] = [];
    for (const root of config.roots) {
      const prefix = root.replace(/\/$/, '') + '/';
      deniedPaths.push('NOT (path=? OR substr(path,1,?)=?)');
      deniedArgs.push(root, prefix.length, prefix);
    }
    const where = deniedPaths.length ? deniedPaths.join(' AND ') : '1';
    this.db
      .prepare('DELETE FROM names WHERE rowid IN (SELECT rowid FROM files WHERE ' + where + ')')
      .run(...deniedArgs);
    this.db.prepare('DELETE FROM files WHERE ' + where).run(...deniedArgs);
    // Excluded folders and names, which a crawl skips but an earlier configuration indexed.
    const rules = searchExclusionRules(config.exclusions);
    const excluded: string[] = [],
      excludedArgs: (string | number)[] = [];
    for (const rule of rules.paths) {
      const prefix = rule.endsWith(path.sep) ? rule : rule + path.sep;
      excluded.push('(path=? OR substr(path,1,?)=?)');
      excludedArgs.push(rule, prefix.length, prefix);
    }
    for (const rule of rules.names) {
      excluded.push('instr(?||path||?,?)>0');
      excludedArgs.push(path.sep, path.sep, path.sep + rule + path.sep);
    }
    if (excluded.length) {
      const named = excluded.join(' OR ');
      this.db
        .prepare('DELETE FROM names WHERE rowid IN (SELECT rowid FROM files WHERE ' + named + ')')
        .run(...excludedArgs);
      this.db.prepare('DELETE FROM files WHERE ' + named).run(...excludedArgs);
    }
    // Revoking text-index permission removes stored body text, even while paused.
    const denied = ["content<>''"],
      args: (string | number)[] = [];
    for (const root of config.contentRoots) {
      const prefix = root.replace(/\/$/, '') + '/';
      denied.push('NOT (path=? OR substr(path,1,?)=?)');
      args.push(root, prefix.length, prefix);
    }
    this.db.prepare("UPDATE names SET content='' WHERE " + denied.join(' AND ')).run(...args);
    this.db.exec(
      "DELETE FROM source_documents WHERE path NOT IN (SELECT path FROM files) OR path IN (SELECT path FROM names WHERE content='')",
    );
  }
  private meta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as
      { value: string } | undefined;
    return row?.value;
  }
  private setMeta(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, value);
  }
  /** Crawls again, in the current configuration, the roots that could not be read. */
  private retryOffline(): void {
    if (this.config?.paused) return;
    const generation = this.generation;
    this.active = (this.active ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        for (const root of this.roots) {
          if (generation !== this.generation) return;
          if (root.status !== 'offline') continue;
          root.status = 'indexing';
          root.count = 0;
          root.errors = 0;
          this.emit(this.status());
          await this.crawl(root, generation);
        }
      });
  }
  /** Whether the document's text, and its search row, are stored for its current version. */
  private extracted(item: FileEntry): boolean {
    const row = this.db
      .prepare(
        'SELECT source_documents.version AS version FROM source_documents JOIN files ON files.path=source_documents.path JOIN names ON names.rowid=files.rowid WHERE source_documents.path=?',
      )
      .get(item.path) as { version: string } | undefined;
    return row?.version === JSON.stringify(sourceVersion(item));
  }
  async settled(): Promise<void> {
    await this.active;
  }
  private async crawl(
    root: IndexStatus['roots'][number],
    generation: number,
    ownerRoot = root.path,
  ): Promise<void> {
    const buffer: {
      item: FileEntry;
      root: string;
      seen: number;
      content?: string | DocumentData;
    }[] = [];
    const flush = () => {
      if (buffer.length) {
        this.putMany(buffer);
        buffer.length = 0;
      }
    };
    const seen = this.stamp();
    const queue = [absolute(root.path)];
    let cursor = 0;
    let tick = 0;
    while (cursor < queue.length && generation === this.generation) {
      const folder = queue[cursor++];
      if (folder === undefined || this.excluded(folder)) continue;
      try {
        const directory = await opendir(folder);
        for await (const child of directory) {
          if (generation !== this.generation) return;
          const file = path.join(folder, child.name);
          if (this.excluded(file)) continue;
          try {
            const item = await entry(file);
            let content: string | DocumentData | undefined = '';
            if (
              !item.directory &&
              item.kind === 'file' &&
              item.size <= 16000000 &&
              this.config?.contentRoots.some((root) => containsPath(root, file))
            )
              // A document whose text is stored for this version keeps it: every crawl (each
              // launch, each configuration) extracted every document under the content roots again.
              content =
                !this.rebuilding && this.extracted(item)
                  ? undefined
                  : ((await this.extract?.(file).catch(() => '')) ?? '');
            item.hidden ||= path
              .relative(ownerRoot, file)
              .split('/')
              .some((part) => part.startsWith('.'));
            if (generation !== this.generation) return;
            buffer.push({ item, root: ownerRoot, seen, content });
            if (buffer.length >= 100) flush();
            root.count++;
            if (child.isDirectory()) queue.push(file);
          } catch {
            root.errors++;
          }
          if (Date.now() - tick > 500) {
            tick = Date.now();
            this.emit(this.status());
          }
        }
      } catch {
        root.errors++;
        if (folder === root.path) {
          flush();
          root.status = 'offline';
          this.emit(this.status());
          return;
        }
      }
      if (cursor > 2000) {
        queue.splice(0, cursor);
        cursor = 0;
      }
    }
    if (generation !== this.generation) return;
    flush();
    const stale = root.errors
      ? []
      : (this.db
          .prepare('SELECT path FROM files WHERE root=? AND seen<? AND substr(path,1,?)=?')
          .all(
            ownerRoot,
            seen,
            root.path.replace(/\/$/, '').length + 1,
            root.path.replace(/\/$/, '') + '/',
          ) as { path: string }[]);
    // in transactions of 500, yielding between them: one commit per row took seconds after a
    // large folder moved, and kept previews waiting in this worker
    for (let start = 0; start < stale.length; start += 500) {
      if (generation !== this.generation) return;
      this.db.exec('BEGIN');
      try {
        for (const file of stale.slice(start, start + 500)) {
          this.db
            .prepare('DELETE FROM names WHERE rowid=(SELECT rowid FROM files WHERE path=?)')
            .run(file.path);
          this.db.prepare('DELETE FROM files WHERE path=?').run(file.path);
          // its extracted text too, as `remove` does: it stayed until the next configuration
          this.db.prepare('DELETE FROM source_documents WHERE path=?').run(file.path);
        }
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    this.count = undefined;
    root.status = 'ready';
    this.emit(this.status());
  }
  update(file: string, removed = false): Promise<void> {
    const task = this.updates
      .catch(() => {})
      .then(async () => {
        await this.active;
        if (removed) {
          this.remove(file);
          this.emit(this.status());
          return;
        }
        const root = this.config?.roots.find((root) => containsPath(root, file));
        if (!root || this.excluded(file) || this.config?.paused) return;
        try {
          const generation = this.generation;
          const item = await entry(file);
          item.hidden ||= path
            .relative(root, file)
            .split('/')
            .some((part) => part.startsWith('.'));
          let content: string | DocumentData = '';
          if (
            !item.directory &&
            item.kind === 'file' &&
            item.size <= 16000000 &&
            this.config?.contentRoots.some((root) => containsPath(root, file))
          )
            content = (await this.extract?.(file).catch(() => '')) ?? '';
          if (generation !== this.generation) return;
          this.putMany([{ item, root, seen: this.stamp(), content }]);
          if (item.directory && item.kind !== 'symlink')
            await this.crawl(
              { path: file, status: 'indexing', count: 0, errors: 0 },
              this.generation,
              root,
            );
        } catch {
          this.remove(file);
        }
        this.emit(this.status());
      });
    this.updates = task;
    return task;
  }
  async close(): Promise<void> {
    this.generation++;
    await this.active;
    await this.updates;
    this.db.close();
  }
}
