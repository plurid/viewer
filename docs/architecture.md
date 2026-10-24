# Architecture

The active application is `packages/viewer-electron/app`. The 2021 predecessor (`old_app`) and what it offered are recorded in [old-app.md](old-app.md); its source is in git history at commit `bd198da`.

`src/domain` owns serializable file, operation, preview, and workspace contracts. It has no Electron or React dependencies. `src/desktop` implements filesystem access, resource capabilities, shared watchers, cancellable search, transfer jobs, and atomic persistence. `src/preload.ts` exposes a fixed typed bridge; the sandboxed renderer never imports Node or Electron. Each IPC method validates its arguments, origin and sending main frame. Arbitrary channels, remote navigation and renderer network access are unavailable.

## Feature ownership and dependency direction

Modules are grouped by the domain concept they own. `domain/contracts.ts`,
`services.ts`, `schemas.ts`, `definitions.ts` and `errors.ts` remain shared
foundations; feature implementations do not hide behind a new catch-all barrel.

| Feature                      | Pure domain rules                                               | Desktop authority and I/O                                     | Renderer adapter                                                                      |
| ---------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Preferences and presentation | `domain/preferences`, including `presentation` schemas/resolver | `desktop/preferences`; `windows` for native appearance        | `state/effective-ui`, pure `state/folder-presentation`, `ui/settings`, `ui/workspace` |
| Files and native metadata    | `domain/files`                                                  | `desktop/files`, `desktop/native`                             | `explorer`, `ui/inspection`, `ui/permissions`, `ui/navigation`                        |
| Mutations and review         | `domain/operations`                                             | `desktop/operations`, `desktop/actions`                       | `ui/operations`, command registry                                                     |
| Agents and model data        | `domain/agents`, `domain/models`                                | `desktop/agents`, `desktop/models`, `desktop/chat`            | `ui/agents`, `ui/models`, `chat`                                                      |
| Comparison and search        | `domain/comparison`, `domain/search`                            | `desktop/comparison`, `desktop/search`                        | Comparison/search planes and commands                                                 |
| Workspaces and automation    | `domain/workspaces`, `domain/automation`                        | `desktop/workspaces`, `desktop/automation`, `desktop/windows` | `workspace`, `commands/window-commands`, feature dialogs                              |
| Editing and previews         | `domain/editing`, format groups under `domain/previews`         | `desktop/editing`, `desktop/previews`, `desktop/workers`      | `editing`, `previews`, preview modules                                                |
| Persistence and transport    | `domain/persistence`                                            | `desktop/persistence`, `desktop/ipc`, `bridge.ts`             | Typed native API, state persistence barrier                                           |
| Terminals and diagnostics    | Shared contracts only                                           | `desktop/terminals`, `desktop/diagnostics`                    | `terminals`, status/recovery surfaces                                                 |

The `ui` root keeps reusable primitives, menus, icons, theme and projected resize
helpers. Business dialogs live in feature folders. Worker source entries in Forge
follow their owning feature; output basenames stay stable. The permanent-removal
ESLint exception names only `desktop/operations/removal.ts`.

`tools/architecture/imports.ts` and `tests/architecture.test.ts` enforce the layer
boundaries and reject runtime initialization cycles. Domain modules may not import
Node, Electron or React; renderers reach desktop services through the typed preload
API; desktop services do not import React. Pure folder resolution and the
persistence-request adapter keep state initialization acyclic.

