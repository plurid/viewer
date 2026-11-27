# File operations and recovery

This page states how Viewer copies, moves, creates, saves and removes files, and how collisions,
Undo, the Trash and recovery work.

Choose **File Operations** in **⌘K**, or **File → File Operations**, to toggle the operations panel,
even when its list is empty. It lists each job with its progress, collision prompt, completed
outputs, errors, recovery paths and **Undo**. Jobs run one at a time, in order. The list keeps the
100 most recent finished jobs; a pending job is never dropped.

The title-bar button appears when work lasts at least one second, when a conflict or unread failure
needs attention, or while the panel is open. Fast successful operations keep the title bar quiet.
**Settings → Space → Title bar icons → File operations** controls this button; the command remains
available when the button is hidden.

## Commands

| Command                                          | Key      | What it does                                                                |
| ------------------------------------------------ | -------- | --------------------------------------------------------------------------- |
| **Copy**, **Cut**                                | ⌘C, ⌘X   | Puts the selection on the clipboard                                         |
| **Paste Here**                                   | ⌘V       | Copies or moves clipboard files; with a picture and no files, creates a PNG |
| **Move Copied Items Here**                       | ⌥⌘V      | Moves the clipboard's items here                                            |
| **Copy To…**, **Move To…**                       |          | Asks for a folder, then copies or moves                                     |
| **Copy to** _folder_, **Move to** _folder_       | ⌃⌘C, ⌃⌘X | Copies or moves to the other folder of a pair                               |
| **Duplicate**                                    | ⌘D       | Makes `Name copy.ext` beside each item                                      |
| **Make Alias**                                   |          | Makes a Finder alias, such as `Report.pdf alias`, beside each item          |
| **New Folder…**                                  | ⇧⌘N      | Creates an empty folder; it never replaces an existing item                 |
| **New File…**                                    |          | Creates an empty file; it never replaces an existing item                   |
| **New Folder with Selection…**                   | ⌃⌘N      | Asks for a name, then moves the selection into a new folder                 |
| **Rename…**                                      | Return   | Renames one item; a case-only rename works on a case-blind volume           |
| **Compress to ZIP**                              |          | Makes `Photos.zip` for one item named `Photos`; `Archive.zip` for several   |
| **Extract Here**                                 |          | Extracts a ZIP or TAR archive into a new folder beside it                   |
| **Move to Trash** (**Move to Trash…**)           | ⌘⌫       | Moves the selection to the system Trash                                     |
| **Undo File Operation**, **Redo File Operation** | ⌘Z, ⇧⌘Z  | Reverses the latest job, or starts it again                                 |

**Move to Trash…** asks first while **Confirm before moving to Trash** is on
(`settings.browsing.confirmTrash`, on by default).

Clipboard files take priority over pictures, including file icons and previews. With a picture and
no files, **Paste Here** creates `Pasted image.png`, then `Pasted image 2.png`, `Pasted image 3.png`
as needed. Its encoded PNG must be at most 64 MiB. Text-only and empty clipboards create nothing.
Text alongside a picture does not prevent the PNG creation. Pictures waiting to be written share a
128 MiB memory budget; wait for a paste to finish or cancel one when it is full. Picture pastes are
ordinary creation jobs with Undo; their image bytes are not kept in the journal, so they have no
Redo. Agents cannot paste from the clipboard.

## Drag and drop

| Drag             | Result                                             |
| ---------------- | -------------------------------------------------- |
| Plain drag       | Moves on the same volume; copies to another volume |
| **Option** held  | Copies                                             |
| **Command** held | Moves, also to another volume                      |

A drag carries at most 10,000 items. A folder cannot be dropped into itself. A plain or move drag
dropped back onto its own parent folder does nothing; hold **Option** to copy it there and keep
both.

## Collisions

When the destination name is taken, the job waits in **File Operations** with "_Name_ already
exists." and these choices:

| Choice                          | Result                                                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Skip**                        | Leaves the existing item; the item is done and leaves nothing to recover                                                               |
| **Keep Both**                   | Uses a free name: `Name copy.ext`, then `Name copy 2.ext`; dotted folder names and non-extension dots stay whole (`Project v1.2 copy`) |
| **Replace**                     | After **Replace existing item?**, sends the existing item to the Trash once its replacement is ready                                   |
| **Use for remaining conflicts** | Applies the choice to every later collision in the job                                                                                 |

- Nothing merges: **Replace** replaces the whole existing item.
- **Replace** is not offered when the existing item contains the source, or when a new folder or
  file would replace it.
