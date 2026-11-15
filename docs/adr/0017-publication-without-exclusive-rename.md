# Publication on volumes without exclusive rename

Status: accepted.

## Decision

macOS publication first uses the existing coordinated `renameatx_np(..., RENAME_EXCL)` path. Only a
structured `ENOTSUP` or `EOPNOTSUPP` permits a retry with reservation publication enabled. The
native retry must itself receive one of those errors before creating a reservation. Success and
every other error retain their existing behavior, including collision handling and `EXDEV`.

`desktop/operations/rename-exclusive.ts` owns this retry for all five callers. The reservation
algorithm lives in `tools/exclusive-rename.h`, called by `tools/macos-files.mm` inside its existing
file-coordinator accessor. TypeScript cannot enumerate an open directory with no-follow semantics; a
Node rename would also omit the native move notifications. Native code keeps reservation,
verification, rename and failure cleanup together without asynchronous gaps.

The final name is reserved with `openat(O_CREAT | O_EXCL | O_NOFOLLOW)` for a file or source link,
or exclusive `mkdirat` for a folder. Existing files, folders and links, including dangling links,
fail without being followed. A retained descriptor and device/inode/type identity identify the
operation's empty reservation. Directory contents are checked through its descriptor. Immediately
before rename, a no-follow lookup must still identify that reservation and it must still be empty.
The complete source is then renamed over the reservation. Nothing streams into the final name.

On failure, only the same verified, still-empty reservation may be discarded. A changed or filled
entry is kept. Cleanup errors are reported with the destination path; a volume that refuses cleanup
cannot be made to remove a reservation safely. No source, staged content or pre-existing item is
permanently deleted by this fallback. Test adapters retain discarded reservations for inspection.

## Accepted race and invariant

Another process can replace the reservation between the final identity/emptiness check and rename;
this race is accepted because exFAT has neither exclusive rename nor hard links, and adjacent
synchronous native calls keep the window short while publishing complete content.

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

An older native helper ignores the reservation argument and continues to fail safely. Rebuild the
helper with the TypeScript change before qualifying exFAT. The native scenario exercises the
production engine and helper on a generated image; it does not establish signed Store sandbox or
physical-device acceptance.

[Operation reference](../reference/file-operations.md) · [Platforms](../reference/platforms.md) ·
[Testing](../development/testing.md)
