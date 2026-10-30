# Read and inspect files

Use this guide to look inside a file without leaving its folder: each kind of file's controls,
saving email attachments, reading any file's bytes, and picking up where you left off.

**Find it:** select a file and press **Space**, or choose **File → Quick Preview** · **Open linked
plane** keeps it open · **⌘K** → **Show as hex** for its bytes

## Look, then keep it open

1. Select a file and press **Space**. [Quick Preview](../reference/terms.md#looking-at-files) opens
   over the folder.
2. With several files selected, **←** and **→** step through them. **Space** or **Escape** closes
   the preview.
3. To keep the file open beside its folder, choose **Open linked plane**. It becomes a
   [linked plane](../reference/terms.md#planes-and-the-space) you can read while you go on browsing.

The footer also opens the file in its own app, offers **Edit** (**⌘E**) for a text file, and shows
the [Suggested](../reference/terms.md#suggestions) next step for the file, such as **Optimize…** for
a large PDF.

## Each kind of file has its own controls

| File                                      | What you can do                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| PDF                                       | Move through pages, show thumbnails and the outline, search the text              |
| EPUB, FictionBook                         | Move through chapters, **Find in book**, follow footnotes and go **Back**         |
| Word, PowerPoint, OpenDocument, Publisher | Read the paginated **Layout**; Word also has a **Reading** view                   |
| Excel and OpenDocument spreadsheets       | Switch sheets in **Print layout**; XLSX also has a **Sheet** grid of saved values |
| JSON, YAML, XML, property lists, map data | Search the tree, **Expand all**, **Collapse all**, or switch to **Source**        |
| SQLite database                           | Pick a table, page through its rows, read its definition                          |
| Notebook                                  | Read cells and their saved outputs                                                |
| Calendar, contacts                        | Read events by date, or contact cards                                             |
| Email and mailboxes                       | Read a message, save its attachments; pick a message from a mailbox               |
| Safari web archive                        | Read the saved page; **Reload** it from the archive                               |
| Subtitles                                 | Search the cues and see their times                                               |
| Font                                      | Type your own sample text, choose its size, read its details and characters       |
| 3D models and drawings                    | Orbit, zoom, show dimensions and measure                                          |
| Audio and video                           | Play, pause and seek; choose a subtitle file named like it, or **Subtitles off**  |
| iWork, Krita, OpenRaster, Sketch, XPS     | Zoom the preview image the document saved                                         |
| Certificates and keys                     | Read each certificate and its chain; a private key shows only its type            |
| Internet shortcuts                        | See the address and its host; **Open in Browser** or **Open in Mail App**         |
| Torrent                                   | Read its files, trackers and info-hash                                            |
| Provisioning profile                      | Read its app ID, team, expiry, devices and entitlements                           |
| Any other file                            | Read its bytes in hex; **Go to offset** jumps to a byte                           |

Video and audio Chromium cannot play, such as WMV, AVI or WMA, play from a copy Viewer makes on your
Mac; the original is only read. A `.ts` or `.mts` file plays as video when it is a camera or TV
recording, and opens as code when it is TypeScript. A compressed text file such as `notes.txt.gz`
shows the text inside it.

A Pages, Numbers or Keynote document, a Krita, OpenRaster or Sketch file and an XPS document show
the picture they saved of themselves, not a live rendering. A Pages, Numbers or Keynote package is a
folder on disk, but Viewer treats it as the document it is: select it and press **Space**, or choose
**Open linked plane** to show it in a plane. Its footer shows the package's total size. Double-click
opens the document in its own app, and **Show Package Contents** goes inside.

A Collada, 3DS, USDZ, X3D, VRML or OFF model shows only what its file holds. Textures and other
files it links to are listed below the model and not opened.

A shortcut, a torrent and a provisioning profile are only read: Viewer loads no address, contacts no
tracker and checks no signature. Double-click shows the preview; open the file in its own app to
import, follow or download it.

[Supported formats](../reference/formats.md) lists every format and what its preview shows.

## Read an email and save its attachments

An email's HTML shows without scripts or remote images, and **Remote images are blocked.** says when
it has any. Choose **Plain text** to read its other form, and **HTML** to go back. In a mailbox,
choose a message, or press the arrow keys to move through the list.

Attachments are listed with their type and size, and never opened. To keep one:

1. Choose **Save** beside it to save it next to the message, or **Save to…** to pick a folder.
2. With several attachments, **Save All** saves every one next to the message, and **Save All to…**
   asks for a folder.
3. **⌘Z** undoes a save.

A Safari web archive shows only what Safari saved: nothing loads from the network.

## Read a file's bytes

A file no preview reads shows its bytes, under what its first bytes say it is. To see any other
file's bytes, choose **Hex** in the preview's footer, or **Show as hex** in Quick Preview or **⌘K**.
Choose **Hex** again, or **Show preview**, to go back.

- Click a byte, or use the arrow keys, **Page Up** and **Page Down**, **Home** and **End**, to move.
  **⌘↑** and **⌘↓** go to the first and last byte.
- Type an offset beside **Go to offset** and press **Return**: `0x1F0` or `1F0h` is hexadecimal,
  `496` decimal.

The hex view pages through a file of any size. A file that holds a private key is never shown as
hex. [Explore a folder](explore.md#identify-a-file-viewer-cannot-show) shows how to identify a file
by its bytes.

## Bookmark a place in a book

1. In an EPUB or FictionBook, choose **Bookmarks**.
2. Type a name, or leave it empty to use the chapter title, and choose **Add bookmark**.
3. Choose the bookmark later to return to that place.

Bookmarks are kept with the workspace, not written into the book.

## Read a spreadsheet

An XLSX opens on its **Sheet** grid. In the grid:

- Arrow keys move between cells and show each cell's saved value and formula.
- Type an address such as `D42` in **Cell address** and choose **Go** to jump to it.
- Drag, **Shift**-click or **Shift**-arrow to select a range, then press **⌘C**, or choose **Copy**,
  to copy it as tab-separated text.
- **More → Stored values** shows and copies the raw values instead of formatted ones; **Formatted
  values** switches back.
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

Press **⌘E** to edit a text file in a plane; **⌘S** saves and **Done** ends editing. For anything
Viewer does not edit, choose **Open With…** and pick another app. To share an Office or OpenDocument
file with someone who has neither app, right-click it and choose **Save PDF copy**: the PDF holds
every page, and every sheet of a workbook. [Make a quick change](create.md) covers the edits Viewer
can make itself.
