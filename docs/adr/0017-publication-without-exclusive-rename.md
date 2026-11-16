# Publication on volumes without exclusive rename

Status: accepted.

## Decision

macOS publication first uses the existing coordinated `renameatx_np(..., RENAME_EXCL)` path. Only a
structured `ENOTSUP` or `EOPNOTSUPP` permits a retry with reservation publication enabled. The
helper must also advertise the recovery protocol; an older helper is never asked to enter its
reservation fallback. The native retry must itself receive an unsupported error before creating a
reservation. Success and every other error retain their existing behavior, including collision
handling and `EXDEV`.

`desktop/operations/rename-exclusive.ts` owns this retry for all five callers. The reservation
algorithm lives in `tools/exclusive-rename.h`, called by `tools/macos-files.mm` inside its existing
file-coordinator accessor. TypeScript cannot enumerate an open directory with no-follow semantics; a
Node rename would also omit the native move notifications. Native code keeps reservation,
verification, rename and failure cleanup together without asynchronous gaps.

The final name is reserved with `openat(O_CREAT | O_EXCL | O_NOFOLLOW)` for a file or source link,
or exclusive `mkdirat` for a folder. Existing files, folders and links, including dangling links,
fail without being followed. A retained descriptor and device/inode/type identity identify the
operation's empty reservation. A folder is opened without following links immediately after
`mkdirat`, and its identity comes from `fstat` on that descriptor, not a later lookup by path.
Directory contents are checked through its descriptor, with close-on-exec reader descriptors.
Immediately before rename, a no-follow lookup must still identify that reservation and it must still
be empty. Viewer compares device and inode as exact unsigned 64-bit values from a single stat call,
including when Node reports an inode as a negative BigInt. The complete source is then renamed over
the reservation. Nothing streams into the final name.

## Recovery without permanent deletion

Native cleanup never unlinks the final name. It creates a random hidden `.viewer-rename-` holding
folder beside the destination and renames the entry at the final name into that private folder
before inspecting it. This claim preserves the entry even if another process replaced or filled the
reservation just before cleanup. The holding folder remains on the same volume.

A crash during recovery can leave that hidden holding folder without a report. The move aside can
also overwrite an entry planted at its private child name after the holding folder is created; its
name carries 128 random bits, which makes discovery unlikely but does not eliminate this accepted
race. Such an entry can lose its content. Both limits are accepted.

The retained reservation descriptor identifies what was claimed. Only the same still-empty
reservation is returned to TypeScript as eligible for disposal. `desktop/operations/removal.ts`
checks its identity and emptiness again and uses the existing native Trash service. An empty owned
holding folder follows through that same service. When preservation is enabled or the Trash refuses
the item, it stays in place and the error reports its path. Neither native recovery nor this
TypeScript disposal path calls a permanent-removal helper. Viewer deletes nothing permanently in
recovery. Native identities arrive as exact decimal strings; TypeScript normalizes them before
comparison, so an unchanged empty file reservation on exFAT follows the same Trash path as on APFS.

A claimed foreign item, including bytes written into the reservation, is never sent to the Trash.
Recovery restores it when the original name is free, using exclusive rename or the same
reserve-then-rename steps. When that name is occupied or restoration fails, the item stays under its
private name and the error reports that path. Recovery is bounded: another race during restoration
keeps and reports additional captured entries instead of repeatedly chasing writers. If recovery
cannot create or access its holding folder, it keeps and reports the final name and any holding
folder already created. Failure to prove ownership never authorizes disposal.

## Identity across time

Same-moment comparisons keep the exact unsigned device and inode from one stat call. Collision
checks, reservation ownership and the publication check use this form. The action folder check uses
the same adapter; the architecture test follows aliases and descriptor reads to reject plain numeric
stats at identity consumers.

macOS FSKit can assign descending synthetic inodes to empty FAT32 files and to empty or newly
created exFAT files. These identities last one mount or less and can change while untouched. The
shared rule recognizes a regular-file inode with bit 63 set. HFS+ file IDs are 32-bit and APFS inode
object IDs are 60-bit, so their real inode IDs cannot enter this range. A distinct temporal identity
records the unsigned device and regular-file type, without retaining that inode as evidence.

A retained synthetic identity also matches a later stable inode on the same device, once the type
and the caller's other evidence agree. This permits Undo after remount. It does not make same-name
items equal during a collision. Same-moment and temporal identities have separate TypeScript types.

