# Performance analysis

Measured on October 11, 2026, in the packaged Apple Silicon app on macOS 15.1. The first table records the preceding interface pass; the service/root-isolation measurements below describe this implementation. The menu's sluggish scrolling came from hover-driven scrolling fighting the wheel. A separate quadratic selection lookup caused a visible stall in large folders. Both are fixed. Operation source pruning and repeated full-job progress messages also scaled poorly and have been replaced.

## Method and scope

Native probes used disposable profiles and generated files, the packaged Electron binary, Chrome DevTools Protocol Performance/Profiler metrics, `PerformanceObserver` long-task entries, and instrumented scroll calls. Node microbenchmarks isolated selection indexes, source pruning and parsers. An additional real 1,000-file copy measured the operation event stream and verified both source and destination contents. No existing user files, folders, application profile or native Trash were changed.

The measured stack is Electron 44.7.0 / Chromium 152.0.7977.130, React 19.3.0, Plurid React 0.0.0-40 / data 0.0.0-26, Three 0.186.1, PDF.js 6.4.299, TypeScript 6.0.3 and Vite 8.3.4. Node probes used 26.8.2. Dependency versions are recorded in the root lockfile. The newer sibling Plurid source and dechat informed API/context analysis; verification used the installed, packaged engine.

Duration figures below are CPU work over controlled observation windows, not end-to-end interaction latency or frame-rate guarantees. These are single-machine diagnostic samples, not a statistical benchmark or a network-drive test. The updated app shows three native spatial aids by default, adding DOM compared with the baseline.

## Findings and fixes

| Workload                                             | Before                                                                                        | After                                                              | Interpretation                                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Context menu: 14 wheel steps with 1px pointer jitter | 13 hover-triggered `scrollIntoView` calls; upward steps moved roughly 35–40px instead of 60px | No hover-triggered calls; every step moves 60px                    | Hover no longer fights manual scrolling.                                                    |
| Select all in a 10,000-file folder                   | 264ms script work; one 262ms long task; 288ms total task work                                 | 6.81ms script work; no observed long task; 38.52ms total task work | Path indexes and Set membership remove quadratic selection work.                            |
| Open Commands in that folder                         | 13.87ms script / 87.52ms task work                                                            | 9.59ms script / 67.21ms task work; no observed long task           | Command mode no longer mounts a file listing/search or constructs 10,000 file commands.     |
| Prune 10,000 independent operation sources, Node     | 1,304.55ms                                                                                    | 3.84–3.92ms                                                        | Ancestor Set membership replaces all-pairs prefix comparison.                               |
| Resolve a 10,000-item selection, Node                | 175.13ms for repeated `find`                                                                  | 1.54–1.90ms including construction of both indexes and path lookup | The hot lookup scales with listing plus selection size.                                     |
| Idle 10,000-file folder, 3 seconds                   | 0.18ms task work                                                                              | 0.37ms task work, 0ms script work                                  | Both samples are effectively idle; there is no evidence of a continuous renderer loop here. |
| Settings tab dimensions, preceding pass              | Heights varied: 180.9 / 586.2 / 332.3px                                                       | Fixed dialog in that pass; now a separate 900×640 native window    | Categories scroll inside a stable window and preserve its size.                             |

### Menu scrolling

The original active-row effect ran `scrollIntoView` after both keyboard and pointer changes. Wheel scrolling brings new rows beneath the pointer; even tiny pointer movement selected another row and pulled it back into view. Blocking only that call reproduced correct scrolling before the fix. No wheel event was prevented, no spatial transform changed, and no long task appeared in that probe. This establishes a scroll feedback problem rather than evidence that the entire Electron or Plurid renderer was saturated.

`CommandResults` now scrolls the active result only after keyboard navigation. Query changes reset the list to the top. Pointer hover retains active-result feedback without forced scrolling, and `overscroll-behavior: contain` keeps the menu's scroll local. After the change, the jitter probe used 10.4ms of script work over about 1.4 seconds, with zero long tasks, zero prevented wheel events and unchanged spatial transforms. A small-folder four-second idle sample used 0.50ms of task work and no script work.

### React, folder views and commands

