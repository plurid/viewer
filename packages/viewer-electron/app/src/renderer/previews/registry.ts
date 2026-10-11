import type { FileEntry } from '../../domain/contracts';
import type { PreviewModule } from './contracts';

const extension = (formats: readonly string[]) => (entry: FileEntry) =>
  formats.includes(entry.extension) ? 100 : 0;
const textFormats = [
  'txt',
  'md',
  'markdown',
  'mdx',
  'json',
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
];
export const previewModules: PreviewModule[] = [
  {
    id: 'model',
    label: '3D model',
    formats: ['glb', 'gltf', 'obj', 'stl', 'fbx'],
    detect: extension(['glb', 'gltf', 'obj', 'stl', 'fbx']),
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
    label: 'Text / code / data',
    formats: textFormats,
    detect: (entry) =>
      textFormats.includes(entry.extension) ||
      ['LICENSE', 'README', 'Dockerfile', 'Makefile'].includes(entry.name)
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
