# 0003: Treat save completion as a durable barrier

Accepted: October 24, 2026.

## Context

A debounced write is not complete when it has only been scheduled. Concurrent Settings edits, text
buffers, Chat drafts and engine arrangement changes can arrive while a window closes. A missing
acknowledgement or caught write error must not silently become a successful Close or workspace
switch.

## Decision

Renderer persistence has one shared flush barrier. It drains unsaved text and Chat drafts, engine
state, revisioned preference intents and workspace metadata. New work arriving during that barrier
is included before it resolves. Preference intents retain their base revisions; failed batches
remain pending without overwriting newer edits to the same leaf. Bootstrap imports a pure folder
resolver and a narrow persistence-request adapter to avoid initialization cycles.

Native flush requests carry an unguessable token, sending window owner and explicit success/failure
result. Matching requests join one promise. Another window cannot acknowledge it. Timeout,
disconnection, send failure and rejected persistence all reject the barrier. Close proceeds only
after a successful save; failures offer Retry or Keep open rather than discarding changes through a
finally handler.

Private documents and saved workspace state serialize writes, validate bounded input, create an
exclusive temporary file, sync its contents, atomically rename it and sync the containing directory
on supported platforms. JSONC publication uses the same parent-directory synchronization, preserves
comments and checks for an intervening external edit. Migration backups are exclusive and synced
before upgraded state is returned. Durability does not authorize replaying interrupted filesystem
operations: journal recovery remains reviewable.

## Consequences

A save failure stays observable and retryable. A directory-sync failure after publication can mean
new bytes are visible without confirmed durability; callers must report that uncertainty rather than
claim that the old document necessarily remains. Windows retains its platform-specific
directory-sync limitation.

Window ownership and source identity remain required independently of durability. The check suite
must cover failed/retried writes, work admitted during flush, cross-window acknowledgement, timeout,
close refusal and byte-preserving migration. Crash/power-loss, low-space, provider and
device-disconnect qualification remains separate from in-process fault injection.

Evidence: `preference-persistence.test.ts`, `settings-persistence.test.ts`, `window-flush.test.ts`,
`window-creation.test.ts`, `document-store.test.ts` and `saved-state-v5.test.ts`.
