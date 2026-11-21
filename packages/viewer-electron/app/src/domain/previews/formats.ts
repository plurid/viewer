import type { FileEntry } from '../contracts';
import { officeFormats } from './documents/layout';
import { embeddedExtensions, embeddedFormat } from './documents/embedded';
import { modelFormats } from './models/formats';
import { renderedImageFormats } from './images/rendered';
import { fontFormats } from './fonts/formats';
import { gzipMember, zipContainers } from '../files/containers';
import { languageExtensions, languageFor } from '../editing/languages';
import { mailFormats } from './mail/formats';
import { certificateFormats, keyFormats, privateKeyNames } from './keys/certificates';
import { shortcutFormats } from './data/shortcuts';
import { provisionFormats } from './data/provision';
import { postscriptFormats } from './documents/postscript';

export type BuiltInPreviewKind =
  | 'html'
  | 'office'
  | 'embedded'
  | 'dxf'
  | 'model'
  | 'epub'
  | 'pdf'
  | 'archive'
  | 'compressed'
  | 'font'
  | 'image'
  | 'djvu'
  | 'postscript'
  | 'rendered-image'
  | 'media'
  | 'notebook'
  | 'cards'
  | 'subtitles'
  | 'mail'
  | 'fictionbook'
  | 'webarchive'
  | 'sqlite'
  | 'certificate'
  | 'shortcut'
  | 'torrent'
  | 'provision'
  | 'text'
  | 'fallback';

export interface FilePreview {
  id: string;
  label: string;
  /** Editing follows the reader that owns the source format. */
  editing?: 'text';
  /** Private-key readers control whether their bytes may be displayed. */
  hex?: 'own';
  formats: readonly string[];
  detect(entry: FileEntry): number;
}

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
/** Media Chromium cannot play, shown through a complete compatibility copy the bundled FFmpeg
 * makes; some have no audio or video MIME type. */
const convertedMedia = [
  'avi',
  'mkv',
  'mpg',
  'mpeg',
  'm2ts',
  'wmv',
  'asf',
  'flv',
  '3gp',
  '3g2',
  'vob',
  'mxf',
  'wma',
  'aif',
  'aiff',
  'caf',
  'mka',
  'ac3',
  'wv',
  'amr',
  'ape',
  'au',
  'snd',
  'm2v',
  'mp2',
  'mpa',
];
const cardFormats = ['ics', 'ical', 'vcf', 'vcard'];
const subtitleFormats = ['srt', 'vtt', 'ass', 'ssa'];
/** Ahead of the text module, which claims some of these by their text MIME type. */
const documentExtension = (formats: readonly string[]) => (entry: FileEntry) =>
  formats.includes(entry.extension.toLowerCase()) ? 110 : 0;
