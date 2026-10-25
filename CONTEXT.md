# Viewer domain map

Viewer is a macOS-first file manager with familiar file navigation, spatial previews and user/agent commands. The active application is `packages/viewer-electron/app`; the 2021 predecessor is recorded in `docs/old-app.md`.

| Term                   | Meaning and owner                                                                                                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File entry             | A filesystem path plus metadata and identity; `src/domain/contracts.ts`, `desktop/files/filesystem.ts`.                                                                                                                                  |
| Explorer session       | One plane's selection, cursor, range anchor, column trail and scroll; `renderer/workspace/sessions.ts`. Navigation history belongs to the saved folder pane.                                                                             |
| Folder presentation    | Shared path-keyed view, sort, metadata columns and browser width; `domain/preferences/folder-presentation.ts`, `renderer/state/presentation.ts`.                                                                                         |
| Lens                   | A folder-local grouping of its direct children, with remembered Map places, stored in the folder's `.viewer/lenses/`; it never moves files. `domain/files/lenses.ts`, `desktop/workspaces/lenses.ts`, [lenses](docs/lenses.md).          |
| Plane                  | A host record for a folder, search, collection, preview, terminal, scratch, comparison, Git changes or Chat; its engine route and geometry belong to the workspace adapter.                                                              |
| Scratch plane          | Text that is not a file yet, kept in private app data until Save As writes it (the plane then shows that file, in place) or it is discarded; `editing/ScratchPlane.tsx`.                                                                 |
| Text buffer            | Unsaved text kept in private app data: a scratch plane's, or a file's unsaved edits with the version they were made over; `desktop/editing/text-buffers.ts`, `renderer/editing/buffers.ts`. Removed only when saved or discarded.        |
| Root                   | An independent spatial branch. Reuse of a preview stays within that root; explicit new planes remain independent.                                                                                                                        |
| Captured target        | Workspace/root/plane/directory plus selected entries and origin path, frozen before an asynchronous action; `domain/automation/actions.ts`.                                                                                              |
| Command                | A contextual action with ID, availability, aliases and shortcut; `renderer/commands/registry.ts`. UI menus, keys and agent proposals invoke it.                                                                                          |
| Recipe                 | A reusable extraction/rename/organization/summarization definition that produces a reviewed file-change proposal.                                                                                                                        |
| Custom action          | Declarative built-in, recipe, terminal, executable or explicit shell invocation; `desktop/actions/executions.ts`, `renderer/commands/programs.ts`.                                                                                       |
| Operation              | A journaled filesystem mutation with progress, conflicts and eligible Undo; existing desktop operation services remain authoritative.                                                                                                    |
| Protected folder       | Disk root, Home, its standard folders and system locations that no request may trash, move, rename or replace, matched by identity; `desktop/files/protected-paths.ts`.                                                                  |
| Permanent removal      | Limited to named cases in `desktop/operations/removal.ts` (own temporary files, empty folders, verified move sources, private app data); ESLint rejects other `rm`/`rmdir`/`unlink` calls. Tests use `tools/temporary.ts`.               |
| Configuration          | Versioned JSONC preferences with validation, comments, recovery and conflict handling; `desktop/preferences/configuration.ts`, `desktop/preferences/settings.ts`.                                                                        |
| Execution grant        | A separately stored user approval for an agent to read terminal output under a canonical folder; `desktop/agents/agent-requests.ts`. Agent commands always need fresh approval.                                                          |
| Terminal session       | A main-process-owned PTY plus a renderer-owned xterm screen, retained through culling; `desktop/terminals/terminals.ts`, `renderer/terminals/sessions.ts`.                                                                               |
| Native file permission | A private picker bookmark or native clipboard/drag session capability, canonicalized and released after dependent work drains; `desktop/files/file-access.ts`.                                                                           |
| Model data permission  | Private user consent for an exact provider endpoint and data level, independently revocable; `desktop/models/model-permissions.ts`, `domain/models/permissions.ts`.                                                                      |
| Operation receipt      | A validated durable record of mutation intent, output identity and eligible guarded Undo; `desktop/operations/operation-journal.ts`. It never authorizes blindly replaying interrupted mutations.                                        |
| Workflow               | A portable JSONC DAG that explicitly composes inspection, comparison and reviewed changes; `domain/automation/workflows.ts`, `desktop/automation/workflows.ts`. Run receipts and resolved bindings stay private.                         |
| Watch rule             | A private approval for an incoming-file selection workflow, content scope and exact definition/recipe revision; `domain/automation/watch-rules.ts`, `desktop/automation/watch-rules.ts`. It creates reviews and cannot apply them.       |
| File relationship      | A versioned receipt link, declared/inferred local reference or separate reported note; `domain/files/relationships.ts`, `desktop/workspaces/relationships.ts`. It is evidence with a basis, not automatic authority.                     |
| Office content         | Bounded DOCX body blocks or XLSX source-addressed stored cells, shared by previews, inspection, search and agent readers; `domain/previews/documents/office.ts`, `desktop/previews/office.ts`. Formulas and external data never execute. |

