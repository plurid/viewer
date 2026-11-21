import type { Resource } from '../../domain/contracts';
import { officeFamily, readsOfficeContent } from '../../domain/previews/documents/layout';
import { officeImageParts } from '../../domain/previews/documents/office';
import type { ApiHandlers } from './schemas';
import type { Resources } from '../previews/resources';
import type { Thumbnails } from '../previews/thumbnails';
import type { WebPreviews } from '../previews/web/service';
import type { FileServices } from '../files/file-services';
import type { FileAccess } from '../files/file-access';
import { macFiles } from '../native/macos-files';

type ResourceHandlers = Pick<
  ApiHandlers,
  | 'resource'
  | 'read'
  | 'release'
  | 'archive'
  | 'archiveEntry'
  | 'sqlite'
  | 'imageRendition'
  | 'videoRendition'
  | 'officeLayout'
  | 'inspectPostscript'
  | 'postscriptStatus'
  | 'renderPostscript'
  | 'officeWarm'
  | 'printPDF'
  | 'thumbnail'
  | 'document'
  | 'cancelDocument'
  | 'resourceFormat'
  | 'officeImage'
>;
interface ResourcePorts {
  resources: Pick<
    Resources,
    | 'grant'
    | 'read'
    | 'release'
    | 'archive'
    | 'archiveEntry'
    | 'sqlite'
    | 'rendition'
    | 'videoRendition'
    | 'officeLayout'
    | 'inspectPostscript'
    | 'postscriptStatus'
    | 'renderPostscript'
    | 'printableFile'
    | 'documentRead'
    | 'documentSource'
    | 'documentFormat'
    | 'signal'
    | 'cancelDocument'
    | 'confirmFormat'
  >;
  thumbnails: Pick<Thumbnails, 'get'>;
  webPreviews: Pick<WebPreviews, 'releaseResource'>;
  files: Pick<FileServices, 'extract'>;
  fileAccess: Pick<FileAccess, 'require'>;
  forgetGitResource(id: string): void;
  warmOffice(): void;
  isAgent?(owner: number): boolean;
}

/** Previews are read through the resource leases that authorized them; a nested image is a
 * child lease, released when its read fails. */
export function createResourceHandlers(ports: ResourcePorts): ResourceHandlers {
  return {
    resource: ([file, requestID], owner) => ports.resources.grant(file, requestID, owner),
    read: ([id, requested], owner) => ports.resources.read(id, requested, owner),
    release: async ([id], owner) => {
      if (ports.resources.release(id, owner) === false) return;
      ports.forgetGitResource(id);
      await ports.webPreviews.releaseResource(id);
    },
    archive: ([id], owner) => ports.resources.archive(id, owner),
    archiveEntry: ([id, name], owner) => ports.resources.archiveEntry(id, name, owner),
    sqlite: ([id, request], owner) => ports.resources.sqlite(id, request, owner),
    imageRendition: ([id, request], owner) => ports.resources.rendition(id, request, owner),
    videoRendition: ([id, requestID], owner) =>
      ports.resources.videoRendition(id, requestID, owner),
    officeLayout: ([id, request], owner) => ports.resources.officeLayout(id, request, owner),
    inspectPostscript: ([id, requestID], owner) =>
      ports.resources.inspectPostscript(id, requestID, owner),
    postscriptStatus: () => ports.resources.postscriptStatus(),
    renderPostscript: ([id, requestID], owner) => {
      if (!ports.isAgent || ports.isAgent(owner))
        throw new Error('PostScript rendering is available only to the person, never to agents.');
      return ports.resources.renderPostscript(id, requestID, owner);
    },
    officeWarm: async () => ports.warmOffice(),
    printPDF: async ([id, password], owner) => {
      if (process.platform !== 'darwin') throw new Error('Printing PDFs requires macOS.');
      const file = await ports.resources.printableFile(id, owner);
      macFiles().printPDF(file, password);
    },
    thumbnail: async ([file, size]) => {
      await ports.fileAccess.require([file]);
      const thumbnail = await ports.thumbnails.get(file, size);
      await ports.fileAccess.require([file]);
      return thumbnail;
    },
    document: async ([id, request], owner) => {
      if (request && 'message' in request) {
        const { message } = request;
        return ports.resources.documentRead(
          id,
          request.requestID,
          (file, signal, format) =>
            ports.files.extract(file, signal, true, undefined, format, message),
          owner,
        );
      }
      if (request) {
        if ('fromRow' in request) {
          const { requestID, ...worksheet } = request;
          return ports.resources.documentRead(
            id,
            requestID,
            (file, signal, format) => ports.files.extract(file, signal, true, worksheet, format),
            owner,
          );
        }
        return ports.resources.documentRead(
          id,
          request.requestID,
          (file, signal, format) => ports.files.extract(file, signal, true, undefined, format),
          owner,
        );
      }
      const file = ports.resources.documentSource(id, owner);
      const format = await ports.resources.documentFormat(id, owner);
      const document = await ports.files.extract(
        file,
        ports.resources.signal(id, owner),
        true,
        undefined,
        format,
      );
      // the preview may have been released while it was read
      ports.resources.documentSource(id, owner);
      return document;
    },
    cancelDocument: async ([id, requestID], owner) =>
      ports.resources.cancelDocument(id, requestID, owner),
    resourceFormat: ([id, extension], owner) => ports.resources.confirmFormat(id, extension, owner),
    officeImage: async ([id, part, requestID], owner) => {
      let child: Resource | undefined;
      try {
        return await ports.resources.documentRead(
          id,
          requestID,
          async (file, signal, format) => {
            if (!format || !(readsOfficeContent(format) && officeFamily(format) === 'word'))
              throw new Error('Embedded document images require a supported Word document.');
            const document = await ports.files.extract(file, signal, true, undefined, format);
            if (!officeImageParts(document.office).includes(part))
              throw new Error('This image is not a supported embedded document relationship.');
            const resource = await ports.resources.archiveEntry(id, part, owner);
            child = resource;
            signal.throwIfAborted();
            if (
              !['png', 'jpg', 'jpeg'].includes(resource.entry.extension) ||
              !resource.dimensions ||
              resource.entry.size > 8 * 1024 * 1024 ||
              resource.dimensions.width * resource.dimensions.height > 64000000
            )
              throw new Error('The embedded image exceeds the supported PNG/JPEG preview bounds.');
            return resource;
          },
          owner,
        );
      } catch (error) {
        if (child) ports.resources.release(child.id, owner);
        throw error;
      }
    },
  };
}
