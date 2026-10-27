# Office documents and worksheets

Viewer previews DOC/DOCX, XLS/XLSX and PPT/PPTX locally. Open with Space or as a linked plane. New
opening defaults use Viewer; explicit native-app preferences are preserved.

## Choose the right view

| Format   | Views                                    |
| -------- | ---------------------------------------- |
| DOC      | Paginated Layout                         |
| DOCX     | Layout and Reading                       |
| XLS      | Print layout with worksheet navigation   |
| XLSX     | Stored-value Sheet view and Print layout |
| PPT/PPTX | Slide Layout                             |

Worksheet tabs support arrow keys, Home and End. In Sheet view they sit below the grid; **All
worksheets** appears when the tabs overflow. Print layout renders only the selected sheet, retaining
its supported page settings and breaks.

## Layout fidelity

The bundled ZetaOffice/LibreOffice WebAssembly engine renders supported fonts, paragraph placement,
pages, headers, footers, images, charts and slide backgrounds to an in-memory PDF. Missing fonts use
substitutes. Output is closer to the document's layout than the semantic reader, but Microsoft
Office pixel parity is not guaranteed.

The engine runs in a fresh sandbox without Node, preload, host filesystem access or Viewer IPC.
Macros and external-document updates are disabled. Inputs use generic virtual filenames; requests
are limited to the job's loopback origin. The same pinned assets are packaged for macOS, Windows and
Linux; executable Windows/Linux qualification is still pending.

One conversion runs at a time. Input is limited to 64 MiB, output to 32 MiB and engine time to 45
seconds. Versioned layouts share a 128 MiB cache; active views pin their entries. Closing or
cancelling releases the request, and warm reopening can reuse cached output. Protected files,
macro-enabled package extensions and unsupported content may require another application.

## Reading and saved cells

DOCX Reading follows body paragraphs, headings, simple tables and supported embedded PNG/JPEG
images. It omits full pagination, floating placement, headers, footnotes and some table/drawing
features. Unsupported images have placeholders.

XLSX Sheet shows original row/column addresses and saved values. Select a cell to inspect its value,
format and saved formula. **More → Stored values** switches from supported number/date formats to
raw values; **Formatted values** switches back. Missing cached values are identified. The reader
does not evaluate formulas or follow external data. Calc may recalculate supported formulas in Print
layout, so the two views can show different values.

The grid loads one selected worksheet and up to 100 stored rows at a time. Pagination appears only
when there are other rows to visit. Previous, Next and Row/Go use source row numbers. Sparse sheets
can skip gaps; page filtering searches loaded values. Cell details appear only after selecting a
cell. Bounded merged ranges retain their anchor, including a **Continued from…** value when the
anchor is on an earlier page.

## Evidence, search and limits

Inspection, content indexing and agent readers use the bounded semantic reader, not rendered layout.
Word citations identify blocks; spreadsheet citations identify sheet, row and column. `query_table`
supports CSV, TSV and XLSX with an optional exact sheet name and bounded paging.

Extraction checks archive paths, XML, CRC and source versions. Retained budgets can truncate
content; results report partial coverage. Automatic indexing has a smaller input limit than explicit
preview. Layout support does not automatically add content indexing for DOC, XLS or PPT.

Reading/Sheet mode, selected worksheet, PDF page, zoom and supported scroll state use
source-version-checked preview history. Retry a failed layout or switch to Reading/Sheet when
available. [Troubleshooting](../guides/troubleshooting.md) covers moved and unavailable files.
