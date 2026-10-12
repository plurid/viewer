import { DatabaseSync } from 'node:sqlite';
import { opendir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { FileEntry } from '../domain/contracts';
import type {
  ApplicationSettings,
  IndexedQuery,
  IndexedResult,
  IndexStatus,
} from '../domain/services';
import { absolute, entry } from './filesystem';
const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();
const inside = (file: string, root: string) =>
  file === root || file.startsWith(root.replace(/\/$/, '') + '/');
export class FileIndex {
  private db: DatabaseSync;
  private roots: IndexStatus['roots'] = [];
  private generation = 0;
  private count?: number;
  private config?: ApplicationSettings['search'];
  private active?: Promise<void>;
  private updates: Promise<void> = Promise.resolve();
  constructor(
    file: string,
    private emit: (value: IndexStatus) => void = () => {},
    private extract?: (file: string) => Promise<string>,
    initialScope?: ApplicationSettings['search'],
  ) {
    this.config = initialScope;
    this.db = new DatabaseSync(file);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000; CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, root TEXT, name TEXT, extension TEXT, size INTEGER, modified REAL, hidden INTEGER, directory INTEGER, data TEXT, seen INTEGER); CREATE INDEX IF NOT EXISTS files_root ON files(root); CREATE INDEX IF NOT EXISTS files_ext ON files(extension); CREATE INDEX IF NOT EXISTS files_name ON files(name,path); CREATE VIRTUAL TABLE IF NOT EXISTS names USING fts5(name, content, path UNINDEXED, tokenize='trigram');",
    );
    const version = Number(
      (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    );
    if (version < 2) {
      // Reconcile the disposable search index without touching any source file.
      this.db.exec(
        "BEGIN; CREATE TEMP TABLE previous_content AS SELECT path,content FROM names; CREATE INDEX previous_content_path ON previous_content(path); DELETE FROM names; INSERT INTO names(rowid,name,content,path) SELECT files.rowid,files.name,coalesce(previous_content.content,''),files.path FROM files LEFT JOIN previous_content ON files.path=previous_content.path; DROP TABLE previous_content; PRAGMA user_version=2; COMMIT;",
      );
    }
  }
  static async open(
    file: string,
    emit?: (value: IndexStatus) => void,
    extract?: (file: string) => Promise<string>,
    initialScope?: ApplicationSettings['search'],
  ) {
    await mkdir(path.dirname(file), { recursive: true });
    return new FileIndex(file, emit, extract, initialScope);
  }
  put(item: FileEntry, root: string, seen = Date.now(), content = ''): void {
    this.putMany([{ item, root, seen, content }]);
  }
  ingest(items: FileEntry[], root: string): void {
    for (let start = 0; start < items.length; start += 100)
      this.putMany(
        items
          .slice(start, start + 100)
          .map((item) => ({ item, root, seen: Date.now(), content: '' })),
      );
  }
  private putMany(items: { item: FileEntry; root: string; seen: number; content: string }[]): void {
    const drop = this.db.prepare(
      'DELETE FROM names WHERE rowid=(SELECT rowid FROM files WHERE path=?)',
    );
    const file = this.db.prepare(
      'INSERT INTO files VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET root=excluded.root,name=excluded.name,extension=excluded.extension,size=excluded.size,modified=excluded.modified,hidden=excluded.hidden,directory=excluded.directory,data=excluded.data,seen=excluded.seen',
    );
    const name = this.db.prepare(
      'INSERT INTO names(rowid,name,content,path) VALUES((SELECT rowid FROM files WHERE path=?),?,?,?)',
    );
    this.db.exec('BEGIN');
    try {
      for (const { item, root, seen, content } of items) {
        drop.run(item.path);
        file.run(
          item.path,
          root,
          fold(item.name),
          item.extension,
          item.size,
          item.modified,
          +item.hidden,
          +item.directory,
          JSON.stringify(item),
          seen,
        );
        name.run(item.path, fold(item.name), fold(content), item.path);
      }
      this.db.exec('COMMIT');
      this.count = undefined;
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
    for (const rule of this.config?.exclusions || []) {
      if (rule.startsWith('/')) {
        where.push('NOT (files.path=? OR substr(files.path,1,?)=?)');
        params.push(rule, rule.length + 1, rule + '/');
      } else {
        where.push("instr('/'||files.path||'/',?)=0");
        params.push('/' + rule + '/');
      }
    }
    return { where, params };
  }
  status(): IndexStatus {
    if (this.count === undefined) {
      const { where, params } = this.scope();
      this.count = Number(
        (
          this.db
            .prepare('SELECT count(*) AS n FROM files WHERE ' + where.join(' AND '))
            .get(...params) as { n: number }
        ).n,
      );
    }
    return {
      roots: this.roots.map((root) => ({ ...root })),
      count: this.count,
      running: this.roots.some((root) => root.status === 'indexing'),
    };
  }
  query(request: IndexedQuery): IndexedResult {
    const root = request.root;
    const indexed =
      !root ||
      !!this.config?.roots.some((indexedRoot) => inside(root, indexedRoot) && !this.excluded(root));
    let text = request.query.trim();
    const { where, params } = this.scope();
    text = text
      .replace(
        /\b(ext|kind|path|size|modified):("[^"]*"|\S+)/g,
        (_all, key: string, raw: string) => {
          const value = raw.replace(/^"|"$/g, '');
          if (key === 'ext') {
            const ext = value.toLowerCase().replace(/^\./, '').split(',');
            where.push(`files.extension IN (${ext.map(() => '?').join(',')})`);
            params.push(...ext);
          }
          if (key === 'kind') {
            where.push('files.directory=?');
            params.push(value === 'folder' || value === 'directory' ? 1 : 0);
          }
          if (key === 'path') {
            where.push('instr(files.path,?)>0');
            params.push(value);
          }
          if (key === 'size') {
            const m = value.match(/^([<>]?)(\d+(?:\.\d+)?)([kmgt]?b)?$/i);
            if (!m) throw new Error('Size filters use size:>10mb.');
            where.push('files.size' + (m[1] || '=') + '?');
            params.push(
              Number(m[2]) *
                ({ kb: 1024, mb: 1048576, gb: 1073741824, tb: 1099511627776 }[
                  m[3]?.toLowerCase() as 'kb'
                ] || 1),
            );
          }
          if (key === 'modified') {
            const op = /^[<>]/.test(value) ? value[0] : '>';
            const date = Date.parse(value.replace(/^[<>]/, ''));
            if (!Number.isFinite(date))
              throw new Error('Modified filters use modified:>2025-01-01.');
            where.push('files.modified' + op + '?');
            params.push(date);
          }
          return '';
        },
      )
      .trim()
      .replace(/^"|"$/g, '');
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
    if (text.length >= 3) {
      const term = (request.content ? '' : 'name:') + '"' + fold(text).replace(/"/g, '""') + '"';
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
    } else if (text) {
      where.push('instr(files.name,?)>0');
      params.push(fold(text));
    }
    const limit = Math.max(1, Math.min(500, request.limit ?? 150));
    const rows = this.db
      .prepare(
        'SELECT files.data FROM files' +
          join +
          ' WHERE ' +
          where.join(' AND ') +
          ' ORDER BY files.name,files.path LIMIT ? OFFSET ?',
      )
      .all(...params, limit + 1, Math.max(0, request.offset ?? 0)) as { data: string }[];
    return {
      entries: rows.slice(0, limit).map((row) => JSON.parse(row.data) as FileEntry),
      more: rows.length > limit,
      indexed,
      status: this.status(),
    };
  }
  private excluded(file: string): boolean {
    return !!this.config?.exclusions.some((rule) =>
      rule.startsWith('/') ? inside(file, rule) : file.split('/').includes(rule),
    );
  }
  configure(config: ApplicationSettings['search']): void {
    this.config = config;
    // Revoking text-index permission removes stored body text, even while paused.
    const denied = ["content<>''"],
      args: (string | number)[] = [];
    for (const root of config.contentRoots) {
      const prefix = root.replace(/\/$/, '') + '/';
      denied.push('NOT (path=? OR substr(path,1,?)=?)');
      args.push(root, prefix.length, prefix);
    }
    this.db.prepare("UPDATE names SET content='' WHERE " + denied.join(' AND ')).run(...args);
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
      });
  }
  async settled(): Promise<void> {
    await this.active;
  }
  private async crawl(
    root: IndexStatus['roots'][number],
    generation: number,
    ownerRoot = root.path,
  ): Promise<void> {
    const buffer: { item: FileEntry; root: string; seen: number; content: string }[] = [];
    const flush = () => {
      if (buffer.length) {
        this.putMany(buffer);
        buffer.length = 0;
      }
    };
    const seen = Date.now();
    const queue = [absolute(root.path)];
    let cursor = 0;
    let tick = 0;
    while (cursor < queue.length && generation === this.generation) {
      const folder = queue[cursor++];
      if (this.excluded(folder)) continue;
      try {
        const directory = await opendir(folder);
        for await (const child of directory) {
          if (generation !== this.generation) return;
          const file = path.join(folder, child.name);
          if (this.excluded(file)) continue;
          try {
            const item = await entry(file);
            let content = '';
            if (
              !item.directory &&
              item.kind === 'file' &&
              item.size <= 16000000 &&
              this.config?.contentRoots.some((root) => inside(file, root))
            )
              content = (await this.extract?.(file).catch(() => '')) ?? '';
            item.hidden ||= path
              .relative(ownerRoot, file)
              .split('/')
              .some((part) => part.startsWith('.'));
            if (generation !== this.generation) return;
            buffer.push({ item, root: ownerRoot, seen, content: content.slice(0, 150000) });
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
    for (const file of stale) {
      this.db
        .prepare('DELETE FROM names WHERE rowid=(SELECT rowid FROM files WHERE path=?)')
        .run(file.path);
      this.db.prepare('DELETE FROM files WHERE path=?').run(file.path);
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
        const root = this.config?.roots.find((root) => inside(file, root));
        if (!root || this.excluded(file) || this.config?.paused) return;
        try {
          const generation = this.generation;
          const item = await entry(file);
          item.hidden ||= path
            .relative(root, file)
            .split('/')
            .some((part) => part.startsWith('.'));
          let content = '';
          if (
            !item.directory &&
            item.kind === 'file' &&
            item.size <= 16000000 &&
            this.config?.contentRoots.some((root) => inside(file, root))
          )
            content = (await this.extract?.(file).catch(() => '')) ?? '';
          if (generation !== this.generation) return;
          this.put(item, root, Date.now(), content.slice(0, 150000));
          if (item.directory)
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
