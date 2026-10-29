# Browse and organize

Everything here works in a folder plane. Each folder remembers its own view, sort order and column
widths; a second plane on the same folder keeps its own selection.

## Pick a view

| View        | Key    | Best for                                             |
| ----------- | ------ | ---------------------------------------------------- |
| **List**    | **⌘1** | Sorting by name, date, kind or size                  |
| **Grid**    | **⌘2** | Thumbnails                                           |
| **Columns** | **⌘3** | Following a folder trail, with a preview beside it   |
| **Gallery** | **⌘4** | One large file at a time while you move through them |
| **Map**     | **⌘5** | Arranging items in space without moving the files    |

The view menu in the folder's header also groups items, for example by kind or date. **⌘⇧.** shows
or hides hidden files.

## Select

- Click to select. **Shift**-click selects a range; **⌘**-click adds or removes one item.
- **⌘A** selects everything. Click empty space to clear the selection.
- Type the first letters of a name to jump to it.
- **⌃⌘=** selects by a name pattern such as `*.jpg`; **⌃⌘-** deselects by one.

## Copy, move and rename

| To                       | Do                                               |
| ------------------------ | ------------------------------------------------ |
| Copy and paste           | **⌘C**, then **⌘V** in the destination           |
| Move                     | **⌘C**, then **⌥⌘V** in the destination          |
| Move by dragging         | Drag onto a folder; hold **Option** to copy      |
| Rename                   | Select, press **Return**, type, press **Return** |
| Duplicate                | **⌘D**                                           |
| Make a folder            | **⌘⇧N**; **⌃⌘N** puts the selection inside it    |
| Copy a file's full path  | **⌥⌘C**                                          |
| See size, dates and tags | **⌘I**                                           |

When a name already exists at the destination, Viewer asks whether to skip, keep both or replace.
The **File operations** button in the title bar shows progress and failures. Completed operations
offer **Undo**, which first checks that the files are still as the operation left them.

## Rename many files at once

1. Select the files, press **⌘K** and choose **Batch rename**.
2. Say what changes: a **Filename template** such as `Trip {number}{extension}`, a **Prefix** or
   **Suffix**, or **Find text** and **Replace with**. Choose **Create proposal**.
3. Review the old and new names. Untick any file that should keep its name, then choose **Apply**.

## Find files

1. Press **⌘F** and type part of a name.
2. Turn on **Subfolders** to search everything below.
3. Add filters: `ext:pdf`, `kind:folder`, `size>10mb`, `modified<7d`. Combine them with spaces.
4. For words inside documents, choose **Search contents**. Choose which locations to index in
   **Settings → Search** first.

A content result opens its passage in the document. [Search](../reference/search.md) lists every
filter and how to save a search.

## See what takes space

- Choose **Calculate Size** on a folder to measure it. Folders are not measured until you ask, so a
  large disk stays fast to browse.
- **Find duplicates…** lists identical files in the selected folders.
- **Compare locations…** shows what differs between two folders.

## Trash and restore

**⌘⌫** moves the selection to the operating system's Trash. Closing a plane only closes its view; it
never deletes files.

To get a file back, choose **Trash** in the sidebar, select the item and choose **Restore**. Choose
**Restore to…** when Viewer does not know where the file came from, which is the case for files
trashed by other apps. On macOS, browsing the Trash needs Full Disk Access for Viewer in **System
Settings → Privacy & Security**.

[File operations](../reference/file-operations.md) covers name collisions, archives and recovery
after an interrupted copy.
