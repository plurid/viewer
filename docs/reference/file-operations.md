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
targets or unsafe links fail; a stale plan is never applied. Skip leaves the existing item and no
recovery paths.

An operation in which any item fails ends as failed, even when other items completed. Their outputs
and Undo are kept, and its recovery paths name the last item that failed.

A copy on one APFS volume is a clone: each file shares the original's disk blocks until either
changes, so it finishes at once and takes no extra space at first. A folder is cloned file by file.
On another volume, or one that cannot clone, Viewer copies the bytes. Either way the copy keeps the
original's dates, permissions and extended attributes, and a file that changes while it is copied
fails its item, leaving the original untouched.

Sizes use decimal units, as Finder shows them: 1 KB is 1,000 bytes.

## Save and Undo

Text Save rechecks the source version. External edits offer conflict recovery; unsaved drafts remain
private until saved or discarded. Closing a view is separate from discarding its draft or removing a
saved document.

The first save of an existing file in an editor session moves its previous version to the OS Trash.
Saved or explicitly discarded private drafts also go to Trash. If that fails, Viewer keeps the draft
reference available for retry instead of silently forgetting it.

Many network shares have no Trash. There, your save or your **Replace** keeps the previous version
beside the file under a free name, such as `Notes (previous).md`, and the operation's result names
it. An agent's replacement on such a share fails and changes nothing: agents only move items to the
Trash.

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

Move to Trash uses the OS Trash. On a volume without a Trash it fails with a message, and the item
stays where it is: Viewer never deletes it instead. Viewer knows such a volume by the error macOS
gives for it, so another Trash failure is reported as itself. In the sidebar's Trash browser, select
an item for Quick Preview, known original-location details, Restore or **Restore to…**. Restore
refuses replacement, unsafe parents, cross-disk fallback and changed identities. A missing original
parent is not recreated automatically.

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

A copy leaves its bytes to macOS to write, as Finder does, because its originals stay where they
are. After a power failure, a copy made in the seconds before it can be incomplete even when it
shows as finished; copy it again. A move to another volume writes each file to permanent storage
(`F_FULLFSYNC`), and then its folders, before it removes the originals. Text saves and operation
receipts are written to permanent storage as well.