The 10,000-file folder still renders 28 file rows. The updated initial document has 529 DOM elements, including the restored spatial controls; it does not render 10,000 rows. Heap use was about 15.1MB before interaction and 19.6MB after select-all. These samples establish bounded DOM and manageable heap for this fixture, not a leak-free guarantee for every preview.

`FolderExplorer` previously resolved each selected path with `sources.find`, then reconciled selection through another identity scan. It now builds path and identity indexes when entries change. The identity index marks collisions explicitly: exact hard-link paths survive, unique renames follow identity, and ambiguous replacements clear. Visible row membership uses a Set. Sorting depends on source entries, query, hidden preference and sort fields rather than the entire pane record; a sidebar-only change does not sort the folder again.

Commands and file finding have separate mounted children. Command mode does not call the folder listing/watch or recursive search hooks. File mode scores lightweight filename entries before constructing a maximum of 150 executable result definitions; matching still considers the whole listing, so a late match in a 10,000-file directory is found. Context, aliases, recency, destination selection and availability rechecks remain shared through the command registry.

This implementation caches command definitions by source revision and gives headers scoped snapshots. Mounted folder scenes and preview hosts use stable props. Folder views now share a path-keyed listing request, watcher and bounded idle cache; refreshes coalesce at 80ms. This avoids duplicate metadata requests from several visible roots at the same path. A whole-folder metadata refresh still costs proportional to its entry count.

Native verification also reproduced an update loop in file finding: a fresh empty search array invalidated command definitions on every render. Shared empty snapshots remove the loop. Another reproduced failure came from replacing a session cache Map after a rename while memoized Columns-view selection handlers retained its old identity. Updating that Map in place keeps child selections visible to both commands and Space preview. The regression covers the real retained-reference pattern.

### Plurid and spatial interaction

Measured failures were host-integration issues: the first title drag started without an engine selection; new linked planes used pair framing, leaving the selected plane at an oblique angle; and reopening a file always created another host record. Native checks now verify selection on the same initial title press, unchanged camera during plane dragging, face-on opening, reuse under rapid repeated activation, and explicit second-view creation.

Plane headers, dragging, resizing, origin and the three spatial aids are configurable. Plane backs are always visible. Native minimap activation faces one plane and synchronizes the host command context without a second camera request. The native toolbar and host commands share engine transform state. Versioned UI preferences remain authoritative when engine arrangement hydration restores configuration. The resize observer ignores equal dimensions, routes keep stable identities, and configuration changes do not reconstruct the engine store.

The installed engine already culls distant content and can unmount it after a delay. Model previews render when dirty or animated and pause while inactive; media also pauses while inactive. The idle measurements do not justify a GPU or spatial-engine rewrite. A workspace with many textured models, high-resolution media and simultaneously visible planes still needs a GPU-memory and frame-timing trace. Such a trace was not performed here.

### Desktop filesystem, search and watches

Directory metadata fan-out is bounded at 24 concurrent workers. Watchers are shared per normalized path and emit debounced folder-change notifications. Recursive search streams batches of at most 64 entries or roughly 150ms, skips symlink recursion, accepts cancellation, and stops at 20,000 matches or 500,000 visited entries. Folder search closes by clearing its query and cancelling the owned request.

The remaining filesystem cost is reading metadata for every directory entry before returning a full listing. That can dominate cold folders and mounted network paths even though the renderer virtualizes rows. Recursive search uses `queue.shift`, and the renderer appends batches by copying accumulated results; both can become costly near their limits. These are source-level scaling risks, not measured explanations of the context-menu issue. Future profiling should distinguish directory enumeration, stat latency, IPC transfer and renderer index construction on real mounts.

### Operation queue and IPC

The old source-pruning loop compared every source with every other source. It now walks each source's parents and checks a Set. Tests cover order, duplicates, directory boundaries, root selections and Windows path separators.

The previous progress throttle reset for each copied file, while file boundaries also emitted full jobs. A 10,000-item synthetic full job occupied 1,496,849 JSON bytes and took about 2.75ms to clone in the baseline microprobe. Resending growing source/completed/error arrays per item created unnecessary CPU, allocation and IPC pressure.

