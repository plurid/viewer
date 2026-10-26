import { readdir } from 'node:fs/promises';
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

/** Private documents outlive their views. There is deliberately no removal or
 * process route; writes compare the revision before replacing private metadata. */
export class Notes {
  private stores = new Map<string, DocumentStore<NoteDocument>>();
  private queues = new Map<string, Promise<unknown>>();
  private closed = false;
  constructor(
    private dataPath: string,
    private changed: (id: string, revision: number) => void = () => {},
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
        if (!z.uuid().safeParse(id).success) continue;
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
        const store = this.store(request.id),
          current = await store.load();
        if (!current)
          throw new Error('This note is unavailable. Your draft is kept in this window.');
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
