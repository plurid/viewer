# Explicit PostScript rendering

Status: accepted.

## Decision

PostScript inspection reads bounded comments, source and embedded pictures without interpreting the
program. An Illustrator file with a PDF inside uses the existing PDF reader. Page rendering is a
separate **Render pages with Ghostscript** button, available only to the person in the direct
edition. Opening a plane, Quick Preview, preview restoration and agent navigation never start an
interpreter. There is no automatic-render preference or command alias for this button.

Discovery checks executable files at three fixed locations and one custom absolute setting. Even a
version probe starts a program, so discovery does not probe. After the explicit click, the desktop
requires Ghostscript's name and version in bounded help output before rendering. It verifies the
executable identity again and keys the existing derived-preview cache by that identity and source
version. A changed setting or executable cannot reuse another interpreter's cached pages.

The existing process runner owns direct spawning, minimal environment, timeout, stdout output
limit, priority reduction and cancellation. The existing private transfer stage owns input-copy
identity checks and Trash recovery; this route never permanently removes even an empty stage.
Ghostscript runs on the copied PostScript section with safe, batch and no-prompt options and writes
a PDF to bounded stdout. Safe mode is an interpreter restriction, not an operating-system sandbox.
Viewer does not bundle Ghostscript or make a licensing decision for its owner.

The resource IPC handler refuses agent-driven calls before executable discovery. Agent commands
and custom actions use the existing allowlist; CLI and MCP expose no rendering service. The
executable setting is excluded from agent configuration, including parent-section replacement.
The Store check is repeated in the renderer service, not inferred from a hidden UI control.

## Consequences

The button can appear for an executable that later fails the Ghostscript identity check. Its
version is known only after a rendering request. This preserves the stronger promise that selecting
a file executes nothing. Conversion failures leave inspection available, and closing the last
preview consumer cancels the owned job through the existing cache leases. Cancellation and access
revocation cannot publish a late result. Store users can inspect comments, source, EPS pictures and
PDF-compatible Illustrator files without an external interpreter.
