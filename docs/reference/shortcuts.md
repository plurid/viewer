# Keyboard shortcuts

This page lists every default key on macOS: command shortcuts, menu keys, keys inside a folder and
Quick Preview, and the prefix keys.

**Settings → Shortcuts** shows and changes the keys with an ID in the tables below; **Reset**
returns one to its default and **Reset All Shortcuts** returns them all. Only your own changes are
saved, in `settings.shortcuts` by ID; an empty value turns a key off. A default comes from Viewer
itself, so a key Viewer later ships differently reaches you unless you changed it. Every command is
also in **⌘K**, with its key beside it.

A key belongs to one command only. Give a default key to something else, as a recipe or a custom
action, and the command it came with leaves it to yours: its row in **Settings → Shortcuts** says
so, and you can choose another key for it. The one key shared on purpose is **⌘L**: see
[Pictures](#pictures).

## Folders and files

| Action                                            | Key                                   | ID                                          |
| ------------------------------------------------- | ------------------------------------- | ------------------------------------------- |
| **Open Folder…**                                  | **⇧⌘O**                               | `choose-folder`                             |
| **New Files Plane**                               | **⌘N**                                | `new-root-folder`                           |
| **New Window**                                    | **⌥⌘N**                               | `new-native-window`                         |
| **Go to Folder…**                                 | **⌘L**, also **⇧⌘G**                  | `go-to`                                     |
| Choose a suggested folder in **Go to Folder…**    | **↑** / **↓**, then **Return**        |                                             |
| **Open** the selection                            | **⌘O**, also **⌘↓** or **⌃↓**         | `open-selection`                            |
| **Parent Folder**                                 | **⌘↑**                                | `parent`                                    |
| **Back** / **Forward**                            | **⌘[** / **⌘]**, also **⌥←** / **⌥→** | `back` / `forward`                          |
| **Get Info…**                                     | **⌘I**                                | `info`                                      |
| **Copy** / **Cut** / **Paste Here**               | **⌘C** / **⌘X** / **⌘V**              | `copy` / `cut` / `paste`                    |
| **Move Copied Items Here**                        | **⌥⌘V**                               | `paste-move`                                |
| **Copy Path**                                     | **⌥⌘C**                               | `copy-path`                                 |
| **Select All Files**                              | **⌘A**                                | `select-all`                                |
| **Select by Pattern…** / **Deselect by Pattern…** | **⌃⌘=** / **⌃⌘-**                     | `select-by-pattern` / `deselect-by-pattern` |
| **Duplicate**                                     | **⌘D**                                | `duplicate`                                 |
| **Move to Trash…**                                | **⌘⌫**                                | `trash`                                     |
| **New Folder…**                                   | **⇧⌘N**                               | `new-folder`                                |
| **New Folder with Selection…**                    | **⌃⌘N**                               | `new-folder-with-selection`                 |
| **Show Hidden Files** / **Hide Hidden Files**     | **⇧⌘.**                               | `toggle-hidden`                             |
| **Undo File Operation** / **Redo File Operation** | **⌘Z** / **⇧⌘Z**                      | `undo-file` / `redo-file`                   |
| **Copy to** / **Move to** the paired folder       | **⌃⌘C** / **⌃⌘X**                     | `copy-to-pair` / `move-to-pair`             |
| **Find File…**                                    | **⌘F**                                | `find-file`                                 |

**Move to Trash…** asks first; with **Confirm before moving to Trash** off, it is **Move to Trash**
and does not ask. Either way the items go to the Trash. **⌥←** and **⌥→** go back and forward in a
folder; on a Map with a selection they move the selected items instead.

## Views

| Action                                                  | Key                                        | ID                                                                       |
| ------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------ |
| List / Grid / Columns / Gallery / Map                   | **⌘1** / **⌘2** / **⌘3** / **⌘4** / **⌘5** | `view-list` / `view-grid` / `view-columns` / `view-gallery` / `view-map` |
| **Show Window Navigation** / **Hide Window Navigation** | **⌥⌘S**                                    | `toggle-sidebar`                                                         |
| **Show Title Bar** / **Hide Title Bar**                 | **⌥⌘T**                                    | `toggle-titlebar`                                                        |
| **Focus Mode**: hide the window's chrome, and back      | **⇧⌘F**                                    | `focus-mode`                                                             |

## Planes and the space

| Action                                      | Key                  | ID                                      |
| ------------------------------------------- | -------------------- | --------------------------------------- |
| **Frame All Planes**                        | **⌘0**               | `frame-all`                             |
| **Dock Plane** / **Reveal Space**           | **⌘Return**          | `dock`                                  |
| **Back to parent plane**                    | **⌥⌘↑**              | `parent-plane`                          |
| **Close Plane**                             | **⌥⌘W**              | `close-plane`                           |
| **Undo Arrangement** / **Redo Arrangement** | **⌥⌘Z** / **⌥⇧⌘Z**   | `undo-arrangement` / `redo-arrangement` |
| **Go to View 1** to **9**                   | **⌥⌘1** to **⌥⌘9**   | `bookmark.1` to `bookmark.9`            |
| **Save View as 1** to **9**                 | **⌃⌥⌘1** to **⌃⌥⌘9** | `bookmark.save.1` to `bookmark.save.9`  |

## Text

| Action                  | Key              | ID                           |
| ----------------------- | ---------------- | ---------------------------- |
| **New Scratch Plane**   | **⌘T**           | `new-scratch-plane`          |
| **Edit Text**           | **⌘E**           | `edit-file`                  |
| **Save** / **Save As…** | **⌘S** / **⇧⌘S** | `save-file` / `save-file-as` |

In a text field or editor, **⌘Z**, **⇧⌘Z**, **⌘X**, **⌘C**, **⌘V** and **⌘A** edit the text, and
file commands such as **Duplicate** and **Move to Trash** do not run. A text editor also keeps
**⌘S**, **⇧⌘S** and **⌘T**.

## Commands, speech and quitting

| Action                           | Key                        | ID or setting                |
| -------------------------------- | -------------------------- | ---------------------------- |
| **Commands…**                    | **⌘K**                     | `palette`                    |
| **Settings…**                    | **⌘,**                     | `settings`                   |
| **Ask Viewer by Voice…**         | Hold **⌃⇧Space**           | `dictate`                    |
| Key prefix                       | **⌃B**                     | `settings.keymap.prefix`     |
| **Quit Viewer**                  | **⌘Q** twice               | `settings.quit.warnShortcut` |
| Show or hide Viewer from any app | **⌥Space**, off by default | `settings.hotkey`            |

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
| **Space**                                                  | **Quick Preview** of the selected files                          |
| **Return**                                                 | **Rename…**                                                      |
| **↑ ↓ ← →**, **Home**, **End**, **Page Up**, **Page Down** | Move the selection; with **⇧**, extend it                        |
| **→** / **←** in Columns                                   | Into the selected folder / back a column, then the parent folder |
| **→** / **←** in List                                      | Expand / collapse the selected folder                            |
| **⌥** and an arrow on a Map                                | Move the selected items 8 px; with **⇧**, 64 px                  |
| A character                                                | Select the next item whose name starts with what you typed       |
| **Escape**                                                 | Clear the selection                                              |

## Quick Preview

| Key                     | Action                                                                       |
| ----------------------- | ---------------------------------------------------------------------------- |
| **Space** or **Escape** | Close Quick Preview                                                          |
| **←** / **→**           | With several files selected, the previous / next of them                     |
| **↑ ↓ ← →**             | Otherwise, move the folder's selection as its view does; the preview follows |

The arrows move on from the file Quick Preview shows. A control that has the focus, such as a
drawing, a 3D model or a long text, answers its own keys first. If the folder's plane closed, the
arrows step through the files Quick Preview shows.

## Pictures

These keys turn the picture that has the keyboard: click the picture or its header's tools, or use
Quick Preview. Anywhere else, **⌘L** is **Go to Folder…**: the two share it on purpose, and both
rows in **Settings → Shortcuts** say so. A trackpad turn goes to the picture under the pointer, else
to the one these keys would turn.

| Action                   | Key    | ID                   |
| ------------------------ | ------ | -------------------- |
| **Rotate Picture Left**  | **⌘L** | `image-rotate-left`  |
| **Rotate Picture Right** | **⌘R** | `image-rotate-right` |

## While a tour plays

| Key           | Action                   |
| ------------- | ------------------------ |
| **→** / **←** | Next / previous stop     |
| **Space**     | Pause or resume the tour |
| **Escape**    | Stop the tour            |

A text field, an open dialog or menu keeps its keys. While a tour is paused, a plane you clicked
keeps its own keys; **Escape** still stops the tour. See
[Show someone around: tours](../guides/workspaces.md#show-someone-around-tours).

## Menu keys from macOS

| Key     | Menu item                     |
| ------- | ----------------------------- |
| **⌘H**  | **Viewer → Hide Viewer**      |
| **⌥⌘H** | **Viewer → Hide Others**      |
| **⌘W**  | **File → Close Window**       |
| **⌘M**  | **Window → Minimize**         |
| **⌃⌘F** | **View → Toggle Full Screen** |

Menu items not in these tables have no key by default. In `settings.shortcuts`, any command ID can
take a key, such as `plane-toolbar.full` and `plane-toolbar.essential` for the plane headers'
buttons. The menu shows the keys given to `new-terminal-plane`, `setting.ui.space.toolbar`,
`setting.ui.space.minimap`, `setting.ui.space.viewcube` and `setting.ui.space.grid`.

Menu commands act only in the focused workspace window, never in unfocused windows. When a
non-workspace window (such as Settings, the diagnostic report window or a separate page window) is
focused, **Edit** commands (**Undo**, **Redo**, **Cut**, **Copy**, **Paste**, **Select All**) act in
that window and workspace commands do nothing. When no workspace window is focused, **View** menu
Show/Hide labels reflect your default visibility preferences.

## Prefix keys

Press **⌃B**, then one key. **Settings → Shortcuts** edits these bindings, stored in
`settings.keymap`. A sequence waits 1.5 seconds for its next key, and the keys it can take show
while it waits. **Escape** cancels it. **⌃B** twice sends **⌃B** to the terminal or text field. The
prefix does not work inside terminals or text fields by default.

| Key after **⌃B**                        | Command                                                                         | ID                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **c**                                   | **New Terminal Plane**                                                          | `new-terminal-plane`                                  |
| **x**                                   | **Close Plane**                                                                 | `close-plane`                                         |
| **z**                                   | **Dock Plane** / **Reveal Space**                                               | `dock`                                                |
| **o**                                   | **Next Plane**                                                                  | `focus-next-plane`                                    |
| **h** **j** **k** **l**, or **← ↓ ↑ →** | **Plane to the Left**, **Plane Below**, **Plane Above**, **Plane to the Right** | `focus-left`, `focus-down`, `focus-up`, `focus-right` |
| **f**                                   | **Jump to Plane…**                                                              | `plane-hints`                                         |
| **n** / **p**                           | **Next Workspace** / **Previous Workspace**                                     | `next-workspace` / `previous-workspace`               |
| **w**                                   | **Change Workspace…**                                                           | `change-workspace`                                    |
| **,**                                   | **Rename Workspace…**                                                           | `rename-workspace`                                    |
| **:**                                   | **Command Line…**                                                               | `command-line`                                        |
| **?**                                   | **Show Key Sequences**                                                          | `keymap-help`                                         |
| **q**                                   | **Record Macro** / **Stop Recording Macro**                                     | `record-macro`                                        |
| **t**                                   | **New Scratch Plane**                                                           | `new-scratch-plane`                                   |
| **s**                                   | **Show Window Navigation** / **Hide Window Navigation**                         | `toggle-sidebar`                                      |
| **1** to **9**                          | **Go to View 1** to **9**                                                       | `bookmark.1` to `bookmark.9`                          |
| **b** then **s**                        | **Save View…**                                                                  | `bookmark-save`                                       |
| **b** then **m**                        | **Views…**                                                                      | `bookmark-manage`                                     |
| **b** then **t**                        | **Tour the Views** / **Stop Tour**                                              | `tour`                                                |
| **%**                                   | **Split Right**                                                                 | `tile-split-right`                                    |
| **"**                                   | **Split Down**                                                                  | `tile-split-down`                                     |
| **Space**                               | **Next Tiling Layout**                                                          | `tile-next-layout`                                    |
| **=**                                   | **Tile the Planes in View**                                                     | `tile-visible`                                        |
| **{** / **}**                           | **Swap with the Previous Tile** / **Swap with the Next Tile**                   | `tile-swap-previous` / `tile-swap-next`               |
| **M**                                   | **Make This the Main Tile**                                                     | `tile-promote`                                        |
| **+** / **-**                           | **Grow the Main Tile** / **Shrink the Main Tile**                               | `tile-main-grow` / `tile-main-shrink`                 |
| **!**                                   | **Stop Tiling**                                                                 | `untile`                                              |
| **e**                                   | **Explode Folder**                                                              | `explode-folder`                                      |
| **E**                                   | **Collapse Exploded Folders**                                                   | `collapse-folder`                                     |
| **>**                                   | **Copy to** the other folder of the pair                                        | `copy-to-pair`                                        |
| **<**                                   | **Swap the Pair’s Folders**                                                     | `swap-pair-folders`                                   |
| **Tab**                                 | **The Other Folder of the Pair**                                                | `focus-pair`                                          |
| **R**                                   | Enter the `resize` mode                                                         | `mode resize`                                         |

**+** and **-** repeat: within half a second, press them again without the prefix.

## Resize mode

**⌃B** then **R** enters the `resize` mode. It stays until **Escape**. Digits before a key repeat it
that many times, up to 99.

| Key in `resize` | Command                     | ID                  |
| --------------- | --------------------------- | ------------------- |
| **h** or **←**  | **Grow Tile Left**          | `tile-resize-left`  |
| **l** or **→**  | **Grow Tile Right**         | `tile-resize-right` |
| **k** or **↑**  | **Grow Tile Up**            | `tile-resize-up`    |
| **j** or **↓**  | **Grow Tile Down**          | `tile-resize-down`  |
| **Space**       | **Next Tiling Layout**      | `tile-next-layout`  |
| **=**           | **Tile the Planes in View** | `tile-visible`      |

**Related:** [Your first five minutes](../guides/getting-started.md) ·
[Keep your work together](../guides/workspaces.md) · [Command language](command-line.md) ·
[Configuration](configuration.md#keys) · [Terms](terms.md)
