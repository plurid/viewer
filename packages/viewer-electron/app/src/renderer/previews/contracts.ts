import type { EvidenceNavigation } from '../../domain/files/inspection';
import type { DocumentData } from '../../domain/services';
import type { ComponentType } from 'react';
import type { ArchiveListing, FileEntry, Resource, ResourceRead } from '../../domain/contracts';
import type { HtmlPreview } from '../../domain/previews/web';
import type { WorksheetDocumentRequest } from '../../domain/previews/documents/office';
import type { ImageRenditionRequest } from '../../domain/previews/images/rendered';
import type { OfficeLayoutRequest } from '../../domain/previews/documents/layout';

/** Renderer-only capabilities: preview modules never import the workspace or explorer. */
export interface PreviewCommand {
  id: string;
  label: string;
  aliases?: readonly string[];
  primary?: boolean;
  available?: boolean;
  run(): void | Promise<void>;
}

export interface PreviewContext {
  evidence?: EvidenceNavigation;
  resource: Resource;
  state?: { get(key: string): unknown; set(key: string, value: unknown): void };
  limits?: { maxImagePixels: number; maxModelMB: number };
  reading?: { fontSize: number };
  active: boolean;
  interactive: boolean;
  signal: AbortSignal;
  look: 'dark' | 'light';
  commands?: { header?: HTMLElement; register(commands: readonly PreviewCommand[]): () => void };
  /** A workspace preview plane's own: its text may be edited where it is. Quick
   * Preview and folder galleries pass none. */
  editing?: { paneID: string };
  /** Opens a local file the preview refers to (a relative link) beside its plane. */
  openRelated?(path: string): void;
  retry?(): void;
  editMedia?(): void;
  editImage?(): void;
  optimize?(): void;
  editPDF?(): void;
  services: {
    htmlPreview(resourceID: string): Promise<HtmlPreview>;
    htmlPreviewClose(id: string): Promise<void>;
    thumbnail(file: string, size: number): Promise<string>;
    document(id: string, request?: WorksheetDocumentRequest): Promise<DocumentData>;
    cancelDocument(id: string, requestID: string): Promise<void>;
    read(id: string, limit?: number): Promise<ResourceRead>;
    archive(id: string): Promise<ArchiveListing>;
    archiveEntry(id: string, name: string): Promise<Resource>;
    rendition(id: string, request?: ImageRenditionRequest): Promise<Resource>;
    videoRendition(id: string, requestID: string): Promise<Resource>;
    officeLayout?(id: string, request: OfficeLayoutRequest): Promise<Resource>;
    officeImage(id: string, part: string, requestID: string): Promise<Resource>;
    release(id: string): Promise<void>;
  };
}
export interface PreviewModule {
  id: string;
  label: string;
  /** The module can open its underlying source in Viewer's text editor. */
  editing?: 'text';
  formats: readonly string[];
  detect(entry: FileEntry): number;
  load(): Promise<{ default: ComponentType<PreviewContext> }>;
  metadata?(context: PreviewContext): Promise<Record<string, string>>;
  thumbnail?(context: PreviewContext): Promise<string | null>;
}
