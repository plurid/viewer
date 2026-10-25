import type { FileEntry } from '../../domain/contracts';
import type { PreviewModule } from './contracts';
import { modelFormats } from '../../domain/previews/models/formats';
import { renderedImageFormats } from '../../domain/previews/images/rendered';
import { languageExtensions, languageFor } from '../../domain/editing/languages';

const extension = (formats: readonly string[]) => (entry: FileEntry) =>
  formats.includes(entry.extension) ? 100 : 0;
/** A dotfile is named by its format: `.env` and `.gitignore` have no extension, `.env.local` has `local`. */
const dotfileFormat = ({ name, extension }: FileEntry) =>
  name.startsWith('.env.')
    ? 'env'
    : name.startsWith('.') && !extension
      ? name.slice(1).toLowerCase()
      : '';
const textFormats = [
  'txt',
  'md',
  'markdown',
  'mdx',
  'json',
  'jsonc',
  'json5',
  'jsonl',
  'csv',
  'tsv',
  'log',
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'css',
  'scss',
  'html',
  'xml',
  'svg',
  'yaml',
  'yml',
  'toml',
  'ini',
  'conf',
  'py',
  'rs',
  'go',
  'java',
  'c',
  'h',
  'cpp',
  'hpp',
  'swift',
  'kt',
  'sh',
  'bash',
  'zsh',
  'sql',
  'graphql',
  'vue',
  'svelte',
  'rb',
  'php',
  'tex',
  'env',
  'gitignore',
  'dockerfile',
  // and every language the highlighting table names (rs, lua, diff, ...)
  ...languageExtensions,
].filter((format, index, all) => all.indexOf(format) === index);
export const previewModules: PreviewModule[] = [
  {
    id: 'html',
    editing: 'text',
    label: 'HTML document',
    formats: ['html', 'htm', 'xhtml'],
    detect: (entry) => (['html', 'htm', 'xhtml'].includes(entry.extension.toLowerCase()) ? 110 : 0),
    load: () => import('./web/HTMLPreview'),
  },
  {
    id: 'office',
    label: 'Office document',
    formats: ['docx', 'xlsx'],
    detect: extension(['docx', 'xlsx']),
    load: () => import('./modules/OfficePreview'),
  },
  {
    id: 'dxf',
    label: 'DXF drawing',
    formats: ['dxf'],
    detect: extension(['dxf']),
    load: () => import('./modules/DXFPreview'),
  },
  {
    id: 'model',
    label: '3D model',
    formats: modelFormats,
    detect: extension(modelFormats),
    load: () => import('./modules/ModelPreview'),
  },
  {
    id: 'epub',
    label: 'EPUB book',
    formats: ['epub'],
    detect: extension(['epub']),
    load: () => import('./modules/EPUBPreview'),
  },
  {
    id: 'pdf',
    label: 'PDF document',
    formats: ['pdf'],
    detect: extension(['pdf']),
    load: () => import('./modules/PDFPreview'),
  },
  {
    id: 'archive',
    label: 'Archive',
    formats: ['zip', 'tar', 'tar.gz', 'tgz'],
    detect: (entry) => (/\.(zip|tar|tar\.gz|tgz)$/i.test(entry.name) ? 100 : 0),
    load: () => import('./modules/ArchivePreview'),
  },
  {
    id: 'image',
    label: 'Image',
    formats: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg'],
    detect: extension(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg']),
    load: () => import('./modules/ImagePreview'),
  },
  {
    id: 'djvu',
    label: 'DjVu document',
    formats: ['djvu', 'djv'],
    detect: extension(['djvu', 'djv']),
    load: () => import('./modules/DjVuPreview'),
  },
  {
    id: 'rendered-image',
    label: 'Image',
    formats: renderedImageFormats,
    detect: extension(renderedImageFormats),
    load: () => import('./modules/RenderedImagePreview'),
  },
  {
    id: 'media',
    label: 'Audio / video',
    formats: [
      'mp4',
      'webm',
      'mov',
      'm4v',
      'ogv',
      'mp3',
      'wav',
      'ogg',
      'flac',
      'm4a',
      'aac',
      'opus',
    ],
    detect: (entry) => (/^(audio|video)\//.test(entry.mime) ? 90 : 0),
    load: () => import('./modules/MediaPreview'),
  },
  {
    id: 'text',
    editing: 'text',
    label: 'Text / code / data',
    formats: textFormats,
    detect: (entry) =>
      textFormats.includes(entry.extension) ||
      textFormats.includes(dotfileFormat(entry)) ||
      ['LICENSE', 'README', 'Dockerfile', 'Makefile'].includes(entry.name) ||
      !!languageFor(entry)
        ? 100
        : entry.mime.startsWith('text/')
          ? 80
          : 0,
    load: () => import('./modules/TextPreview'),
  },
  {
    id: 'fallback',
    label: 'File information',
    formats: [],
    detect: () => 1,
    load: () => import('./modules/TextPreview'),
  },
];
export function choosePreview(entry: FileEntry, modules = previewModules): PreviewModule {
  const match = modules
    .map((module) => ({ module, score: module.detect(entry) }))
    .sort((a, b) => b.score - a.score)[0];
  if (!match || match.score <= 0)
    throw new Error('A preview registry must include a fallback module.');
  return match.module;
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
