import { PreviewWorker } from './worker-client';
import type { DelimitedPreview } from './table-data';

export function createTableSession() {
  const client = new PreviewWorker(
    () => new Worker(new URL('./table.worker.ts', import.meta.url), { type: 'module' }),
    'Table processing',
  );
  return {
    load: (text: string, delimiter: string) =>
      client.request<DelimitedPreview>({ action: 'parse', text, delimiter }),
    filter: (query: string, signal: AbortSignal) =>
      client.request<Uint32Array>({ action: 'filter', query }, signal),
    close: () => client.close(),
  };
}
