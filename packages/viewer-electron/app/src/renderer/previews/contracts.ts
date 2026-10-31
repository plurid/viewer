import type { EvidenceNavigation } from '../../domain/files/inspection';
import type { DocumentData } from '../../domain/services';
import type { ComponentType } from 'react';
import type {
  ArchiveListing,
  FileEntry,
  FolderListing,
  Resource,
  ResourceRead,
  Look,
} from '../../domain/contracts';
import type { HtmlPreview } from '../../domain/previews/web';
import type { WorksheetWindow } from '../../domain/previews/documents/office';
import type { DocumentRequest } from '../../domain/previews/documents/requests';
import type { ImageRenditionRequest } from '../../domain/previews/images/rendered';
import type { OfficeLayoutRequest } from '../../domain/previews/documents/layout';
import type { SQLiteReply, SQLiteRequest } from '../../domain/previews/data/sqlite';
import type { PageColors } from '../../domain/previews/documents/dark-pages';

/** Renderer-only capabilities: preview modules never import the workspace or explorer. */
export interface PreviewCommand {
  id: string;
  label: string;
  aliases?: readonly string[];
  primary?: boolean;
  available?: boolean;
  run(): void | Promise<void>;
}

/** How page previews (PDF and Office layout) draw their pages: `dark` holds the dark page's
 * colours while pages are dark. `toggle` turns them the other way for every page preview, as the
 * Dark pages setting. Hosts without the setting pass none, and pages are as printed. */
export interface PagePresentation {
  dark?: PageColors;
  toggle(): void;
}

/** Where saved attachments go: beside their message, or to a folder the person chooses. */
export type AttachmentDestination = 'beside' | 'choose';
/** Attachments of the previewed message to save, by their place in its list and the names they are
 * listed by. `message` is the message's place in a mailbox. */
export interface AttachmentSave {
  message?: number;
  attachments: readonly { part: number; name: string }[];
  destination: AttachmentDestination;
}

/** Which of its controls a module shows in the plane header: `essential`, its main ones, each
 * other one also a command, in the plane's "…" menu; `all`, every one. */
export type PreviewToolbarSet = 'essential' | 'all';
export interface PreviewContext {
  evidence?: EvidenceNavigation;
  /** Undefined shows every control: Quick Preview, galleries and tests. */
  toolbar?: PreviewToolbarSet;
  resource: Resource;
  state?: { get(key: string): unknown; set(key: string, value: unknown): void };
  limits?: { maxImagePixels: number; maxModelMB: number };
  reading?: { fontSize: number };
  active: boolean;
  interactive: boolean;
  signal: AbortSignal;
  look: Look;
  pages?: PagePresentation;
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
  /** Shows the file's bytes in place of its preview, where the host offers it. */
  showHex?(): void;
  /** Saves attachments of the previewed message as files. Absent where the message is not a file
   * of its own, as inside an archive. */
  saveAttachments?(request: AttachmentSave): Promise<void>;
  services: {
    /** `message`, one message of a mailbox, whose HTML body is the page. */
    htmlPreview(resourceID: string, message?: number): Promise<HtmlPreview>;
    htmlPreviewClose(id: string): Promise<void>;
    thumbnail(file: string, size: number): Promise<string>;
    document(id: string, request?: DocumentRequest): Promise<DocumentData>;
    /** Available only after this view acquired an authorized, versioned resource. */
    cachedDocument?(request?: WorksheetWindow): DocumentData | undefined;
    cancelDocument(id: string, requestID: string): Promise<void>;
    read(id: string, limit?: number): Promise<ResourceRead>;
    archive(id: string): Promise<ArchiveListing>;
    archiveEntry(id: string, name: string): Promise<Resource>;
    /** Present where the desktop SQLite reader is: test hosts and galleries may omit it. */
    sqlite?(id: string, request: SQLiteRequest): Promise<SQLiteReply>;
    rendition(id: string, request?: ImageRenditionRequest): Promise<Resource>;
    videoRendition(id: string, requestID: string): Promise<Resource>;
    officeLayout?(id: string, request: OfficeLayoutRequest): Promise<Resource>;
    officeImage(id: string, part: string, requestID: string): Promise<Resource>;
    /** Files beside the previewed one, such as a video's subtitles: each is listed and read
     * through its own authorized resource. Test hosts and galleries may omit them. */
    list?(folder: string): Promise<FolderListing>;
    resource?(path: string): Promise<Resource>;
    release(id: string): Promise<void>;
  };
}
export interface PreviewModule {
  id: string;
  label: string;
  /** The module can open its underlying source in Viewer's text editor. */
  editing?: 'text';
  /** The module offers Show as hex itself, only for a file whose bytes may be shown: a private
   * key's never are. Other modules' files can be shown as hex by the host. */
  hex?: 'own';
  formats: readonly string[];
  detect(entry: FileEntry): number;
  load(): Promise<{ default: ComponentType<PreviewContext> }>;
  metadata?(context: PreviewContext): Promise<Record<string, string>>;
  thumbnail?(context: PreviewContext): Promise<string | null>;
}
