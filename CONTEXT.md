# Viewer domain map

The maintained app is `packages/viewer-electron/app`. Paths below are relative to that directory.
For product intent, read [PRODUCT.md](PRODUCT.md); for UI rules, read [DESIGN.md](DESIGN.md). Start
development with [CONTRIBUTING.md](CONTRIBUTING.md).

## Layer ownership

| Layer           | Owns                                                                 | Entry points                                                                          |
| --------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Domain          | Serializable types, validation and pure decisions                    | `src/domain/contracts.ts`, feature directories under `src/domain/`                    |
| Desktop         | Filesystem and process authority, native access, persistence and IPC | `src/desktop/bridge.ts`, `src/desktop/ipc/`, desktop feature services                 |
| Preload         | The narrow renderer-to-desktop API                                   | `src/preload.ts`                                                                      |
| Renderer        | User commands, sessions and presentation                             | `src/renderer/commands/`, `src/renderer/workspace/`, feature views                    |
| Native helpers  | Platform-specific file, preview and process integration              | Native helper sources under `tools/`, `src/desktop/native/`, `tools/build-helpers.ts` |
| Tests and tools | Reproducible fixtures, qualification and packaging                   | `tests/`, `tools/`                                                                    |

## Files and views

A **file entry** combines a path, metadata and stable identity. File operations check identity and
source version rather than trusting a previously displayed path. Native file permission belongs to
desktop services and can be revoked.

A **plane** is a view record. Its engine route, framing and geometry belong to
`src/renderer/workspace/controller.ts`. A **root** is an independent spatial branch: preview reuse
is scoped to that root. Keep engine IDs inside the adapter.

Content-plane opening and reuse live in `src/renderer/workspace/content-planes.ts`; asynchronous
results keep their originating workspace. IPC dispatch lives in feature groups,
`src/desktop/ipc/*-handlers.ts`, each given only the services it needs. The desktop bridge still
validates the sender and window role, and owns window records and root quiescence.

An **explorer session** owns selection, cursor, range anchor, scroll and column trail. **Folder
presentation** is shared by path and owns view/sort/column choices. Navigation and operation
selection remain independent of camera input.

A **preview resource** is an authorized lease on a source or derived rendition. The desktop resource
owner checks versions, bounds work and releases dependent resources on cancellation or revocation.
Office layout uses a bundled sandboxed engine; Office content inspection is a separate bounded
saved-value reader.

Completed document data can outlive a view in `renderer/previews/document-cache.ts`, bounded per
window and keyed by workspace and validated source version. It retains no resource URLs or mounted
viewers. Every reuse follows fresh resource authorization; revocation invalidates pending and
completed matching data. Desktop extraction and in-flight deduplication remain desktop-owned.

## Documents and runtimes

| Concept               | Lifetime and owner                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Scratch / text buffer | Private unsaved text, managed by `desktop/editing` and renderer editing sessions                                   |
| Note / checklist      | A revisioned private document independent of its open views; `domain/editing/notes.ts`, `desktop/editing/notes.ts` |
| Task area             | A checkout context with durable tool references; `domain/workspaces/tasks.ts`, `renderer/tasks/controller.ts`      |
| Terminal              | A desktop-owned PTY plus a renderer xterm session; survives culling, ends when its view closes                     |
| Server                | A window-owned listener independent of its controls plane; restored stopped                                        |
| Browser               | An isolated Chromium guest rendered into a plane; `desktop` browser services and `renderer/browser`                |
| Media draft           | Private versioned editing decisions; a transform publishes new output through operations                           |
| Command receipt       | Private process evidence independent of the output view; `desktop/actions/receipts.ts`                             |

Different worktrees have different working files and indices. Two views of one checkout share those
files and staging. A view ID is never checkout identity. Cold restoration does not replay terminal
input, commands, agents or server starts.

## Commands and authority

A **captured target** freezes workspace, root, plane, directory and selection before asynchronous
work. Contextual commands, recipes and custom actions use it instead of reading a later selection.

A **command** is a contextual registry action. A **custom action** is a declarative executor. A
**recipe** prepares a reviewed file proposal. A **workflow** composes typed inspection and
proposals; a **watch rule** can prepare a review, not apply it.

The terminal **CLI** (`domain/cli`, `desktop/cli`) binds argument parsing and scripting output to
the existing scoped MCP transport. `desktop/agents/service-tools.ts` adapts shared feature owners;
it does not own a second execution or approval service. Managed speech weights belong to
`desktop/speech`; installed weights and recognition availability are separate states. Its Speech
service reserves a window-owned session before consent and allows one capture/inference at a time.
`renderer/speech` owns bounded audio capture and editable transcript review. The helper receives PCM
through stdin and exits after inference; audio is never persisted. See
[window-owned speech](docs/adr/0009-window-owned-speech.md).

Hosted speech metadata and endpoint/model-bound audio consent belong to `desktop/speech/providers`;
encrypted keys use a separate private namespace. `desktop/speech/transcription` owns wire protocols
and bounded responses. Local and hosted paths share capture and reviewed insertion.
`desktop/agents/task-workflow` binds parameterized CLI task proposals to workspace ownership and
worktree leases. Its raw checkout writer cannot run hooks or filters; the renderer task controller
persists the approved bundle before acknowledging completion.

`desktop/workspaces/task-requests` binds a person's editable task form to that same engine using
ordinary folder access and native confirmation, independently of agent grants. `task-new` only fills
the form; Ask Viewer and reviewed speech do not gain a second executor. Hosted speech catalog checks
belong to `desktop/speech/provider-check`; results are session-only and separate from audio consent.

Native file permission, provider data permission and local agent authority have separate owners.
Effective grants and credentials stay outside editable JSONC. Agent terminal read permission does
not grant input or process containment. Every agent removal requires fresh exact-scope approval and
operating-system Trash; see the authoritative [removal policy](AGENTS.md).

The broker owns cancellable authority lifetimes independently of RPC sockets. Shared withdrawal
retires agent work; per-client withdrawal retires that client's work. Model data permission also
tracks the request's user/agent origin. Agent Git inspection uses a contained process on macOS and
never falls back to an uncontained status or diff.

An **operation receipt** records mutation intent and guarded Undo. An intent is synced to disk
before the change it covers; a finished item's record waits for the next sync, so after a power
failure that item reads as interrupted and recovery changes nothing. **Journal** is a bounded
human-readable projection; it cannot authorize or replay an event. An external session's
**Reported** state comes from its authenticated adapter, not terminal output or elapsed time.

## Persistence and decisions

Shared configuration is validated JSONC. A **setting profile** is a presentation overlay, distinct
from an application data profile and from authorization. Window-local resolution and shared folder
presentation have separate precedence.

**Update checks** belong to `desktop/updates`: one feed (`domain/updates/feed.ts`), read only after
its Ed25519 signature matches the key in `desktop/release.ts`. A check never downloads or installs;
Download opens the https disk image in the browser. The Store edition never checks.

`CURRENT_STATE_VERSION` and migration functions in domain/persistence code are authoritative for
saved-state versions. Durable save barriers coordinate document and window shutdown; invalid files
and migration inputs are preserved for recovery.

Read the [architecture](docs/development/architecture.md),
[configuration](docs/reference/configuration.md) and [ADRs](docs/adr/README.md) before changing
ownership. Run [affected checks](docs/development/testing.md). Routine native verification uses
isolated hidden windows and generated files.
