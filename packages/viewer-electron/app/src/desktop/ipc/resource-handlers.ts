import path from 'node:path';
import type { Resource } from '../../domain/contracts';
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
  | 'imageRendition'
  | 'videoRendition'
  | 'officeLayout'
  | 'printPDF'
  | 'thumbnail'
  | 'document'
  | 'cancelDocument'
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
    | 'rendition'
    | 'videoRendition'
    | 'officeLayout'
    | 'printableFile'
    | 'documentRead'
    | 'documentSource'
    | 'signal'
    | 'cancelDocument'
  >;
  thumbnails: Pick<Thumbnails, 'get'>;
  webPreviews: Pick<WebPreviews, 'releaseResource'>;
  files: Pick<FileServices, 'extract'>;
  fileAccess: Pick<FileAccess, 'require'>;
  forgetGitResource(id: string): void;
}

/** Previews are read through the resource leases that authorized them; a nested image is a
 * child lease, released when its read fails. */
export function createResourceHandlers(ports: ResourcePorts): ResourceHandlers {
  return {
    resource: ([file, requestID]) => ports.resources.grant(file, requestID),
    read: ([id, requested]) => ports.resources.read(id, requested),
    release: async ([id]) => {
      ports.forgetGitResource(id);
      ports.resources.release(id);
      await ports.webPreviews.releaseResource(id);
    },
    archive: ([id]) => ports.resources.archive(id),
    archiveEntry: ([id, name]) => ports.resources.archiveEntry(id, name),
    imageRendition: ([id, request]) => ports.resources.rendition(id, request),
    videoRendition: ([id, requestID]) => ports.resources.videoRendition(id, requestID),
    officeLayout: ([id, request]) => ports.resources.officeLayout(id, request),
    printPDF: async ([id, password]) => {
      if (process.platform !== 'darwin') throw new Error('Printing PDFs requires macOS.');
      const file = await ports.resources.printableFile(id);
      macFiles().printPDF(file, password);
    },
    thumbnail: async ([file, size]) => {
      await ports.fileAccess.require([file]);
      const thumbnail = await ports.thumbnails.get(file, size);
      await ports.fileAccess.require([file]);
      return thumbnail;
    },
    document: async ([id, request]) => {
      if (request) {
        const { requestID, ...worksheet } = request;
        return ports.resources.documentRead(id, requestID, (file, signal) =>
          ports.files.extract(file, signal, true, worksheet),
        );
      }
      const file = ports.resources.documentSource(id);
      const document = await ports.files.extract(file, ports.resources.signal(id), true);
      // the preview may have been released while it was read
      ports.resources.documentSource(id);
      return document;
    },
    cancelDocument: async ([id, requestID]) => ports.resources.cancelDocument(id, requestID),
    officeImage: async ([id, part, requestID]) => {
      let child: Resource | undefined;
      try {
        return await ports.resources.documentRead(id, requestID, async (file, signal) => {
          if (path.extname(file).toLowerCase() !== '.docx')
            throw new Error('Embedded document images require a DOCX file.');
          const document = await ports.files.extract(file, signal, true);
          if (!officeImageParts(document.office).includes(part))
            throw new Error('This image is not a supported embedded document relationship.');
          const resource = await ports.resources.archiveEntry(id, part);
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
        });
      } catch (error) {
        if (child) ports.resources.release(child.id);
        throw error;
      }
    },
  };
}
