# File operations and recovery

Copy, move, rename, create, duplicate and Trash actions use desktop operation services. The **File
operations** button in the title bar shows real progress, collision decisions, completed outputs,
errors and eligible Undo.

## Transfers and collisions

Drag onto a folder, use Copy/Paste or Cut/Paste, or choose an explicit action. Cross-volume behavior
and modifier keys can change a transfer into a copy or move; review the destination. Paired folder
views offer explicit transfers to their other panel.

Existing names require a collision decision. Keep both uses the actual published destination name.
Replace/merge behavior is limited by the operation and current filesystem identities. Changed
targets or unsafe links fail; a stale plan is never applied.

## Save and Undo

Text Save rechecks the source version. External edits offer conflict recovery; unsaved drafts remain
private until saved or discarded. Closing a view is separate from discarding its draft or removing a
saved document.

The first save of an existing file in an editor session moves its previous version to the OS Trash.
Saved or explicitly discarded private drafts also go to Trash. If that fails, Viewer keeps the draft
reference available for retry instead of silently forgetting it.

Eligible operation Undo checks its receipt and outputs before reversal. A changed output may prevent
Undo. Arrangement Undo affects views and geometry, independently of file changes. Git actions and
changes made by other applications are not Viewer file-operation Undo.

## Archives and comparisons

**Extract here** writes into a new folder named after the archive, beside it; from search results,
each archive extracts beside itself. An archive whose entries all sit in one top-level folder
extracts that folder's contents, so `Photos.zip` holding `Photos/` gives `Photos/`, not
`Photos/Photos/`. The `__MACOSX` folder of resource-fork copies that macOS adds is left out. An
existing name asks before replacing, as any transfer does.

Archive browsing is read-only inspection. ZIP creation and supported ZIP/TAR extraction are explicit
jobs with entry/size bounds. Unsafe paths, links, special files and conflicting entries are refused.
Previewing an archive does not execute its contents.

Folder comparison and duplicate inspection support deliberate decisions. Hashes and metadata have
their own costs; selecting a folder does not automatically scan all its contents. **Calculate Size**
is an explicit measurement.

## Trash and Restore

Move to Trash uses the OS Trash. In the sidebar's Trash browser, select an item for Quick Preview,
known original-location details, Restore or **Restore to…**. Restore refuses replacement, unsafe
parents, cross-disk fallback and changed identities. A missing original parent is not recreated
automatically.

macOS original locations come from identity-matched Viewer receipts; Finder's items may require a
destination. **Date added** is system directory metadata, not a fabricated deletion time. Full Disk
Access can be required to enumerate macOS Trash. Native folder authorization is a separate
permission.

Empty Trash has native human confirmation and no agent command/API. Agents need fresh exact-path
approval for every removal; aliases, imported settings and saved execution grants cannot bypass that
policy. See [AGENTS.md](../../AGENTS.md).

## Interrupted work

Restart does not blindly replay an operation. Inspect its receipt, completed outputs and any partial
output before retrying. After a power failure, the last items of a copy can show as interrupted even
though their copies are complete; the copies are kept. Reconnect unavailable locations and use
offered recovery controls. [Troubleshooting](../guides/troubleshooting.md) lists common next steps.
