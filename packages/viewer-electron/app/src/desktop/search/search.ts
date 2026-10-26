import path from 'node:path';
import { opendir } from 'node:fs/promises';
import { spotlightAvailable, spotlightNames, spotlightTagged } from './spotlight';
import type { SearchRequest, SearchBatch, FileEntry } from '../../domain/contracts';
import {
  matchesQuery,
  parseFileQuery,
  QueryError,
  type FileQuery,
  type QueryEntry,
} from '../../domain/search/query';
import { absolute, entry } from '../files/filesystem';

export class Search {
  private requests = new Map<string, AbortController>();
  private work = new Set<Promise<void>>();
  private closed = false;
  constructor(
    private emit: (batch: SearchBatch) => void,
    /** Spotlight lookup; absent where it cannot run (other platforms, the App Store build). */
    private spotlight:
      | ((root: string, query: string, signal: AbortSignal) => Promise<string[]>)
      | null = spotlightAvailable ? spotlightNames : null,
    /** Spotlight's Finder tags, for `tag:`. */
    private tagged: (
      root: string,
      tag: string,
      signal: AbortSignal,
    ) => Promise<string[]> = spotlightTagged,
    private authorize: (file: string) => Promise<void> = async () => {},
  ) {}
  cancel(id: string): void {
    this.requests.get(id)?.abort();
  }
  async quiesce(): Promise<void> {
    for (const controller of this.requests.values()) controller.abort();
    await Promise.allSettled(this.work);
  }
  close(): Promise<void> {
    this.closed = true;
    return this.quiesce();
  }
  start(request: SearchRequest): void {
    if (this.closed) throw new Error('Folder search has closed.');
    // the file query language (domain/search/query.ts), as the folder filter and the index read it
    let query: FileQuery;
    try {
      query = parseFileQuery(request.query);
    } catch (error) {
      throw error instanceof QueryError ? new Error(error.message) : error;
    }
    this.cancel(request.id);
    const abort = new AbortController();
    this.requests.set(request.id, abort);
    const work = this.walk({ ...request, root: absolute(request.root) }, query, abort).finally(
      () => {
        if (this.requests.get(request.id) === abort) this.requests.delete(request.id);
        this.work.delete(work);
      },
    );
    this.work.add(work);
    void work.catch(() => {});
  }
  private async walk(
    request: SearchRequest,
    query: FileQuery,
    abort: AbortController,
  ): Promise<void> {
    const queue = [request.root];
    let visited = 0,
      errors = 0,
      found = 0,
      truncated = false;
    let entries: FileEntry[] = [];
    let tick = Date.now();
    const flush = (done: boolean) => {
      this.emit({ id: request.id, entries, done, visited, errors, truncated });
      entries = [];
      tick = Date.now();
    };
    // a tag's files from Spotlight first: the walk then asks each item about them
    const tags = new Map<string, Set<string>>();
    try {
      for (const tag of query.tags)
        tags.set(tag, new Set(await this.tagged(request.root, tag, abort.signal)));
    } catch (error) {
      errors++;
      flush(true);
      throw error;
    }
    const facts = { tagged: (tag: string) => tags.get(tag) };
    const hiddenPart = (relative: string) =>
      !request.showHidden && relative.split(path.sep).some((part) => part.startsWith('.'));
    // Spotlight answers indexed folders almost at once, by a word of the name; the walk below
    // still completes the list, because Spotlight cannot tell an unindexed folder from one
    // without matches.
    const shown = new Set<string>();
    const word = query.words.toSorted((a, b) => b.length - a.length)[0];
    if (this.spotlight && word)
      try {
        for (const file of await this.spotlight(request.root, word, abort.signal)) {
          if (abort.signal.aborted || shown.size >= 2000) break;
          const relative = path.relative(request.root, file);
          if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
          if (hiddenPart(relative)) continue;
          try {
            await this.authorize(file);
            const item = await entry(file);
            if (!matchesQuery(query, item, facts)) continue;
            entries.push(item);
            shown.add(file);
            found++;
          } catch {
            // The walk reports anything it cannot read.
          }
          if (entries.length >= 64) flush(false);
        }
        if (entries.length) flush(false);
      } catch {
        // Spotlight is only a shortcut; the walk is authoritative.
      }
    try {
      while (queue.length && !abort.signal.aborted) {
        const folder = queue.shift()!;
        try {
          await this.authorize(folder);
          const directory = await opendir(folder);
          for await (const child of directory) {
            if (abort.signal.aborted) break;
            if (!request.showHidden && child.name.startsWith('.')) continue;
            visited++;
            const file = path.join(folder, child.name);
            // Do not recurse through symlinks (cycles and unintended external trees).
            if (child.isDirectory()) queue.push(file);
            if (!shown.has(file)) {
              // a directory read answers names, extensions and kinds; sizes and dates need a stat
              const light: QueryEntry = {
                name: child.name,
                path: file,
                extension: path.extname(child.name).slice(1).toLowerCase(),
                directory: child.isDirectory(),
                hidden: child.name.startsWith('.'),
                kind: child.isSymbolicLink()
                  ? 'symlink'
                  : child.isDirectory()
                    ? 'directory'
                    : 'file',
              };
              if (query.needsStat || matchesQuery(query, light, facts))
                try {
                  await this.authorize(file);
                  const item = await entry(file);
                  if (!query.needsStat || matchesQuery(query, item, facts)) {
                    entries.push(item);
                    found++;
                  }
                } catch {
                  errors++;
                }
            }
            if (entries.length >= 64 || Date.now() - tick > 150) flush(false);
            if (found >= 20000 || visited >= 500000) {
              truncated = true;
              queue.length = 0;
              break;
            }
          }
        } catch {
          errors++;
        }
      }
    } finally {
      flush(true);
    }
  }
}