The new 80ms throttle covers the whole job. Sequenced progress messages contain only current path, byte/item counters and error count. Queued/running, collision/resolution, terminal and undo transitions send complete authoritative snapshots. Unknown jobs or revision gaps trigger a coalesced jobs resynchronization; stale replies cannot rewind newer state. Completed and error inventories remain complete at authoritative transitions.

A generated 1,000-file copy completed in 5.88 seconds with all 1,000 destination files byte-identical and all sources retained. It emitted three full snapshots (queued/running/completed: 110,335 / 110,336 / 360,349 bytes) and 70 compact progress updates totaling 18,437 bytes. The largest progress message was 265 bytes; the shortest measured progress-to-progress interval was 80.21ms. That duration includes actual file I/O and sync calls and is not a throughput claim for other drives.

The change preserves serial ownership, exclusive publication, source revalidation, collision decisions, cancellation, partial-error reporting, metadata protections and eligible undo. Full lifecycle snapshots still scale with job inventory, and the jobs endpoint can return up to 100 retained jobs; this is intentional correctness data with lower frequency, not zero-cost storage.

### Persistence

UI preferences use version 3 independently of core saved-state version 4, which adds projects; a file of an earlier version is backed up before it is read as version 4. Core version 1 is read with an additive, backed-up migration for virtual search roots. The version-3 whole-state migration enables existing plane navigation and hides window navigation once after an exclusive synced metadata backup; subsequent choices remain authoritative. Unversioned profiles restore toolbar, minimap and viewcube once; versioned false choices survive reload. Optional malformed fields fall back individually. Folder-plane navigation stores only visibility and width; order, labels, Favorites and folding remain shared. Native tests check persistence and unchanged fixture inventories for UI-only actions.

Persistence debounces at 400ms, captures dirty workspace arrangements and uses validated atomic writes. Settings use a separate revisioned document with coalesced field patches. Closing native Settings waits for its queued edits to flush. The bridge's request schema and the storage service both validate the state; preload only forwards it. Large arrangements can therefore create a renderer serialization pause and main-process validation/serialization work. The final saved-state document still serializes the complete layout. Large arrangements and cold storage remain profiling targets; validation is retained.

### Previews and memory

Lazy loading and bounded reads keep preview cost out of ordinary folder browsing. PDF parsing/rendering uses its worker. Model geometry, materials, textures, renderers and active frame requests have explicit cleanup; the native suite verifies representative previews and independent model gestures.

Several expensive tasks remain synchronous:

- A roughly 4MiB / 55,188-row CSV preview produced 80ms and 68ms native long tasks in a cold-load probe. Total task work was 286ms; script 113.6ms, style recalculation 71.8ms and layout 15.5ms. CPU sampling attributed about 40.8ms to garbage collection and roughly 25ms to parsing/filtering. It would be incorrect to attribute the whole stall to the CSV parser. A separate Node parse/filter probe took 42.55 / 2.73ms.
- A roughly 3.97MiB JSON parsed in 4.93ms in Node. Rendering expanded trees, syntax highlighting and repeated filters can add work that this parser-only measurement does not include.
- Three's OBJ parser took 70.61ms for a 1.53MiB synthetic source with 200,000 triangles; Node heap reached about 108MB and the position buffer alone occupied 6.87MB. This is an isolated parser measurement, not a native GPU allocation or leak trace. A 256MiB source limit does not bound decoded geometry or texture memory.
- Visible image tiles now request platform-generated PNG thumbnails rather than original image resources. Requested dimensions are capped at 512px, generation is serialized, pending identical requests are shared, and the cache is bounded at 128 entries / 16MB of encoded data. Full previews retain separate source and decoded-pixel budgets. Encoded cache bounds do not constitute a native decoder/GPU-memory trace.
- PDF search visits up to the first 1,000 pages, with cancellation, and keeps each page's extracted text for the document's later queries. Large document search merits its own trace.

Document extraction and indexing now run in a utility process; native PDF extraction/OCR and granted EPUB content indexing are exercised. Large CSV/model parser work and decoded model texture budgets remain separate profiling targets.

### Bundles and startup

