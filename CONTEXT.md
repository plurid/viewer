# Viewer domain map

The maintained app is `packages/viewer-electron/app`. Paths below are relative to that directory.
For product intent, read [PRODUCT.md](PRODUCT.md); for UI rules, read [DESIGN.md](DESIGN.md). Start
development with [CONTRIBUTING.md](CONTRIBUTING.md).

## Layer ownership

| Layer           | Owns                                                                 | Entry points                                                                          |
| --------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Domain          | Serializable types, validation and pure decisions                    | `src/domain/contracts.ts`, feature directories under `src/domain/`                    |
| Desktop         | Filesystem and process authority, native access, persistence and IPC | `src/desktop/bridge.ts`, `src/desktop/ipc/`, desktop feature services                 |
| Preload         | The narrow renderer-to-desktop API                                   | `src/preload.ts`; `src/report-preload.ts` for the report window                       |
| Renderer        | User commands, sessions and presentation                             | `src/renderer/commands/`, `src/renderer/workspace/`, feature views                    |
| Native helpers  | Platform-specific file, preview and process integration              | Native helper sources under `tools/`, `src/desktop/native/`, `tools/build-helpers.ts` |
| Tests and tools | Reproducible fixtures, qualification and packaging                   | `tests/`, `tools/`                                                                    |

## Files and views

A **file entry** combines a path, metadata and stable identity. File operations check identity and
source version rather than trusting a previously displayed path. Native file permission belongs to
desktop services and can be revoked.

The [remote-plane proposal](docs/adr/0023-remote-planes-over-system-openssh.md) defines a **remote
location** as the raw internal string `viewer-sftp://<connectionID><absolute-path>`. It is not a
local path or a typed server address. `domain/remote/*` owns pure location, address, identity and
connection-record validation, limits and protected-path rules. Local access checks require absolute
local paths in every edition. Raw location guards protect shared services and definition-command
entry points before path resolution.

A **server connection** is a private saved SSH endpoint and its connection lifetime, distinct from a
local server listener. `desktop/remote/connections.ts` owns private saved records, state, window
authority, idle release and connection-scoped quiescing; `control.ts` owns explicit system OpenSSH
masters and their holders. `askpass.ts`, `native-prompts.ts` and the Swift relay attach native
secure input to the clicking window. `session.ts` owns one lazy `UtilityClient` for
`remote-worker.ts`, its SFTP channels and `lane-scheduler.ts`. `ssh-config.ts` reads host
suggestions only after the person's yes. `domain/remote/ssh-arguments.ts` builds every argv,
`domain/remote/ssh-errors.ts` classifies exits and `domain/remote/prompts.ts` words OpenSSH's
questions. Remote resources, server Trash and operation executors join this owner in later packages.
Existing Operations, Resources, Terminals and Trash retain their shared state and authority. SSH
planes are proposed for the direct build behind `VIEWER_REMOTE=1` until qualification; construction
never connects or writes a connection record. Connections and secrets stay outside editable JSONC
and agent authority.

`desktop/remote/sftp` owns the bounded SFTP v3 codec, duplex client, stream windows and listing-name
boundary.

A **plane** is a view record. Its engine route, framing and geometry belong to
`src/renderer/workspace/controller.ts`. A **root** is an independent spatial branch: preview reuse
is scoped to that root. Keep engine IDs inside the adapter. Where a new root opens, beside the
active plane, and that no root moves as others open and close, belong to
`renderer/workspace/root-placement.ts`, which the workspace surface installs on each engine.

Content-plane opening and reuse live in `src/renderer/workspace/content-planes.ts`; asynchronous
results keep their originating workspace. IPC dispatch lives in feature groups,
`src/desktop/ipc/*-handlers.ts`, each given only the services it needs. The desktop bridge still
validates the sender and window role, and owns window records and root quiescence.

