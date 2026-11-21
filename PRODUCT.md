# Viewer

Viewer helps people work with files without constantly losing their place between applications. It
starts as an ordinary file explorer and grows into a workspace for previews, creative tools,
development and automation.

## Who it serves

Someone organizing photographs should be able to open a folder, preview and convert an image without
learning a command language. Someone developing software should be able to put source, Git review, a
terminal and a browser together. Neither workflow requires adopting the other.

The documentation follows the same progression: everyday files, creating and editing, workspaces,
development, then automation. Advanced features remain discoverable through contextual commands and
deeper guides.

## Product principles

- **Start with the file.** Files stay in ordinary folders with their own identity. A workspace
  points at files; it never imports them into a closed library.
- **Make the next action clear.** Show relevant commands for the active folder, selection or
  preview. Put quick inspection and common actions within reach.
- **Give each format its own controls.** A worksheet needs sheet navigation; a model needs a camera;
  a PDF needs pages. Explain partial coverage honestly.
- **Use space for context.** Linked views express relationships. Docking and tiling support focused
  work. Spatial navigation is optional for basic use.
- **Keep views separate from work.** Closing a note view keeps its document; closing a server view
  can keep its listener. Restoration never replays commands. Opening a defined workspace asks before
  each named command; restored command planes return to their Start panel.
- **Show real outcomes.** Report saved files, measured optimization savings, process exits and
  explicitly reported agent status. Missing signals stay unknown.
- **Keep consequential changes reviewable.** Exports preserve originals; file proposals expose their
  scope and conflicts. Eligible Undo checks identities.
- **Make automation optional.** Built-in tools work without a model. Provider data permission,
  native file access and agent authority are separate decisions.

## Current shape

The maintained application is the Electron desktop app (0.1.0-0 alpha in source), built for direct
macOS download and the Mac App Store. The direct build includes an offline 30-day trial and pay-once
license key check, inactive until configured by the publisher. Current local native qualification is
on Apple Silicon macOS (macOS 14 or later); Intel macOS, Windows, Linux and signed Store acceptance
are tracked in the [platform reference](docs/reference/platforms.md).

Core capabilities include folder views, folder insights, habit navigation and name/content search;
document, Office, PostScript, media, archive, SQLite and 3D/CAD previews; text editing, notes and
checklists; PDF/image/media transforms, unified Optimize, photo/PDF layouts, DXF nesting and
fabrication checks; defined and found workspaces, declared commands, personal backups, browser and
terminal planes, local servers, Git/worktree tasks and a bounded Journal; custom actions, a typed
command line, a terminal CLI, reviewed workflows and watch rules; optional local and hosted
dictation (direct and Store macOS builds; signed Store qualification pending), optional model
recipes, conversation canvases with a Tool Library, optional 3D photo reconstruction and scoped
agent integration. Viewer moves removed files to the Trash with guarded Undo; only the person's own
**Empty Trash…** in the Trash window erases anything, and agents cannot reach it.

The [capability reference](docs/reference/capabilities.md) describes current behavior. Open problems
from the repository review live in [review findings](docs/development/findings.md).
[Research](docs/research/README.md) holds proposed capabilities. A proposal is not an implemented
feature.

## Writing about Viewer

Show real work in the real application. Use ordinary language, the app's exact labels and keys,
readable screenshots and short recordings. Teach a small action before introducing its larger
system. Link to the canonical reference instead of duplicating its limits or appending
implementation history. See [contributing](CONTRIBUTING.md).
