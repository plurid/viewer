import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  chatDocumentSchema,
  storedChatDocumentSchema,
  type ChatDocument,
} from '../../domain/models/chat';
import { DocumentStore } from '../persistence/document-store';

const maximumStoredBytes = 16_000_000;

/** Chat format upgrades retain the exact old bytes before any replacement. */
export class ChatDocumentStore {
  private readonly writer: DocumentStore<ChatDocument>;
  private loading?: Promise<ChatDocument | null>;

  constructor(readonly file: string) {
    this.writer = new DocumentStore(file, (value) => chatDocumentSchema.parse(value));
  }

  private async bytes(): Promise<Buffer | null> {
    try {
      const handle = await open(
        this.file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.size > maximumStoredBytes)
          throw new Error('The conversation is not a bounded regular file.');
        const bytes = Buffer.alloc(before.size);
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
          if (!bytesRead) throw new Error('The conversation changed while it was read.');
          offset += bytesRead;
        }
        const after = await handle.stat();
        if (
          before.ino !== after.ino ||
          before.dev !== after.dev ||
          before.size !== after.size ||
          before.ctimeMs !== after.ctimeMs ||
          before.mtimeMs !== after.mtimeMs
        )
          throw new Error('The conversation changed while it was read.');
        return bytes;
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  load(): Promise<ChatDocument | null> {
    if (this.loading) return this.loading;
    const loading = this.read().finally(() => {
      if (this.loading === loading) this.loading = undefined;
    });
    this.loading = loading;
    return loading;
  }

  private async read(): Promise<ChatDocument | null> {
    await this.writer.flush();
    const bytes = await this.bytes();
    if (!bytes) return null;
    const stored = storedChatDocumentSchema.parse(JSON.parse(bytes.toString('utf8')));
    if (stored.version === 3) return stored;
    const migrated = chatDocumentSchema.parse({ ...stored, version: 3 });
    const backup = await open(this.file + '.before-chat-v3-' + randomUUID() + '.bak', 'wx', 0o600);
    try {
      await backup.writeFile(bytes);
      await backup.sync();
    } finally {
      await backup.close();
    }
    if (process.platform !== 'win32') {
      const directory = await open(
        path.dirname(this.file),
        constants.O_RDONLY | constants.O_DIRECTORY,
      );
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
    const current = await this.bytes();
    if (!current?.equals(bytes))
      throw new Error('The conversation changed during its upgrade. Its original bytes were kept.');
    await this.writer.save(migrated);
    return migrated;
  }

  save(document: ChatDocument): Promise<void> {
    return this.writer.save(document);
  }

  flush(): Promise<void> {
    return this.writer.flush();
  }
}