/** Images Chromium decodes itself: JFIF and JPE are JPEG; APNG is an animated PNG. */
const browserImages = [
  'png',
  'apng',
  'jpg',
  'jpeg',
  'jpe',
  'jfif',
  'gif',
  'webp',
  'avif',
  'bmp',
  'ico',
  'svg',
];
export const filePreviewModules: (FilePreview & { id: BuiltInPreviewKind })[] = [
  {
    id: 'html',
    editing: 'text',
    label: 'HTML document',
    formats: ['html', 'htm', 'xhtml'],
    detect: (entry) => (['html', 'htm', 'xhtml'].includes(entry.extension.toLowerCase()) ? 110 : 0),
  },
  {
    id: 'office',
    label: 'Office document',
    formats: officeFormats,
    detect: extension(officeFormats),
  },
  {
    id: 'embedded',
    label: 'Saved preview',
    formats: embeddedExtensions,
    hex: 'own',
    // ahead of other readers of these names: a `.key` file that is not an archive, such as a
    // PEM or DER private key, is handed on to the preview it would otherwise have
    detect: (entry) => (embeddedFormat(entry.extension) ? 110 : 0),
  },
  {
    id: 'dxf',
    label: 'DXF drawing',
    formats: ['dxf'],
    detect: extension(['dxf']),
  },
  {
    id: 'model',
    label: '3D model',
    formats: modelFormats,
    detect: extension(modelFormats),
  },
  {
    id: 'epub',
    label: 'EPUB book',
    formats: ['epub'],
    detect: extension(['epub']),
  },
  {
    id: 'pdf',
    label: 'PDF document',
    formats: ['pdf'],
    detect: extension(['pdf']),
  },
  {
    id: 'archive',
    label: 'Archive',
    formats: ['zip', 'tar', 'tar.gz', 'tgz', ...zipContainers],
    // by the extension too: a file shown as the archive its bytes say keeps its own name
    detect: (entry) =>
      /\.(zip|tar|tar\.gz|tgz)$/i.test(entry.name) ||
      ['zip', 'tar', 'tgz', ...zipContainers].includes(entry.extension)
        ? 100
        : 0,
  },
  {
    id: 'compressed',
    label: 'Compressed file',
    formats: ['gz'],
    // one gzip-compressed file; a .tar.gz is the archive's
    detect: (entry) => (gzipMember(entry.name) ? 100 : 0),
  },
  {
    id: 'font',
    label: 'Font',
    formats: fontFormats,
    detect: extension(fontFormats),
  },
  {
    id: 'image',
    label: 'Image',
    formats: browserImages,
    detect: extension(browserImages),
  },
  {
    id: 'djvu',
    label: 'DjVu document',
    formats: ['djvu', 'djv'],
    detect: extension(['djvu', 'djv']),
  },
  {
    id: 'postscript',
    label: 'PostScript / EPS / Illustrator',
    formats: postscriptFormats,
    detect: (entry) => (entry.directory ? 0 : documentExtension(postscriptFormats)(entry)),
  },
  {
    id: 'rendered-image',
    label: 'Image',
    formats: renderedImageFormats,
    detect: extension(renderedImageFormats),
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
      'oga',
      'f4v',
      ...convertedMedia,
    ],
    detect: (entry) =>
      /^(audio|video)\//.test(entry.mime) || convertedMedia.includes(entry.extension) ? 90 : 0,
  },
  {
    id: 'notebook',
    editing: 'text',
    label: 'Jupyter notebook',
    formats: ['ipynb'],
    detect: documentExtension(['ipynb']),
  },
  {
    id: 'cards',
    editing: 'text',
    label: 'Calendar / contacts',
    formats: cardFormats,
    detect: documentExtension(cardFormats),
  },
  {
    id: 'subtitles',
    editing: 'text',
    label: 'Subtitles',
    formats: subtitleFormats,
    detect: documentExtension(subtitleFormats),
  },
  {
    id: 'mail',
    label: 'Email',
    formats: mailFormats,
    // a folder Mail exported, `Inbox.mbox`, is browsed: it is no mailbox file
    detect: (entry) => (entry.directory ? 0 : documentExtension(mailFormats)(entry)),
  },
  {
    id: 'fictionbook',
    label: 'FictionBook',
    formats: ['fb2'],
    detect: documentExtension(['fb2']),
  },
  {
    id: 'webarchive',
    label: 'Web archive',
    formats: ['webarchive'],
    detect: (entry) => (entry.directory ? 0 : documentExtension(['webarchive'])(entry)),
  },
  {
    id: 'sqlite',
    label: 'SQLite database',
    formats: ['sqlite', 'sqlite3', 'db3', 'db'],
    // a .db file is only a hint: the reader checks the header, and other files keep the text view
    detect: (entry) =>
      ['sqlite', 'sqlite3', 'db3'].includes(entry.extension)
        ? 100
        : entry.extension === 'db'
          ? 60
          : 0,
  },
  {
    id: 'certificate',
    label: 'Certificate or key',
    formats: [...certificateFormats, ...keyFormats],
    hex: 'own',
    // ahead of Office, which reads `.pub` as Publisher: a file that is not PEM, armor or DER is
    // handed on to the preview it would otherwise have
    detect: (entry) =>
      !entry.directory &&
      ([...certificateFormats, ...keyFormats].some((format) => format === entry.extension) ||
        privateKeyNames.some((name) => name === entry.name))
        ? 105
        : 0,
  },
  {
    id: 'shortcut',
    label: 'Internet shortcut',
    formats: shortcutFormats,
    detect: (entry) => (entry.directory ? 0 : documentExtension(shortcutFormats)(entry)),
  },
  {
    id: 'torrent',
    label: 'Torrent',
    formats: ['torrent'],
    detect: documentExtension(['torrent']),
  },
  {
    id: 'provision',
    label: 'Provisioning profile',
    formats: provisionFormats,
    detect: documentExtension(provisionFormats),
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
  },
  {
    id: 'fallback',
    label: 'File information',
    formats: [],
    detect: () => 1,
  },
];

export function chooseFilePreview<T extends FilePreview>(
  entry: FileEntry,
  modules: readonly T[],
): T {
  const match = modules
    .map((module) => ({ module, score: module.detect(entry) }))
    .sort((a, b) => b.score - a.score)[0];
  if (!match || match.score <= 0)
    throw new Error('A preview registry must include a fallback module.');
  return match.module;
}

/** Signature probes share the renderer's readers so a known kind always keeps its own preview. */
export const hasFilePreview = (entry: FileEntry) =>
  chooseFilePreview(entry, filePreviewModules).id !== 'fallback';
