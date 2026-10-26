# File and folder removal

The user requires explicit permission for every agent-initiated file or folder removal. Name the
exact paths, explain what will be moved (including folder contents), and wait for approval. General
task authorization, previous approvals, saved execution grants and hidden confirmation preferences
are not permission for a new removal. Never click or simulate approval of your own removal request
on the user's behalf.

Always use the operating system Trash. Never permanently delete files or folders, empty Trash, run
`rm -rf`/forced deletion, or substitute permanent deletion when Trash fails. Preserve the items and
report the failure. Verify scope, identity and unexpected symlinks before moving approved items. Do
not expand a reviewed selection or recursively remove an unreviewed parent.

This applies to coding agents as well as Viewer agents. Preserve generated test folders and build
artifacts until their removal has been approved; do not run cleanup routines that permanently delete
them. Do not rewrite or delete user changes while doing unrelated work.

Standing exception (approved 2026-10-23): `pnpm package` and `pnpm make` first run
`tools/trash-previous-build.ts`, which moves the previous build output, exactly
`packages/viewer-electron/app/.vite` and
`packages/viewer-electron/app/out/Viewer-<platform>-<arch>`, to the Trash before rebuilding. It
moves nothing else, refuses links and stops the build if the Trash fails.

Viewer must enforce agent removal approval in the desktop service. Editable JSONC, imported
configuration, custom-action aliases and saved terminal/execution grants must not bypass it. Agent
shell, executable and terminal-input routes must remain unavailable unless they can enforce the same
Trash-only policy.

# Documentation

Follow [CONTRIBUTING.md](CONTRIBUTING.md) when changing documentation or comments. Keep user
instructions, exact reference, research and run-specific evidence separate. Update the canonical
guide rather than appending an implementation diary to the README.