- Copying an item onto itself, or converting a file to its own format, keeps both.
- If the replacement then fails, Viewer puts the replaced item back when it can; otherwise the error
  says it is in the Trash.
- A file that appears at the destination during the transfer fails the item; retry to choose again.
- Sources are checked again once a collision is decided: a source edited while the prompt was open
  fails its item.

## Copies, moves and durability

| Operation                      | How it is made                                                       | Durability                                                                   |
| ------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Copy on one APFS volume        | A clone: each file shares the original's blocks until either changes | Left to macOS to write, as Finder does                                       |
| Copy to another volume         | Bytes streamed into a private folder beside the destination          | Left to macOS to write                                                       |
| Move on one volume             | One rename                                                           | Atomic                                                                       |
| Move to another volume         | A copy, then removal of each verified original                       | Each file synced (`F_FULLFSYNC`), then its folders, before any original goes |
| Text save, extraction, new ZIP | New file, synced                                                     | Written to permanent storage                                                 |

A pasted picture is written and synced in a private stage, then published exclusively under its
final name, so a failed or canceled write leaves no partial picture there.

- A folder is cloned or copied file by file. A copy keeps the original's dates, permissions, locks,
  ACLs and extended attributes (including read-only `0555`, locked or deny-delete ACL items, with
  Undo proof).
- A file that changes while it is copied fails its item, and the original is left untouched.
- A move that finds a source changed after copying keeps both the copy and the original.
- Links are copied as links. Devices and sockets are refused.
- Partial content is staged in a hidden `.viewer-transfer-` folder. On failure it moves to the Trash
  as `Viewer incomplete transfer` _id_; if the Trash refuses it, it is kept and its path is
  reported.
- After a power failure, a copy made in the seconds before it can be incomplete even when it shows
  as finished; copy it again.

### Volumes without exclusive rename

On macOS, Viewer first attempts an exclusive rename. When the volume reports `ENOTSUP` or
`EOPNOTSUPP`, as exFAT does, Viewer reserves the final name exclusively, verifies that its own
reservation is still empty, then renames the complete item over it. The final name briefly holds an
empty reservation. Names occupied when the reservation is created are refused; a final link is never
followed. Any other native rename error is reported without this fallback.

Viewer compares device and inode as exact unsigned 64-bit values from a single stat call, including
when Node reports an inode as a negative BigInt.

On macOS FSKit, empty files on FAT32 and empty or newly created files on exFAT can receive synthetic
inode numbers that last one mount or less. The shared rule uses only regular files with an unsigned
inode in the top 2^32 values. Real upper-half IDs below that range stay exact, and folders and links
keep their exact identity at every value. Real APFS and HFS+ inode IDs cannot enter the synthetic
range.

Across time, a synthetic file must remain in that range on the same device, keep its regular-file
type and creation time, and satisfy the operation's other evidence. Text saves also compare size,
modification time and the text hash. Replace checks size, modification time and change time. Undo
checks its recorded path, metadata and output proof; proofs include the creation time of each
synthetic descendant. Moves verify copied sources, their dates and their folder children before the
existing source-removal checks. Selections keep the same path or one unambiguous candidate with the
same type, creation time, size and modification time. A captured action, plan, agent proposal or Git
selection uses that same temporal comparison, with all its existing authority checks.

The earlier rounded form still rejected a stable-ID stand-in. Viewer keeps that check and adds
creation time because modification and change time can both be freely set on these drivers. If a
remount assigns a stable ID to a genuine file, Undo refuses and keeps it in place. Immediate
collision and reservation checks always retain exact inodes. Metadata can still match a different
item with identical values; it does not prove ownership of a reservation.

Safe proofs retain the earlier numeric layout with no version field, so an older build accepts those
records on downgrade. Proofs needing large identities use the newer layout; an older strict reader
can set those records aside. Older synthetic records without creation time remain readable but
cannot authorize Undo. A workspace with an older rounded server-pane identity also remains readable;
Viewer discards that untrusted pin and restores the server stopped. The
[decision](../adr/0017-publication-without-exclusive-rename.md) records these compatibility limits.

After a failed rename, Viewer first moves whatever is at the final name into a random hidden
`.viewer-rename-` holding folder beside it. It then checks what was moved. Its own unchanged empty
reservation, and any empty owned holding folder, go through the removal module to the system Trash.
With no Trash or with preservation enabled, they stay and the error names their paths. Viewer
deletes nothing permanently in this recovery path.

