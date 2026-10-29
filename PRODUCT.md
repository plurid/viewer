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
  can keep its listener. Restoration never replays commands.
- **Show real outcomes.** Report saved files, measured optimization savings, process exits and
  explicitly reported agent status. Missing signals stay unknown.
- **Keep consequential changes reviewable.** Exports preserve originals; file proposals expose their
  scope and conflicts. Eligible Undo checks identities.
- **Make automation optional.** Built-in tools work without a model. Provider data permission,
  native file access and agent authority are separate decisions.

## Current shape

The maintained application is the Electron desktop app. Current local native qualification is on
Apple Silicon macOS; portability and platform-specific qualification are tracked in the
[platform reference](docs/reference/platforms.md).

Core capabilities include folder views and search; document, media and model previews; text editing;
PDF/image/media transforms; notes and checklists; browser and terminal planes; Git/worktree tasks;
custom commands; reviewed workflows; optional model recipes and scoped agent integration.

The [capability reference](docs/reference/capabilities.md) describes current behavior.
[Research](docs/research/README.md) holds proposed capabilities and the hackathon direction. A
proposal is not an implemented feature.

## Writing about Viewer

Show real work in the real application. Use ordinary language, the app's exact labels and keys,
readable screenshots and short recordings. Teach a small action before introducing its larger
system. Link to the canonical reference instead of duplicating its limits or appending
implementation history. See [contributing](CONTRIBUTING.md).