The current static renderer graph is approximately 1,040.3KiB uncompressed: main entry 732.3KiB, React/Redux chunk 289.4KiB, controls 10.0KiB, React shared chunk 8.4KiB and a small Plurid re-export. The preceding pass was approximately 989KiB. Preview chunks remain lazy: model 713.0KiB, PDF 423.5KiB, text 194.0KiB and EPUB 2.9KiB; the PDF worker is 2,177.5KiB. The app ASAR is 25.0MiB, including the service worker, PDF extraction bundle and native OCR helper.

These are on-disk JavaScript sizes, not measured cold-start times. Gzip sizes are less relevant to a local packaged protocol than parse/compile cost and module execution. Heavy preview libraries are already split from routine browsing. The spatial engine/React graph is the meaningful startup profiling target; changing dependencies or adding dynamic imports without tracing the startup path would not establish a benefit.

## Root/service pass measurements

Fresh packaged-native probes used isolated profiles, 120Hz frame observations, generated files and a React DevTools commit hook. They checked source hashes afterward and recorded no renderer exceptions or observer long tasks. These include asynchronous waits and instrumentation; elapsed duration is the observation window, not click latency.

| Workload                                                                      | React commits / engine emissions | Frame p95 | Largest frame interval |
| ----------------------------------------------------------------------------- | -------------------------------- | --------- | ---------------------- |
| Two roots: open/scroll contextual actions, 24 wheel steps with pointer jitter | 51 / 7 in 1.65s                  | 9.1ms     | 175ms                  |
| Two roots: repeated hover on one command row                                  | 8 / 1 in 1.41s                   | 9.1ms     | 9.4ms                  |
| Two roots: camera wheel rotation                                              | 607 / 202 in 2.01s               | 8.5ms     | 9.3ms                  |
| Twelve roots / 1,000 generated files: contextual menu scrolling               | 30 / 1 in 1.44s                  | 8.9ms     | 15.8ms                 |
| Same layout plus four 4,096×4,096 image roots: contextual menu scrolling      | 27 / 0 in 1.43s                  | 9.5ms     | 12.8ms                 |
| Image-root layout: camera wheel rotation                                      | 751 / 251 in 2.40s               | 8.9ms     | 9.3ms                  |
| Image-root layout: plane title drag                                           | 125 / 46 in 1.41s                | 9.3ms     | 10.3ms                 |

The small-menu sample contains one 175ms frame gap despite no JavaScript long task. This must not be hidden by percentile reporting or interpreted as a solved compositor stall. The larger menu samples did not reproduce that gap. The image-root camera trace recorded 194.4ms of FunctionCall work (largest 2.8ms), 15.9ms of style updates, 34.3ms layout, 8.8ms event dispatch and 33.0ms paint across its observation window. This is renderer trace data, not a GPU-memory or platform-compositor measurement.

Camera gestures still cause about three React root commits per engine emission. Stable folder/preview props keep heavy browsing work out of those updates, but the engine's subscriber scheduling remains a meaningful investigation target. The twelve-root camera attempt with only four emissions did not exercise rotation and is excluded from the table. Culling means the image-root workload does not establish that all decoded images remain simultaneously resident; the roots are present in the layout, and visibility is engine-controlled.

The probes also verified independent same-image children in two roots, same-root reuse, Space after row/search/frame controls and selection surviving culling. They are generated diagnostic workloads, not representative real book libraries or network mounts.

### Reliability-pass foreground observations

Before switching routine QA to background rendering, the packaged harness recorded three warm, one-root menu samples with 24 alternating ±60px wheel events and 1px pointer jitter. The fixture contained 11 entries. A test-only React commit hook, engine subscription, RAF probe and long-task observer ran in the actual foreground app.

| Workload              | Observation window | React commits / engine emissions | Frame p95 | Largest frame interval | JS long tasks |
| --------------------- | ------------------ | -------------------------------- | --------- | ---------------------- | ------------- |
| Menu wheel, sample 1  | 1.006s             | 26 / 0                           | 8.4ms     | 9.2ms                  | 0             |
| Menu wheel, sample 2  | 1.006s             | 27 / 0                           | 8.7ms     | 9.3ms                  | 0             |
| Menu wheel, sample 3  | 1.006s             | 25 / 0                           | 8.6ms     | 9.1ms                  | 0             |
| Camera wheel rotation | 1.218s             | 301 / 100                        | 8.4ms     | 9.3ms                  | 0             |

