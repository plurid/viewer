import { modelFormats } from '../src/domain/previews/models/formats';
import { officeFormats } from '../src/domain/previews/documents/layout';

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
];