The preload exposes frozen `viewerNative` methods. `renderer/native-api.ts` installs the public `window.viewer` API before application bootstrap; `api-boundary.ts` reconstructs cloneable failure envelopes as renderer Errors. Worker replies preserve OS error codes, and preload sends plain message/code data because Electron drops custom properties on bridged Error objects. Success values, synchronous drop-path helpers, callbacks and event cleanup retain their contracts. [Electron context-bridge type rules](https://www.electronjs.org/docs/latest/api/context-bridge).

`desktop/files/file-access.ts` owns private native picker bookmarks in MAS mode. JSONC paths and agent grants never confer OS permission. Readers, resource grants, transfers/Undo, actions and agent authorization acquire/check canonical scopes through this boundary; shutdown releases them after work drains. Direct builds retain unrestricted native filesystem behavior and perform no bookmark I/O. `FileServices` uses main-process Node threads for Store readers/indexing and sizes, while direct builds retain utility processes. `worker-port.ts` adapts the transport, and bounded PDF data reaches the inheriting OCR helper over stdin. Store signing/profile checks and generated entitlements live in `tools/mas*.ts`; public identity lives in `mac-app-store.json`. Actual App Sandbox compatibility still needs the signed development gate in [mac-app-store-build.md](mac-app-store-build.md).

`desktop/native/native-selections.ts` binds revoked clipboard/drag roots to each native pasteboard generation. Focus or menu discovery cannot restore revoked access from an unchanged selection. A new native copy/drag or an explicit picker grant can authorize access again. Revocation reads only the pasteboard generation, without reading or changing its contents. Denied roots remain bounded, and unavailable generation metadata fails closed. Each in-flight import retains its captured deny set, so a later copy cannot make the older import valid.

File-access authorization rechecks the live scope after canonical filesystem reads finish. Revocation and shutdown invalidate pending native imports; a released scope cannot approve an old caller after revocation has completed. A separate, explicitly authorized parent remains a valid capability. Settings alone exposes the revocation IPC method; tests use that real window boundary rather than adding a privileged test API.

`desktop/previews/preview-work.ts` tracks bounded in-flight preview requests and invalidated roots while canonical paths resolve. Root cleanup purges only affected resource IDs, archive children, companion assets, streams and thumbnail cache entries; independent previews remain usable. Completion waits for canonical invalidation checks, so a late alias resolution cannot publish stale bytes. File-access events carry affected IDs for alias-backed previews. `PreviewHost` aborts and unmounts affected viewers immediately, disposing decoded text, media and GPU state, and retries owned paths after cleanup completes. Full shutdown still drains every request and stream.

`src/renderer/explorer` owns navigation, path-based selection, virtualized views and shared folder subscriptions. `src/renderer/commands` owns the typed registry, availability, ranking, command palette and destination step. Folder sources supply current selection and directory; window sources supply navigation, workspace and application commands. Searchable context menus capture the clicked target or multiselection. Invocation rechecks source lifetime and availability, retains the captured targets, and refreshes jobs and live folder preferences. Paste refreshes native clipboard files strictly; focus/menu discovery clears stale clipboard state quietly, so denied external items cannot block unrelated commands. Recent command IDs persist without targets; the first two applicable actions also appear as shortcuts with distinct row IDs while retaining their normal placement. Search ranks each underlying command once. Text-focused native Edit commands use a narrow preload method instead of file actions.

`src/renderer/workspace` adapts host pane records to Plurid routes and handles. Engine arrangement state is independent of file state. A synchronous memory storage adapter is hydrated before Plurid mounts and mirrored through the main process. Workspace switches and orderly shutdown flush both layers. Closing a parent removes its linked host branch; bounded in-memory records permit arrangement undo and redo. The active pane is restored separately in each workspace. Workspace deletion calls no filesystem service: it removes only the saved workspace and its adapter, retains one session recovery record, and creates an empty replacement when necessary. Jobs remain window-wide. Recovery preserves any work added to the replacement.

## Saved state and profile migration

Optional `SavedState.ui` preferences retain their separate version **3**. Core saved
workspace state uses **7**, declared by `CURRENT_STATE_VERSION`. Storage reads
versions 1–7: version 2 added virtual searches, 3 terminal/navigation state, 4
projects, 5 scratch and unsaved preview buffers, 6 comparison/Git/Chat planes and
window presentation, and 7 window-local presentation overlays.

Before returning a migrated version 1–6 document, Storage writes its untouched
bytes to an exclusive mode-0600 `.before-profile-overlays-v7-<uuid>.bak` sibling and
syncs the file and containing directory. Earlier navigation/project/plane backups
remain where applicable. A backup failure propagates without quarantining or
replacing a valid layout. Unknown newer/corrupt state is preserved with a recovery
notice; valid workspaces may be salvaged without treating damaged data as writable.

`desktop/preferences/profile-migration.ts` plans restoration of the old globally
applied profile values. It only restores a field when the current canonical value
still matches the old profile's applied value. Newer edits, ambiguous window values,
missing definitions and unsupported fields are retained with diagnostics. The
bridge adopts the returned state only after its revisioned configuration patches
succeed. The original previous-value records remain available when restoration
cannot be safely completed.

Whole-state migration precedes UI normalization. Old layouts enable each existing
folder sidebar, retain its width and hide window navigation once; later versioned
choices survive reload. Each malformed optional preference falls back independently
so that it cannot discard otherwise valid workspaces.

Optional `FolderPane.sidebar` holds only local width/visibility. The same Sidebar component renders window and plane navigation, sharing order, aliases, Favorites and folding while retaining independent sizing and visibility. Plane headers expose navigation directly; new folder planes default to visible navigation, while the optional window sidebar defaults hidden. Pointer resizing inverts the projected sidebar rectangle once at gesture start, handling spatial zoom, rotation and perspective without layout reads during movement. Narrow planes cap navigation at half the content width. Async path resolution captures workspace and pane ownership before stat; switching the active pane cannot redirect that navigation. Sidebar drag payloads describe shortcuts and section order; they are separate from file-transfer payloads. Adding a folder to Favorites uses a read-only stat and updates saved navigation only. The operations control is derived from pending/conflicting jobs and unacknowledged failures; history is explicitly opened through Commands or the native menu.

Folder selection uses a path index and an identity index with an explicit ambiguous marker. Exact-path identity checks and unique-identity rename reconciliation are linear in the listing and selection; ambiguous replacements clear. Selected-row membership uses Sets, and sort memoization depends on sort fields rather than the whole mutable pane. Command sources cache definitions by source revision, with scoped header subscriptions. Command mode mounts no file finder, folder subscription or search hook. File mode ranks lightweight entries before constructing at most 150 result commands. Pointer hover changes the active action without scrolling; keyboard movement and query changes own menu scrolling.

`explorer/selection.ts` owns file selection independently of Plurid selection. Cursor and range anchor are separate session fields; extending and reversing a range does not infer its endpoint from selected-path order. Folder and search surfaces handle file keys in React capture before engine bubble listeners. Header range keys route to the owning file session. Editable controls, dialogs and embedded previews retain their own input. Blank file-space clicks clear cursor/anchor/selection, and background context menus capture an empty file target set.

`explorer/column-navigation.ts` keeps the column trail, active keyboard scope and operation directory in the same browse session. Loaded columns register their entries; selection reveals the next folder, Left/Right traverses the visible branch, and removed listings prune cached descendants and selection. These fields survive Plurid detachment and participate in path remapping. Paste refreshes the clipboard before command availability is resolved; native invocation retains its original target while refreshing clipboard data. `explorer/file-drop.ts` shares target resolution, imperative hover feedback and edge scrolling across folder and search views, delegating mutations and conflict handling to the existing operation service. `drag-navigation.ts` owns bounded hover/animation lifecycles and stale-result checks. `folder-drag.ts` adapts temporary traversal to the existing pane/session, validates native access through stat and restores cancelled navigation. Temporary history stays valid for persistence; a successful drop records one final history entry. Column traversal preserves its root and uses captured-path session transitions.

`domain/preferences/list-columns.ts` defines shared field defaults and width bounds. Additive `ui.list` and `ui.space.headerControls` preferences normalize older state without discarding layout. `explorer/FileTable.tsx` gives folder/search headers and virtual rows one grid and horizontal viewport. Pointer resizing changes CSS variables and commits preferences only on release. Wrapped rows use stable path keys and measured heights; changing wrapping/density clears obsolete measurements. Manual rename delegates applicable recipes through a captured registry command into the ordinary action setup/review path.

`explorer/anchors.ts` registers virtual-view reveal callbacks by host pane ID. Opening captures the workspace/root/source before awaiting reveal, then revalidates that ownership. The public spawn topic receives the source selector; Plurid measures it inside the parent plane. The reading bridge preset opens linked children at 90.1° relative to their parent, while persisted manual arrangements remain independent. Spatial preference synchronization coalesces engine emissions into a microtask: publishing preferences reentrantly between a mode change's reducer actions could restore the previous mode.

`desktop/files/folder-sizes.ts` performs explicit read-only logical-size scans in its own `folder-size-worker` utility process. Starting a measurement never waits for SQLite initialization, indexing, recursive watching or document extraction. It streams directory entries, bounds metadata concurrency, shares identical running selections, limits active scans to two and retains at most 64 task snapshots. Ancestor pruning prevents selected descendants from being counted again. `lstat` counts symlink entries without traversing targets; no file contents are opened. Cancellation stops new work after any pending filesystem call returns. Worker exit terminates tracked task state instead of leaving indefinite progress. The renderer's separate scoped store immediately publishes pending progress, shares in-flight starts, handles cancellation before the native acknowledgement, reports failed starts, guards late running replies, records partial results and timestamps, and invalidates overlapping measurements after observed changes. This is not disk-allocation accounting or a filesystem snapshot.

`desktop/native/applications.ts` uses a packaged macOS NSWorkspace helper to discover applications compatible with all captured targets. Discovered bundles and native-picker choices are canonicalized into opaque IDs; the renderer cannot provide an executable path. Opening revalidates the registered bundle and selected paths and passes literal arguments to `/usr/bin/open`, in bounded batches. The searchable fixed-height dialog retains captured targets through discovery and launch, and has loading, empty, disabled, failure and cancellation states. Non-macOS discovery reports unsupported until a native adapter exists. It changes no default association.

`src/renderer/previews` owns the preview registry and modules. A preview receives an opaque, scoped resource handle and bounded read/stream methods. Heavy viewers are loaded only when needed. A module cannot reach into explorer or engine state. Quick Preview supplies one footer through the host's render slot, combining metadata, file navigation and open actions without a second external-open icon. Its default-open control resolves the native application name only when mounted; a small, short-lived cache shares discovery. Opening still uses the live OS association. Local companion assets resolve inside the model's directory scope. The resource protocol rejects traversal and escaping symlinks, uses descriptor-based streams and refuses special files. Resource responses have a sandbox CSP and never render executable documents. EPUB uses bounded local extraction and a sanitized reader; image grids request bounded native thumbnails instead of decoding every original. See [preview-modules.md](preview-modules.md) for the extension contract and resource ownership.

File commands become serial jobs in the desktop process. Selected ancestors prune descendants through Set membership and path-parent walking while retaining source order and path boundaries. Progress is throttled across the entire job at 80 ms, including between small files. Sequenced `job-progress` events carry counters, current path and error count; queued/running, collision/resolution, terminal and undo transitions send complete authoritative jobs. The renderer rejects stale revisions and resynchronizes unknown jobs or sequence gaps through the jobs endpoint, retaining full completed/error inventories. Collisions wait for a decision; replacements go to native Trash. Exclusive work (Undo, plan application, agent changes, Trash restore) waits for the queue to drain; an Undo, which names the paths it changes, may instead run while the current job waits at its prompt when no pending job involves those paths, and no job moves on until it ends. Transfers preserve symlinks, stage writes, publish exclusively, support cancellation, and report completed and failed items separately. Cross-volume moves validate the source tree again before removing it. Native macOS copying preserves modes, extended attributes, resource forks and ACLs and fails rather than discarding unsupported metadata. Journaled Undo checks current identities/content manifests and native Trash receipts before restoring or removing anything; arrangement undo belongs to the engine. See [file operations](file-operations.md) for eligibility, recovery and archive limits. Full cloud/file-provider coordination remains a separate engineering and native-acceptance gate.

## Plurid integration

The implementation was informed by the sibling `technologies/tools/plurid` source and application patterns in `applications/containers/plurid-com/frontends/web/products/cores/dechat`. Viewer uses the direct named `PluridApplication`, typed public handles and the spawn-plane topic. The registry release pinned by `tools/plurid-release.json` (React `0.0.0-42`, data `0.0.0-28`, engine `0.0.0-25`) includes click-to-scroll. For local Plurid development only, `pnpm plurid:sync` builds data/engine/React without cleanup, copies the generated packages into the installed dependency graph and records source provenance; qualification rejects that overlay, and reinstalling dependencies restores the registry packages. Linked creation uses `SPACE_SPAWN_PLANE` with parent identity and `framing: 'none'`, so framing stays host-owned.

`WorkspaceSurface` sets `space.gestures.wheel: 'click-to-scroll'` and reapplies it after engine configuration restoration. Plurid captures wheel input before native preview and terminal handlers: hover navigates the workspace, while a primary click gives one plane its ordinary wheel input. The ephemeral engine UI owner is separate from Viewer's active command target, file selection, spatial multi-selection, persistence and arrangement history. Plane chrome receives `scrollSelected` for a subtle header tint. Background click/Escape release it; docking activates it. Explicit navigation gestures retain priority. Quick Preview lives outside the engine View and retains its own input and interactive defaults.

The installed release also exposes handle APIs with remaining adoption work:

| Viewer today                                                                                                                                              | Available handle API                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `renderer/state/persistence.ts` `flushState` dispatches a synthetic `pagehide` to force Plurid's save, which also runs every other `pagehide` listener    | `handle.persist.flush()`; `flushState` has no handle today, so the workspace adapter must pass one in |
| Some `workspace/controller.ts` operations still bracket changes with `historyBegin`/`historyEnd` dispatches; linked-plane closing already uses the handle | `handle.history.transaction(work)`, which also closes the step when the work throws                   |

Authored arrangements (saved-layout restore, split, Size & position) are exact `restoreArrangement` writes. `setTree`, and `handle.tree.set` with it, reconciles against the live tree, which keeps every plane already pinned at its previous pose and size; a restore therefore did not move planes an earlier restore, drag or preset had pinned. Planes outside a restored arrangement are closed in both layers, so their records do not linger unseen, and arrangement Undo restores them.

`Size & position` commands act on an existing captured workspace/plane, without creating roots. A shared catalog in `domain/workspaces/plane-layout.ts` supplies fractions and alignments to the native menu and renderer registry. The controller authors manual geometry through the same exact arrangement restore and history brackets used for folder pairs. Fraction sizes include the common 12px tiling gutter; independent width, height and alignment operations compose in the camera's shared natural-scale grid. Other planes retain their authored geometry, and file sessions remain untouched. Move/Resize select one plane, enable the corresponding host preference, clear camera transform/grab modes, and use Plurid's existing title drag and resize handles. Presets release docking and pending automatic framing; ordinary storage and Undo/Redo retain the result.

`View side by side` and `View stacked` create one independent root at the captured folder's exact path and arrange it with the source in equal halves. Each invocation creates a fresh copy; history, selection and scroll remain local, while presentation stays shared by folder. The adapter registers the root through the synchronous view topic and authors manual sizes/placements with an exact `restoreArrangement` write, bracketed by the existing history actions. Ordinary `setTree` reconciliation preserves previous manual geometry, so it cannot author a new split of an already pinned plane. The pair sits in front of existing sheets and receives one measured, face-on, natural-scale camera placement across the full canvas width. Only the bottom toolbar reserves space; minimap and viewcube overlays do not narrow the pair. Resetting only scrolled engine wrappers prevents menu focus restoration from clipping headers. These commands do not retain a viewport layout mode or pair relationship. Normal workspace storage and arrangement Undo/Redo own their lifetime.

Registered routes and the `view` array retain stable identities. `WorkspaceController.newRootFolder` synchronously reserves a fresh host folder/root, copies the originating folder’s view preferences and initializes independent history. The declarative root list merges additions with the live engine tree; no second imperative view mutation races React or duplicates a root. Captured workspace/pane ownership rejects stale invocations. Window plus, Command-N, Commands, native menu, plane actions and shortcut actions share this path. Live configuration sizes automatic planes to the available surface while manual resizing remains an engine concern. A host preference subscription reconciles restored engine configuration with current UI preferences, including deferred measured-tree hydration. Workspace navigation disables the engine's shared URL docking state, so one workspace cannot restore another's plane. The shell and engine receive one dark/light look. Only the plane title is a drag handle: its capture handler selects an unselected plane before the engine's gesture listener, so the first press moves that plane; an already selected plane preserves multiselection. Chrome buttons and content retain their own gestures. Model canvases isolate gesture initiation from engine controls while allowing move/up events to reach Three's document listeners. Plane backs are always visible; title dragging, headers and resizing default on. Native minimap navigation uses single-plane framing even for linked children, and its click capture binds the host active pane without issuing a competing camera tween. Restored engine configuration cannot override these two invariants. The native toolbar, minimap and viewcube default on with independent Settings switches; transform origin defaults off. Transform commands read and publish the engine's mode, shared with the native toolbar and Escape. Offscreen previews pause or dispose through engine culling, with models rendering only when dirty or animated and media pausing when inactive.

One contextual plane header exposes navigation, view, search and frame/dock; narrower headers keep spatial actions in the registry. There is no global plane-tab toolbar or footer. Preview controls use a host-supplied header slot; the engine's duplicate dock rail and palette are disabled. Normal opening reuses a normalized path/type within the originating root, using live tree ownership plus pending spawn reservations, synchronously reserving host records to make rapid repeat events idempotent. Existing links and positions are retained; explicit Open in another plane bypasses reuse and creates an independent root; pending ownership points to itself. Saved duplicate records are preserved until explicit recovery. `Consolidate repeated previews` closes only automatic leaf previews with the same normalized path and parent, excluding manually positioned views, shared host IDs and `PreviewPane.keepSeparate` copies. Exported engine history grouping actions make the edit one undo step; bounded closed host records restore both layers on undo. New planes use single-plane `camera.frame` by default, giving a face-on view; Settings may choose linked-pair framing or docking. Framing waits for resolved engine layout, the public inspected viewport to match the surface, and live DOM plane measurements to match stable engine boxes. It uses `camera.frame`, `camera.fit` or the public multi-plane frame topic. Resize refits only the camera position last owned by that framing request; manual movement cancels ownership. Restoration uses the same measured readiness check, keeping a fully visible active plane's saved camera verbatim and framing only a clipped/offscreen active plane. Plane locations also participate in the settling signature. Public inspection/snapshot seams supply viewport, grab and transform state. Host filesystem records, selections, jobs, resources and preferences stay in their own store. Browser storage is not the persisted source of truth.

Preview modules receive an optional command capability with `register()` and a header element. Commands have stable module-local IDs, availability and handlers; the host adds preview scope, resource/pane lifetime checks and cleanup. `PreviewToolbar` uses the header slot in a spatial plane and an inline toolbar in quick previews. Modules do not import the registry, explorer or engine.

## Service boundaries

`desktop/previews/web` shares one bounded static-folder reader between offline
HTML capabilities and explicitly started loopback HTTP servers. HTML documents
use `viewer-html:` frames with an opaque sandbox origin; native navigation and
request policies prevent page scripts from borrowing Viewer resources or network
access. The sandboxed page has no preload API. `desktop/ipc/web-handlers.ts` binds
server actions to the sending window and resolves external URLs by owned server
ID. Folder and alias identities, per-read access checks, response budgets and
owner/revocation shutdown remain service responsibilities.

`renderer/local-servers` keeps runtime sessions outside React mount lifetimes.
Only an explicit command or Start action starts a listener. Saved server panes
hold folder identity, while URLs, ports and bounded logs remain runtime state.
The server plane is a linked child of its source folder; culling pauses log
polling, while explicit plane removal disposes its native listener. See
[HTML previews and local servers](web-previews.md).

Every IPC method has a schema, a handler and an allowed window in `desktop/ipc/schemas.ts` and `bridge.ts`: `ApiHandlers` and `methodWindows` are typed over every method, so a method without a handler or a window decision does not compile. Credentials, agent clients and folder revocation run only from Settings; file changes and workspace state only from the workspace window.

All application code (main, preload, renderer and domain) compiles with `noUncheckedIndexedAccess`: an index into an array or record may be missing, so code handles that case rather than assuming it. Tests and build tools do not use the flag yet.

`SettingsService` is the authoritative revisioned preference document shared by the Viewer and modeless Settings windows. Patches merge independent field edits and reject stale overlapping edits. Renderer writes are serialized; native close/quit asks Settings to commit its focused field and drain queued writes before flushing metadata. The Settings IPC role cannot invoke file mutations or read file resources.

Native Quit shares the in-flight window save handshake and keeps the IPC bridge alive until Electron closes all windows. Service disposal starts in `will-quit`, with guards against activation, second-instance events or Settings reopening during shutdown. Native window Close saves without disposing services, allowing macOS activation to reopen Viewer. Disposal is idempotent and waits for every service's cleanup, including journaled file mutations. Each read-only utility worker's shutdown rejects pending reads, allows two seconds for its index/cache checkpoint or scan cancellation, then bounds termination to one additional second. Only those owned workers may be force-stopped. Quit with file operations in progress asks first (`askNatively` in `before-quit`): wait for them, then quit; cancel them and quit, which waits for them to settle (completed items stay; a partial transfer's temporary copy goes to the Trash); or keep Viewer open. Metadata writes drain before shutdown; a missing renderer acknowledgement rejects after the bounded flush deadline and keeps Close from succeeding.

`FileServices` owns independent restartable indexing and folder-size utility processes through `UtilityClient` until terminal shutdown; late calls cannot restart either after service disposal. `index-core.ts` implements SQLite/WAL with FTS5 trigram filename/document-text search and bounded result pages. Worker configuration, crawling, shared watching, document extraction and cancellation stay outside the renderer. Content-grant revocation clears stored text immediately; generation checks discard late extraction. `formats.ts` handles bounded PDF/EPUB/plain-text evidence and the packaged local macOS OCR helper. Search roots and exclusions are rechecked at query time, including cached/offline records. `SearchExplorer` is a virtual root using the same file commands, dialogs, recipes and preview ownership as a physical folder.

`ActionPlanner` captures `ActionContext` and creates typed proposals using local transformations or provider output. Provider output is validated against source IDs, paths and evidence before review. Apply requires an exact revision and explicit rows, uses the ordinary operations lock, checks sources again, journals transition intent and publishes exclusively. Recipe Undo is a separate transaction that rechecks every completed file and applies the reverse plan at once; recovery creates a separate proposal that waits for review. A plan's step log is private recovery data, removed once the plan is recorded as settled; an unreadable one is set aside (`.unreadable-<time>`) and its plan kept in recovery, rather than stopping Actions from loading. Summary input identities survive restart and are rechecked before export/application. Actions expose progress through bounded snapshots; reviewed rows are virtualized.

`providers.ts` adapts OpenAI, Anthropic and compatible local endpoints behind one structured proposal interface. Keys use Electron secure storage only on explicit credential storage/use. `AgentBroker` uses an app-owned mode-0600 local token without Keychain, canonical folder grants and reviewed command/configuration proposals. Every command needs fresh approval; saved execution/write grants cannot bypass it. Terminal output requires a separate read grant. Its socket is mode 0600 in a private temporary directory. `mcp-client.ts` implements the packaged executable's headless stdio client; the UI process remains the service and approval owner.

`desktop/agents/agent-access.ts` makes private `agent-access-v2.json` the
shared connection's only authority. Configuration intersects with and can narrow
that approval; importing or re-enabling JSONC cannot widen it. Legacy version-1
records require reapproval and grant nothing. Settings-only positive changes bind a
single-use native review to canonical identities, configuration revision and
approval generation, then recheck them before publication. Unreadable authority
fails closed and is preserved before an explicit review replaces it. Named client
credentials, native file scopes and model data permissions remain separate.
See [ADR 0002](adr/0002-private-agent-authority-v2.md).

`model-permissions.ts` owns private user consent for a provider signature, canonical endpoint and data level. `Providers` checks it before each model-data request; configuration reconciliation, credential removal and explicit revocation cancel/invalidate requests. Renderer disclosure collects approval before transmission. Agent/configuration proposals cannot confer this permission.

`file-access.ts` owns persistent native picker grants and bounded session grants from native clipboard/drag objects. These are distinct from agent application grants and from the private one-item Trash Undo lease. It checks canonical containment, denies immediately during revocation and releases scope only after services quiesce. `macos-files.ts` is the typed boundary to the native pasteboard, mount inventory/eject, metadata, exclusive rename and Trash-receipt addon.

`operation-journal.ts` validates durable private mutation intent and guarded Undo receipts. `staging.ts` owns private temporary directories and protects cleanup against replaced roots. `archive-jobs.ts` performs bounded ZIP creation and safe ZIP/TAR extraction inside the ordinary job lifecycle. `document-store.ts` bounds private reads, rejects symlink metadata, serializes atomic writes and syncs the containing directory after publication. Pending intent at relaunch becomes reviewable recovery rather than automatic replay.

`workspace/sessions.ts` keeps selection, filtering, anchors, cached entries and scroll outside culled React components. Shared folder data has one watch/load subscription per normalized path, bounded idle caching and coalesced refreshes. A reload that fails keeps the listing it had under its error, unless the folder is gone or needs access again, and a failed watch is reported without hiding a listing that loaded. File-change batches apply a simultaneous longest-ancestor path map to panes, histories, navigation and sessions, preserving rename cycles and path boundaries. Preview state keys use host/resource identity for image pan/zoom, PDF page/zoom and model wireframe. Model cameras, media position and every module's state are not yet durable across culling.

`text-files.ts` opens previewed text for editing and saves it: the first save of an editing session through `Operations.writeText`, which moves the replaced version to the Trash with Undo, later ones over that session's own last save. `text-buffers.ts` keeps unsaved text, one private `DocumentStore` per buffer in `text-buffers/`, removed only through `removePrivateData` when a person saves or discards it. The renderer keeps its copy in `editing/buffers.ts`, written half a second after typing stops and at every flush; at launch, a buffer no plane holds comes back as a plane (`editing/unsaved.ts`). Their IPC methods (`textOpen`, `textSave`, `textSaveAs`, `textEditEnd`, `textPrompt`, `bufferList`, `bufferRead`, `bufferWrite`, `bufferDiscard`) are the workspace window's.

These services are in-repository extension points; they are not a third-party plugin sandbox. [actions.md](actions.md) and [search.md](search.md) document their permissions, limits and user flows.

`desktop/files/directory-watch.ts` owns watch lifetime and closes failed backends immediately. Open folder planes share shallow native directory watches; macOS and Windows indexing use native recursive directory watches. macOS uses FSEvents rather than opening each descendant file. Linux retains the Chokidar recursive fallback pending native-backend acceptance. `index-watch.ts` coalesces changes into serial reconciliations, prunes redundant descendant events and collapses more than 512 pending paths per root into a subtree rescan. Missing filenames reconcile the root; missing paths remove stale rows. Exclusions apply before enqueueing and inside the index, and incremental directory symlinks are recorded without traversing their targets. Failed index watches report offline roots until reconfigured. Reconfiguration retires watches without waiting for an in-flight index read, so a long crawl can be cancelled promptly; final shutdown drains index work separately.

`workspace/open-path.ts` owns captured-path navigation and native permission recovery. Sidebar and Places commands identify known folder destinations, so denied Volumes/Favorites paths can open the native picker before their initial stat succeeds. Cancellation retains the current folder; successful selection opens the actual selected folder. Results from a closed plane, changed folder or switched workspace are ignored. Linked and independent root opening retain their placement semantics, and arbitrary denied file paths do not become folder requests.

Following a link (a row's link marker, Go to linked plane, a Markdown link to a local file) also makes the plane the active one, taking the wheel (plurid's click-to-scroll owner, its header tinted) and the keys (2026-10-23); plurid's selection, for moving planes, is not changed. Opening a file from a folder leaves the keys in the folder, so its rows stay browsable. Focusing a plane retains a docked presentation: navigating in the same docked folder does not issue a spatial framing command. New plane dimensions follow the viewport, and framing uses a 0.92 fill ratio. Quick Preview has its own responsive dialog size rather than changing every wide dialog. Columns previews reuse `PreviewHost`, including resource disposal on selection changes and permission revocation. Folder-size workers return per-root totals as well as the selection total; the renderer shares a bounded measurement cache and subscriptions across list rows, information dialogs and changing selections, without replacing filesystem metadata with logical directory sizes.

`renderer/ui/navigation/Volumes.tsx` first displays native mount inventory and capacity without requesting a broad `/Volumes` grant. Opening a mount passes through captured-path permission recovery; cancellation retains the mount dialog. Eject blocks/drains affected work and purges caches/index data before invoking the native eject service. Actual reconnect/cloud-provider coordination remains a release acceptance gate.

## Verification scope

Native file-information editing is isolated in domain/files/information.ts, desktop/files/file-information.ts and tools/file-information.h. The typed service validates edits, serializes bounded work, checks the same native grants and provider claims as file operations, and rejects stale change-time revisions. The renderer does not issue shell commands to edit metadata. Finder aliases use private staging and the existing operation journal/publication/Undo path. tools/file-panels.h owns the system Quick Look data source and native sharing picker. Their API does not grant file access. [Finder integration](finder-integration.md) describes behavior and remaining acceptance.

`tests/*.test.ts` exercise real temporary filesystem paths, partial failures, cancellation, collisions, source/destination races, cross-device and unsupported-hard-link fallback, safe undo, scoped range streams, corrupt archives, ZIP CRC/TAR checksums, PAX Unicode paths, shared watchers, streamed search and atomic state recovery. Command tests use mocked services to check availability, target snapshots, alias/recency ranking, stale sources, clipboard and text editing. State tests verify layout-only deletion/recovery, jobs, sidebar preferences and legacy state. Workspace tests validate host records across engine-history reconciliation and adapter flushes.

`tests/electron-smoke.ts` launches the actual locally signed app against synthetic files in a temporary profile. It verifies every initial preview family, malformed/missing assets, selectable PDF text/search, media cleanup, four explorer views, independent model orbiting, native IPC/resource restrictions, workspace switching/restoration and the close-flush handshake. The browser fixture server adds UI checks with an isolated file-operation clipboard and Trash adapter. Copy Path writes to the browser text clipboard, reports permission failures and clears the virtual file selection only after a successful write. Raster/video fixtures are authored color samples; all model, PDF and archive fixtures are generated locally. No user files are mutated by verification.

Packaged functional checks default to hidden offscreen Viewer and Settings windows with GPU rendering retained. Test mode requires explicit render/background flags and an isolated profile; normal window behavior is unaffected. The macOS QA instance uses accessory activation policy and never calls window show/focus or native activation. A read-only NSRunningApplication probe asserts that it remains inactive, including after closing Settings. Foreground activation and physical frame profiling require `VIEWER_TEST_FOREGROUND=1`; offscreen timings are excluded from those measurements.

Run `pnpm check`, `pnpm lint`, `pnpm test`, and `pnpm package` from the root. `pnpm make` produces a macOS ZIP; `pnpm test:desktop` verifies the packaged app. Fuses disable RunAsNode, Node options and Node CLI inspection, require ASAR-only loading and validate ASAR integrity. Local ad-hoc signing makes the development bundle executable; certificate signing/notarization are release work.

Actual disconnected/reconnected external drives and network mounts, release distribution, Windows and Linux remain unverified. Mounted-path behavior uses ordinary local filesystem APIs, with platform-specific Trash, dialogs, clipboard and metadata kept in desktop adapters. Format and workload limits are listed in the project README. [verification.md](verification.md) records the checks and their scope; [performance.md](performance.md) records measured workloads and remaining performance risks.

## Window-local presentation

`domain/preferences/presentation/profile-fields.ts` is the exact typed catalog of
profile-capable leaves, compiled from the same schemas as shared Settings. It
includes UI presentation, appearance, browsing defaults, editor/terminal fonts,
tiling, Tour and chosen theme IDs. It excludes session restoration, Trash
confirmation, process-global services, credentials, agent/model/native consent and
shared catalogs. Unknown paths cannot fall through to a shorter valid setting.
Legacy parent shorthand expands only through the catalog; explicit leaves win and
malformed/protected siblings invalidate the shorthand.

`resolver.ts` applies shared defaults → workspace default profile → explicit
profile → local workspace overrides. `state/folder-presentation.ts` then applies
shared per-path folder overrides and project folder views, in that order. The
renderer and `Bridge.windowPreferences` use the same resolver. `WorkspaceSessions`
returns only detached presentation metadata for a native appearance read, avoiding
a clone of the full workspace, file history and preview state.

Selecting or leaving a profile does not patch shared configuration. Settings edits
canonical values; pinned overlay leaves remain local. Generic workspace setting
commands edit local leaves while a profile is active, otherwise keep their shared
behavior; explicit workspace commands always remain local. Matching an inherited
value removes the override. Leaving an explicit profile reveals the workspace
default and retained local choices. Native creation uses those same effective
backdrop values; effects requiring native window recreation keep that constraint.

Definitions are shared by ID and edits apply live. Missing references remain saved
with diagnostics and inherited fallback. Built-in identifiers are reserved. Startup
preserves invalid legacy definitions with warnings; new invalid definitions or
imports are rejected. Untouched groups retain identity, compilation uses immutable
profile keys and renderer windows cache their resolved values. OS look is a
separate input, never another window's overridden appearance. Present starts Tour
only when explicitly invoked; restoring a workspace does not start one.

See [ADR 0001](adr/0001-window-local-profiles.md) and
[configuration](configuration.md) for user-facing precedence and examples.

## Spatial overlays

`renderer/workspace/overlays` owns a pure collision solver and a small DOM adapter
for Plurid's public overlay attributes. Overview retains a valid corner, measures
projected header controls, toolbar and viewcube as obstacles and falls back to an
explicit popover when no corner fits. Empty map background ignores pointer input;
map buttons remain navigable. Placement coalesces to animation frames and stays
stable during pointer interaction. The host restores focus, attributes, observers
and subscriptions on dismissal/disposal; Plurid retains projection/navigation.
The Viewcube also retains its engine-owned corner, conceal and hover behavior;
the host only suppresses it while its visible portion covers a protected control.
Toolbar protection uses actual controls and menus rather than the empty
click-through band across the bottom of the viewport.
See [ADR 0004](adr/0004-collision-aware-spatial-overview.md).

## Durable save and close

Renderer flushes share one barrier for text buffers, Chat drafts, engine state,
preference intents and saved workspaces, including edits admitted during a save.
Failed preference batches retain their base revisions and do not overwrite newer
queued changes. Native flush acknowledgements match both a token and the sending
window; timeout, disconnect and rejected saves are failures. Close offers Retry or
Keep open after failure and proceeds only after success.

`desktop/persistence/directory-sync.ts` centralizes parent-directory synchronization
for private documents, saved state and JSONC publication. Writes validate and sync
exclusive temporary bytes, rename atomically and sync the containing directory on
supported platforms; JSONC also checks for external edits. A failure after rename
can leave visible new bytes without confirmed durability, so callers retain and
report the failed intent. Windows directory-sync limitations and actual crash,
low-space/provider/device tests remain explicit qualification concerns.
See [ADR 0003](adr/0003-durable-save-barriers.md).

## Shared preferences, commands and terminals

`domain/preferences/folder-presentation.ts` resolves defaults and partial path-keyed overrides. The state store shares those appearances across explorers while `workspace/sessions.ts` keeps a bounded per-plane/per-folder history of selection, scroll, filtering, expansion and column trails. `explorer/input.ts` owns Finder keys before Plurid camera listeners; `ListNavigation.tsx` owns expanded children and visible traversal; `BrowserColumn.tsx` shares the projected-coordinate resize adapter with list/sidebar resizing. Pointer movement mutates geometry only, then commits one preference change.

`desktop/preferences/configuration.ts` owns JSONC parsing, preserved comments, last-valid recovery, atomic publication and external watching. `desktop/preferences/settings.ts` owns strict validation, migration, path-level conflict detection and schema generation. Renderer Settings and agent proposals use its same patches. Credentials, effective grants, arrangements and caches remain separate documents. Matching folder overrides retain object identity when another preference changes.

`workspace/controller.ts` is the boundary between host planes and engine routes/IDs. New terminals capture their root and origin before creation. `desktop/terminals/terminal-launch.ts` owns app discovery, checked bundled it2 capability, private command files and tmux operations. `desktop/terminals/terminals.ts` owns sender-scoped PTYs; `terminal-worker.ts` owns node-pty, batched output and flow control. Renderer terminal sessions retain an xterm instance and DOM outside culled components. PTYs are stopped on plane/window/app close and fresh shells are started after app restart.

Terminal process IDs originate only from the owned worker. `terminal-groups.ts` reaps its process group and reports unconfirmed cleanup instead of silently reusing an ID. Preparing commands and terminal handoffs participate in drain/cancellation; late authorization changes are checked again before spawn/handoff. External terminal apps and user-requested tmux sessions have an independent lifetime after handoff. Native evidence for these boundaries is recorded in [qualification](release-qualification.md).

`renderer/commands/programs.ts` adapts declarative actions to the existing registry. `desktop/actions/executions.ts` validates captured source identities and executes human-requested literal argv or an explicit shell, with bounded output and cancellation. `domain/agents/safety.ts` blocks opaque execution, external-app opening and file Undo in the agent catalog and approval path. `desktop/agents/agent-requests.ts` owns fresh review, exact executor/source checks and separately persisted terminal-read grants. Approved agent Trash requests start directly in the desktop operation service with captured source versions; coordination rechecks each item before native Trash. Proposals track the actual job result and queued cancellation. No failure falls back to permanent removal. Renderer commands acknowledge completion to the main process. A cwd identifies context and never acts as a process sandbox.

The same bounded catalog publication carries a compact live workspace/plane snapshot, without persisted arrangement or navigation history. `desktop/agents/agent-broker.ts` filters discovery through native access and canonical agent roots and constructs typed navigation proposals. `AgentRequests` requires review; the desktop rechecks authority before its sender-owned dispatch/acknowledgement. `workspace/agent-navigation.ts` checks origin/root/active-column ownership and destination snapshots before calling the ordinary store/controller/session transitions. Selecting files validates the whole set before changing selection. Empty-workspace targets have no parent and can create only independent roots; preview targets keep their actual root and parent directory. No second filesystem manager, permission picker or direct command execution is added to the MCP path.

See [CONTEXT.md](../CONTEXT.md) for vocabulary and [configuration.md](configuration.md) / [terminals.md](terminals.md) for the public interfaces.
