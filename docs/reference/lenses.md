# Lenses and Map view

A lens groups a folder's direct children without moving their files. Choose it under **Group by**.
Subfolders have their own lenses; each Columns trail follows its own folder's choice.

## Organize visually

Groups can nest, collapse and accept items dropped from the same folder. They can combine explicit
membership and supported rules. List, Grid and Columns show group headings. Gallery labels groups
while keeping its file browsing behavior.

Map shows one lens as a spatial arrangement of items and group regions. Drag an item to place it or
add it to a region. Drag a region by its heading, resize its corner or double-click empty space to
create a group. Command-drag transfers the files themselves instead of just changing their map
places.

Arrow keys navigate nearby items. Option-arrows nudge; Option-Shift-arrows make a larger nudge.
Pinch or Command-scroll zooms around the pointer. The first manual placement in an ungrouped
automatic map creates a Map lens with Undo.

## Where it saves

Writable ordinary folders store lens definitions under `.viewer/lenses/` beside their files. Opening
a folder alone does not create that directory. Definitions can travel with sync, backups and version
control. Local collapsed/scroll state and rename-recognition identities stay private.

Protected or unwritable locations use private storage labeled **kept on this Mac**. **Store lens in
this folder** transfers an eligible lens later. An unknown or symbolic-link `.viewer` directory is
not adopted.

## Renames and conflicts

Viewer updates lens references for its own renames/moves. External renames can be recognized by
unique identity; ambiguous cases remain missing. Recognized updates can change the lens file when
the folder opens. Missing entries stay available for recovery before explicit/retention cleanup
forgets membership.

Lens edits rebase onto the latest valid definition. Conflicted or malformed JSONC is not
overwritten. Lens Undo changes organization, separately from file-operation Undo.
[File work](../guides/files.md) covers ordinary file transfers.
