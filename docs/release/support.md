# Viewer support: publication draft

Prepared October 13, 2026. Publish at a stable support URL after owner review. Contact:
**source@plurid.com**. The initial release targets Apple Silicon Macs running macOS 14 or later;
supported-version acceptance is recorded separately from this proposed support text.

## Getting started

Open a folder, then choose List, Grid, Columns, Gallery or Map. Folder view settings are remembered
by path. Use the workspace menu or Command-K to switch workspace. Command-K also searches commands;
right-click exposes grouped file, folder, view and terminal actions.

Settings → Browsing provides separate starting folders for the first plane in an empty workspace and
later planes. Settings → Configuration opens the commented JSONC configuration and displays
validation or edit conflicts. Settings → Space controls plane toolbar buttons. List column headers
and the View menu control visible fields and widths.

## Folder access

In the App Store edition, use **Allow folder access…** or Settings → Permissions when macOS
authorization is missing. Selecting a parent folder authorizes its descendants. Cancelling the
picker leaves the current folder in place. A saved location that was moved, removed or became
unavailable may need to be selected again.

The Volumes dialog can list mounted devices without authorizing browsing their contents. Opening a
volume can still require the folder picker. Eject stops Viewer work for that volume before asking
macOS to eject it. Other applications or the system can prevent ejection; the displayed error is
retained for review.

## File operations

Copy/paste supports files and folders. Option-Command-V requests a move after copying. Drag onto a
folder to transfer into it; Option requests copying and Command requests moving. A same-volume
transfer normally moves; a cross-volume transfer normally copies. Collisions require a choice. Use
Operations to see progress, errors, interrupted work and eligible Undo.

Undo refuses removal when a copied or created output changed after the operation. Viewer Trash Undo
uses a private receipt for the generated Trash item; it does not authorize general browsing of the
Trash. Interrupted operations keep recovery details and never replay changes automatically. Keep any
reported partial output until you inspect it.

ZIP creation and ZIP/TAR/TAR.GZ extraction have visible size and entry limits. Unsupported links,
special files, unsafe paths and conflicting archive names are rejected. Archive viewing and archive
extraction are separate actions.

## Previews

Space opens Quick Preview for a selected file. A preview can also open in a linked plane or an
independent root plane. The status/footer action opens the file in its associated macOS application.

DXF previews include distance, angle and area tools. STEP/STP and IGES/IGS previews convert geometry
locally; STL, 3MF, GLB/glTF, OBJ, PLY and FBX use their registered loaders. Mesh measurements use
tessellated surfaces, not CAD feature snapping. For formats without declared units, choose the
assumed units before interpreting a measurement. Viewing does not change the source file. Some
formats, complex files, codecs or missing companion files can produce a visible unsupported/error
state.

## Models, commands and agents

Optional model actions need your own provider configuration and may incur provider charges. Settings
→ Models shows the endpoint and permitted data. Explicit approval is required before any file data,
including filenames, is sent. Revoke it there to stop future/active requests; contact the provider
about information already transmitted.

Terminal profiles and custom commands are configured in Settings. External terminal selection can
discover Terminal or iTerm; tmux options can use a chosen session and socket. Local agents use a
private connection token and configured roots; review each requested capability before granting it.
These executables and external apps have their own permissions.

## Reporting a problem

Include the Viewer version/build, macOS version, Apple Silicon model, direct/App Store edition,
exact steps and expected result. A small generated example is preferable to a confidential file.
Include the visible error and whether the issue survives Quit/relaunch. Redact private paths,
filenames, API keys and agent tokens. Do not send your entire application data directory or Keychain
credentials.

If a file operation fails, keep the original and any reported partial output until inspected.
Describe the operation, source/destination volume types and collision decision. Never delete
unrelated Trash contents to troubleshoot Viewer.
