# Read and inspect files

Select a file and press **Space** for Quick Preview. Choose **Open linked plane** when you want to
keep it open while continuing through the folder.

## Use the file's own controls

PDFs have page navigation, thumbnails, an outline and text search. Books have chapter navigation.
Models have orbit, zoom, dimensions and measurement tools. Audio and video have playback controls.
Available actions follow the file type.

For JSON and YAML, use the tree's search, **Expand all** and **Collapse all**. Switch to Source when
you need the original text. Read-only source uses a 16 px default; editor and terminal typography
have separate settings.

## Office documents

Word and PowerPoint open in a local paginated layout. Excel has worksheet navigation; XLSX also
offers a stored-value grid. DOCX has an additional Reading view. Choose Layout or Print layout when
page appearance matters.

The bundled engine preserves the layout it supports and substitutes unavailable fonts. It does not
guarantee identical output to Microsoft Office. See [Office previews](../reference/office.md) for
the distinction between rendered layout and the saved cell/text reader.

## Return to your place

Viewer remembers supported page, scroll, playback and model-camera state against the file's version.
Changed files can invalidate that state. Closing a preview does not change its source file.

If a source disappears, the retained preview identifies its last loaded version and offers **Check
again**, **Locate file** or **Find renamed file**. Unsaved editor text remains attached to its
draft; locating another file opens it separately.

## Edit or open elsewhere

Text files offer **Edit** in a plane, then Save or Save As. Quick Preview remains a reading surface.
**Open in…** uses another installed application when a format needs more specialized work.

[Supported formats](../reference/formats.md) distinguishes a full interactive preview, a rendered
image and partial inspection. [Create and edit](create.md) covers changes you can make directly in
Viewer.
