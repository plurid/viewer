# Office previews

DOCX and XLSX have local, read-only previews in a file plane or Quick Preview.
New settings open these formats in a plane. Existing native-app preferences and
explicit extension overrides are preserved; Open linked plane remains available.
Old DOC/XLS, presentations, encrypted Office files and macro-enabled package types
still require another app.

DOCX shows document-body paragraphs, supported heading levels and simple tables.
It preserves text, tabs and line breaks, excludes tracked deletions and field
instructions, and renders source text through React without source HTML or fonts.
Embedded body PNG/JPEG images appear in reading order, including simple table cells. Alternative text is retained; unsupported drawings, missing parts and external images have explicit placeholders. Floating placement, full page layout, headers, footers, footnotes and merged Word table cells are omitted.
Preview details explains the coverage; a separate warning appears for reader limits.

XLSX provides a named worksheet selector, visible labels for hidden sheets,
original row numbers and A/B/C column headings. Blank gaps remain sparse and the
first row is data. Filtering preserves the original addresses. Selecting a cell
shows its stored value and optional saved formula. Missing cached values are
explicitly labeled. Viewer never evaluates formulas, resolves external data or
opens workbook hyperlinks. **Formatted** presents supported number, currency, percentage,
date/time and duration formats; **Stored** exposes the source value. The inspector
always retains the raw value, saved formula and format code. The pinned local SSF
0.11.2 formatter runs inside the document worker. It respects the workbook's
1900/1904 date system, including Excel's serial-60 convention. Unsupported locale/
numeral directives and malformed styles fall back visibly to stored values.
No formula is recalculated and source evidence continues to contain stored values.
Charts, conditional formatting, source fonts and drawings are omitted.

Bounded merged worksheet ranges span the loaded stored rows and columns. A merge
that starts before the current page fetches only its anchor value in a second
bounded, CRC-validated stream pass and displays **Continued from A3** (for example).
Selecting that continuation identifies the original A3 source coordinate. Row gaps
remain sparse; the preview does not invent millions of blank rows. Filtering can
compress the displayed span and searches the loaded cell values. Overlapping or
malformed ranges are refused; ranges beyond supported bounds are labeled.

Workbook previews load one sheet and up to 100 stored rows at a time. Previous,
Next and Row/Go use original Excel row numbers; a sparse sheet may skip blank
gaps. Sheet choices retain their own row position in private preview state.
Opening a cell citation loads its source row directly, including rows beyond the
old retained preview. Manual navigation stops following that citation. Filter
this page searches the loaded rows. Page transitions hide stale cells while
retaining sheet choices; errors expose Try again and First worksheet.

Each requested sheet/page receives a fresh bounded content budget. A row that
cannot fit the remaining character budget moves intact to the next page when
possible. A single row or individual value that exceeds a hard limit remains
partial and is labeled as such. Source ranges never imply full Excel fidelity.

Inspection, opt-in content indexing, workflows and named agent content tools use
the same worker reader. Word citations identify a document block; workbook
citations identify a sheet, row and column. Opening a citation selects its sheet
and marks its cell or passage. Ordinary sheet choices persist in private preview
state; an explicit source citation takes precedence after a cold restart. Source
versions are checked before returning or caching extraction results. Revoking
native/client access or content-index scope keeps the existing permission and
index-purge behavior.

`query_table` accepts CSV, TSV and XLSX. XLSX adds an optional exact `sheet` name,
defaulting to the first visible worksheet. `offset` pages retained stored rows,
starting at zero; `limit` is at most 200. Sparse original row numbers and cell
addresses are returned alongside formula text and cached-value availability.
The response lists available sheets, reports reader truncation separately from
partial format coverage, and obeys the named client's returned-byte budget.
No input file is modified. CSV/TSV keep their existing first-row header behavior.
This agent/indexing interface remains separately bounded; the interactive
preview's new row-window API does not widen agent content permissions.

The reader follows local package relationships rather than assuming a particular
main-part filename. It uses the existing bounded ZIP/CRC reader, rejects unsafe
targets, duplicate parts, unsupported/encrypted required parts, DTD/entity
declarations and malformed XML, and releases the archive index on every exit.
External main/worksheet targets are never followed. Content type must match DOCX
or XLSX; macros and embedded objects never execute.

Native content coordination rejects existing pipes and other special sources
before requesting a provider accessor. Archive descriptors are also opened
without following the leaf symlink or waiting on a pipe, and checked as regular
files. Automatic content indexing retains its existing 16 MB input limit;
explicit Office preview/inspection uses the larger bound below.

Worksheets stream through bounded ZIP chunks and an incremental XML scanner.
The reader keeps cell values and original coordinates without building a complete
worksheet tree. Scanning continues beyond the retained rows/cells, so malformed
trailing XML, checksum failures and source changes still reject the preview.
Cancellation closes the stream and releases the native read claim.

