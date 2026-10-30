import { modelFormats } from '../src/domain/previews/models/formats';
import { officeFormats } from '../src/domain/previews/documents/layout';
import { embeddedExtensions } from '../src/domain/previews/documents/embedded';
import { mailFormats } from '../src/domain/previews/mail/formats';
import { provisionFormats } from '../src/domain/previews/data/provision';

interface DocumentType {
  CFBundleTypeName: string;
  CFBundleTypeRole: 'Viewer';
  LSHandlerRank: 'Alternate';
  LSItemContentTypes?: string[];
  CFBundleTypeExtensions?: string[];
}
const type = (name: string, contentTypes: string[]): DocumentType => ({
  CFBundleTypeName: name,
  CFBundleTypeRole: 'Viewer',
  // Viewer is offered in Open With; it never becomes the default app for a type.
  LSHandlerRank: 'Alternate',
  LSItemContentTypes: contentTypes,
});

/** What Finder may open with Viewer: folders and every format a preview module reads. */
export const documentTypes: DocumentType[] = [
  type('Folder', ['public.folder']),
  type('Image', ['public.image']),
  type('Movie', ['public.movie']),
  type('Audio', ['public.audio']),
  type('PDF document', ['com.adobe.pdf']),
  type('EPUB book', ['org.idpf.epub-container']),
  type('Web archive', ['com.apple.webarchive']),
  {
    // Mail declares a type for its own messages only, and none for a single mailbox file.
    CFBundleTypeName: 'Email message or mailbox',
    CFBundleTypeRole: 'Viewer',
    LSHandlerRank: 'Alternate',
    CFBundleTypeExtensions: [...mailFormats],
  },
  {
    CFBundleTypeName: 'FictionBook',
    CFBundleTypeRole: 'Viewer',
    LSHandlerRank: 'Alternate',
    CFBundleTypeExtensions: ['fb2'],
  },
  type('Text', ['public.text', 'public.source-code', 'public.json']),
  {
    CFBundleTypeName: 'Office document',
    CFBundleTypeRole: 'Viewer',
    LSHandlerRank: 'Alternate',
    CFBundleTypeExtensions: officeFormats,
  },
  type('Archive', ['public.zip-archive', 'public.tar-archive', 'org.gnu.gnu-zip-tar-archive']),
  type('Font', ['public.font']),
  {
    // Drawings and 3D models have no system content types, so they match by extension.
    CFBundleTypeName: 'Drawing or 3D model',
    CFBundleTypeRole: 'Viewer',
    LSHandlerRank: 'Alternate',
    CFBundleTypeExtensions: ['dxf', ...modelFormats],
  },
  {
    CFBundleTypeName: 'DjVu document',
    CFBundleTypeRole: 'Viewer',
    LSHandlerRank: 'Alternate',
    CFBundleTypeExtensions: ['djvu', 'djv'],
  },
  {
    // Sound, video and a camera's RAW whose content type only another app declares, if any.
    CFBundleTypeName: 'Audio, video or camera RAW',
    CFBundleTypeRole: 'Viewer',
    LSHandlerRank: 'Alternate',
    CFBundleTypeExtensions: ['oga', 'ape', 'mpa', 'f4v', 'kdc'],
  },
  {
    // iWork, Krita, OpenRaster, Sketch and XPS files, shown by the picture each saved
    CFBundleTypeName: 'Document with a saved preview',
    CFBundleTypeRole: 'Viewer',
    LSHandlerRank: 'Alternate',
    CFBundleTypeExtensions: embeddedExtensions,
  },
  type('Certificate or web location', [
    'public.x509-certificate',
    'com.apple.web-internet-location',
  ]),
  {
    // PEM text and armored keys, Windows shortcuts, torrents and provisioning profiles, whose
    // content types only other apps declare, if any
    CFBundleTypeName: 'Key, shortcut, torrent or profile',
    CFBundleTypeRole: 'Viewer',
    LSHandlerRank: 'Alternate',
    CFBundleTypeExtensions: ['pem', 'asc', 'url', 'torrent', ...provisionFormats],
  },
];
