import type { Resource } from '../../domain/contracts';
import type { DocumentData } from '../../domain/services';
import type {
  WorksheetDocumentRequest,
  WorksheetWindow,
} from '../../domain/previews/documents/office';
import { sourceVersion } from '../../domain/files/inspection';
import type { PreviewContext } from './contracts';

interface CachedDocument {
  path: string;
  data: DocumentData;
  bytes: number;
}

/** Completed data only: a cache hit never substitutes for a newly authorized resource. */
export class PreviewDocumentCache {
  private entries = new Map<string, CachedDocument>();
  private bytes = 0;
  private pending = new Set<{ path: string; invalidated: boolean }>();
  constructor(
    private maximumEntries = 16,
    private maximumBytes = 32 * 1024 * 1024,
  ) {}

  key(owner: string, resource: Resource, page?: Partial<WorksheetWindow>): string | undefined {
    const file = resource.entry;
    // A symlink entry describes the link, not its target version. Its desktop
    // extraction cache already inspects the resolved target safely.
    if (file.kind !== 'file' || !file.identity || resource.derivation) return;
    return JSON.stringify([
      owner,
      file.path,
      sourceVersion(file),
      page?.sheet || '',
      page?.fromRow ?? 1,
      page?.limit ?? 100,
    ]);
  }
  get(key: string | undefined): DocumentData | undefined {
    if (!key) return;
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.data;
  }
  async read(
    key: string | undefined,
    file: string,
    load: () => Promise<DocumentData>,
    signal: AbortSignal,
  ): Promise<DocumentData> {
    signal.throwIfAborted();
    const cached = this.get(key);
    if (cached) return cached;
    const pending = { path: file, invalidated: false };
    this.pending.add(pending);
    let value: DocumentData;
    try {
      value = await load();
      if (pending.invalidated) throw new Error('Preview access changed. Open the file again.');
    } finally {
      this.pending.delete(pending);
    }
    signal.throwIfAborted();
    if (!key) return value;
    const bytes = JSON.stringify(value).length * 2;
    if (bytes > this.maximumBytes) return value;
    const old = this.entries.get(key);
    if (old) this.bytes -= old.bytes;
    this.entries.delete(key);
    this.entries.set(key, { path: file, data: value, bytes });
    this.bytes += bytes;
    while (this.entries.size > this.maximumEntries || this.bytes > this.maximumBytes) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
    return value;
  }
  invalidate(root?: string): void {
    const within = (file: string) =>
      !root ||
      file === root ||
      ['/', '\\'].some((separator) => file.startsWith(root.replace(/[/\\]+$/, '') + separator));
    for (const pending of this.pending) if (within(pending.path)) pending.invalidated = true;
    for (const [key, entry] of this.entries)
      if (within(entry.path)) {
        this.entries.delete(key);
        this.bytes -= entry.bytes;
      }
  }
}

export const previewDocuments = new PreviewDocumentCache();

export function documentServices(
  base: PreviewContext['services'],
  owner: string,
  resource: Resource,
  signal: AbortSignal,
): PreviewContext['services'] {
  const key = (request?: Partial<WorksheetWindow>) => {
    if (request?.sheet) {
      // The initial request lets the reader choose a visible sheet. Reuse that
      // same page when the user later selects its explicit name in the tabs.
      const firstKey = previewDocuments.key(owner, resource, { ...request, sheet: undefined });
      const first = previewDocuments.get(firstKey)?.office;
      if (first?.kind === 'workbook' && first.page?.sheet === request.sheet) return firstKey;
    }
    return previewDocuments.key(owner, resource, request);
  };
  return {
    ...base,
    cachedDocument: (request) => (signal.aborted ? undefined : previewDocuments.get(key(request))),
    document: (id: string, request?: WorksheetDocumentRequest) =>
      id !== resource.id
        ? base.document(id, request)
        : previewDocuments.read(
            key(request),
            resource.entry.path,
            () => base.document(id, request),
            signal,
          ),
  };
}
