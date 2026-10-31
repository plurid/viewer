# Browse and organize

Use this guide for everyday file work in a folder plane: picking a view, selecting, copying,
renaming, finding files, measuring folders and getting things back from the Trash.

**Find it:** right-click a file or empty space for the file menu · **⌘F** to find files · **⌘K** for
any command by name · **File** and **Edit** in the menu bar

Each folder remembers its own view, sort order and column widths. A second plane on the same folder
keeps its own selection.

## Pick a view

| View        | Key    | Best for                                             |
| ----------- | ------ | ---------------------------------------------------- |
| **List**    | **⌘1** | Sorting by name, date, kind or size                  |
| **Grid**    | **⌘2** | Thumbnails                                           |
| **Columns** | **⌘3** | Following a folder trail, with a preview beside it   |
| **Gallery** | **⌘4** | One large file at a time while you move through them |
| **Map**     | **⌘5** | Arranging items in space without moving the files    |

The **View mode** button in the folder's header switches views too. To group items, right-click
empty space and choose **View → Group by**, then **Group by kind** or **Group by date modified**.
**⌘⇧.** shows or hides hidden files.

**Columns** shows the path from the filesystem root to the current folder and scrolls that folder
into view. Scroll left to reach its ancestors, or use the left and right arrow keys to follow the
folder trail.

Sizes use decimal units, as Finder shows them: 1 KB is 1,000 bytes and 1 MB is 1,000,000 bytes.

## Select

- Click to select. **Shift**-click selects a range; **⌘**-click adds or removes one item.
- **⌘A** selects everything. Click empty space, or press **Escape**, to clear the selection.
- Type the first letters of a name to jump to it.
- **⌃⌘=** (**Select by pattern…**) selects names such as `*.jpg`; **⌃⌘-** (**Deselect by pattern…**)
  deselects them.

## Copy, move and rename

| To                       | Do                                                                        |
| ------------------------ | ------------------------------------------------------------------------- |
| Copy and paste           | **⌘C**, then **⌘V** in the destination                                    |
| Move                     | **⌘C**, then **⌥⌘V** (**Move Copied Items Here**) in the destination      |
| Move by dragging         | Drag onto a folder: it moves on the same disk and copies to another       |
| Choose copy or move      | Hold **Option** while you drop to copy, **⌘** to move                     |
| Rename                   | Select, press **Return**, type, press **Return**                          |
| Duplicate                | **⌘D**                                                                    |
| Make a folder            | **⌘N**; **⌃⌘N** (**New folder with selection…**) puts the selection in it |
| Copy a file's full path  | **⌥⌘C** (**Copy path**)                                                   |
| Copy a path in a dialog  | Click the path to select all of it, or click the copy button beside it    |
| See size, dates and tags | **⌘I** (**Get info…**)                                                    |

A copy on the same disk is instant: on APFS, Viewer clones the file, so the copy shares the
original's storage until either one changes. Copies to another disk read and write every byte.