The exact native and Node identities agree for empty file reservations on exFAT too. A genuinely
changed recovery entry is kept and reported. Older safe integer identities remain readable; newer
large identities carry an exact-value marker. An older rounded identity cannot authorize Undo:
"Can’t undo: this older record doesn’t say exactly which file it changed."

Someone else's item, including content added to the reservation, is never sent to the Trash. Viewer
puts it back when its original name is free, using the same guarded rename steps. If the name is
occupied or restoration cannot finish, it keeps the item at its private path and reports that path.
If recovery itself cannot proceed, the error reports the final name or holding folder that remains.

An item appearing after the last check can still be overwritten by rename and lose its content: a
file, empty file, link, empty folder for a folder source, or bytes added to a file reservation. A
link's target is not followed. Non-empty folders and file/folder type mismatches are preserved when
rename fails. This short race also applies to restoration and is accepted on these volumes. Volumes
that support exclusive rename keep their atomic no-replacement behavior.

This applies to copies, pastes, moves, renames, Undo from Trash, replacement recovery, stage cleanup
and Put Back from the Trash. Direct and Store builds retain native file coordination and move
notifications. Trash availability is separate: the rules below still apply when a volume has no
Trash. See the [publication decision](../adr/0017-publication-without-exclusive-rename.md).

## Protected folders

These cannot be moved, renamed, replaced or moved to the Trash by anyone, including agents and watch
rules: the disk root, your Home folder, its Applications, Desktop, Documents, Downloads, Library,
Movies, Music, Pictures and Public folders, the root of any mounted volume, and `/Applications`,
`/Library`, `/System`, `/Users`, `/Volumes`, `/bin`, `/etc`, `/opt`, `/private`, `/sbin`, `/tmp`,
`/usr` and `/var`. Matching uses the folder's identity, so another spelling or a link to it is
protected too. Items inside them, and folders under a linked folder on another volume, are not.

## Save text

| Rule              | Value                                                                          |
| ----------------- | ------------------------------------------------------------------------------ |
| Largest text file | 4 MiB; larger files are saved from another app                                 |
| First save        | Moves the version read to the Trash, with **Undo**                             |
| Later saves       | Overwrite the editor's own last save atomically while it is unchanged          |
| Every save        | Checked against the version the editor read; an outside change offers recovery |
| Links             | Refused; save to the file the link points to                                   |

The first save of each editor session trashes again, also after a relaunch. Unsaved drafts stay
private until saved or discarded; a saved or discarded draft goes to the Trash, and if that fails
the draft stays available for a retry. Closing a view does not discard its draft or remove its
document.

## Volumes without a Trash

Many network shares have no Trash. Viewer recognizes one by the error macOS reports for it
(`ENOTSUP`); any other Trash failure is reported as itself.

| Action                   | Result on a volume without a Trash                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **Move to Trash**        | Fails with a message; the item stays where it is                                                                  |
| Your **Replace** or save | Keeps the previous version beside it as `Name (previous).ext`, then `Name (previous 2).ext`, and the job names it |
| An agent's replacement   | Fails and changes nothing                                                                                         |

Viewer never deletes an item in place of moving it to the Trash.

## Undo and Redo

| Job                                                           | Undo                                                                   |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Move or rename on one volume                                  | Moves the item back                                                    |
| Move to another volume                                        | None                                                                   |
| Copy, duplicate, alias, new item, ZIP, extraction, conversion | Moves the output to the Trash                                          |
| Text save                                                     | Moves the saved version to the Trash and puts back the one it replaced |
| **Move to Trash**, **Replace**                                | Puts the item back from the Trash                                      |

- Before anything moves, Undo checks every step: each item must have the identity it had after the
  job, a file its size and modification time, and an output or trashed folder the same contents.
- A trashed folder of more than 10,000 items has no Undo, and the job says so. An output that large
  is kept without an Undo step, and the job names it: "Undo leaves out “Photos”, which holds more
  than 10,000 items. Move it to the Trash to remove it." When nothing else can be undone, it reads
  "Undo is not offered: …" and adds that the originals are unchanged.
- Undo refuses when the original location is taken, so a known conflict never produces a partial
  Undo. If an Undo step fails while running, the completed job stays undoable across restarts.
- Text saves, Undo, **Clear Finished** and unrelated **Put Back** operations can proceed while
  another job waits at a collision prompt.
- **Redo** starts the job again as a new job with every usual check, only in the session that undid
  it. A text save or pasted picture has no Redo.
