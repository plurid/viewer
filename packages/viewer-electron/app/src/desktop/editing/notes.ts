import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  noteRequestSchema,
  noteSchema,
  type NoteDocument,
  type NoteReply,
  type NoteRequest,
  type NoteSummary,
} from '../../domain/editing/notes';
import { DocumentStore } from '../persistence/document-store';
import { localPath } from '../schemas';

/** Private documents outlive their views. Human-requested removal moves exactly
 * one versioned document to the OS Trash; writes share its serialization queue. */
export class Notes {
  private stores = new Map<string, DocumentStore<NoteDocument>>();
  private queues = new Map<string, Promise<unknown>>();
  private closed = false;
  private trashed = new Set<string>();
  constructor(
    private dataPath: string,
    private changed: (id: string, revision: number) => void = () => {},
    private trash?: (file: string) => Promise<void>,
  ) {}
  private store(id: string) {
    z.uuid().parse(id);
    let store = this.stores.get(id);
    if (!store) {
      store = new DocumentStore(path.join(this.dataPath, 'notes', id + '.json'), (value) => {
        const document = noteSchema.parse(value);
        if (document.id !== id)
          throw new Error('The note identity does not match its saved record.');
        return document;
      });
      this.stores.set(id, store);
    }
    return store;
  }
  async request(input: NoteRequest): Promise<NoteReply> {
    if (this.closed) throw new Error('Notes are closing.');
    const request = noteRequestSchema.parse(input);
    if (request.kind === 'list') {
      const names = await readdir(path.join(this.dataPath, 'notes')).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return [];
          throw error;
        },
      );
      const notes: NoteSummary[] = [],
        problems: string[] = [];
      for (const name of names.filter((name) => name.endsWith('.json')).slice(0, 2000)) {
        const id = name.slice(0, -5);
        if (!z.uuid().safeParse(id).success || this.trashed.has(id)) continue;
        try {
          const note = await this.store(id).load();
          if (note) {
            const { text: _text, ...summary } = note;
            notes.push(summary);
          }
        } catch {
          problems.push(`A saved note could not be read and was preserved: ${name}`);
        }
      }
      return { kind: 'list', notes: notes.sort((a, b) => b.updated - a.updated), problems };
    }
    if (request.kind === 'create') {
      localPath.parse(request.directory);
      const document: NoteDocument = {
        id: randomUUID(),
        kind: request.format,
        title: request.format === 'checklist' ? 'Untitled checklist' : 'Untitled note',
        directory: request.directory,
        text: '',
        revision: 0,
        updated: Date.now(),
      };
      await this.store(document.id).save(document);
      this.changed(document.id, document.revision);
      return { kind: 'document', document };
    }
    if (request.kind === 'read') {
      if (this.trashed.has(request.id)) throw new Error('This note was moved to Trash.');
      const document = await this.store(request.id).load();
      if (!document)
        throw new Error(
          'This note is unavailable. Its view can be closed without removing a document.',
        );
      return { kind: 'document', document };
    }
    const work = (this.queues.get(request.id) ?? Promise.resolve())
      .catch(() => {})
      .then(async (): Promise<NoteReply> => {
        if (this.trashed.has(request.id)) throw new Error('This note was moved to Trash.');
        const store = this.store(request.id),
          current = await store.load();
        if (!current)
          throw new Error('This note is unavailable. Your draft is kept in this window.');
        if (request.kind === 'trash') {
          if (!this.trash) throw new Error('Moving notes to Trash is unavailable.');
          if (current.revision !== request.revision)
            throw new Error(
              'This note changed. Review its latest version before moving it to Trash.',
            );
          const directory = path.dirname(store.file);
          const parent = await lstat(directory);
          if (
            !parent.isDirectory() ||
            parent.isSymbolicLink() ||
            (await realpath(directory)) !== path.join(await realpath(this.dataPath), 'notes')
          )
            throw new Error('The private notes folder changed. The note was preserved.');
          const before = await lstat(store.file);
          if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)
            throw new Error('The note is not an ordinary private document. It was preserved.');
          await store.flush();
          const verified = await store.load();
          const after = await lstat(store.file);
          if (
            !verified ||
            verified.revision !== request.revision ||
            before.dev !== after.dev ||
            before.ino !== after.ino ||
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            before.ctimeMs !== after.ctimeMs
          )
            throw new Error('This note changed before removal. It was preserved.');
          await this.trash(store.file);
          this.trashed.add(request.id);
          this.stores.delete(request.id);
          return { kind: 'trashed', id: request.id };
        }
        if (current.revision !== request.revision) {
          const recovered: NoteDocument = {
            ...current,
            id: randomUUID(),
            title: (request.title + ' (recovered)').slice(0, 255),
            text: request.text,
            revision: 0,
            updated: Date.now(),
            recoveredFrom: current.id,
          };
          await this.store(recovered.id).save(recovered);
          this.changed(recovered.id, 0);
          return { kind: 'document', document: recovered };
        }
        const document = {
          ...current,
          title: request.title,
          text: request.text,
          revision: current.revision + 1,
          updated: Date.now(),
        };
        await store.save(document);
        this.changed(document.id, document.revision);
        return { kind: 'document', document };
      });
    this.queues.set(request.id, work);
    try {
      return await work;
    } finally {
      if (this.queues.get(request.id) === work) this.queues.delete(request.id);
    }
  }
  async flush(): Promise<void> {
    await Promise.all([
      ...this.queues.values(),
      ...[...this.stores.values()].map((store) => store.flush()),
    ]);
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
  }
}
