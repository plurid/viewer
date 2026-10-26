# PDF tools

Select PDFs and choose **PDF tools…**, or open the tool from a PDF preview. The page list is the
output plan; the preview shows the selected source page.

## Assemble pages

- **Extract:** enter `1-3, 8, 5`, then Apply range. Order and reverse ranges matter.
- **Merge:** select several PDFs or use Add PDFs, then arrange their pages.
- **Reorder/rotate:** select a page and use the move and clockwise controls.
- **Split:** enable Save each included page separately for numbered outputs.

Exports create new files. Page text, vectors and page geometry remain; newly assembled documents do
not retain document bookmarks, interactive forms or accessibility tags. Signed or encrypted inputs
need an unsigned, unlocked copy.

The tool supports up to 16 inputs, 1,000 source/output pages, 256 MB per source and 512 MB combined.
Split admits at most 100 output pages per run. Cancellation stops further work; inspect any already
completed outputs.

## Optimize

Choose **Optimize…** for smaller copies. Lossless compresses PDF structure and streams. Balanced and
Smaller can recompress eligible embedded images while preserving separate searchable text and
vectors.

For scanned documents, explicitly enable **Recompress scanned images** and set the maximum edge.
This can re-encode compatible eight-bit RGB/grayscale JPEG streams, including existing JPEG scans.
Unusual color spaces, masks and unsupported encodings remain unchanged. Pages are not flattened to
screenshots.

Lossless disables scan recompression. Signature fields are refused. A result is published only if
smaller; there is no target-size or OCR guarantee. The scan pass supports up to 500 compatible
images and 48 MB of replacement image data, within the PDF task's three-minute budget.

**PDF for email…** starts with Smaller, scan recompression and a 1600 px maximum edge. Review those
choices before exporting.

## Implementation

Bundled qpdf handles page assembly and object updates; the image utility performs bounded encoding.
Typed plans determine arguments and destinations, and source versions are rechecked before
publishing. See [media exports](media.md) and [file operations](file-operations.md) for output
receipts and recovery.
