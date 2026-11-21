# Empty Trash is the person's own command

Status: accepted. Date: 2026-11-21.

## Context

Viewer moves removed files and folders to the operating system Trash and never permanently deletes
items during file operations, replacements or agent work. During the November 2026 review, the owner
decided to keep **Empty Trash…** in Viewer's Trash window while ensuring no automated path can ever
reach it.

## Decision

Only the person can empty the Trash, from the Trash window (`src/renderer/ui/trash/Trash.tsx`),
after a native confirmation (`src/desktop/operations/trash.ts`,
`src/desktop/ipc/access-handlers.ts`, `src/desktop/ipc/schemas.ts`).

On macOS, `Trash.confirmation` calls `macFiles().trashConfirmation`
(`src/desktop/native/macos-files.ts`, implemented in `tools/trash-ui.h`). That native entry point
only displays a native `NSAlert` with Cancel as the default button and runs handle-relative removal
only when the person chooses **Empty Trash**. No erasure function, approval token or confirmation
flag is exported to JavaScript. Before erasing anything, the native code verifies every reviewed
Trash root and item identity and aborts if anything changed.

On Linux and Windows, `Trash.confirmation` presents a native `dialog.showMessageBox` with Cancel as
the default button, re-verifies the Trash revision, and runs `/usr/bin/gio trash --empty` or the
Windows shell `SHEmptyRecycleBin` call without a no-confirmation flag.

No agent tool (`src/desktop/agents/tool-catalog.ts`), CLI command (`src/domain/cli/catalog.ts`),
workflow (`src/desktop/automation/workflows.ts`) or custom action reaches `trashConfirmation`. Every
other user-file removal goes through the Trash in `src/desktop/operations/operations.ts`, which
refuses volumes without a Trash (`VIEWER_NO_TRASH`) instead of deleting permanently. Viewer's narrow
non-Trash cleanups for its own temporary files, empty directories, verified copies and private data
live only in `src/desktop/operations/removal.ts`.

## Consequences

A person can empty the Trash inside Viewer with native confirmation, while agents, the CLI,
workflows and custom actions remain strictly Trash-only. If Trash contents change after review or
confirmation, erasure stops and preserves remaining items until the person refreshes Trash.

See [File operations reference](../reference/file-operations.md) and [AGENTS.md](../../AGENTS.md).
