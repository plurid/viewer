# Read and inspect files

Select a file and press **Space** for Quick Preview. Choose **Open linked plane** when you want to
keep it open while continuing through the folder.

## Use the file's own controls

PDFs have page navigation, thumbnails, an outline and text search. Books have chapters, local
illustrations, internal links and **Find in book**. Follow a footnote, then use **Back** to return
to your reading position. Choose a search result to open and highlight its passage. Models have
orbit, zoom, dimensions and measurement tools. Audio and video have playback controls. Available
actions follow the file type.

For JSON, YAML and XML, use the tree's search, **Expand all** and **Collapse all**. Narrow previews
keep expansion and copy controls under **More**. XML shows elements, attributes and ordered text; it
does not turn an invoice into a rendered bill. Switch to **Source** for the original text. Read-only
source uses a 16 px default; editor and terminal typography have separate settings.

## Save a book position

In an EPUB, choose **Bookmarks**, enter a name and choose **Add bookmark**. Leave the name blank to
use the current chapter's title. Choose a saved name to return to that chapter and reading position.
Use **Rename** and **Save name** to change its label, or **Remove** to discard the bookmark.

Bookmarks stay with the file's preview state in the workspace when you close the preview, reopen
Viewer or the book changes. If its chapter is no longer available, the bookmark remains visible with
**Chapter unavailable**. Bookmarks do not change the EPUB file.

## Office documents

Word and PowerPoint open in a local paginated layout. Excel has worksheet navigation; XLSX also
offers a stored-value grid. DOCX has an additional Reading view. Choose Layout or Print layout when
page appearance matters.

In an XLSX grid, arrow keys inspect cells and their saved formulas. Enter an address such as **D42**
beside the cell details to jump there. Drag across cells, Shift-click or use Shift + arrow keys to
select a range. Choose **Copy** beside the selected range, or press Control/Command + C while the
grid has focus, to copy tab-separated values. **More → Stored values** copies raw saved values;
**Formatted values** uses the supported number/date formats. Escape reduces a multi-cell range to
its active cell. Control + Page Up/Down switches sheets. See
[worksheet controls](../reference/office.md#reading-and-saved-cells) for the full keyboard controls.

The bundled engine preserves the layout it supports and substitutes unavailable fonts. It does not
guarantee identical output to Microsoft Office. See [Office previews](../reference/office.md) for
the distinction between rendered layout and the saved cell/text reader.

## Return to your place

Viewer remembers supported page, scroll, playback and model-camera state against the file's version.
EPUB retains chapter, text size and contents visibility. XLSX retains the worksheet, loaded row
position, filter and selected range. Returning to a recently read book or worksheet can reuse its
completed data while still checking file access. Changed files reset transient reading coordinates;
named EPUB bookmarks remain saved. Closing a preview does not change its source file or remove its
bookmarks.

If a source disappears, the retained preview identifies its last loaded version and offers **Check
again**, **Locate file** or **Find renamed file**. Unsaved editor text remains attached to its
draft; locating another file opens it separately.

## Edit or open elsewhere

Text files offer **Edit** in a plane, then Save or Save As. Quick Preview remains a reading surface.
**Open in…** uses another installed application when a format needs more specialized work.

[Supported formats](../reference/formats.md) distinguishes a full interactive preview, a rendered
image and partial inspection. [Create and edit](create.md) covers changes you can make directly in
Viewer.
