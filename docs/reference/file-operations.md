# File operations and recovery

This page states how Viewer copies, moves, creates, saves and removes files, and how collisions,
Undo, the Trash and recovery work.

The **File operations** button in the title bar, or **Recent file operations** in **⌘K**, lists each
job with its progress, collision prompt, completed outputs, errors, recovery paths and **Undo**.
Jobs run one at a time, in order. The list keeps the 100 most recent finished jobs; a pending job is
never dropped.

## Commands

| Command                                          | Key      | What it does                                                              |
| ------------------------------------------------ | -------- | ------------------------------------------------------------------------- |
| **Copy**, **Cut**                                | ⌘C, ⌘X   | Puts the selection on the clipboard                                       |
| **Paste here**                                   | ⌘V       | Copies the clipboard's items here; after **Cut**, moves them              |
| **Move copied items here**                       | ⌥⌘V      | Moves the clipboard's items here                                          |
| **Copy to…**, **Move to…**                       |          | Asks for a folder, then copies or moves                                   |
| **Copy to** _folder_, **Move to** _folder_       | ⌃⌘C, ⌃⌘X | Copies or moves to the other folder of a pair                             |
| **Duplicate**                                    | ⌘D       | Makes `Name copy.ext` beside each item                                    |
| **Make alias**                                   |          | Makes a Finder alias, such as `Report.pdf alias`, beside each item        |
| **New folder…**                                  | ⇧⌘N      | Creates an empty folder; it never replaces an existing item               |
| **New file…**                                    |          | Creates an empty file; it never replaces an existing item                 |
| **New folder with selection…**                   | ⌃⌘N      | Asks for a name, then moves the selection into a new folder               |
| **Rename…**                                      | Return   | Renames one item; a case-only rename works on a case-blind volume         |
| **Compress to ZIP**                              |          | Makes `Photos.zip` for one item named `Photos`; `Archive.zip` for several |
| **Extract here**                                 |          | Extracts a ZIP or TAR archive into a new folder beside it                 |
| **Move to Trash** (**Move to Trash…**)           | ⌘⌫       | Moves the selection to the system Trash                                   |
| **Undo file operation**, **Redo file operation** | ⌘Z, ⇧⌘Z  | Reverses the latest job, or starts it again                               |

**Move to Trash…** asks first while **Confirm before moving to Trash** is on
(`settings.browsing.confirmTrash`, on by default).

## Drag and drop

| Drag             | Result                                             |
| ---------------- | -------------------------------------------------- |
| Plain drag       | Moves on the same volume; copies to another volume |
| **Option** held  | Copies                                             |
| **Command** held | Moves, also to another volume                      |

A drag carries at most 10,000 items. A folder cannot be dropped into itself.

## Collisions

When the destination name is taken, the job waits in **File operations** with "_Name_ already
exists." and these choices:

| Choice                          | Result                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Skip**                        | Leaves the existing item; the item is done and leaves nothing to recover                             |
| **Keep both**                   | Uses a free name: `Name copy.ext`, then `Name copy 2.ext`                                            |
| **Replace**                     | After **Replace existing item?**, sends the existing item to the Trash once its replacement is ready |
| **Use for remaining conflicts** | Applies the choice to every later collision in the job                                               |

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

- A folder is cloned or copied file by file. A copy keeps the original's dates, permissions, ACLs
  and extended attributes.
- A file that changes while it is copied fails its item, and the original is left untouched.
- A move that finds a source changed after copying keeps both the copy and the original.
- Links are copied as links. Devices and sockets are refused.
- Partial content is staged in a hidden `.viewer-transfer-` folder. On failure it moves to the Trash
  as `Viewer incomplete transfer` _id_; if the Trash refuses it, it is kept and its path is
  reported.
- After a power failure, a copy made in the seconds before it can be incomplete even when it shows
  as finished; copy it again.

## Protected folders

These cannot be moved, renamed, replaced or moved to the Trash by anyone, including agents and watch
rules: the disk root, your Home folder, its Applications, Desktop, Documents, Downloads, Library,
Movies, Music, Pictures and Public folders, the root of any mounted volume, and `/Applications`,
`/Library`, `/System`, `/Users`, `/Volumes`, `/bin`, `/etc`, `/opt`, `/private`, `/sbin`, `/tmp`,
`/usr` and `/var`. Matching uses the folder's identity, so another spelling or a link to it is
protected too. Items inside them are not.

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
  is kept without an Undo step.
- Undo refuses when the original location is taken, so a known conflict never produces a partial
  Undo.
- **Redo** starts the job again as a new job with every usual check, only in the session that undid
  it. A text save has no Redo.
- **Undo file operation** also undoes a lens edit when that was the latest change. Arrangement Undo
  is separate, and so are Git actions and changes made by other apps.

## Archives

**Extract here** writes into a new folder named after the archive, beside it (`Photos.zip` gives
`Photos`). From search results, each archive extracts beside itself. An archive whose entries all
sit in one top-level folder extracts that folder's contents, so `Photos.zip` holding `Photos/` gives
`Photos/`, not `Photos/Photos/`. The `__MACOSX` folder of resource-fork copies is left out. An
existing name asks before replacing.

| Limit   | Extraction                                                                               | ZIP creation                                |
| ------- | ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| Formats | Unencrypted ZIP, TAR, `.tar.gz`, `.tgz`                                                  | ZIP                                         |
| Entries | 20,000                                                                                   | 20,000                                      |
| Size    | 32 MB per entry, 256 MB expanded in all; 64 MB for a compressed TAR                      | 2 GB of files                               |
| Refused | Unsafe paths, links, special files, duplicate or conflicting names; nothing is extracted | Links and special files; names that collide |

Previewing an archive never runs its contents. **Calculate Size**, **Find duplicates…** and
**Compare locations…** measure only when you choose them.

## Trash and Restore

Open **Trash** in the sidebar to browse the system Trash. Select an item for Quick Preview, its
original location when known, **Restore** or **Restore to…**. A folder lists up to 4,000 items.

| Restore rule            | Value                                              |
| ----------------------- | -------------------------------------------------- |
| Items at once           | Up to 1,000                                        |
| Destination             | Same disk only; an existing name is never replaced |
| Missing original folder | Not recreated; use **Restore to…**                 |
| Changed item or folder  | Refused; refresh the Trash                         |
| Link in the destination | Refused; choose the actual folder                  |

Original locations come from Viewer's own receipts, matched by identity; an item Finder trashed may
need **Restore to…**. **Date added** is the system's directory date, not a deletion time. Reading
the macOS Trash can require Full Disk Access, which is separate from folder access.

Viewer never empties the Trash: empty it in Finder. There is no command, API or agent tool that
empties it.

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
**Copy recovery paths**. Its Undo stays available for the items it finished. After a power failure,
the last items of a copy can show as interrupted although their copies are complete; the copies are
kept. If operation receipts cannot be saved, Viewer stops every further file change and fails the
queued jobs with their recovery paths.

All sizes use decimal units, as Finder shows them: 1 KB is 1,000 bytes.

**Related:** [Browse and organize](../guides/files.md) ·
[Get back to your work](../guides/troubleshooting.md) · [Search](search.md) ·
[Configuration](configuration.md) · [Agents](agents.md#what-an-agent-cannot-do) · [Terms](terms.md)
