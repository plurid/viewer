# Read and inspect files

Select a file and press **Space** to look inside it. Choose **Open linked plane** to keep it open
beside its folder while you go on browsing.

## Each kind of file has its own controls

| File                                      | What you can do                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| PDF                                       | Move through pages, show thumbnails and the outline, search the text       |
| EPUB                                      | Move through chapters, **Find in book**, follow footnotes and go **Back**  |
| Word, PowerPoint and OpenDocument         | Read the paginated layout; Word also has a **Reading** view                |
| Excel and OpenDocument spreadsheets       | Switch sheets; XLSX also has a grid of saved cell values                   |
| JSON, YAML, XML, property lists, map data | Search the tree, **Expand all**, **Collapse all**, or switch to **Source** |
| SQLite database                           | Pick a table, page through its rows, read its definition                   |
| Notebook                                  | Read cells and their saved outputs                                         |
| Calendar, contacts                        | Read events by date, or contact cards                                      |
| Subtitles                                 | Search the cues and see their times                                        |
| Font                                      | Type your own sample text and change its size                              |
| 3D models and drawings                    | Orbit, zoom, show dimensions and measure                                   |
| Audio and video                           | Play, pause and seek                                                       |

Video and audio Chromium cannot play, such as WMV, AVI or WMA, play from a copy Viewer makes on your
Mac; the original is only read.

[Supported formats](../reference/formats.md) lists every format and what its preview shows.

## Bookmark a place in a book

1. In an EPUB, choose **Bookmarks**.
2. Type a name, or leave it empty to use the chapter title, and choose **Add bookmark**.
3. Choose the bookmark later to return to that place.

Bookmarks are kept with the workspace, not written into the book.

## Read a spreadsheet

In an XLSX grid:

- Arrow keys move between cells and show each cell's saved formula.
- Type an address such as **D42** beside the cell details to jump to it.
- Drag, **Shift**-click or **Shift**-arrow to select a range, then press **⌘C** to copy it as
  tab-separated text. **More → Stored values** copies the raw values instead.
- **⌃Page Up** and **⌃Page Down** switch sheets.

[Worksheet controls](../reference/office.md#reading-and-saved-cells) lists the rest. Office layout
comes from a bundled engine; fonts you do not have are substituted, so pages can differ slightly
from Microsoft Office.

## Pick up where you left off

Viewer remembers the page, scroll position, playback time and model camera for each file. Reopen the
file and you are back where you were. If the file has changed since, it opens at the start; book
bookmarks stay.

## When a file moves or disappears

The preview keeps showing what it last loaded and offers three ways back:

- **Check again** after you reconnect a disk or share.
- **Locate file** to point Viewer at the file's new place.
- **Find renamed file** when it was renamed in the same folder.

## Edit it or open it elsewhere

Press **⌘E** to edit a text file in a plane; **⌘S** saves. For anything Viewer does not edit, choose
**Open With…** and pick another app. To share an Office or OpenDocument file with someone who has
neither app, right-click it and choose **Save PDF copy**: the PDF holds every page, and every sheet
of a workbook. [Make a quick change](create.md) covers the edits Viewer can make itself.
