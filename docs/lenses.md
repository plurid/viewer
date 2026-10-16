# Lenses

A lens organizes the items directly inside one folder without moving them. A folder of clients can be grouped “By year” (2025, 2026) and “By status” at the same time; a CAD part folder can be grouped by subassembly. The folder stays flat on disk; the groups exist only in the lens.

## Model

- **Lens:** one way of grouping a folder. A folder can have up to 64.
- **Group:** a node in the lens's small tree. Groups can nest; two or three levels are usually enough.
- **Member:** an item placed in a group by hand. Within one lens an item belongs to exactly one group. Items not placed by hand go to the most specific group whose rules match them, otherwise to **Unsorted**, which is always last.
- **Rules:** a group can fill itself by name pattern (`2025-*`, case-insensitive, with `*`, `?` and `[a-z]`), extension, type, or created/modified year or date range, matching every rule or any of them. Rules are evaluated live and never written for individual items, so new items join the right group by themselves. Placing an item by hand, including into Unsorted, always wins.
- **Place:** a remembered position on the Map, relative to the group region that holds it, so moving a region carries its items. Places are what make the Map a memory: an item put top-right is top-right the next time.

A lens covers the folder's direct children only. Subfolders have their own lenses; in Columns view each column follows its own folder's lens.

## Where lenses are stored

Lenses live in a hidden `.viewer` folder inside the organized folder:

```
Clients/.viewer/
  README.md                  explains the folder; deleting it never touches your files
  lenses/by-year.lens.jsonc  one file per lens
```

`.viewer` is created only when a lens is made, never when a folder is opened. Because it travels with the folder, sync, backups, external drives, version control and colleagues all see the same groups and places. Collapsed groups, Map zoom and scroll, and the identities used to recognize renames stay on this Mac.

Viewer writes each lens file in a fixed order with one item per line, so two people's changes merge cleanly in sync tools and git. Edits are applied to the latest file: if someone else saved in the meantime, Viewer replays the edit on their version instead of overwriting it, and reports edits whose group was removed. A file that does not parse (for example, with git conflict markers) is never overwritten; its lens is listed as unreadable until it is fixed.

Folders Viewer cannot write keep their lenses in Viewer's data on this Mac instead, shown as “kept on this Mac”. The same applies to Home, application packages, and a `.viewer` folder that Viewer did not create (such as the 2021 app's `~/.viewer` data). **Store lens in this folder** moves such a lens into the folder once it can hold it. A symbolic link named `.viewer` is never followed.

## Renames and missing items

- Renames and moves made in Viewer update lenses directly. An item moved to another folder stays listed in its lens as missing, so Undo or Put Back returns it to its group and place.
- Renames made in Finder are recognized by the item's identity when exactly one new item matches; differences only in case or Unicode form are matched by name. Anything ambiguous stays missing rather than guessing.
- Missing items are hidden. **Clean up missing items** forgets them; items missing for 30 days are forgotten with the next edit.

## Views

**Group by** in a folder's view menu lists its lenses. Grouped list, grid, columns and gallery views show a heading per group: headings collapse, take items dropped on them (only items from this folder; nothing moves on disk), and have their own menu (select, rename, rules, new group inside, delete). Empty groups still show a heading so items can be dropped in. While filtering, empty groups are hidden; searching subfolders shows results ungrouped.

The **Map** view (⌘5) draws one lens freely: groups are regions, Unsorted is a dashed region, and every item stays where it was put.

- Drag items to place them; dropping into a region puts them in that group. Command-drag carries the files themselves to Finder or another plane.
- Drag a region by its heading to move it, or into another region to nest it; drag its corner to resize it.
- Double-click empty space to create a group there.
- Arrow keys move to the nearest item in that direction; Option-arrows nudge the selection by 8, Option-Shift-arrows by 64. Command-[ and Command-] still go back and forward.
- Pinch or Command-scroll zooms around the pointer; below 50% items show icons only, and below 30% each group shows its count.
- In a folder without a lens, the Map arranges items automatically. The first drag creates a lens named “Map” and says so; ⌘Z removes it again.

## Undo

Lens edits share one Undo history with file operations in a window: ⌘Z undoes whichever happened last, and Commands names it (“Undo Move to “2026””). Undoing an edit restores only what it changed, keeping edits others made meanwhile. Undoing a new lens moves its file to the Trash.

## Safety

Lenses never move, rename or remove the items they group. Moving a lens to the Trash is an ordinary file operation with Undo; nothing is deleted permanently. Lens files from other people are untrusted input: names must be items directly inside the folder, sizes are bounded (4 MiB, 50,000 members, 1,000 groups, 8 levels), rules are bounded patterns that never execute, and broken structure (duplicate IDs, loops, missing parents) is repaired rather than trusted.

## Code

- `src/domain/lenses.ts`: schema, edits, matching, rules, resolution and the file format.
- `src/domain/lens-layout.ts`: deterministic Map layout, hit-testing and spatial navigation.
- `src/desktop/lenses.ts`: storage, fallback, healing, private state and rename remapping.
- `src/renderer/state/lenses.ts`: per-folder loading, optimistic edits and the shared Undo history.
- `src/renderer/explorer/sections.ts`, `folder-sections.ts`, `map/MapView.tsx`, `LensDialogs.tsx` and `src/renderer/commands/lenses.ts`: views, dialogs and commands.

## Not yet

- Lifting groups into plurid planes around the folder plane (the 3D view), once plurid publishes placement APIs.
- Regular-expression rules, merging sync-tool conflict copies, agent proposals for lenses, lens grouping inside expanded list folders, and applying a lens to another folder as a template.
- The native Edit menu still reads “Undo”; Commands shows the named action.
- Map zoom and scroll are remembered for the session only, not across restarts.
- With hidden files shown, `.viewer` itself appears among Unsorted items; it is never a member and never on the Map.
- A lens in a folder that cannot be changed is read-only; there is no private copy to edit yet.
