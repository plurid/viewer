# Archive

These files predate the 2026 modernization and are not used by the workspace, builds or tests. Their features are documented in [docs/old-app.md](../docs/old-app.md). Everything tracked here is also in git history, at commit `bd198da` or earlier.

| Path here | Moved from | Contents |
|---|---|---|
| `viewer-electron-2021/old_app/` | `packages/viewer-electron/old_app/` | The 2021 Electron app: 639 files, 26 MB, 615 of them tracked. |
| `viewer-electron-2021/old_app/examples/` | (same) | 11 MB of sample media. **Git-ignored and not in git history.** |
| `viewer-electron-2021/.gitignore` | `packages/viewer-electron/.gitignore` | The 2021 ignore rules. They still keep `old_app/examples` untracked. The current app has its own `.gitignore`. |
| `viewer-electron-2021/about/` | `packages/viewer-electron/about/` | An empty `notes/general.md` and two `.gitkeep` placeholders. |
| `viewer-strategies/` | `packages/viewer-strategies/` | Three empty folders (`djvu`, `epub`, `pdf`). Never tracked. |
| `workspace-2021/scripts/` | `scripts/` | `joiner.packages.deon` (2021 joiner monorepo configuration) and `update_readme.py`. The script would overwrite `packages/viewer-electron/README.md` with the root README. |

To keep any sample media, copy it out of `old_app/examples/` before deleting. Two items contain personal details; see [Sample files](../docs/old-app.md#sample-files).
