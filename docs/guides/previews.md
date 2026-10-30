# Read and inspect files

Select a file and press **Space** to look inside it. Choose **Open linked plane** to keep it open
beside its folder while you go on browsing.

## Each kind of file has its own controls

| File                                      | What you can do                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| PDF                                       | Move through pages, show thumbnails and the outline, search the text       |
| EPUB, FictionBook                         | Move through chapters, **Find in book**, follow footnotes and go **Back**  |
| Word, PowerPoint, OpenDocument, Publisher | Read the paginated layout; Word also has a **Reading** view                |
| Excel and OpenDocument spreadsheets       | Switch sheets; XLSX also has a grid of saved cell values                   |
| JSON, YAML, XML, property lists, map data | Search the tree, **Expand all**, **Collapse all**, or switch to **Source** |
| SQLite database                           | Pick a table, page through its rows, read its definition                   |
| Notebook                                  | Read cells and their saved outputs                                         |
| Calendar, contacts                        | Read events by date, or contact cards                                      |
| Email and mailboxes                       | Read a message and its attachment list; pick a message from a mailbox      |
| Safari web archive                        | Read the saved page; **Reload** it from the archive                        |
| Subtitles                                 | Search the cues and see their times                                        |
| Font                                      | Type your own sample text and change its size                              |
| 3D models and drawings                    | Orbit, zoom, show dimensions and measure                                   |
| Audio and video                           | Play, pause and seek; **Subtitles** shows a subtitle file named like it    |
| iWork, Krita, OpenRaster, Sketch, XPS     | Zoom the preview image the document saved                                  |
| Certificates and keys                     | Read each certificate and its chain; a private key shows its type only     |
| Internet shortcuts                        | See the address and its host; **Open in Browser** or **Open in Mail App**  |
| Torrent                                   | Read its files, trackers and info-hash                                     |
| Provisioning profile                      | Read its app ID, team, expiry, devices and entitlements                    |
| Any other file                            | Read its bytes in hex; **Go to offset** jumps to a byte                    |

Video and audio Chromium cannot play, such as WMV, AVI or WMA, play from a copy Viewer makes on your
Mac; the original is only read. A `.ts` or `.mts` file plays as video when it is a recording and
opens as code when it is TypeScript. A compressed text file such as `notes.txt.gz` shows the text
inside it.

A Pages, Numbers or Keynote document, a Krita, OpenRaster or Sketch file and an XPS document show
the picture they saved of themselves, not a live rendering. A Pages, Numbers or Keynote package
folder previews too: select it and press **Space**, or choose **Open linked plane** to show it in a
plane. Its footer shows the package's total size. Double-click opens the document in its own app.

A Collada, 3DS, USDZ, X3D, VRML or OFF model shows only what its file holds. Textures and other
files it links to are listed below the model and not opened.

An email's HTML shows without scripts or remote images, and **Remote images are blocked.** says when
it has any. Choose **Plain text** to read its other form. Attachments are listed, never opened. To
keep one, choose **Save** beside it to save it next to the message, or **Save to…** to pick a
folder. **Save All** saves every attachment, and **⌘Z** undoes a save. In a mailbox, choose a
message, or press the arrow keys to move through the list. A Safari web archive shows only what
Safari saved: nothing loads from the network.

A shortcut, a torrent and a provisioning profile are only read: Viewer loads no address, contacts no
tracker and checks no signature. Double-click shows the preview; open the file in its own app to
import, follow or download it.

[Supported formats](../reference/formats.md) lists every format and what its preview shows.

## Read a file's bytes

A file no preview reads shows its bytes, under what its first bytes say it is. To see any other
file's bytes, choose **Hex** in the preview's footer, or **Show as hex** in Quick Preview or the
command palette. Choose **Hex** again, or **Show preview**, to go back.

- Click a byte, or use the arrow keys, **Page Up** and **Page Down**, **Home** and **End**, to move.
  **⌘↑** and **⌘↓** go to the first and last byte.
- Type an offset beside **Go to offset** and press **Return**: `0x1F0` or `1F0h` is hexadecimal,
  `496` decimal.

A file that holds a private key is never shown as hex.

## Bookmark a place in a book

1. In an EPUB or FictionBook, choose **Bookmarks**.
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

Viewer remembers the page, scroll position, playback time, subtitle choice and model camera for each
file. Reopen the file and you are back where you were. If the file has changed since, it opens at
the start; book bookmarks stay.

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
