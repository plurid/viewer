import type { FileEntry } from '../../domain/contracts';
import type { PreviewModule } from './contracts';
import type { BuiltInPreviewKind } from '../../domain/previews/formats';
import { chooseFilePreview, filePreviewModules } from '../../domain/previews/formats';

const loaders: Record<BuiltInPreviewKind, PreviewModule['load']> = {
  html: () => import('./web/HTMLPreview'),
  office: () => import('./modules/OfficePreview'),
  embedded: () => import('./modules/EmbeddedPreview'),
  dxf: () => import('./modules/DXFPreview'),
  model: () => import('./modules/ModelPreview'),
  epub: () => import('./modules/EPUBPreview'),
  pdf: () => import('./modules/PDFPreview'),
  archive: () => import('./modules/ArchivePreview'),
  compressed: () => import('./modules/CompressedPreview'),
  font: () => import('./modules/FontPreview'),
  image: () => import('./modules/ImagePreview'),
  djvu: () => import('./modules/DjVuPreview'),
  postscript: () => import('./modules/PostScriptPreview'),
  'rendered-image': () => import('./modules/RenderedImagePreview'),
  media: () => import('./modules/MediaPreview'),
  notebook: () => import('./modules/NotebookPreview'),
  cards: () => import('./modules/CardsPreview'),
  subtitles: () => import('./modules/SubtitlesPreview'),
  mail: () => import('./modules/MailPreview'),
  fictionbook: () => import('./modules/EPUBPreview'),
  webarchive: () => import('./modules/WebArchivePreview'),
  sqlite: () => import('./modules/SQLitePreview'),
  certificate: () => import('./modules/CertificatePreview'),
  shortcut: () => import('./modules/ShortcutPreview'),
  torrent: () => import('./modules/TorrentPreview'),
  provision: () => import('./modules/ProvisionPreview'),
  text: () => import('./modules/TextPreview'),
  fallback: () => import('./modules/TextPreview'),
};

export const previewModules: PreviewModule[] = filePreviewModules.map((module) => ({
  ...module,
  load: loaders[module.id],
}));

export function choosePreview(entry: FileEntry, modules = previewModules): PreviewModule {
  return chooseFilePreview(entry, modules);
}
export function registerPreview(module: PreviewModule): () => void {
  if (previewModules.some((item) => item.id === module.id))
    throw new Error(`Preview module ${module.id} is already registered.`);
  previewModules.unshift(module);
  return () => {
    const index = previewModules.indexOf(module);
    if (index >= 0) previewModules.splice(index, 1);
  };
}
