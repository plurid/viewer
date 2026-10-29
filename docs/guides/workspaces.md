# Keep your work together

A workspace is a set of planes and where you put them. Viewer saves it as you go, so the same
folders, files and tools are there when you come back. Your files stay in their ordinary folders.

![A folder and its linked document side by side](../media/hero.png)

## Open a second plane

- In a preview, choose **Open linked plane**, or **Option**-double-click a file. The new plane is a
  child of the folder it came from, and a line joins them.
- Choose **Open in another plane** for a separate folder plane with its own history.
- **Related planes** in a plane's header lists its parent and children. Closing a child returns you
  to its parent.

Opening a file that already has a plane in the same branch shows that plane again.

## Move between planes

| To                                   | Do                                           |
| ------------------------------------ | -------------------------------------------- |
| See every plane                      | **⌘0**                                       |
| Give one plane the whole window      | **⌘Return**, or **Dock plane** in its header |
| Lay the planes out face-on           | **⌘K** → **Tile the planes in view**         |
| Go to the parent plane               | **⌥⌘↑**                                      |
| Close a plane                        | **⌥⌘W**, or **×** in its header              |
| Undo a move, resize or close         | **⌥⌘Z**; **⌥⇧⌘Z** redoes it                  |
| Hide the window's chrome for a while | **⌘⇧F**                                      |

In the spatial view, click inside a plane to scroll it and type into it. Click the background or
press **Escape** to move around the space again. Drag a plane by its header.

**⌥⌘Z** only undoes arrangement. File changes have their own **⌘Z**; see
[Browse and organize](files.md#copy-move-and-rename).

## Save a view and return to it

1. Arrange the planes and camera the way you want.
2. Press **⌃⌥⌘1** to save the view in slot 1, up to **⌃⌥⌘9**, or choose **Save view…** to name it.
3. Press **⌥⌘1** to fly back to slot 1.

**Save layout as template…** keeps the arrangement of plane kinds, so you can apply it to other
folders.

## Use several workspaces

Open the workspace menu at the top of the window to create, rename and switch workspaces. Give each
kind of work its own: a writing workspace with a folder, a PDF and notes; a project workspace with
an editor, a terminal and a browser. Choose where new folder planes open in **Settings → Browsing →
New folder planes start in**.

## Share a project folder

**File → Create Project…** writes `viewer.project.jsonc` into a folder. It records which files are
open and how they are arranged, using paths relative to that folder, so the project opens the same
way on another computer. It never copies your files, terminal history, conversations or keys. Open
it again with **File → Open Project…**.

## Back up and restore your work

1. Choose **Workspace → Backup and Restore…**, then **Create backup…**.
2. Check the workspace and document counts, then save the file.
3. On the other computer, choose **Open backup…**, relink any folder that moved, then choose
   **Restore copies**.

The backup holds your notes, drafts, conversations, file paths and command history, so keep it
private. It does not hold your files, keys, folder permissions or browser sessions. Restored
terminals, servers and conversations stay stopped until you start them.
[Personal backups](../reference/configuration.md#personal-backups) lists the exact contents.

## What closing a plane does

| Plane          | Closing it                                                            |
| -------------- | --------------------------------------------------------------------- |
| A preview      | Keeps the file                                                        |
| A note         | Keeps the note; reopen it from **Notes…**                             |
| A terminal     | Ends its shell                                                        |
| A local server | Keeps the server running; reopen its controls from **Local servers…** |

When Viewer restarts, it reopens your planes but never reruns terminal input, commands, agents or
servers.