Workspace definitions are resolved by `domain/workspaces/definitions`; `capture.ts` owns portable
capture and keeps command text desktop-owned. `desktop/workspaces/definitions.ts` owns live source
reloads and comment-preserving edits. `defined-workspaces.ts` privately remembers closed planes
outside session state, backups and agent discovery. `desktop/ipc/definition-handlers.ts` enforces
human and window ownership before close, reset, save and reopen. `renderer/state/definitions.ts`
owns the persisted renderer transitions; Manage is `ui/workspace/WorkspacesDialog.tsx`.

**Folder history** keeps up to 500 visited folders (`maximumFolderVisits` in
`domain/files/folder-visits.ts`, persisted on `SavedState.visits` in
`desktop/persistence/storage.ts`) beside the 50-item `recents` list.
`domain/files/folder-checks.ts`, `folder-visit-changes.ts` and `folder-history-remaps.ts` bound
candidate checks, visit deltas and concurrent rename remaps. `desktop/files/folder-history.ts`
prepares history and runs `BackgroundFolderHistory` outside the window startup barrier;
`desktop/windows/folder-history-checks.ts` shares two worker lanes and per-volume timeout quarantine
across windows. `renderer/state/folder-visits.ts` (`FolderVisitSync`) synchronizes unsaved visits,
remaps and eight-second **Undo Clear Recent Folders** across windows.

`domain/workspaces/found` owns root rules, candidate evidence, keys and plain found definitions.
`domain/workspaces/ownership.ts` indexes owning roots and workspace shares. The desktop
`workspaces/found-workspaces.ts` schedules bounded probes through FolderFacts and keeps the private
found cache and hidden roots; only the person's `workspaceDefinitionFile` requests hide or show one.
Workspace links record their definition source.

The **workspace offer** is `domain/workspaces/offer.ts`: the owning root for a folder and whether
opening it adds something. `domain/suggestions/insights.ts` words it as the `workspace.open` card,
`renderer/workspace/workspace-offer.ts` reads it for the folder in view, and the folder card and the
palette's Suggested section show it. `desktop/workspaces/offer-dismissals.ts`, owned by the
definition catalog, keeps its dismissals in a private file the catalog reports, never in
configuration.

- `domain/terminals/command-text.ts` validates command text.
- `domain/terminals/declared-commands.ts` parses bounded file declarations without execution.
- `desktop/workspaces/folder-facts.ts` owns scoped, prioritized reads and disposable probe threads.
- `desktop/terminals/declared-commands.ts` owns root walks, cache and private last-run references.
- `renderer/terminals/DeclaredCommandList.tsx` fills the command input from declared lines.
- `domain/terminals/definition-commands.ts` defines references and outcomes.
- `desktop/workspaces/definition-commands.ts` owns approved command starts.
- `desktop/workspaces/definition-command-lookup.ts` binds commands to owned panes.
- `desktop/actions/execution-confirmations.ts` owns native approvals and fingerprints.
- `desktop/terminals/terminal-start-input.ts` separates held input and terminal reports.
- `renderer/terminals/definition-command-session.ts` owns choices and reattachment.
- `renderer/terminals/start-authority.ts` drives panel UI state and automatic-start deferral.
- `renderer/terminals/command-focus.ts` restores focus after notice actions.
- `renderer/workspace/WorkspaceDefinitionCommands.tsx` owns the notice and Run all.

A **tour** is a `.viewer-tour.jsonc` definition (`domain/tours`, read and saved by
`desktop/workspaces/tours.ts`) of **stops**: files at an evidence anchor, with captions.
`renderer/workspace/tour.ts` plays it through a `TourStage` (`workspace/tours/stage.ts`), which only
travels; the player only opens files, found inside the tour's folder without links by the desktop.
The player is the only sequencer: on Plurid's anchors (0.0.0-43) the stage is `pluridStage`, which
hands the engine the pose and the motion, never the sequence.

A **fabrication check** (`domain/fabrication`, `desktop/fabrication/service.ts`,
`renderer/fabrication`) reads a laser job as an inventory of opaque refs, asks a model once at the
`images` data level, and grades the answer against Viewer's own DXF measurement and independently
extracted source requirements. A private **check document** persists its result, version-bound human
confirmations, correction and handoff receipts. Closing a check plane detaches a view; reopening
reads the document without another model request. Only explicit cancellation stops a running check.
The desktop validates current sources and corrected output before a `fabrication-handoff` transform
publishes the handoff through operations. SAM 3.1 runs on the reading model's provider, under the
same approval (`desktop/models/segmentation.ts`); its outlines do not verify dimensions.

