# Git, comparisons, Chat and native windows

These controls share Viewer's command registry and Plurid workspace adapter.
Filesystem operations, permissions, text saves and agent reviews remain owned by
the existing desktop services.

## Git status

Turn on **Settings → Browsing → Show Git status** in the direct build. It starts
off. While disabled, Viewer neither probes Git nor scans repositories.

List, grid, columns, gallery and Map show change badges. The optional **Git** list
column displays status without changing filesystem sorting. The folder header
shows the branch and available ahead/behind counts. Click it, or run
`git-changes`, to open the repository's changes. Deleted files appear there;
Viewer does not manufacture missing filesystem entries. Folder badges roll up
changes beneath them.

`desktop/git.ts` uses a fixed executable, literal arguments, sanitized environment
and read-only commands. Hooks, fsmonitor, optional locks, replacement objects,
credential prompts, lazy fetch and network protocols are disabled. Processes have
time and output limits; at most two Git commands run concurrently. Incomplete,
oversized or unreadable results are reported instead of presented as clean.

## Comparison planes

Select two regular files and choose **Compare files** (`compare-files`). Choose
**Compare with HEAD** (`git-diff`) for one file, or **Open diff** in a folder
comparison. Git comparisons pin the original commit so subsequent branch changes
cannot silently replace the left side.

Text comparisons offer side-by-side and unified modes and previous/next change.
The right file uses the ordinary editor, text buffers, guarded save and conflict
review. Switching modes retains its text, selection and undo history. Closing a
dirty comparison uses the ordinary unsaved-edit prompt. Complete text inputs are
limited to 4 MiB; binary and truncated inputs are refused.

Images offer a divider, onion skin, side-by-side and absolute pixel difference.
Different dimensions share a top-left pixel origin. Decoded sizes are checked
against the image preview budget before comparison. A worker computes differences
without blocking file browsing and releases transferred bitmaps when finished.

## Shortcut and shell command

In **Settings → Navigation**, enable the global shortcut and choose its binding.
The initial binding is **⌥Space**, and registration starts off. It reuses the most
recently focused Viewer window, places it at the top of the pointer's display,
and toggles it away. Its ordinary frame, maximized state and fullscreen state
are retained. **Restore window placement** returns it to that frame. Shortcut
conflicts are reported; reduced motion avoids the drop animation.

The same Settings page installs the direct build's shell command at
`~/.local/bin/viewer`. It does not edit shell startup files. Add that directory to
your PATH yourself if needed. Installation refuses foreign files and linked
parent directories. Uninstall confirms the exact script natively, rechecks its
identity, and moves it to the operating system Trash.

```sh
viewer ~/Documents
viewer --new-window ~/Projects
viewer --terminal ~/Projects
viewer --workspace Research ~/Projects
viewer --workspace workspace-id
viewer -- --a-filename-starting-with-dashes
```

Paths resolve relative to the caller. A workspace can be selected by ID or a
unique name. **New window** creates a separate workspace; a workspace already open
in another native window is focused there. Saves merge against each window's
baseline and cannot overwrite another window's owned workspace. Normal window
placement and the set of open workspaces are private session state.

## Chat planes

Choose **Chat about files** (`new-chat`) with a selection, or from a folder.
Drop files or folders into the conversation to attach more context. The quick
`>` request also offers **Continue in Chat**. Choose a configured model and grant
its endpoint the data level you intend to send. Names/metadata and excerpts use
the existing private, revocable provider permissions.

The model can list, search, read metadata and request bounded excerpts only inside
attached context. Canonical path checks reject escaping links and Viewer private
data. File contents are untrusted evidence. A request has an eight-step limit,
120-second deadline, 256 KiB model context and 1 MiB total tool-output budget.
At most four conversations run at once. **Stop** cancels further work.

Renames create ordinary revisioned operation reviews. Commands and configuration
changes create agent reviews. The model has no apply, approval, Trash, terminal or
program-execution tool. A proposal cannot inherit authority from a reopened native
window. Existing removal approval and Trash-only rules still apply.

Transcripts, attachments and drafts are kept privately when a plane closes, with
a 4 MiB document limit. **Conversations** reopens them; **Export** asks where to
save a Markdown transcript. Draft writes survive culling and join the native quit
flush. Interrupted requests stay stopped after restart. Chat and scratch contents
are excluded from portable projects; comparison projects store source references
and pinned Git commits rather than private buffers or blob contents.

## Presentation and tiling

**Workspace look… → Default profile** sets a workspace's presentation. An explicit
profile applies above that default, and explicit workspace overrides take
precedence. Profile chrome does not overwrite shared UI preferences. Explicitly
activating Present starts the existing Tour when saved views are available;
launching Viewer does not resume a Tour automatically.

Custom themes include interface font, density and corner radius. Interface media,
selection, file-family, tag and shadow colors use semantic theme tokens.

`tile-resize-left`, `tile-resize-right`, `tile-resize-up` and `tile-resize-down`
resize the active tile toward its nearest applicable boundary. Outside edges stay
fixed. A normalized split tree retains individual proportions across resizing and
session saves; minimum sizes and gutters contract together in crowded layouts.
Arrangement Undo/Redo restores the corresponding tiling policy.

Session format 6 adds the new plane types and window presentation records.
Formats 1–5 remain readable and receive an untouched backup before migration.

## Verification

The `milestones` packaged scenario exercises Git status, editable HEAD comparisons,
mode changes, image modes, Chat draft recovery, the real second-process CLI and
independent native windows. Service regressions cover disabled Git, fsmonitor and
index protection, scope escapes, proposal-only Chat, draft interleaving, workspace
save isolation, shortcut conflicts and shell-command identity checks.

The unattended agent smoke step checks that configuration and named credentials
leave native broker approval pending and expose no tools or metadata. Authorized
MCP framing, capability filtering, scope checks and transport run in service tests;
the unattended test does not approve a native consent dialog.

Physical shortcut behavior, live model-provider responses, signed Store behavior
and installation into a person's actual shell environment require their own
native acceptance; synthetic checks do not establish those results.