A **worktree view** is an ordinary folder plane opened on an existing checkout.
`domain/comparison/worktrees.ts` defines registry metadata; the desktop worktree
service owns bounded discovery and owner-bound identity leases. View IDs are
independent of checkout identity, while views of one checkout share real files
and staging. Git changes and diffs link under their source planes. See
[existing worktrees](docs/git-worktrees.md).

A **Journal** is a human-readable projection of desktop activity, separate from
the authoritative operation receipt log. `domain/journal` owns the closed event
and query vocabulary; `desktop/journal` owns bounded private persistence, captured
origins and reviewed exports/Trash; `renderer/journal` owns independent reader
cursors and the plane. History cannot apply, undo, authorize or replay its event.
There is no renderer append API or agent Journal reader. See
[Journal scope](docs/journal-plane.md).

A **setting profile** is a named presentation overlay, not an application data
profile or an authorization document. The shared configuration remains canonical.
Each workspace window resolves general preferences → workspace default profile →
explicit profile → local overrides. Shared folder choices and project folder views
then refine folder defaults. Settings edits the shared values; activation and Leave
profile do not. Missing definitions retain their references and report diagnostics.

The feature groups have matching ownership across layers. Domain code supplies
serializable types, schemas and pure rules; desktop adapters own native authority,
I/O and persistence; renderer features own commands, sessions and presentation.
`domain/preferences/presentation` owns the exact profile field catalog and common
resolver. `desktop/{preferences,persistence,agents,files,operations,windows,ipc}`
separates shared configuration, durable documents, consent and window ownership.
Other desktop groups cover models, chat, automation, workspaces, search,
comparison, previews, terminals, workers, native helpers and diagnostics.
`renderer/ui` groups business controls by feature and keeps only shared primitives
at its root. Existing explorer, workspace, editing, terminal, Chat and preview
modules remain separate features.

Saved workspace state is version **8** (`CURRENT_STATE_VERSION`). Versions 1–7
receive byte-preserving backups before migration; legacy globally applied profiles
are restored only through compare-and-set checks. Shared-agent authority is private
version **2** and requires native review; version-1 authority cannot grant access.
See [decisions](docs/adr/0001-window-local-profiles.md),
[consent](docs/adr/0002-private-agent-authority-v2.md),
[durability](docs/adr/0003-durable-save-barriers.md) and
[spatial overlays](docs/adr/0004-collision-aware-spatial-overview.md).

Keep file selection/input independent of camera input. Keep shared presentation independent of local navigation. Keep engine IDs inside `renderer/workspace/controller.ts`. Keep credentials and effective grants out of editable configuration. A working directory is not a sandbox.

See [architecture](docs/architecture.md), [configuration](docs/configuration.md), [terminals](docs/terminals.md), [actions](docs/actions.md), [verification](docs/verification.md), [capability map](docs/capabilities.md) and [remaining product work](docs/roadmap.md). Routine app verification stays hidden and never activates Viewer.

Release checks and mandatory native gates live in [qualification](docs/release-qualification.md). The owner separately authorized a coordinated visible native acceptance session using disposable profiles and generated data; routine checks remain hidden. A passing source/mock/browser check is not proof of genuine native picker, Finder, accessibility or distribution behavior.

A **server runtime** is a window-owned listener, independent of its detachable
server planes. A **browser guest** is an isolated persistent offscreen Chromium
page rendered into a plane canvas. A **media draft** is a private revisioned
segment/audio plan against source versions. A **transform** is a bounded typed
image/media/PDF export submitted to the existing operation executor; optimization
records size results and publishes only a smaller candidate. None is an agent
shell or deletion grant. See [resource lifetimes](docs/adr/0007-spatial-workbench-resources.md)
and [media and optimization](docs/media-tools.md).

Large XLSX worksheets use `desktop/previews/office-worksheet.ts` with the shared
incremental XML scanner and bounded archive streams. Retained cell/evidence
budgets do not stop full XML, CRC and source-version validation. Word and small
package parts keep their separate tree limits; see [Office previews](docs/office-previews.md).

A **worksheet page** is one selected sheet's bounded stored-row window, addressed
by original Excel row numbers. It uses an existing preview resource, a cancellable
request ID and a source-version/range cache key. Unloaded sheet metadata differs
from empty sheet content. Index/agent extraction keeps its separate existing
content bounds and authority.
