# Found workspaces

Status: accepted.

## Context

Workspace definitions should not depend on another app’s catalog or a handwritten file. Folder
history already records where the person works. It is private evidence, separate from open workspace
state.

## Decision

The pure found-workspace domain selects bounded candidate folders and recognizes roots through Git
and manifest markers. Outer Git directories fold monorepos together; worktree files and workspace
markers have explicit precedence. Home, standard home folders, hidden and generated trees, bundles
and non-local volumes stay out.

The desktop finder starts ten seconds after folder history is prepared. Later passes follow new
visits outside known roots, with a thirty-second delay and five-minute spacing. Each pass has at
most 300 probes. FolderFacts owns its disposable worker thread, prioritizes interactive reads and
bounds requests to 150 ms with volume quarantine. Store discovery borrows active scopes and never
asks for one.

Found definitions contain one folder plane. Explicit definitions win by path and known canonical
root. Found roots never become ROOT token targets. Shared ownership helpers index ancestor roots
without rescanning the whole definition catalog for each plane.

The private versioned document holds at most 200 entries, 500 hidden roots, 1,000 probes and 200
last-run references within 1 MB. It is written with mode 0600 only after finding, hiding or running
something. Probe results expire after seven days. References contain file names and command names,
never command text. Unreadable regular files move aside; files that cannot be kept aside remain
protected. Backups, project exports and agent discovery exclude this cache.

Clear recent folders clears entries and probes, retaining entries linked open or remembering planes.
Hidden roots remain. Undo restores visit evidence so deterministic keys return. Viewer’s own moves
remap roots; identity-preserving outside renames keep the key.

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
