# Keyboard shortcuts

This page lists every default key on macOS: command shortcuts, menu keys, keys inside a folder and
Quick Preview, and the prefix keys.

**Settings → Shortcuts** shows and changes the keys with an ID in the tables below; **Reset**
returns one to its default and **Reset all shortcuts** returns them all. Changes are saved in
`settings.shortcuts` by ID; an empty value turns a key off. Every command is also in **⌘K**, with
its key beside it. A key belongs to one command only.

## Folders and files

| Action                                            | Key                                   | ID                                          |
| ------------------------------------------------- | ------------------------------------- | ------------------------------------------- |
| **Open folder…**                                  | **⇧⌘O**                               | `choose-folder`                             |
| **New folder plane**                              | **⌘N**                                | `new-root-folder`                           |
| **Go to folder…**                                 | **⌘L**, also **⇧⌘G**                  | `go-to`                                     |
| **Open** the selection                            | **⌘O**, also **⌘↓** or **⌃↓**         | `open-selection`                            |
| **Parent folder**                                 | **⌘↑**                                | `parent`                                    |
| **Back** / **Forward**                            | **⌘[** / **⌘]**, also **⌥←** / **⌥→** | `back` / `forward`                          |
| **Get info…**                                     | **⌘I**                                | `info`                                      |
| **Copy** / **Cut** / **Paste here**               | **⌘C** / **⌘X** / **⌘V**              | `copy` / `cut` / `paste`                    |
| **Move copied items here**                        | **⌥⌘V**                               | `paste-move`                                |
| **Copy path**                                     | **⌥⌘C**                               | `copy-path`                                 |
| **Select all files**                              | **⌘A**                                | `select-all`                                |
| **Select by pattern…** / **Deselect by pattern…** | **⌃⌘=** / **⌃⌘-**                     | `select-by-pattern` / `deselect-by-pattern` |
| **Duplicate**                                     | **⌘D**                                | `duplicate`                                 |
| **Move to Trash…**                                | **⌘⌫**                                | `trash`                                     |
| **New folder…**                                   | **⇧⌘N**                               | `new-folder`                                |
| **New folder with selection…**                    | **⌃⌘N**                               | `new-folder-with-selection`                 |
| **Show hidden files** / **Hide hidden files**     | **⇧⌘.**                               | `toggle-hidden`                             |
| **Undo file operation** / **Redo file operation** | **⌘Z** / **⇧⌘Z**                      | `undo-file` / `redo-file`                   |
| **Copy to** / **Move to** the paired folder       | **⌃⌘C** / **⌃⌘X**                     | `copy-to-pair` / `move-to-pair`             |
| **Find file…**                                    | **⌘F**                                | `find-file`                                 |

**Move to Trash…** asks first; with **Confirm before moving to Trash** off, it is **Move to Trash**
and does not ask. Either way the items go to the Trash. **⌥←** and **⌥→** go back and forward in a
folder; on a Map with a selection they move the selected items instead.

## Views

| Action                                             | Key                                        | ID                                                                       |
| -------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------ |
| List / Grid / Columns / Gallery / Map              | **⌘1** / **⌘2** / **⌘3** / **⌘4** / **⌘5** | `view-list` / `view-grid` / `view-columns` / `view-gallery` / `view-map` |
| **Show / Hide Window Navigation**                  | **⌥⌘S**                                    | `toggle-sidebar`                                                         |
| **Show / Hide Title Bar**                          | **⌥⌘T**                                    | `toggle-titlebar`                                                        |
| **Focus mode**: hide the window's chrome, and back | **⇧⌘F**                                    | `focus-mode`                                                             |

## Planes and the space

| Action                                      | Key                  | ID                                      |
| ------------------------------------------- | -------------------- | --------------------------------------- |
| **Frame all planes**                        | **⌘0**               | `frame-all`                             |
| **Dock plane** / **Reveal space**           | **⌘Return**          | `dock`                                  |
| **Back to parent plane**                    | **⌥⌘↑**              | `parent-plane`                          |
| **Close plane**                             | **⌥⌘W**              | `close-plane`                           |
| **Undo arrangement** / **Redo arrangement** | **⌥⌘Z** / **⌥⇧⌘Z**   | `undo-arrangement` / `redo-arrangement` |
| **Go to view 1** to **9**                   | **⌥⌘1** to **⌥⌘9**   | `bookmark.1` to `bookmark.9`            |
| **Save view as 1** to **9**                 | **⌃⌥⌘1** to **⌃⌥⌘9** | `bookmark.save.1` to `bookmark.save.9`  |

