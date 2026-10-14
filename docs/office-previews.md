# Office previews

DOCX and XLSX have local, read-only previews in a file plane or Quick Preview.
New settings open these formats in a plane. Existing native-app preferences and
explicit extension overrides are preserved; Open linked plane remains available.
Old DOC/XLS, presentations, encrypted Office files and macro-enabled package types
still require another app.

DOCX shows document-body paragraphs, supported heading levels and simple tables.
It preserves text, tabs and line breaks, excludes tracked deletions and field
instructions, and renders source text through React without source HTML or fonts.
Page layout, images, headers, footers, footnotes and merged table cells are omitted.
Preview details explains the coverage; a separate warning appears for reader limits.

XLSX provides a named worksheet selector, visible labels for hidden sheets,
original row numbers and A/B/C column headings. Blank gaps remain sparse and the
first row is data. Filtering preserves the original addresses. Selecting a cell
shows its stored value and optional saved formula. Missing cached values are
explicitly labeled. Viewer never evaluates formulas, resolves external data or
opens workbook hyperlinks. Numeric/date formatting, merged cells, charts and
drawings are omitted; numeric dates remain stored serial values.

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

Limits: 64 MB container, 4 MB per XML part, 32 MB total expanded reads, 200,000 XML
nodes per part and nesting depth 64. Word retains at most 2,000 blocks and 10,000
table cells. Workbooks retain up to 32 supported worksheets, 2,000 stored rows per
sheet, 256 columns, 50,000 cells and 8,000 content evidence records. Retained text
and formula text share a 500,000-character budget; individual cell/formula strings
are capped at 10,000 characters. Out-of-budget container/XML fails explicitly;
bounded content output is marked truncated. All Office inspection/search results
report partial coverage rather than claiming complete Word/Excel fidelity.

Implementation: `desktop/office.ts`, `desktop/office-xml.ts`, `domain/office.ts`,
`previews/modules/OfficePreview.tsx` and the shared `previews/DataTable.tsx`.
The package relationship/cell model follows Microsoft's
[SpreadsheetML structure](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document),
[cell-value documentation](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/how-to-retrieve-the-values-of-cells-in-a-spreadsheet)
and [Word paragraphs](https://learn.microsoft.com/en-us/office/open-xml/word/working-with-paragraphs).

`tests/office.test.ts` covers extraction, original index anchors/purge, incomplete
format coverage, malicious/malformed packages, source limits and cancellation.
Agent tests exercise worksheet selection/paging/content grants. The owned direct
package check is `pnpm exec tsx tests/native-office.ts`; its generated fixtures,
captures and result live under `out/office-acceptance`. It does not qualify native
folder pickers, physical assistive technologies or Mac App Store distribution.