An **explorer session** owns selection, cursor, range anchor, scroll and column trail. **Folder
presentation** is shared by path and owns view/sort/column choices. Navigation and operation
selection remain independent of camera input. The Columns preview's width is its plane's own
(`FolderPane.previewWidth`, `renderer/explorer/PreviewColumn.tsx`): saved with the workspace, never
with a folder or a project.

A **preview resource** is an authorized lease on a source or derived rendition. The desktop resource
owner checks versions, bounds work and releases dependent resources on cancellation or revocation.
Office layout uses a bundled sandboxed engine; Office content inspection is a separate bounded
saved-value reader.

Completed document data can outlive a view in `renderer/previews/document-cache.ts`, bounded per
window and keyed by workspace and validated source version. It retains no resource URLs or mounted
viewers. Every reuse follows fresh resource authorization; revocation invalidates pending and
completed matching data. Desktop extraction and in-flight deduplication remain desktop-owned. Parsed
3D models outlive a view in `renderer/previews/model/cache.ts`: CPU geometry only, keyed by path and
file version, bounded per window, forgotten on revocation; each preview builds and disposes its own
GPU geometry.

**Network sharing** belongs to the person alone. `desktop/files/network-sharing.ts` reads macOS File
Sharing state through fixed system tools, each stopped after about two seconds;
`networkSharingAvailable` is macOS outside the Store build.
`desktop/ipc/network-sharing-handlers.ts` refuses agents and requires folder access for each path it
inspects. `domain/files/network-sharing.ts` holds the snapshot types.

## Documents and runtimes

| Concept               | Lifetime and owner                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Scratch / text buffer | Private unsaved text, managed by `desktop/editing` and renderer editing sessions                                         |
| Note / checklist      | A revisioned private document independent of its open views; `domain/editing/notes.ts`, `desktop/editing/notes.ts`       |
| Task area             | A checkout context with durable tool references; `domain/workspaces/tasks.ts`, `renderer/tasks/controller.ts`            |
| Terminal              | A desktop-owned PTY plus a renderer xterm session; survives culling, ends when its view closes                           |
| Server                | A window-owned listener independent of its controls plane; restored stopped                                              |
| Browser               | An isolated Chromium guest rendered into a plane; `desktop` browser services and `renderer/browser`                      |
| Media draft           | Private versioned editing decisions; a transform publishes new output through operations                                 |
| Command receipt       | Private process evidence independent of the output view; `desktop/actions/receipts.ts`                                   |
| Conversation canvas   | Generated HTML, independent input state and immutable assets; `domain/canvases`, `desktop/canvases`, `renderer/canvases` |

Quote branches in `desktop/chat` capture context through an exact message passage and fork a linked
canvas. Applying content back checks the original revision and preserves its latest inputs.
`desktop/canvases/reconstruction.ts` owns durable fal generation requests, native confirmation and
GLB validation. The sandbox runtime uses the existing private web-preview capability service. See
[conversation canvases](docs/adr/0011-conversation-canvases.md).