## Text

| Action                  | Key              | ID                           |
| ----------------------- | ---------------- | ---------------------------- |
| **New scratch plane**   | **⌘T**           | `new-scratch-plane`          |
| **Edit text**           | **⌘E**           | `edit-file`                  |
| **Save** / **Save as…** | **⌘S** / **⇧⌘S** | `save-file` / `save-file-as` |

In a text field or editor, **⌘Z**, **⇧⌘Z**, **⌘X**, **⌘C**, **⌘V** and **⌘A** edit the text, and
file commands such as **Duplicate** and **Move to Trash** do not run. A text editor also keeps
**⌘S**, **⇧⌘S** and **⌘T**.

## Commands, speech and quitting

| Action                             | Key                        | ID or setting                |
| ---------------------------------- | -------------------------- | ---------------------------- |
| **Commands…**                      | **⌘K**                     | `palette`                    |
| **Settings…**                      | **⌘,**                     | `settings`                   |
| **Dictate an Ask Viewer request…** | Hold **⌃⇧Space**           | `dictate`                    |
| Key prefix                         | **⌃B**                     | `settings.keymap.prefix`     |
| **Quit Viewer**                    | **⌘Q** twice               | `settings.quit.warnShortcut` |
| Show or hide Viewer from any app   | **⌥Space**, off by default | `settings.hotkey`            |

The first **⌘Q** shows "Press ⌘Q again to quit"; press it again within 2.5 seconds, or hold it.
**Quit Viewer** in the menu, the Dock and logging out quit at once. To quit on the first press, turn
off **Settings → Browsing → Warn before quitting with ⌘Q**. Turn the global key on in **Settings →
Navigation → Quick access → Global shortcut**; **Show or hide Viewer** sets its key.

In a terminal plane, **⌘C** and **⌘X** copy the terminal's selection, **⌘V** pastes into it, **⌘A**
selects its text and **⌘F** searches its output. The shell receives the prefix **⌃B** unless
`settings.keymap.inTerminals` is `true`.

## Keys in a folder

These keys are fixed. They work when the folder has the focus, not in a text field.

| Key                                                        | Action                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| **Space**                                                  | **Quick preview** of the selected files                          |
| **Return**                                                 | **Rename…**                                                      |
| **↑ ↓ ← →**, **Home**, **End**, **Page Up**, **Page Down** | Move the selection; with **⇧**, extend it                        |
| **→** / **←** in Columns                                   | Into the selected folder / back a column, then the parent folder |
| **→** / **←** in List                                      | Expand / collapse the selected folder                            |
| **⌥** and an arrow on a Map                                | Move the selected items 8 px; with **⇧**, 64 px                  |
| A character                                                | Select the next item whose name starts with what you typed       |
| **Escape**                                                 | Clear the selection                                              |

## Quick Preview

| Key                     | Action                        |
| ----------------------- | ----------------------------- |
| **Space** or **Escape** | Close Quick Preview           |
| **←** / **→**           | Previous / next selected file |

A control that has the focus, such as a drawing or a video, answers its own keys first.

## Menu keys from macOS

| Key     | Menu item                     |
| ------- | ----------------------------- |
| **⌘H**  | **Viewer → Hide Viewer**      |
| **⌥⌘H** | **Viewer → Hide Others**      |
| **⌘W**  | **File → Close Window**       |
| **⌘M**  | **Window → Minimize**         |
| **⌃⌘F** | **View → Toggle Full Screen** |

Menu items not in these tables have no key by default. In `settings.shortcuts`, any command ID can
take a key; the menu shows the keys given to `new-terminal-plane`, `setting.ui.space.toolbar`,
`setting.ui.space.minimap`, `setting.ui.space.viewcube` and `setting.ui.space.grid`.

## Prefix keys

Press **⌃B**, then one key. **Settings → Shortcuts** edits these bindings, stored in
`settings.keymap`. A sequence waits 1.5 seconds for its next key, and the keys it can take show
while it waits. **Escape** cancels it. **⌃B** twice sends **⌃B** to the terminal or text field. The
prefix does not work inside terminals or text fields by default.