| Check                             | Evidence retained for a synthetic regular file                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Save text read earlier            | Device, file type, size, modification time and the text hash                                                                                   |
| Undo a new file                   | Path, device, type, size, dates, mode and the output proof                                                                                     |
| Undo a move                       | Recorded paths, device, file type, size and modification time                                                                                  |
| Undo a folder copy                | Relative paths and types, devices, sizes, modification and change times, modes and link targets; non-synthetic descendants retain inode checks |
| Delayed Replace                   | Device, file type, size, modification and change times                                                                                         |
| Remove a fully copied move source | Each fingerprint's device, type, size, dates and directory children; the existing final change-time and size check runs before removal         |
| Keep a saved selection            | Path or one unambiguous candidate, device, type, size, modification and creation times                                                         |

Metadata cannot distinguish a substituted item with exactly the same fallback evidence. This is
accepted for synthetic inodes, whose previous rounded representation already provided no useful
inode evidence across time. An exact immediate check remains mandatory wherever ownership, rather
than a retained version, is required. Native reviewed Trash materializes a fresh exact identity,
then the helper verifies it and the reviewed content hash inside its coordinated accessor.

## Journal compatibility

Safe integer identities retain the earlier representation. A proof containing only safe identities
uses the earlier numeric hash layout and omits `proofVersion`, so an older strict reader accepts
APFS records in that range. A large identity requires a versioned proof. A synthetic descendant's
relative path is recorded separately, so its inode stays excluded even when remount assigns a stable
inode. Other descendants keep their own identity checks.

Older safe proofs remain readable. Earlier exact version 2 proofs can still validate while their
recorded inode evidence remains reproducible; they cannot be reconstructed after a synthetic inode
has changed, because their descendant identities were only hashed. Undo refuses that case. An
unmarked rounded identity never authorizes Undo: "Cannot undo because this older record does not
have an exact file identity." Exceeding the proof item limit is reported as changed contents.

Large or synthetic proof records require this format. An older strict reader can set those records
aside as unreadable on downgrade; safe records keep the earlier layout and their Undo history.

## Accepted race and invariant

Another process can replace or write into the reservation between the final check and rename. A file
with content, an empty file, a link, or bytes written into a file reservation can then be
overwritten and lost; an empty folder can be replaced by a folder source too. A link's entry is
lost, but its target is never followed or overwritten. A non-empty folder and a file/folder type
mismatch make rename fail and their contents are preserved. Recovery then restores or reports the
preserved entry as described above. The same race applies when restoring a claimed foreign item.

This content-loss race is accepted because exFAT has neither exclusive rename nor hard links.
Adjacent synchronous checks and rename minimize the window while publishing complete content.

The invariant is exclusive reservation, no following a final link, identity and emptiness checks,
and complete-content rename. This is weaker than the atomic no-replacement guarantee of
`RENAME_EXCL` in the stated race. A process crash or storage failure can interrupt reservation
cleanup; the reservation never contains partial copied bytes. Supporting volumes retain the atomic
path unchanged.

## Callers and authority

| Caller                             | Behavior without exclusive rename                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `file-transfer.ts`, `publish`      | Publishes staged copies, file and picture pastes, new outputs, moves and renames through the shared retry.                 |
| `operations.ts`, `undoTask`        | Restores a trashed item during Undo through the same guarded native move.                                                  |
| `operations.ts`, `restoreReplaced` | Puts a replaced item back after failed publication only while its original name can be reserved.                           |
| `staging.ts`, stage move           | Moves an incomplete stage to its visible cleanup name, including any guarded move back, before the existing Trash attempt. |
| `trash.ts`, `restore`              | Restores to the reviewed same-volume destination without replacing an existing entry.                                      |

Direct and Store builds share the native fallback. The coordinator's purpose, URL validation, Store
`willMoveToURL` notification and successful `didMoveToURL` notification surround the move as before.
Folder grants, Trash bookmark access, journaling, Undo validation and agent removal approval stay
with their existing owners. Agents gain no endpoint or authority, including on volumes without a
Trash.

A helper built from this source is required. With an older helper, the TypeScript gate reports the
original unsupported-rename error without attempting reservation publication or replacing an item.
The Store fallback also needs access to the destination's parent folder: a grant to a single file
cannot authorize opening its parent. The operation fails with a permission error and keeps its
source or complete stage until the person grants the folder and retries.

[Operation reference](../reference/file-operations.md) · [Platforms](../reference/platforms.md) ·
[Testing](../development/testing.md)