- **Undo File Operation** also undoes a lens edit when that was the latest change. Arrangement Undo
  is separate, and so are Git actions and changes made by other apps.

## Archives

**Extract Here** writes into a new folder named after the archive, beside it (`Photos.zip` gives
`Photos`). From search results, each archive extracts beside itself. An archive whose entries all
sit in one top-level folder extracts that folder's contents, so `Photos.zip` holding `Photos/` gives
`Photos/`, not `Photos/Photos/`. The `__MACOSX` folder of resource-fork copies is left out. An
existing name asks before replacing.

| Limit   | Extraction                                                                               | ZIP creation                                                                                           |
| ------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Formats | Unencrypted ZIP, TAR, `.tar.gz`, `.tgz`                                                  | ZIP                                                                                                    |
| Entries | 20,000                                                                                   | 20,000                                                                                                 |
| Size    | 32 MB per entry, 256 MB expanded in all; 64 MB for a compressed TAR                      | 2 GB of files                                                                                          |
| Refused | Unsafe paths, links, special files, duplicate or conflicting names; nothing is extracted | Links and special files; names that collide; non-portable names (`:` or `\`, or longer than 255 chars) |

Previewing an archive never runs its contents. **Calculate Size**, **Find Duplicates…** and
**Compare Locations…** measure only when you choose them.

## Trash and Put Back

Choose **Trash** in the sidebar or in the command palette under **Places**. You can also open
`viewer://trash` in **Go to Folder…**, with `:e viewer://trash`, or with `viewer viewer://trash`
from your terminal. Select an item for Quick Preview, its original location when known, **Put Back**
or **Put Back To…**. A folder lists up to 4,000 items.

| Put Back rule           | Value                                              |
| ----------------------- | -------------------------------------------------- |
| Items at once           | Up to 1,000                                        |
| Destination             | Same disk only; an existing name is never replaced |
| Missing original folder | Not recreated; use **Put Back To…**                |
| Changed item or folder  | Refused; refresh the Trash                         |
| Link in the destination | Refused; choose the actual folder                  |

Original locations come from Viewer's private Trash-origins store (`trash-origins-v1.json`, up to
5,000 items and 8 MiB, mode `0600`, moving an unreadable file aside and leaving a newer-version file
untouched) and operation receipts, matched by identity, so **Put Back** stays available after the
100-job history rolls over; an item Finder trashed may need **Put Back To…**. Removable volumes
without POSIX ownership (such as FAT and exFAT) also support Trash listing, **Put Back** and **Empty
Trash…**. **Date added** is the system's directory date, not a deletion time. Reading the macOS
Trash can require Full Disk Access, which is separate from folder access.

Viewer never deletes a file for good unless you choose **Empty Trash…** yourself at the bottom of
the Trash window and confirm **Empty Trash** in the system dialog. **Empty Trash…** is available
when every Trash location is readable and the top-level list fits within 4,000 items (up to 100,000
items or 64 folder levels in all), and stops if the Trash changes before or during erasure. No
**⌘K** command, CLI command, workflow, custom action or agent tool can empty the Trash.

## Agent removals

An agent's removal follows the policy in [AGENTS.md](../../AGENTS.md):

- it can only propose **Move to Trash** for the exact items it names, and Viewer shows each path,
  with each folder's item count and size;
- you approve every removal yourself, in a native confirmation; aliases, imported settings and saved
  execution grants cannot approve it;
- a change to an approved folder's contents cancels the approval, and a folder of more than 10,000
  items is refused;
- nothing is permanently deleted.

## Interrupted work

Restart never replays a job. An interrupted job shows as failed with **Interrupted operation.
Completed items were kept.**, its **Recovery paths** (source, destination and temporary copy) and
**Copy Recovery Paths**. Its Undo and dismissal stay available across restarts for the items it
finished. After a power failure, the last items of a copy can show as interrupted although their
copies are complete; the copies are kept. An orphaned checkpoint folder left behind by a crash
appears in **Content Checkpoints…** as a failed **Incomplete checkpoint**, counts toward the
checkpoint budget and can be removed there. If operation receipts cannot be saved, Viewer stops
every further file change and fails the queued jobs with their recovery paths.

All sizes use decimal units, as Finder shows them: 1 KB is 1,000 bytes.

**Related:** [Browse and organize](../guides/files.md) ·
[Get back to your work](../guides/troubleshooting.md) · [Search](search.md) ·
[Configuration](configuration.md) · [Agents](agents.md#what-an-agent-cannot-do) · [Terms](terms.md)