Plugins own their application logic, including reused parsers, calculations and tests. Viewer owns
context capture, sandbox execution, shared actions, input persistence and revision management.
`domain/canvases/library.ts` defines management requests; `desktop/canvases/service.ts` lists and
configures the same documents. `renderer/canvases/ToolLibrary.tsx` presents them in a Plurid plane.
The runtime bundles generic Three.js modules, with no robotics solver or checker. The existing
robotics implementation is packaged by `tools/plugins/robotics` into an explicitly imported canvas
and code asset. Its source and retained experiment adapters stay outside the app's runtime
dependency graph. Those adapters are `domain/robotics` (re-exports of the plugin's `core/`),
`desktop/robotics`, `desktop/canvases/robot.ts`, `robot-check.ts`, `placement-check.ts` and the
robot and placement panels in `renderer/canvases`; only tests and `tools/robotics` import them. The
agent can extend that working plugin without starting from an empty canvas. See
[generated tool ownership](docs/adr/0015-generated-tool-host.md).

Different worktrees have different working files and indices. Two views of one checkout share those
files and staging. A view ID is never checkout identity. Cold restoration does not replay terminal
input, commands, agents or server starts.

## Commands and authority

A **captured target** freezes workspace, root, plane, directory and selection before asynchronous
work. Contextual commands, recipes and custom actions use it instead of reading a later selection.

A preview plane's command context carries its **subject**, the file it shows
(`CommandContext.subject`, set by `renderer/previews/PreviewHost.tsx` and passed on by
`renderer/commands/toolbar.ts`). `toolFiles` in `renderer/commands/target.ts` gives a file tool the
selection, else the subject, so a preview's pinned tools act on its own file.

A **command** is a contextual registry action. A **spoken request** is Ask Viewer by voice: its
transcript becomes a plan of registry commands, checked against the captured target
(`domain/command-line/spoken.ts`) and run through the registry (`renderer/command-line/spoken.ts`),
never a second executor; a command's `spoken` says how a plan names and awaits it. A **custom
action** is a declarative executor. A **recipe** prepares a reviewed file proposal. A **workflow**
composes typed inspection and proposals; a **watch rule** can prepare a review, not apply it.

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

## Interface

Shared controls live in `src/renderer/ui/`; a feature's own dialogs and panels stay with the
feature. `SpaceOverlay` (`renderer/workspace/tours/TourBar.tsx`) is the grid that holds the panels
over the space. [DESIGN.md](DESIGN.md) holds their rules.

Ordinary open/save dialogs and app notices use `renderer/dialogs/DialogHost.tsx`. Their desktop
owner is `desktop/native/window-dialogs.ts`, attached to each window by the bridge. The native
dialog facades retain sandbox bookmark panels, explicit system-picker fallback and protected
approvals. [Window-owned dialogs](docs/adr/0012-window-owned-dialogs.md) records the boundary.

| Control                         | Owner                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `Disclosure`                    | `renderer/ui/Disclosure.tsx`; base.css draws every summary, `disclosure.css` places each variant |
| `Button`, `Row`                 | `renderer/ui/primitives.tsx`; base.css styles the button kinds and the shared row edge           |
| `CopyButton`, `PathField`       | `renderer/ui/primitives.tsx`, copying through the clipboard helpers below                        |
| `PathLabel`, `PathHome`         | `renderer/ui/PathLabel.tsx`; `domain/files/path-label.ts` fits a path, home as `~`               |
| `FormField`, `FileNameField`    | `renderer/ui/`; `form-fields.css` lays out output forms, labels above fields                     |
| `DestinationField`              | `renderer/ui/DestinationField.tsx`: a folder's name, its path label and Choose…                  |
| `FileName`                      | `renderer/ui/FileName.tsx`: a name loses its middle and keeps its extension                      |
| `NumberField`                   | `renderer/ui/NumberField.tsx`: a text field with no spin arrows                                  |
| `ChoiceButton`, `MenuButton`    | `renderer/ui/ChoiceMenu.tsx`, with `SegmentedControl`; the renderer has no native `<select>`     |
| `useListKeys`                   | `renderer/ui/useListKeys.ts`: Finder's keys for a list in a dialog or a panel                    |
| `Panel`, `PanelSection`         | `renderer/ui/Panel.tsx`; what holds a panel places it, such as `SpaceOverlay`'s grid             |
| `Popover`, `useAnchoredLayer`   | `renderer/ui/Popover.tsx`; `ChoiceMenu` and `ContextMenu` place their layers with the hook       |
| Type, spacing and shadow tokens | `renderer/styles/base.css` `:root`, checked against DESIGN.md by `tests/design-tokens.test.ts`   |

The clipboard helpers in `renderer/state/ui.ts` own copying text: `copyPaths` sends paths through
the desktop pasteboard (`window.viewer.copyPaths`), `copyText` other text through the clipboard.
Both read the file clipboard again, as copied text replaces a copied file. Features call them, or
`CopyButton`, never `navigator.clipboard.writeText`.

The **plane header**'s controls are `ui.space.headerControls`, one key each. Their Essential and
Full presets and the version 4 migration that started every profile from Essential belong to
`domain/preferences/header.ts` and `ui.ts`. `renderer/workspace/PlaneHeader.tsx` reads the window's
effective preferences, so profiles and workspaces reach it; `renderer/workspace/header-overflow.ts`
measures the header and spills ranked items into **…** (`spillHeader`, `useHeaderOverflow`).

A new profile's **first-run tips** are `ui.firstRunHint` (`domain/preferences/first-run.ts`). Only
the desktop settings service starts them, for a configuration with nothing before it;
`renderer/explorer/FolderInsights.tsx` shows them, and the palette and Quick Preview record their
steps through `renderer/state/preferences.ts`.

**Shortcuts** belong to `domain/preferences/shortcuts.ts`. Settings saves only the keys a person
changed. `resolvedShortcut` gives the key in effect: a shipped key the person gave to something else
is left to theirs (`shippedKeyHolder`). The desktop refuses to save two bindings on one key
(`shortcutClash` in `desktop/preferences/settings-schema.ts`). `desktop/windows/application-menu.ts`
and `renderer/explorer/input.ts` read the same resolution.

## Persistence and decisions

Shared configuration is validated JSONC. A **setting profile** is a presentation overlay, distinct
from an application data profile and from authorization. Window-local resolution and shared folder
presentation have separate precedence.

**Update checks** belong to `desktop/updates`: one feed (`domain/updates/feed.ts`), read only after
its Ed25519 signature matches the key in `desktop/release.ts`. A check never downloads or installs;
Download opens the https disk image in the browser. The Store edition never checks.

**Diagnostic reports** (**Help → Copy Report…**) belong to `domain/diagnostics` and
`desktop/diagnostics/report.ts` (`diagnosticReport`, `reportLimits`). The default report projects
bounded environment facts and up to 20 recent failures from `Logs/diagnostics.log` with no message
text or personal file names; optional excerpts pass through `domain/diagnostics/report-redaction.ts`
after local account, Home, host and `/Volumes` checks in both editions.
`desktop/windows/report-window.ts` and `src/report-preload.ts` present the report in an isolated
window whose preload exposes only revision-bound option, display-acknowledgment, copy and close
events, never a log reader.

**License keys and trials** belong to `domain/license` and `desktop/license`. The domain owns the
payload, status and 30-day clock arithmetic; the desktop verifies exact-byte Ed25519 signatures and
stores `license-v1.json` in `userData`. The record retains the earliest start, latest observed time
and key, never a paid flag. Unreadable files are preserved for recovery, and a key this build cannot
verify stays saved. Status reads checkpoint only key or visible status changes or an hour of clock
advance. Both fields of `licenseConfiguration` in `desktop/release.ts` ship empty; incomplete
configuration, the Store edition and headless CLI/MCP runs have no license UI or record. Settings
alone may enter or remove a key. `renderer/app/LicenseReminder.tsx` shows the ended-trial bar; its
per-launch hidden state belongs to the desktop process. `tools/license-key.ts` issues keys without a
server and keeps the private key outside the repository. Release and issuance checks reject partial
or invalid license configuration. See the
[offline license decision](docs/adr/0016-offline-license-keys.md).

`CURRENT_STATE_VERSION` in `domain/contracts.ts` and the migrations in
`desktop/persistence/storage.ts` are authoritative for saved-state versions. Durable save barriers
coordinate document and window shutdown; invalid files and migration inputs are preserved for
recovery.

Read the [architecture](docs/development/architecture.md),
[configuration](docs/reference/configuration.md) and [ADRs](docs/adr/README.md) before changing
ownership. Run [affected checks](docs/development/testing.md). Routine native verification uses
isolated hidden windows and generated files.