Menu scrolling left the camera unchanged; the camera sample asserted that rotation actually changed. These short warm samples did not reproduce the historical 175ms gap. They do not invalidate that earlier two-root observation or establish smoothness on cold, remote or larger workloads. Camera commit volume remains about three per emission. The spatial preference reentrancy fix was subsequently verified functionally; these figures are not a new physical benchmark of that change.

Folder-size work now runs explicitly in an independent utility process with two active scans and bounded metadata batches. The native regression suspends only its owned index worker and verifies that a right-click Calculate Size command still completes. Before isolation, the same regression remained at “Size not calculated” until the index worker resumed. This establishes the blocking mechanism under a controlled stall, without identifying why the user's index worker stalled. A separate renderer store publishes immediate start feedback and limits progress rerenders to subscribers for that selection. No folder traversal runs merely because a folder was selected. Native application discovery runs in a bounded helper process, and media waits expose loading/recovery instead of an indefinite blank stage. Filesystem-call latency, decoded video/GPU costs and large directory scans still require representative traces.

Routine `pnpm test:desktop` now renders hidden offscreen windows, keeps the QA process out of the Dock and checks that it never becomes active. This preserves functional renderer, WebGL, IPC and recovery checks without stealing user focus. Physical frame profiling requires explicit `VIEWER_TEST_FOREGROUND=1` and activates the owned test app. Offscreen frame observations are excluded from foreground performance evidence and do not overwrite its artifact. See [Electron's offscreen rendering behavior](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering).

### SQLite filename/metadata index

The checked-in `tools/index-benchmark.ts` ingests synthetic records into a temporary disk SQLite/WAL database, then alternates publication-extension queries and frequent filename/size queries over 30 samples. It does not crawl a user's filesystem.

| Records   | Ingestion | Query p50 | Query p95 |
| --------- | --------- | --------- | --------- |
| 100,000   | 980ms     | 21.46ms   | 22.50ms   |
| 1,000,000 | 10,878ms  | 18.69ms   | 19.61ms   |

Before the frequent-term query-plan correction, the million-record fixture took 285.81ms p50 / 296.2ms p95. The current plan uses a bounded count probe and scans matching names in stable order when a term is frequent, avoiding a large intermediate FTS sort. A regression checks disjoint pages through this branch. These figures measure indexed warm queries over synthetic filenames/metadata; extraction, first crawl, real document search and mount latency have separate costs.

Reproduce from the app package with `node --import tsx tools/index-benchmark.ts 100000` and `node --import tsx tools/index-benchmark.ts 1000000`. The script removes only its owned temporary database directory.

## Regression evidence and follow-up

The unit suite covers identity reconciliation, normalized pane reuse, bounded finder ranking, preference migration, optional sidebar persistence, progress gaps/stale snapshots, whole-job throttling and filesystem safety. The packaged-app suite covers search toggle/focus restoration, ring suppression, fixed Settings dimensions, controls persistence/toggles, title dragging, independent plane navigation, face-on opening, duplicate prevention, explicit second views, previews, transfers, undo and workspace restoration. See [verification.md](verification.md).

To reproduce functional checks, run `pnpm check`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm package`, then `pnpm test:desktop`. The native harness uses generated fixtures and an isolated profile. A requested foreground profiling run uses `VIEWER_TEST_FOREGROUND=1 pnpm test:desktop` for the reliability-pass menu/camera observations. For other comparisons, use the same binary/profile setup, enable CDP Performance/Profiler and a long-task observer, and measure: 14 alternating ±60px menu wheel events with 1px pointer jitter; three seconds of idle in a generated 10,000-file folder; command opening and select-all over one-second windows. Keep window visibility and fixture size identical and distinguish full observations from parser-only Node probes.

The next evidence-driven priorities are camera subscriber/commit work, large CSV/model parsing, multi-preview GPU usage, cold/mounted-folder metadata and large workspace saves. Ordinary menu scrolling and large-folder selection no longer show the previously measured stalls.
