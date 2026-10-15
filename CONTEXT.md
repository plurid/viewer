# Viewer domain map

Viewer is a macOS-first file manager with familiar file navigation, spatial previews and user/agent commands. The active application is `packages/viewer-electron/app`; `old_app` is archival.

| Term                | Meaning and owner                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| File entry          | A filesystem path plus metadata and identity; `src/domain/contracts.ts`, `desktop/filesystem.ts`.                                                |
| Explorer session    | One plane's selection, cursor, range anchor, history, column trail and scroll; `renderer/workspace/sessions.ts`.                                 |
| Folder presentation | Shared path-keyed view, sort, metadata columns and browser width; `domain/folder-presentation.ts`, `renderer/state/store.ts`.                    |
| Plane               | A host record for a folder, search, preview or terminal; its engine route and geometry belong to the workspace adapter.                          |
| Root                | An independent spatial branch. Reuse of a preview stays within that root; explicit new planes remain independent.                                |
| Captured target     | Workspace/root/plane/directory plus selected entries and origin path, frozen before an asynchronous action; `domain/automation.ts`.              |
| Command             | A contextual action with ID, availability, aliases and shortcut; `renderer/commands/registry.ts`. UI menus, keys and agent proposals invoke it.  |
| Recipe              | A reusable extraction/rename/organization/summarization definition that produces a reviewed file-change proposal.                                |
| Custom action       | Declarative built-in, recipe, terminal, executable or explicit shell invocation; `desktop/executions.ts`, `renderer/commands/programs.ts`.       |
| Operation           | A journaled filesystem mutation with progress, conflicts and eligible Undo; existing desktop operation services remain authoritative.            |
| Protected folder    | Disk root, Home, its standard folders and system locations that no request may trash, move, rename or replace, matched by identity; `desktop/protected-paths.ts`. |
| Permanent removal   | Limited to named cases in `desktop/removal.ts` (own temporary files, empty folders, verified move sources, private app data); ESLint rejects other `rm`/`rmdir`/`unlink` calls. Tests use `tools/temporary.ts`. |
| Configuration       | Versioned JSONC preferences with validation, comments, recovery and conflict handling; `desktop/configuration.ts`, `desktop/settings.ts`.        |
| Execution grant     | A separately stored user approval for an exact custom action or terminal capability in a canonical folder; `desktop/agent-requests.ts`.          |
| Terminal session    | A main-process-owned PTY plus a renderer-owned xterm screen, retained through culling; `desktop/terminals.ts`, `renderer/terminals/sessions.ts`. |
| Native file permission | A private picker bookmark or native clipboard/drag session capability, canonicalized and released after dependent work drains; `desktop/file-access.ts`. |
| Model data permission | Private user consent for an exact provider endpoint and data level, independently revocable; `desktop/model-permissions.ts`, `domain/model-permissions.ts`. |
| Operation receipt | A validated durable record of mutation intent, output identity and eligible guarded Undo; `desktop/operation-journal.ts`. It never authorizes blindly replaying interrupted mutations. |
| Workflow | A portable JSONC DAG that explicitly composes inspection, comparison and reviewed changes; `domain/workflows.ts`, `desktop/workflows.ts`. Run receipts and resolved bindings stay private. |
| Watch rule | A private approval for an incoming-file selection workflow, content scope and exact definition/recipe revision; `domain/watch-rules.ts`, `desktop/watch-rules.ts`. It creates reviews and cannot apply them. |
| File relationship | A versioned receipt link, declared/inferred local reference or separate reported note; `domain/relationships.ts`, `desktop/relationships.ts`. It is evidence with a basis, not automatic authority. |
| Office content | Bounded DOCX body blocks or XLSX source-addressed stored cells, shared by previews, inspection, search and agent readers; `domain/office.ts`, `desktop/office.ts`. Formulas and external data never execute. |

Keep file selection/input independent of camera input. Keep shared presentation independent of local navigation. Keep engine IDs inside `renderer/workspace/controller.ts`. Keep credentials and effective grants out of editable configuration. A working directory is not a sandbox.

See [architecture](docs/architecture.md), [configuration](docs/configuration.md), [terminals](docs/terminals.md), [actions](docs/actions.md), [verification](docs/verification.md) and [remaining product work](docs/roadmap.md). Routine app verification stays hidden and never activates Viewer.

Release checks and mandatory native gates live in [qualification](docs/release-qualification.md). The owner separately authorized a coordinated visible native acceptance session using disposable profiles and generated data; routine checks remain hidden. A passing source/mock/browser check is not proof of genuine native picker, Finder, accessibility or distribution behavior.