| Key after **⌃B**                        | Command                                                                         | ID                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **c**                                   | **New terminal plane**                                                          | `new-terminal-plane`                                  |
| **x**                                   | **Close plane**                                                                 | `close-plane`                                         |
| **z**                                   | **Dock plane** / **Reveal space**                                               | `dock`                                                |
| **o**                                   | **Next plane**                                                                  | `focus-next-plane`                                    |
| **h** **j** **k** **l**, or **← ↓ ↑ →** | **Plane to the left**, **Plane below**, **Plane above**, **Plane to the right** | `focus-left`, `focus-down`, `focus-up`, `focus-right` |
| **f**                                   | **Jump to plane…**                                                              | `plane-hints`                                         |
| **n** / **p**                           | **Next workspace** / **Previous workspace**                                     | `next-workspace` / `previous-workspace`               |
| **w**                                   | **Change workspace…**                                                           | `change-workspace`                                    |
| **,**                                   | **Rename workspace…**                                                           | `rename-workspace`                                    |
| **:**                                   | **Command line…**                                                               | `command-line`                                        |
| **?**                                   | **Show key sequences**                                                          | `keymap-help`                                         |
| **q**                                   | **Record macro** / **Stop recording macro**                                     | `record-macro`                                        |
| **t**                                   | **New scratch plane**                                                           | `new-scratch-plane`                                   |
| **s**                                   | **Show window navigation** / **Hide window navigation**                         | `toggle-sidebar`                                      |
| **1** to **9**                          | **Go to view 1** to **9**                                                       | `bookmark.1` to `bookmark.9`                          |
| **b** then **s**                        | **Save view…**                                                                  | `bookmark-save`                                       |
| **b** then **m**                        | **Views…**                                                                      | `bookmark-manage`                                     |
| **b** then **t**                        | **Tour the views** / **Stop tour**                                              | `tour`                                                |
| **%**                                   | **Split right**                                                                 | `tile-split-right`                                    |
| **"**                                   | **Split down**                                                                  | `tile-split-down`                                     |
| **Space**                               | **Next tiling layout**                                                          | `tile-next-layout`                                    |
| **=**                                   | **Tile the planes in view**                                                     | `tile-visible`                                        |
| **{** / **}**                           | **Swap with the previous tile** / **Swap with the next tile**                   | `tile-swap-previous` / `tile-swap-next`               |
| **M**                                   | **Make this the main tile**                                                     | `tile-promote`                                        |
| **+** / **-**                           | **Grow the main tile** / **Shrink the main tile**                               | `tile-main-grow` / `tile-main-shrink`                 |
| **!**                                   | **Stop tiling**                                                                 | `untile`                                              |
| **e**                                   | **Explode folder**                                                              | `explode-folder`                                      |
| **E**                                   | **Collapse exploded folders**                                                   | `collapse-folder`                                     |
| **>**                                   | **Copy to** the other folder of the pair                                        | `copy-to-pair`                                        |
| **<**                                   | **Swap the pair’s folders**                                                     | `swap-pair-folders`                                   |
| **Tab**                                 | **The other folder of the pair**                                                | `focus-pair`                                          |
| **R**                                   | Enter the `resize` mode                                                         | `mode resize`                                         |

**+** and **-** repeat: within half a second, press them again without the prefix.

## Resize mode

**⌃B** then **R** enters the `resize` mode. It stays until **Escape**. Digits before a key repeat it
that many times, up to 99.

| Key in `resize` | Command                     | ID                  |
| --------------- | --------------------------- | ------------------- |
| **h** or **←**  | **Grow tile left**          | `tile-resize-left`  |
| **l** or **→**  | **Grow tile right**         | `tile-resize-right` |
| **k** or **↑**  | **Grow tile up**            | `tile-resize-up`    |
| **j** or **↓**  | **Grow tile down**          | `tile-resize-down`  |
| **Space**       | **Next tiling layout**      | `tile-next-layout`  |
| **=**           | **Tile the planes in view** | `tile-visible`      |

**Related:** [Your first five minutes](../guides/getting-started.md) ·
[Keep your work together](../guides/workspaces.md) · [Command language](command-line.md) ·
[Configuration](configuration.md#keys) · [Terms](terms.md)
