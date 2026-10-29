import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ExecutionTask } from '../../domain/automation/actions';
import {
  receiptSchema,
  receiptRequestSchema,
  type CommandReceipt,
  type ReceiptRequest,
  type ReceiptReply,
} from '../../domain/automation/receipts';
import { DocumentStore } from '../persistence/document-store';
import { errorMessage } from '../../domain/errors';

/** Private human-command evidence. Closing a view never removes a receipt or replays a command. */
export class CommandReceipts {
  /** A personal import adds new identities without changing any existing live receipt. */
  refreshDocuments(): void {
    this.admission = undefined;
  }
  private stores = new Map<string, DocumentStore<CommandReceipt>>();
  private latest = new Map<string, CommandReceipt>();
  private writes = new Map<string, Promise<void>>();
  private live = new Map<string, CommandReceipt>();
  private failures = new Map<string, string>();
  private admission?: Promise<Set<string>>;
  constructor(
    private root: string,
    private changed: (id: string) => void = () => {},
  ) {}
  private names(): Promise<Set<string>> {
    return (this.admission ??= readdir(path.join(this.root, 'command-receipts')).then(
      (names) =>
        new Set(names.filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5))),
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return new Set<string>();
        throw error;
      },
    ));
  }
  private store(id: string) {
    z.uuid().parse(id);
    let store = this.stores.get(id);
    if (!store) {
      store = new DocumentStore(path.join(this.root, 'command-receipts', id + '.json'), (value) => {
        const receipt = receiptSchema.parse(value);
        if (receipt.id !== id) throw new Error('Receipt identity changed.');
        return receipt;
      });
      this.stores.set(id, store);
    }
    return store;
  }
  record(task: ExecutionTask): Promise<void> {
    if (
      !task.command ||
      !task.directory ||
      task.started === undefined ||
      !task.workspaceID ||
      !task.paneID
    )
      return Promise.resolve();
    const receipt = receiptSchema.parse({
      id: task.id,
      title: task.title,
      command: task.command,
      directory: task.directory,
      folderIdentity: task.folderIdentity,
      started: task.started,
      ended: task.ended,
      status: task.status,
      output: task.output,
      truncated: task.truncated,
      exitCode: task.exitCode,
      error: task.error?.slice(0, 16000),
      workspaceID: task.workspaceID,
      paneID: task.paneID,
    });
    this.live.set(receipt.id, receipt);
    this.latest.set(receipt.id, receipt);
    const pending = this.writes.get(receipt.id);
    if (pending) return pending;
    const work = (async () => {
      const names = await this.names();
      if (!names.has(receipt.id) && names.size >= 1000)
        throw new Error('Command receipt storage is full. Existing receipts were preserved.');
      names.add(receipt.id);
      while (this.latest.has(receipt.id)) {
        const next = this.latest.get(receipt.id)!;
        this.latest.delete(receipt.id);
        await this.store(receipt.id).save(next);
        this.failures.delete(receipt.id);
        if (next.status !== 'running' && this.live.get(receipt.id) === next)
          this.live.delete(receipt.id);
        this.changed(receipt.id);
      }
    })()
      .catch((error) => {
        this.latest.delete(receipt.id);
        this.live.delete(receipt.id);
        this.failures.set(receipt.id, errorMessage(error));
        this.changed(receipt.id);
        throw error;
      })
      .finally(() => {
        if (this.writes.get(receipt.id) === work) this.writes.delete(receipt.id);
      });
    this.writes.set(receipt.id, work);
    return work;
  }
  async request(input: ReceiptRequest): Promise<ReceiptReply> {
    const request = receiptRequestSchema.parse(input);
    if (request.kind === 'summary') {
      const reply = await this.request({ kind: 'read', id: request.id });
      if (reply.kind !== 'receipt') throw new Error('Receipt unavailable.');
      const { command: _command, output: _output, ...summary } = reply.receipt;
      return { kind: 'summary', receipt: summary };
    }
    if (request.kind === 'read') {
      const failure = this.failures.get(request.id);
      if (failure) throw new Error(failure);
      const current = this.live.get(request.id);
      if (current) return { kind: 'receipt', receipt: current };
      const receipt = await this.store(request.id).load();
      if (!receipt) throw new Error('This command receipt is unavailable.');
      return {
        kind: 'receipt',
        receipt:
          receipt.status === 'running'
            ? {
                ...receipt,
                status: 'interrupted',
                error:
                  'Viewer closed before a final outcome was recorded. The command was not replayed.',
              }
            : receipt,
      };
    }
    const receipts: Extract<ReceiptReply, { kind: 'list' }>['receipts'] = [],
      problems: string[] = [];
    for (const id of [...(await this.names())].slice(0, 1000)) {
      if (!z.uuid().safeParse(id).success) continue;
      try {
        const reply = await this.request({ kind: 'read', id });
        if (reply.kind === 'receipt') {
          const { command: _command, output: _output, ...summary } = reply.receipt;
          receipts.push(summary);
        }
      } catch {
        problems.push('A command receipt could not be read and was preserved.');
      }
    }
    return { kind: 'list', receipts: receipts.sort((a, b) => b.started - a.started), problems };
  }
  async flush(): Promise<void> {
    while (this.writes.size) await Promise.allSettled([...this.writes.values()]);
  }
}
