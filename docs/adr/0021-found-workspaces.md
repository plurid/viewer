# Found workspaces

Status: accepted.

## Context

Workspace definitions should not depend on another app’s catalog or a handwritten file. Folder
history already records where the person works. It is private evidence, separate from open workspace
state.

## Decision

The pure found-workspace domain selects bounded candidate folders and recognizes roots through Git
and manifest markers. Outer Git directories fold monorepos together; worktree files and workspace
markers have explicit precedence. An outer Git directory yields to inner repositories when it would
absorb at least two inner repositories Viewer has seen. Home, standard home folders, hidden and
generated trees, bundles and non-local volumes stay out.

The desktop finder starts ten seconds after folder history is prepared. Later passes follow new
visits outside known roots, with a thirty-second delay and five-minute spacing. Each pass has at
most 300 requests. Incomplete passes follow up at five-minute spacing while they read unknown
folders or change entries, within the passes needed to read every candidate folder once. FolderFacts
owns its disposable worker thread, prioritizes interactive reads and bounds requests to 150 ms with
volume quarantine. Store discovery borrows active scopes and never asks for one. A granted scope
root can itself be a project; the walk never goes above it. FolderFacts times active work, so queue
time behind an interactive read is not a probe timeout.

Found definitions contain one folder plane. Explicit definitions win by path and known canonical
root. Found roots never become ROOT token targets. Shared ownership helpers index ancestor roots
without rescanning the whole definition catalog for each plane.

The ordinary finding cap is 200; retained roots rank first and are exempt. The private versioned
document holds at most 1,800 entries, 500 hidden roots and 1,000 probes within 1 MB. It is written
with mode 0600 only after finding or hiding something. Probe refresh deadlines spread across six to
seven days, oldest first. Stale facts remain as a fallback until a bounded refresh replaces them.
Incomplete ancestry carries existing entries forward. Cached roots receive a bounded identity-only
check during a pass; a changed identity triggers a fresh probe before carrying keys. These checks
share the 300-request budget. Declared-command run recency lives only in
`declared-commands-v1.json`; legacy found files’ `lastRun` fields are ignored. Launch reads metadata
without moving or rewriting it. Unreadable regular files move aside on a later pass or person’s
change; files that cannot be kept aside remain protected. Backups, project exports and agent
discovery exclude this cache.

Clear recent folders clears entries and probes, retaining entries linked open or remembering planes.
Hidden roots remain. Undo restores visit evidence; unchanged paths and explicit definitions give the
same deterministic keys. Viewer’s own moves remap only affected records and coalesce writes for
about a second; shutdown writes what remains. A move that cancels a pass schedules another. Outside
renames settle fresh identity claims before carrying the key. Existing keys are reserved before
minting, with path hashes for lossy slugs and collisions. Explicit key takeover carries the found
entry’s live link and remembered planes to a new key. A pending migration remains in the private
document until its owners accept it. Unplugged local volumes keep their known entries for ninety
days from the entry’s last activity, or while linked open or remembering planes.

Links record their source. Existing links acquire it when their key is known in the catalog; unknown
links retain the prior conservative behavior. Missing standalone definitions permit Delete and Save
as. An unused Project Manager source protects its project and override links. Found links wait for
discovery before reporting a missing folder.

## Consequences

Finding opens no workspace and executes no command. Search and Manage show the Found badge and root.
Recently closed includes a found definition only when it remembers planes. Turning finding off
empties entries and probes by rewriting metadata, while keeping hidden roots.

Hiding controls, contextual offers and learned arrangements are separate work packages. The source
tag, ownership helpers and private hidden list provide their foundations.

See [workspace instructions](../guides/workspaces.md#workspaces-viewer-finds) and
[configuration](../reference/configuration.md#found-workspaces).
