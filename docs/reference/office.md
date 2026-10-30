# Office documents and worksheets

This page lists the Office, OpenDocument and Publisher formats Viewer lays out, the views each one
gets, and the engine's and worksheet reader's limits.

Open a file with **Space** or as a linked plane. Everything runs on your Mac; macros never run.

## Formats and views

| Formats                                                                                      | Views                                |
| -------------------------------------------------------------------------------------------- | ------------------------------------ |
| `.docx`, `.docm`, `.dotx`, `.dotm`                                                           | **Layout** and **Reading**           |
| `.doc`, `.dot`, `.rtf`, `.odt`, `.ott`, `.fodt`                                              | **Layout**                           |
| `.xlsx`, `.xlsm`, `.xltx`, `.xltm`                                                           | **Sheet** and **Print layout**       |
| `.xls`, `.xlt`, `.ods`, `.ots`, `.fods`                                                      | **Print layout** with worksheet tabs |
| `.ppt`, `.pptx`, `.pptm`, `.pps`, `.ppsx`, `.pot`, `.potx`, `.potm`, `.odp`, `.otp`, `.fodp` | **Layout**, one page per slide       |
| `.odg`, `.fodg`, `.pub`, `.emf`, `.wmf`                                                      | **Layout**, as drawing pages         |

- **Reading** and **Sheet** need the file's own extension; a file shown with **Show as** gets
  **Layout** only.
- A packaged OpenDocument file (`.odt`, `.ods`, `.odp`, `.odg`, `.ott`, `.ots`, `.otp`) shows the
  picture of its first page it carries while the layout renders.
- A `.pub` file that holds a public key shows as a key or as text, not as a layout.
- New settings open `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt` and `.pptx` in a plane
  (`settings.fileOpening.types`); set a type to `native` to open it in its own app.

Worksheet tabs support arrow keys, **Home** and **End**. In **Sheet** they sit below the grid; **All
worksheets** appears when the tabs overflow. **Print layout** renders only the selected sheet, with
its supported page settings and breaks.

**Save PDF copy** writes `Name.pdf` beside each selected file, laid out by the same engine; a
workbook's copy holds every worksheet. A name in use asks before replacing.

## Layout fidelity

The bundled engine, ZetaOffice 24.2 (LibreOffice built for WebAssembly), renders supported fonts,
paragraph placement, pages, headers, footers, images, charts and slide backgrounds to an in-memory
PDF. Missing fonts use substitutes. Output is closer to the document's layout than the semantic
reader, but Microsoft Office pixel parity is not guaranteed.

Font metrics and line wrapping, chart plot/label placement, and worksheet drawing styles can differ
from Office. Some rotated floating pictures in legacy DOC files lose their rotation and change text
wrapping. Bundled Noto CJK serif and sans collections supply Chinese, Japanese and Korean glyphs.
Named families such as MS Mincho, Meiryo, SimSun and Batang use regional substitutes that retain
their serif or sans style; this does not guarantee identical font metrics. Filename fields retain
the source basename. Revision/comment balloons are not a qualified review view; use the original
application when those annotations matter.

The engine runs in a fresh sandbox without Node, preload, host filesystem access or Viewer IPC.
Macros and external-document updates are disabled. Inputs retain their basename in an isolated RAM
directory; the engine does not receive the source folder path. Requests are limited to the job's
loopback origin. The same pinned assets are packaged for macOS, Windows and Linux; executable
Windows/Linux qualification is still pending.

| Limit           | Value                                                          |
| --------------- | -------------------------------------------------------------- |
| Layouts at once | 1                                                              |
| Input           | 64 MB                                                          |
| Output PDF      | 32 MB                                                          |
| Engine time     | 45 seconds per layout                                          |
| Layout cache    | 128 MiB, shared; open views pin their entries                  |
| Spare engine    | 1, started for the next document; closes after 1 minute unused |

Closing or cancelling a view releases its request, and reopening can reuse cached output. Protected
files and unsupported content may need another application.

## Reading and saved cells

DOCX Reading follows body paragraphs, headings, simple tables and supported embedded PNG/JPEG
images. It omits full pagination, floating placement, headers, footnotes and some table/drawing
features. Unsupported images have placeholders.

XLSX Sheet shows original row/column addresses and saved values. Select a cell to inspect its value,
format and saved formula. **More → Stored values** switches from supported number/date formats to
raw values; **Formatted values** switches back. Missing cached values are identified. The reader
does not evaluate formulas or follow external data. Calc may recalculate supported formulas in Print
layout, so the two views can show different values.

Focus the grid and use arrow keys to inspect cells; Tab leaves the grid instead of visiting every
cell. Page Up/Down moves by the visible page and loads another bounded page when needed. Home/End
moves to the first/last previewed column; Control/Command + Home/End reaches the sheet's beginning
or last stored row. **Cell address** accepts A1 notation, including `$B$42`, and Go loads its row.
Addresses are limited to the previewed columns and worksheet row range. Control + Page Up/Down
switches worksheets and keeps keyboard focus through loading.

The grid loads one selected worksheet and up to 100 stored rows at a time. Pagination appears only
when there are other rows to visit. Previous, Next and Row/Go use source row numbers. Sparse sheets
can skip gaps; page filtering searches loaded values. The compact address/detail row shows the
selected cell's saved value and formula. Bounded merged ranges retain their anchor, including a
**Continued from…** value when the anchor is on an earlier page.

### Select and copy a range

Drag across cells, Shift-click or use Shift + arrow keys to extend the selection. The shared fill
marks the selected range; the focused grid outlines its active cell. The detail row shows the source
range beside **Copy** and the active cell's saved value. Escape collapses a multi-cell range to its
active cell. With a single cell selected, Escape continues the normal preview-close behavior.

Choose **Copy** or press Control/Command + C while the grid has focus. The clipboard receives
tab-separated values using the current **Formatted values** or **Stored values** setting. Fields
containing tabs, line breaks or quotes are quoted, with embedded quotes doubled. Blank cells and
source row/column gaps remain empty fields. Merged values appear only in the upper-left cell of
their range. Formulas are never evaluated or copied in place of values; formulas without cached
values copy as empty cells.

Selections use source coordinates. A display filter does not remove intervening source rows from the
copied rectangle. Known merged cells expand the selection to their full range. A selection can span
pages: copying fetches additional bounded pages without moving the visible page. Incomplete
extraction rejects the copy. If a merge discovered on a later page extends beyond the selection,
select its entire range before copying.

Copy is limited to 10,000 cells, 1 MiB of UTF-8 text and a 15-second timeout. Use **Cancel copy**
while a copy is pending. Status or failure appears below the detail row; copying never changes the
source workbook.

## Evidence, search and limits

Inspection, content indexing and agent readers use the bounded semantic reader, not rendered layout.
Word citations identify blocks; spreadsheet citations identify sheet, row and column. `query_table`
supports CSV, TSV and XLSX with an optional exact sheet name and bounded paging.

Extraction checks archive paths, XML, CRC and source versions. Retained budgets can truncate
content; results report partial coverage. Automatic indexing has a smaller input limit than explicit
preview. Layout support does not automatically add content indexing for DOC, XLS or PPT.

Reading or Sheet mode, the selected worksheet, the layout page, zoom and supported scroll positions
are kept in preview history, checked against the file's version. Retry a failed layout, or switch to
**Reading** or **Sheet** when the format has it.

**Related:** [Read and inspect files](../guides/previews.md#read-a-spreadsheet) ·
[Supported formats](formats.md) · [PDF tools](pdf.md) · [Search](search.md) ·
[Get back to your work](../guides/troubleshooting.md)