When a name already exists at the destination, Viewer asks whether to **Skip**, **Keep both** or
**Replace**. The **File operations** button in the title bar shows each operation as a
[job](../reference/terms.md#changes-and-recovery), with its progress and failures. Choose **Clear
all** in that panel to dismiss finished operations, including failures. Running and queued
operations stay visible. Undo and recovery receipts remain available.

**⌘Z** undoes the last file operation, and **⇧⌘Z** redoes it. An operation offers **Undo** for the
items it finished, even when another item failed. Undo first checks that the files are still as the
operation left them.

## Let Viewer suggest

Right-click a shortcut in **Favorites** for **Suggested → Remove from Favorites**. This removes the
saved shortcut; the folder and its contents stay in place.

Right-click a file. Under **Suggested**, Viewer offers up to three actions that fit it, each with
its reason:

![A file menu suggesting Extract here for a zip archive](../media/suggested.png)

| Selection                             | Suggested                                                               |
| ------------------------------------- | ----------------------------------------------------------------------- |
| A zip or tar archive                  | **Extract here**                                                        |
| A PDF over 10 MB                      | **Optimize…**                                                           |
| A JPEG or PNG photo over 3 MB         | **Images for web…**                                                     |
| A HEIC photo                          | **Convert copy to JPEG**                                                |
| Several photos                        | **Lay out…**, **Create PDF from images**                                |
| Three or more photos                  | **Batch rename…**                                                       |
| DXF drawings                          | **Nest for cutting…**                                                   |
| A video or audio file                 | **Edit media…**; **Extract audio…** for a video                         |
| An Office or OpenDocument file        | **Save PDF copy**                                                       |
| A text or code file                   | **Edit text**                                                           |
| A folder                              | **Calculate Size**; **Git changes** in a repository, with Git status on |
| Several items                         | **Compress to ZIP**                                                     |
| A name ending in " copy" or "(2)"     | **Find duplicates…**                                                    |
| An installer in Downloads, a week old | **Move to Trash…**                                                      |

What you choose for a kind of file rises for that kind next time: if you always rename PDFs, PDFs
suggest it. The same suggestions appear in **⌘K** before you type, and the best one appears as a
button in Quick Preview. Turn them off with **Settings → Browsing → Suggestions → Suggest actions in
file menus**; **⌘K** → **Forget learned suggestions** clears what Viewer learned. A folder can also
point out what needs attention, and a model can add its own picks: see
[Explore a folder](explore.md).

**Extract here** puts an archive's contents in a folder named after it, beside the archive. When the
archive holds one folder with everything inside, that folder's contents are the result, so you never
get a folder inside a folder of the same name.

## Rename many files at once

1. Select the files, press **⌘K** and choose **Batch rename…**.
2. Say what changes: a **Filename template** such as `Trip {number}{extension}`, a **Prefix** or
   **Suffix**, or **Find text** and **Replace with**. Choose **Create proposal**.
3. Review the old and new names. Untick any file that should keep its name, then choose **Apply 12
   changes**; the button counts the files that change.

**Rename as book…** names PDFs and EPUBs from their own publication details: year, authors, title
and publisher.

## Find files

1. Press **⌘F** and type part of a name. Matches appear as you type; choose one to open it.
2. To search below the folder, choose **This folder** beside the results and change it to
   **Subfolders**. **Indexed locations** searches every location Viewer has indexed.
3. Add filters: `ext:pdf`, `kind:folder`, `size>10mb`, `modified<7d`. Combine them with spaces.
4. For words inside documents, turn on **Document text**. First turn on **Contents** for the
   location in **Settings → Search**; **Add location…** adds another.
5. **Open results** keeps the matches in a search plane. **Save search…** keeps the query.

To filter the folder you are in as you type, choose **Search this folder** (the magnifier) in the
plane's header. **Subfolders** includes names in nested folders. For document text, use the search
panel's **Document text** option.

A content result opens its passage in the document. [Search](../reference/search.md) lists every
filter and how to save a search.

## See what takes space

- Choose **Calculate Size** on a folder to measure it. Folders are not measured until you ask, so a
  large disk stays fast to browse.
- **Find duplicates…** lists identical files in the selected folders.
- **Compare locations…** shows what differs between two folders.

## Trash and restore

**⌘⌫** (**Move to Trash…**) moves the selection to the operating system's Trash. Viewer never
deletes a file for good. Closing a plane only closes its view; it never deletes files.

To get a file back, choose **Trash** in the sidebar, select the item and choose **Restore**. Choose
**Restore to…** when Viewer does not know where the file came from, which is the case for files
trashed by other apps. Browsing the Trash needs Full Disk Access for Viewer in **System Settings →
Privacy & Security**.

## On a network share without a Trash

Many network shares have no Trash, and Viewer never deletes a file instead.

- **Move to Trash** refuses there and leaves the item where it is. Move it to a disk with a Trash
  first, or delete it from another app.
- Saving over a file, or choosing **Replace**, keeps the previous version beside it, such as
  `Notes (previous).md`. **File operations** names the file it kept. Remove it yourself when you no
  longer need it.

[File operations](../reference/file-operations.md) covers name collisions, archives and recovery
after an interrupted copy.