Limits: 64 MB container, 4 MB for Word, shared-string and package metadata XML,
32 MB per streamed worksheet and 32 MB total expanded reads. Small XML trees
allow 200,000 nodes; streamed worksheets allow 4 million nodes with bounded
nesting and 256 KiB markup tokens. Word retains at most 2,000 blocks and 10,000
table cells. Workbooks retain up to 32 supported worksheets, 2,000 stored rows per
sheet, 256 columns, 50,000 cells and 8,000 content evidence records. Interactive
preview pages retain up to 100 stored rows of one selected sheet using a fresh
cell/text budget; other sheets in that response carry unloaded metadata.
Retained text
and formula text share a 500,000-character budget; individual cell/formula strings
are capped at 10,000 characters. Out-of-budget container/XML fails explicitly;
bounded content output is marked truncated. All Office inspection/search results
report partial coverage rather than claiming complete Word/Excel fidelity.

Implementation: `desktop/previews/office.ts`, `desktop/previews/office-worksheet.ts`,
`desktop/previews/office-xml.ts`, `domain/previews/documents/office.ts`,
`previews/modules/OfficePreview.tsx` and the shared `previews/DataTable.tsx`.
`previews/useOfficeDocument.ts` owns current-request UI state and
`previews/WorksheetNavigation.tsx` owns bounded row navigation.
The package relationship/cell model follows Microsoft's
[SpreadsheetML structure](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document),
[cell-value documentation](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/how-to-retrieve-the-values-of-cells-in-a-spreadsheet)
and [Word paragraphs](https://learn.microsoft.com/en-us/office/open-xml/word/working-with-paragraphs).

`tests/office.test.ts` covers extraction, original index anchors/purge, incomplete
format coverage, malicious/malformed packages, source limits and cancellation.
`tests/office-streaming.test.ts`, `tests/office-xml-stream.test.ts` and
`tests/archive-streaming.test.ts` cover large worksheets, bounded cell text,
byte/UTF-16/entity boundaries, malformed suffixes, full CRC/size validation,
cancellation and changed sources.
`tests/office-pagination.test.ts`, `tests/office-pagination-preview.test.tsx`,
resource/cache, IPC and file-service tests cover page continuations, independent
sheet budgets, citation jumps, stale responses, cancellation and access rechecks.
Agent tests exercise worksheet selection/paging/content grants. The owned direct
package check is `pnpm exec tsx tests/native-office.ts`; its generated fixtures,
captures and result now live in a unique retained `viewer-native-office-*` folder.
`tests/native/worksheet-pages.ts` exercises actual paging, keyboard row submission,
row-2500 citations, external-target refusal, empty recovery and the public large
workbook in dark/light/narrow views. These do not qualify native
folder pickers, physical assistive technologies or Mac App Store distribution.

Preview resource acquisition and Office reads have recoverable deadlines and
retry controls. A bounded shared extraction cache keys by source identity,
version and reader options, deduplicates concurrent reads and cancels abandoned
subscribers independently. Long media responses have a separate native queue,
so they cannot occupy every foreground reader. Worksheets virtualize both rows
and columns; selecting/filtering retains original cell addresses.

Paged document requests contain only the existing preview resource ID, a request
ID and validated sheet/row bounds. They cannot name another file. Cancellation
matches both resource and request, and releasing the resource aborts dependent
reads. The shared worker cache keys pages by source version and canonical range;
source permissions are rechecked on return. New ranges still validate the full
selected XML stream and CRC, so uncached reads scan the worksheet rather than
using a random-access row index. Cached pages share the existing eight-entry,
32 MB derived-data budget.


## Embedded image authority

Word images use a typed `officeImage(resourceID, part, requestID)` request. The
part must be a supported image relationship in the extracted DOCX. The desktop
service rechecks source access and image dimensions before issuing a child
resource. Only PNG/JPEG up to 8 MiB and 64 million pixels can appear. Images load
near the viewport, cancel when hidden or closed, and release late completions.
External image URLs, source HTML, SVG and embedded objects never execute. Parent
release/revocation expires dependent images. Child resources share a 128 MiB
unique-buffer ceiling with a 64 MiB per-resource ceiling; the existing 256-grant
limit still applies. The parser retains at most 256 images, 1,024 nonoverlapping
worksheet merges and 256 columns. Custom format codes are limited to 256 characters;
style and format records are bounded independently of cell text.

`tests/office-fidelity.test.ts`, `tests/office-fidelity-preview.test.tsx` and
`tests/native/office-fidelity.ts` cover stored/formatted values, both date systems,
merged anchors beyond the current page, inline and table image order, cancellation,
late-resource release, arbitrary-part refusal and source preservation. The public
Apache POI `VariousPictures.docx` fixture contains PNG/JPEG and unsupported WMF/EMF;
its provenance and hash are pinned in the playground qualification catalog.
