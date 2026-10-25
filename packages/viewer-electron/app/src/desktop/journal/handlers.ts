import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import type { ApiHandlers } from '../ipc/schemas';
import type {
  JournalExportPreview,
  JournalQuery,
  JournalRecord,
} from '../../domain/journal/events';
import type { JournalStore } from './store';
import { inspectReviewedFile, type ReviewedFile } from '../native/reviewed-file';

interface JournalPorts {
  store: JournalStore;
  chooseExport(owner: number): Promise<string | undefined>;
  confirmClear(owner: number, file: string): Promise<boolean>;
  trash(reviewed: ReviewedFile): Promise<void>;
  allowHuman(owner: number): void;
}

type JournalHandlers = Pick<
  ApiHandlers,
  'journalQuery' | 'journalExportPreview' | 'journalExport' | 'journalClear'
>;

/** Export tickets bind the exact preview to one human window; no arbitrary path/write IPC. */
export function createJournalHandlers(ports: JournalPorts): JournalHandlers {
  const previews = new Map<number, JournalExportPreview & { at: number }>();
  const busy = new Set<number>();
  return {
    journalQuery: ([query], owner) => {
      ports.allowHuman(owner);
      return ports.store.query(query);
    },
    journalExportPreview: async ([input], owner) => {
      ports.allowHuman(owner);
      const records: JournalRecord[] = [];
      let query: JournalQuery = { ...input, limit: 500, before: undefined };
      let truncated = false;
      do {
        const page = await ports.store.query(query);
        records.push(...page.records);
        truncated = page.nextBefore !== undefined;
        query = { ...query, through: page.through, before: page.nextBefore };
      } while (truncated && records.length < 2000);
      const text = JSON.stringify({ version: 1, records }, null, 2) + '\n';
      const preview = {
        id: randomUUID(),
        count: records.length,
        bytes: Buffer.byteLength(text),
        text,
        truncated,
        at: Date.now(),
      };
      // Bounded even when windows close without an export.
      if (!previews.has(owner) && previews.size >= 8)
        previews.delete(previews.keys().next().value!);
      previews.set(owner, preview);
      return preview;
    },
    journalExport: async ([id], owner) => {
      ports.allowHuman(owner);
      const preview = previews.get(owner);
      if (!preview || preview.id !== id || Date.now() - preview.at > 10 * 60_000)
        throw new Error('The export preview expired. Preview these events again.');
      if (busy.has(owner)) throw new Error('An export is already open for this window.');
      busy.add(owner);
      try {
        const file = await ports.chooseExport(owner);
        if (!file) return false;
        // A new file only. Never overwrite an existing export, link or user document.
        const handle = await open(file, 'wx', 0o600);
        try {
          await handle.writeFile(preview.text);
          await handle.sync();
        } finally {
          await handle.close();
        }
        previews.delete(owner);
        return true;
      } finally {
        busy.delete(owner);
      }
    },
    journalClear: (_args, owner) => {
      ports.allowHuman(owner);
      return ports.store.clear(async (file) => {
        const inspected = await inspectReviewedFile(file, ports.store.status().byteLimit);
        if (!(await ports.confirmClear(owner, file))) return false;
        ports.allowHuman(owner);
        await ports.trash(inspected.reviewed);
        return true;
      });
    },
  };
}
