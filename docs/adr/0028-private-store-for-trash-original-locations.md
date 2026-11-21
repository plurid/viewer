# Private store for Trash original locations

Status: accepted. Date: 2026-11-21.

## Context

Operation history keeps at most 100 finished jobs. When **Put Back** in the Trash window relied only
on that history for items Viewer trashed, running more than 100 later operations evicted older Trash
receipts and lost their original locations. The owner chose a small private store so **Put Back**
keeps working after history rolls over.

## Decision

`TrashOrigins` (`src/desktop/operations/trash-origins.ts`) keeps original locations for items Viewer
moved to the Trash in a private versioned file, `trash-origins-v1.json`, written atomically through
`DocumentStore` (`src/desktop/persistence/document-store.ts`) with mode `0600`. The store is bounded
to 5,000 entries (`trashOriginLimit`) and 8 MiB (`trashOriginMaxBytes`), dropping the oldest entries
first and storing each item's Trash path, original path, identity, size and modification time.

`Operations` (`src/desktop/operations/operations.ts`) records entries when trashing items and when
evicting finished jobs past the 100-job cap, removes entries when items are undone or restored from
the Trash window (`src/desktop/bridge.ts`), and merges stored origins with active job receipts in
`Operations.trashOrigins()`. `Trash` (`src/desktop/operations/trash.ts`) verifies each item's
identity before using its stored origin for **Put Back**. Unreadable store files move aside as
`trash-origins-v1.json.unreadable-<uuid>`; files from a newer format version or unmovable files stay
untouched in place. The store is excluded from editable `config.jsonc` and personal backups
(`src/desktop/persistence/backup.ts`).

## Consequences

**Put Back** works for items Viewer trashed even after the 100-job history rolls over, without
enlarging operation history or exposing private file paths in editable configuration or backups.
Items trashed outside Viewer or evicted past 5,000 entries remain recoverable with **Put Back To…**.

See [File operations reference](../reference/file-operations.md).
