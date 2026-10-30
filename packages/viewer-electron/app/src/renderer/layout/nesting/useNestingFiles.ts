/**
 * The selected drawings, each read once by the parts worker and extracted again whenever its
 * units, marked layers or grouping change.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileEntry, Resource } from '../../../domain/contracts';
import { sourceVersion, type SourceVersion } from '../../../domain/files/inspection';
import { errorMessage } from '../../../domain/errors';
import { unitInfo } from '../../../domain/previews/drawings/dxf/units';
import type {
  DrawingFacts,
  FilePartsView,
  PartsOptions,
  PartsQuestion,
  PartsReply,
  PartsRequest,
} from './protocol';
import { nestingWorkers } from './workers';

/** Millimetres, unless a drawing says otherwise. */
export const defaultUnits = 4;
export type FileStatus = 'reading' | 'ready' | 'failed';
export interface NestingFile {
  entry: FileEntry;
  key: string;
  status: FileStatus;
  error?: string;
  version?: SourceVersion;
  drawing?: DrawingFacts;
  /** The `$INSUNITS` code the drawing is read in. */
  units: number;
  marks: string[];
  together: boolean;
  parts?: FilePartsView;
}
export type FileOptions = Pick<NestingFile, 'units' | 'marks' | 'together'>;

type Pending = (reply: PartsReply) => void;
class PartsClient {
  private worker = nestingWorkers.parts();
  private next = 0;
  private pending = new Map<number, Pending>();
  constructor() {
    this.worker.onmessage = (event: MessageEvent<PartsReply>) => {
      const reply = event.data;
      this.pending.get(reply.id)?.(reply);
      this.pending.delete(reply.id);
    };
  }
  private ask(question: PartsQuestion): Promise<PartsReply> {
    const id = ++this.next;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ ...question, id } satisfies PartsRequest);
    });
  }
  async read(key: string, url: string): Promise<DrawingFacts> {
    const reply = await this.ask({ kind: 'read', key, url });
    if (reply.kind === 'error') throw new Error(reply.error);
    if (reply.kind !== 'read') throw new Error('The drawing reader answered out of turn.');
    return reply.drawing;
  }
  async parts(key: string, options: PartsOptions): Promise<FilePartsView> {
    const reply = await this.ask({ kind: 'parts', key, options });
    if (reply.kind === 'error') throw new Error(reply.error);
    if (reply.kind !== 'parts') throw new Error('The drawing reader answered out of turn.');
    return reply.parts;
  }
  forget(key: string) {
    this.worker.postMessage({ kind: 'forget', key } satisfies PartsRequest);
  }
  close() {
    this.worker.terminate();
    this.pending.clear();
  }
}
const baseName = (entry: FileEntry) => entry.name.replace(/\.dxf$/i, '');
/** A drawing as selected: a changed file is read again. */
const fileKey = (entry: FileEntry) => `${entry.path}\0${entry.identity}\0${entry.modified}`;

export function useNestingFiles(entries: readonly FileEntry[]) {
  const [files, setFiles] = useState<NestingFile[]>([]);
  const client = useRef<PartsClient | null>(null);
  const latest = useRef({ entries, files });
  latest.current = { entries, files };
  /** The newest extraction asked for each drawing; older answers are dropped. */
  const asked = useRef(new Map<string, number>());
  const change = useCallback((fileKey: string, patch: Partial<NestingFile>) => {
    setFiles((current) =>
      current.map((item) => (item.key === fileKey ? { ...item, ...patch } : item)),
    );
  }, []);
  const extract = useCallback(
    (file: NestingFile, options: FileOptions) => {
      const reader = client.current;
      if (!reader || !file.drawing) return;
      const ticket = (asked.current.get(file.key) ?? 0) + 1;
      asked.current.set(file.key, ticket);
      reader
        .parts(file.key, {
          scale: unitInfo(options.units).mm ?? 1,
          marks: options.marks,
          together: options.together,
          name: baseName(file.entry),
        })
        .then((parts) => {
          if (asked.current.get(file.key) === ticket)
            change(file.key, { ...options, parts, status: 'ready', error: undefined });
        })
        .catch((error: unknown) => {
          if (asked.current.get(file.key) === ticket)
            change(file.key, { status: 'failed', error: errorMessage(error) });
        });
    },
    [change],
  );
  const selection = entries.map(fileKey).join('\n');
  useEffect(() => {
    const reader = new PartsClient();
    client.current = reader;
    let live = true;
    const initial: NestingFile[] = latest.current.entries.map((entry) => ({
      entry,
      key: fileKey(entry),
      status: 'reading',
      units: defaultUnits,
      marks: [],
      together: false,
    }));
    setFiles(initial);
    for (const file of initial)
      void (async () => {
        let resource: Resource | undefined;
        try {
          resource = await window.viewer.resource(file.entry.path);
          const drawing = await reader.read(file.key, resource.url);
          if (!live) return;
          const ready: NestingFile = {
            ...file,
            version: sourceVersion(resource.entry),
            drawing,
            units: drawing.units && unitInfo(drawing.units).mm ? drawing.units : defaultUnits,
            marks: drawing.suggested,
          };
          change(file.key, ready);
          extract(ready, ready);
        } catch (error) {
          if (live) change(file.key, { status: 'failed', error: errorMessage(error) });
        } finally {
          if (resource) void window.viewer.release(resource.id).catch(() => {});
        }
      })();
    return () => {
      live = false;
      reader.close();
      if (client.current === reader) client.current = null;
    };
  }, [selection, change, extract]);
  /** New units, marked layers or grouping for one drawing. */
  const configure = useCallback(
    (key: string, patch: Partial<FileOptions>) => {
      const file = latest.current.files.find((item) => item.key === key);
      if (!file) return;
      const options = { units: file.units, marks: file.marks, together: file.together, ...patch };
      change(key, options);
      extract(file, options);
    },
    [change, extract],
  );
  return { files, configure };
}
