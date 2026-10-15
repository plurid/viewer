import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CustomAction } from '../domain/automation';
import { DocumentStore } from './document-store';

const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Describes exactly what a custom action runs, for a native confirmation. */
export function executionSummary(action: CustomAction): { title: string; detail: string } {
  const executor = action.executor;
  const detail =
    executor.kind === 'shell'
      ? `${executor.executable} runs this script${executor.perItem ? ' once per selected item' : ''}:\n\n${executor.script}`
      : executor.kind === 'executable'
        ? `${[executor.executable, ...executor.args].join(' ')}${executor.perItem ? '\n\nRuns once per selected item.' : ''}`
        : `Terminal profile ${JSON.stringify(executor)}`;
  return { title: `Run “${action.name}” for the first time?`, detail: detail.slice(0, 6000) };
}

/**
 * Remembers, outside editable configuration, which exact executors the person has
 * confirmed. A new or changed shell or executable action asks natively once, so
 * an imported or externally edited configuration cannot run code silently.
 */
export class ExecutionConfirmations {
  private store: DocumentStore<string[]>;
  private confirmed?: Promise<Set<string>>;
  private asking = new Map<string, Promise<void>>();
  constructor(
    directory: string,
    private ask: (summary: { title: string; detail: string }) => Promise<boolean>,
  ) {
    this.store = new DocumentStore(path.join(directory, 'confirmed-actions-v1.json'), (value) =>
      z
        .array(z.string().regex(/^[0-9a-f]{64}$/))
        .max(1000)
        .parse(value),
    );
  }
  private load(): Promise<Set<string>> {
    return (this.confirmed ??= this.store
      .load()
      .then((values) => new Set(values ?? []))
      .catch((error: unknown) => {
        this.confirmed = undefined;
        throw error;
      }));
  }
  async require(action: CustomAction): Promise<void> {
    if (action.executor.kind !== 'shell' && action.executor.kind !== 'executable') return;
    const key = fingerprint(action.executor);
    const confirmed = await this.load();
    if (confirmed.has(key)) return;
    // One dialog per executor, even when the action is started twice quickly.
    let pending = this.asking.get(key);
    if (!pending) {
      pending = (async () => {
        if (!(await this.ask(executionSummary(action))))
          throw new Error('The action was not confirmed. Nothing was run.');
        confirmed.add(key);
        await this.store.save([...confirmed].slice(-1000));
      })().finally(() => this.asking.delete(key));
      this.asking.set(key, pending);
    }
    await pending;
  }
}
