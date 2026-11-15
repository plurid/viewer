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
be empty. The complete source is then renamed over the reservation. Nothing streams into the final
name.

## Recovery without permanent deletion

Native cleanup never unlinks the final name. It creates a random hidden `.viewer-rename-` holding
folder beside the destination and renames the entry at the final name into that private folder
before inspecting it. This claim preserves the entry even if another process replaced or filled the
reservation just before cleanup. The holding folder remains on the same volume.

The retained reservation descriptor identifies what was claimed. Only the same still-empty
reservation is returned to TypeScript as eligible for disposal. `desktop/operations/removal.ts`
checks its identity and emptiness again and uses the existing native Trash service. An empty owned
holding folder follows through that same service. When preservation is enabled or the Trash refuses
the item, it stays in place and the error reports its path. Neither native recovery nor this
TypeScript disposal path calls a permanent-removal helper. Viewer deletes nothing permanently in
recovery.

A claimed foreign item, including bytes written into the reservation, is never sent to the Trash.
Recovery restores it when the original name is free, using exclusive rename or the same
reserve-then-rename steps. When that name is occupied or restoration fails, the item stays under its
private name and the error reports that path. Recovery is bounded: another race during restoration
keeps and reports additional captured entries instead of repeatedly chasing writers. If recovery
cannot create or access its holding folder, it keeps and reports the final name and any holding
folder already created. Failure to prove ownership never authorizes disposal.

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

## Verification provenance

The initial agent scenario did not reach any file operation: its 12-character volume label caused
`hdiutil create` to report "Operation not permitted". That refusal was not evidence of an
environment limitation. The reviewer reported that shortening only the label let all four scenario
steps and unmount pass with an externally built helper. The reviewer also reported broader exFAT
workflows, concurrent publication and APFS, HFS+ and FAT controls on `e12829d0`.

The agent subsequently ran the corrected `ViewerQA` scenario with this recovery implementation and
an externally compiled helper: file/folder copy, picture-paste publication, a same-volume move,
rename and unmount passed on a real exFAT image. Both preservation flags were set. Standalone native
tests force cleanup interleavings against real folders. These runs do not establish signed Store,
physical-device, OS clipboard UI or cross-volume source-removal acceptance. Run-specific receipts,
helper hashes and retained fixture paths remain in generated evidence.

[Operation reference](../reference/file-operations.md) · [Platforms](../reference/platforms.md) ·
[Testing](../development/testing.md)
