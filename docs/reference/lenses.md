# Lenses and Map view

This page describes lenses, which group a folder's items without moving them, and the Map view that
arranges a lens in space: their commands, rules, storage, file format and limits.

A lens groups the items directly inside one folder. Within a lens an item belongs to one group, or
to **Unsorted**. Subfolders have their own lenses; each Columns trail follows its own folder's
choice.

## Commands

**View → Group by** in a folder's menu offers **Ungroup files**, **Group by kind**, **Group by date
modified** and **Group by “**_lens_**”** for each lens of the folder. The other lens commands are in
**⌘K** and the folder's menus.

| Command                                                  | Does                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **New lens…**                                            | Makes an empty lens for this folder                                                                               |
| **Group selection…**                                     | Puts the selected items in a new group                                                                            |
| **Move to group…**, **Move to Unsorted**                 | Places the selection by hand                                                                                      |
| **Place automatically**                                  | Lets rules or Unsorted decide again                                                                               |
| **New group…**, **New group inside…**                    | Adds a group, at the top level or inside the chosen group                                                         |
| **Rename group…**, **Rules…**, **Delete group**          | Edit the chosen group; deleting moves its contents to its parent, or back to automatic placement at the top level |
| **Select items in group**                                | Selects the group's items                                                                                         |
| **Collapse all groups**, **Expand all groups**           | Change this person's view only                                                                                    |
| **Rename lens…**, **Duplicate lens**, **Show lens file** | Work on the whole lens                                                                                            |
| **Store lens in this folder**                            | Moves a lens kept on this Mac into the folder, once it can hold it                                                |
| **Clean up** _n_ **missing items**                       | Forgets groups and places of items no longer in the folder                                                        |
| **Move lens to Trash…**                                  | Moves the lens file to the Trash; the files it groups stay                                                        |

List, Grid and Columns show group headings. Groups nest, collapse and accept items dropped from the
same folder. Gallery labels groups and keeps its file browsing.

## Rules

Items not placed by hand join the most specific group whose rules they match: a subgroup is tried
before its parent. A group without rules holds only what is put in it. With several rules, **Items
must match** **every rule** (at first) or **any rule**.

| Rule             | JSONC                                          | Matches                                                                                                                           |
| ---------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Name matches** | `{ "kind": "name", "glob": "2025-*" }`         | A case-insensitive pattern of `*`, `?` and `[a-z]` or `[!abc]` classes, up to 200 characters                                      |
| **Extension is** | `{ "kind": "extension", "values": ["step"] }`  | Files with one of 1 to 50 lowercase extensions, without the dot                                                                   |
| **Type is**      | `{ "kind": "type", "value": "image" }`         | `folder`, `file` (**Any file**), `image`, `audio`, `video`, `pdf`, `drawing`, `model` (**3D model**), `archive`, `data` or `code` |
| **Created**      | `{ "kind": "created", "year": 2026 }`          | A local creation day in `year` (1970 to 9999), or from `from` to `to` (`YYYY-MM-DD`), or both                                     |
| **Modified**     | `{ "kind": "modified", "from": "2026-01-01" }` | The same, by modification day                                                                                                     |

A group holds up to 16 rules. A date rule needs a year or a range.

## Map view

Map shows one lens as a spatial arrangement of items and group regions.

| Action                       | Result                                          |
| ---------------------------- | ----------------------------------------------- |
| Drag an item                 | Places it, or adds it to the region it lands in |
| Drag a region by its heading | Moves the region with its items                 |
| Drag a region's corner       | Resizes it                                      |
| Double-click empty space     | Creates a group there                           |
| **⌘**-drag                   | Transfers the files themselves                  |
| Arrow keys                   | Move to the nearest item in that direction      |
| **⌥** arrow, **⌥⇧** arrow    | Nudge the selection by 8 or 64 map units        |
| Pinch, or **⌘**-scroll       | Zoom around the pointer                         |

Dragging changes the lens only; files never move. The first placement in a folder without a lens
creates a lens named **Map**, with **⌘Z** to undo it.

## Where it saves

| Folder                   | Lens file                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| Writable ordinary folder | `.viewer/lenses/<name>.lens.jsonc` beside the files; Viewer adds a `README.md` in `.viewer` |
| Protected or unwritable  | Viewer's private data, labeled **Lens kept on this Mac**                                    |

Opening a folder does not create `.viewer`. A lens file travels with sync, backups and version
control. Collapsed groups, scroll positions and rename identities stay private. An unknown or
symbolic-link `.viewer` folder is not adopted. A folder that cannot be changed shows its lenses
read-only.

The file name is the lens name in lowercase words joined by hyphens, at most 48 characters, with
`-2`, `-3` added when taken. Viewer writes the file in a fixed order, one group or item per line, so
changes merge cleanly. Deleting the file, or `.viewer`, never touches the folder's files.

| Field             | Values                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `version`, `kind` | `1`, `"viewer-lens"`                                                                                             |
| `id`              | A UUID                                                                                                           |
| `name`, `order`   | 1 to 100 characters; an integer that orders the folder's lenses                                                  |
| `unsorted`        | Optional `name` and `rect` for **Unsorted**                                                                      |
| `groups[]`        | `id` (`g` and 4 to 16 lowercase letters or digits), `name`, `parent`, `order`, `match`, `rules`, `rect`, `space` |
| `members[]`       | `name` of an item directly in the folder, `group` (absent: **Unsorted** by hand), `at`                           |
| `rect`, `at`      | `[x, y, width, height]` and `[x, y]`, integers, relative to the region that holds them                           |

| Limit              | Value    |
| ------------------ | -------- |
| Lens file          | 4 MB     |
| Lenses in a folder | 64       |
| Groups in a lens   | 1,000    |
| Group depth        | 8 levels |
| Members in a lens  | 50,000   |
| Rules in a group   | 16       |

## Renames and conflicts

Viewer updates a lens for its own renames and moves. An external rename is recognized when one
unclaimed name matches after Unicode normalization and case folding, or when one item carries the
member's remembered identity, as after a Finder rename. Ambiguous cases stay missing. A recognized
rename can change the lens file when the folder opens.

Missing items stay listed for recovery. **Clean up** _n_ **missing items** forgets them at once; an
item missing for more than 30 days is forgotten with the next edit.

Lens edits rebase onto the latest valid definition. An edit whose group was removed meanwhile is
skipped and reported. Problems found while reading, such as a duplicate entry or a group nested too
deeply, are repaired with the next edit and reported. Conflicted or malformed JSONC is not
overwritten. Lens Undo changes organization, separately from file-operation Undo.

**Related:** [Browse and organize](../guides/files.md) ·
[File operations and recovery](file-operations.md) · [Configuration](configuration.md) ·
[Keyboard shortcuts](shortcuts.md)
