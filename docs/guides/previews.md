# Read and inspect files

Select a file and press **Space** for Quick Preview. Choose **Open linked plane** when you want to
keep it open while continuing through the folder.

## Use the file's own controls

PDFs have page navigation, thumbnails, an outline and text search. Books have chapter navigation.
Models have orbit, zoom, dimensions and measurement tools. Audio and video have playback controls.
Available actions follow the file type.

For JSON, YAML and XML, use the tree's search, **Expand all** and **Collapse all**. Narrow previews
keep expansion and copy controls under **More**. XML shows elements, attributes and ordered text; it
does not turn an invoice into a rendered bill. Switch to **Source** for the original text. Read-only
source uses a 16 px default; editor and terminal typography have separate settings.

## Office documents

Word and PowerPoint open in a local paginated layout. Excel has worksheet navigation; XLSX also
offers a stored-value grid. DOCX has an additional Reading view. Choose Layout or Print layout when
page appearance matters.

The bundled engine preserves the layout it supports and substitutes unavailable fonts. It does not
guarantee identical output to Microsoft Office. See [Office previews](../reference/office.md) for
the distinction between rendered layout and the saved cell/text reader.

## Return to your place

Viewer remembers supported page, scroll, playback and model-camera state against the file's version.
EPUB retains chapter, text size and contents visibility. XLSX retains the worksheet, loaded row
position, filter and selected cell. Returning to a recently read book or worksheet can reuse its
completed data while still checking file access. Changed files can invalidate that state. Closing a
preview does not change its source file.

If a source disappears, the retained preview identifies its last loaded version and offers **Check
again**, **Locate file** or **Find renamed file**. Unsaved editor text remains attached to its
draft; locating another file opens it separately.

## Edit or open elsewhere

Text files offer **Edit** in a plane, then Save or Save As. Quick Preview remains a reading surface.
**Open in…** uses another installed application when a format needs more specialized work.

[Supported formats](../reference/formats.md) distinguishes a full interactive preview, a rendered
image and partial inspection. [Create and edit](create.md) covers changes you can make directly in
Viewer.
