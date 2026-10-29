import type { BrowserWindow } from 'electron';
import { sameSourceVersion, sourceVersion } from '../../domain/files/inspection';
import type { ApiHandlers } from './schemas';
import type { BrowserPlanes } from '../browser/browser-planes';
import type { MediaDocuments } from '../transforms/media-documents';
import type { OptimizationReviews } from '../transforms/optimization-reviews';
import type { Transforms } from '../transforms/transforms';
import type { Resources } from '../previews/resources';
import { entry } from '../files/filesystem';
import { chooseRememberedFiles, type DialogAccess } from '../native/dialogs';

type MediaHandlers = Pick<
  ApiHandlers,
  'browser' | 'media' | 'optimization' | 'imageInspect' | 'pdfInspect' | 'choosePDFs'
>;
interface MediaPorts {
  browsers: Pick<BrowserPlanes, 'request'>;
  documents: Pick<MediaDocuments, 'request'>;
  optimization: Pick<OptimizationReviews, 'request'>;
  transforms: Pick<Transforms, 'inspectImage' | 'pdfInspect'>;
  resources: Pick<Resources, 'grantBytes'>;
  fileAccess: DialogAccess;
  window(owner: number): BrowserWindow | undefined;
}

/** An inspection answers for the version it read: a file changed meanwhile is read again. */
export function createMediaHandlers(ports: MediaPorts): MediaHandlers {
  return {
    browser: ([request], owner) => ports.browsers.request(owner, request),
    media: ([request], owner) => ports.documents.request(request, owner),
    optimization: ([request], owner) => ports.optimization.request(request, owner),
    imageInspect: async ([file]) => {
      const before = sourceVersion(await entry(file));
      const value = await ports.transforms.inspectImage(file);
      if (!sameSourceVersion(before, sourceVersion(await entry(file))))
        throw new Error('The image changed while being read. Try again.');
      const preview = await ports.resources.grantBytes(
        file,
        'image-preview.png',
        Buffer.from(value.preview),
      );
      return { width: value.width, height: value.height, alpha: value.alpha, preview };
    },
    pdfInspect: async ([file]) => {
      await ports.fileAccess.require([file]);
      const version = sourceVersion(await entry(file));
      const value = await ports.transforms.pdfInspect(file);
      if (!sameSourceVersion(version, sourceVersion(await entry(file))))
        throw new Error('The PDF changed while being read. Inspect it again.');
      return { ...value, version };
    },
    choosePDFs: async (_args, owner) => {
      const window = ports.window(owner);
      if (!window || window.isDestroyed()) throw new Error('The PDF tools window closed.');
      return chooseRememberedFiles(
        ports.fileAccess,
        window,
        { title: 'Add PDFs', filters: [{ name: 'PDF documents', extensions: ['pdf'] }] },
        { count: 16, message: 'Choose at most 16 PDFs.' },
      );
    },
  };
}
