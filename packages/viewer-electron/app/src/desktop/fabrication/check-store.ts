import path from 'node:path';
import type { CheckDocument, CheckIndex } from '../../domain/fabrication/check-document';
import { checkDocumentSchema, checkIndexSchema } from '../../domain/fabrication/check-document';
import { DocumentStore } from '../persistence/document-store';

/** Each paid result has its own durable document; the small index only discovers documents. */
export class CheckStore {
  private documents = new Map<string, DocumentStore<CheckDocument>>();
  private index: DocumentStore<CheckIndex>;
  private writes: Promise<void> = Promise.resolve();
  constructor(private folder: string) {
    this.index = new DocumentStore(path.join(folder, 'index.json'), (value) =>
      checkIndexSchema.parse(value),
    );
  }
  private document(id: string) {
    const valid = checkDocumentSchema.shape.id.parse(id);
    let store = this.documents.get(valid);
    if (!store) {
      store = new DocumentStore(path.join(this.folder, `${valid}.json`), (value) => {
        const document = checkDocumentSchema.parse(value);
        if (document.id !== valid) throw new Error('This saved check has a different identity.');
        return document;
      });
      this.documents.set(valid, store);
    }
    return store;
  }
  read(id: string) {
    return this.document(id).load();
  }
  async list() {
    await this.writes;
    return (await this.index.load())?.checks ?? [];
  }
  save(input: CheckDocument): Promise<void> {
    const document = checkDocumentSchema.parse(input);
    const write = this.writes
      .catch(() => {})
      .then(async () => {
        await this.document(document.id).save(document);
        const index = (await this.index.load()) ?? { version: 1 as const, checks: [] };
        const { id, job, folder, paths, status, updated } = document;
        const summary = {
          id,
          job,
          folder,
          paths,
          status,
          updated,
          ...(document.result ? { summary: document.result.summary } : {}),
        };
        const position = index.checks.findIndex((check) => check.id === id);
        if (position < 0) index.checks.push(summary);
        else index.checks[position] = summary;
        await this.index.save(index);
      });
    this.writes = write;
    return write;
  }
  async flush(): Promise<void> {
    await this.writes;
    await Promise.all([
      this.index.flush(),
      ...[...this.documents.values()].map((store) => store.flush()),
    ]);
  }
}
