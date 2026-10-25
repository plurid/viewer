# PDF workbench

Select one or more PDFs and run **PDF tools…**, or use that button in a PDF
preview. The tool lists pages in output order beside a live preview of the
selected page. All exports create new files through Recent file operations.

- **Extract:** enter a range such as `1-3, 8, 5`, then Apply range. The range
  determines inclusion and order for the chosen source. Reverse ranges work.
- **Merge:** select multiple PDFs, or use Add PDFs. Their included pages become
  one output, in the order shown.
- **Reorder and rotate:** select a page row, then use the up/down and clockwise
  controls. Rotation adds to the page's existing orientation.
- **Split:** enable Save each included page separately. Outputs receive numbered
  names. Split exports admit at most 100 pages per run; Cancel stops further
  admission and cancels jobs that were admitted while cancellation was pending.

The working limits are 16 inputs, 1,000 source/output pages, 256 MB per source
and 512 MB combined. PDF page content remains searchable and vector content is
retained. New assembled documents do not retain document bookmarks, interactive
forms or accessibility tags. Signed and encrypted files require an unsigned,
unlocked copy. Source identities, sizes and modification times are pinned at
inspection and checked again by the operation executor before publication.

## Scanned PDF compression

In **Optimize…**, choose Balanced or Smaller and enable **Recompress scanned
images**. Set the maximum image edge to trade image detail for size. This
explicitly re-encodes compatible eight-bit RGB/grayscale JPEG image streams,
including JPEGs already compressed inside a PDF. Text, vector operators and page
geometry remain separate; pages are not flattened into screenshots.

Masks, unusual color spaces, custom decode parameters and other image encodings
remain unchanged. There is no OCR or target-size guarantee. Lossless disables
image recompression. Every optimized output is published only if smaller than its
original; the original remains intact. The scan pass accepts up to 500 compatible
images and 48 MB of replacement image data; the complete PDF task has a three
minute time budget and supports cancellation.

The bundled qpdf 12.4.2 is used for page assembly and PDF object updates, following
its [JSON update contract](https://qpdf.readthedocs.io/en/stable/json.html#json-input).
Sharp performs bounded image encoding in a cancellable utility worker. Process
arguments, page references and output paths come from strict typed plans. No
shell expression, arbitrary qpdf option, PDF-supplied filesystem path or runtime
processor download is accepted.

The native optimizer build clears ambient compiler include/library paths so
installed JPEG headers cannot override its pinned static library. Build revision
2 preserves previous resources in the retained processor build directory before
rebuilding. Generated test and build folders are retained under the repository's
Trash-only removal policy.
