import { modelFormats } from '../src/domain/model-formats';

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
  type('Text', ['public.text', 'public.source-code', 'public.json']),
  type('Office document', [
    'org.openxmlformats.wordprocessingml.document',
    'org.openxmlformats.spreadsheetml.sheet',
  ]),
  type('Archive', ['public.zip-archive', 'public.tar-archive', 'org.gnu.gnu-zip-tar-archive']),
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
];
