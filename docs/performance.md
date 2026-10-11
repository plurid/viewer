# Performance analysis

Measured on October 11, 2026, in the packaged Apple Silicon app on macOS 15.1. The menu's sluggish scrolling came from hover-driven scrolling fighting the wheel. A separate quadratic selection lookup caused a visible stall in large folders. Both are fixed. Operation source pruning and repeated full-job progress messages also scaled poorly and have been replaced.

## Method and scope

Native probes used disposable profiles and generated files, the packaged Electron binary, Chrome DevTools Protocol Performance/Profiler metrics, `PerformanceObserver` long-task entries, and instrumented scroll calls. Node microbenchmarks isolated selection indexes, source pruning and parsers. An additional real 1,000-file copy measured the operation event stream and verified both source and destination contents. No existing user files, folders, application profile or native Trash were changed.

The measured stack is Electron 44.7.0 / Chromium 152.0.7977.130, React 19.3.0, Plurid React 0.0.0-40 / data 0.0.0-26, Three 0.186.1, PDF.js 6.4.299, TypeScript 6.0.3 and Vite 8.3.4. Node probes used 26.8.2. Dependency versions are recorded in the root lockfile. The newer sibling Plurid source informed API analysis; verification used the installed, packaged engine.

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
| Settings tab dimensions                              | Heights varied: 180.9 / 586.2 / 332.3px                                                       | 500×540px on all three tabs                                        | Content scrolls inside a stable viewport-constrained dialog.                                |

### Menu scrolling

The original active-row effect ran `scrollIntoView` after both keyboard and pointer changes. Wheel scrolling brings new rows beneath the pointer; even tiny pointer movement selected another row and pulled it back into view. Blocking only that call reproduced correct scrolling before the fix. No wheel event was prevented, no spatial transform changed, and no long task appeared in that probe. This establishes a scroll feedback problem rather than evidence that the entire Electron or Plurid renderer was saturated.

`CommandResults` now scrolls the active result only after keyboard navigation. Query changes reset the list to the top. Pointer hover retains active-result feedback without forced scrolling, and `overscroll-behavior: contain` keeps the menu's scroll local. After the change, the jitter probe used 10.4ms of script work over about 1.4 seconds, with zero long tasks, zero prevented wheel events and unchanged spatial transforms. A small-folder four-second idle sample used 0.50ms of task work and no script work.

### React, folder views and commands

The 10,000-file folder still renders 28 file rows. The updated initial document has 529 DOM elements, including the restored spatial controls; it does not render 10,000 rows. Heap use was about 15.1MB before interaction and 19.6MB after select-all. These samples establish bounded DOM and manageable heap for this fixture, not a leak-free guarantee for every preview.

`FolderExplorer` previously resolved each selected path with `sources.find`, then reconciled selection through another identity scan. It now builds path and identity indexes when entries change. The identity index marks collisions explicitly: exact hard-link paths survive, unique renames follow identity, and ambiguous replacements clear. Visible row membership uses a Set. Sorting depends on source entries, query, hidden preference and sort fields rather than the entire pane record; a sidebar-only change does not sort the folder again.

Commands and file finding have separate mounted children. Command mode does not call the folder listing/watch or recursive search hooks. File mode scores lightweight filename entries before constructing a maximum of 150 executable result definitions; matching still considers the whole listing, so a late match in a 10,000-file directory is found. Context, aliases, recency, destination selection and availability rechecks remain shared through the command registry.

Remaining renderer opportunities are broader command-registry invalidation and whole-folder refreshes. Multiple planes viewing the same path share a desktop watcher but can each request metadata again. Profile these with several large open folders before adding caches or changing subscription ownership.

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

UI preferences use version 3 independently of core saved-state version 1. The version-3 whole-state migration enables existing plane navigation and hides window navigation once after an exclusive synced metadata backup; subsequent choices remain authoritative. Unversioned profiles restore toolbar, minimap and viewcube once; versioned false choices survive reload. Optional malformed fields fall back individually. Folder-plane navigation stores only visibility and width; order, labels, Favorites and folding remain shared. Native tests check persistence and unchanged fixture inventories for UI-only actions.

Persistence debounces at 400ms, serializes all workspace arrangements and uses validated atomic writes. The preload boundary and storage service both validate the state. Large arrangements can therefore create a renderer serialization pause and main-process validation/serialization work. Incremental workspace persistence is a future profiling target; this pass does not change the durable format or remove validation to chase throughput.

### Previews and memory

Lazy loading and bounded reads keep preview cost out of ordinary folder browsing. PDF parsing/rendering uses its worker. Model geometry, materials, textures, renderers and active frame requests have explicit cleanup; the native suite verifies representative previews and independent model gestures.

Several expensive tasks remain synchronous:

- A roughly 4MiB / 55,188-row CSV preview produced 80ms and 68ms native long tasks in a cold-load probe. Total task work was 286ms; script 113.6ms, style recalculation 71.8ms and layout 15.5ms. CPU sampling attributed about 40.8ms to garbage collection and roughly 25ms to parsing/filtering. It would be incorrect to attribute the whole stall to the CSV parser. A separate Node parse/filter probe took 42.55 / 2.73ms.
- A roughly 3.97MiB JSON parsed in 4.93ms in Node. Rendering expanded trees, syntax highlighting and repeated filters can add work that this parser-only measurement does not include.
- Three's OBJ parser took 70.61ms for a 1.53MiB synthetic source with 200,000 triangles; Node heap reached about 108MB and the position buffer alone occupied 6.87MB. This is an isolated parser measurement, not a native GPU allocation or leak trace. A 256MiB source limit does not bound decoded geometry or texture memory.
- Thumbnails currently open full image resources for visible tiles, capped at a 30MiB source file. CSS resizing does not limit decoded pixel memory. A bounded thumbnail service/cache is the next likely improvement for image-heavy grids.
- PDF search visits up to the first 1,000 pages, with cancellation, but does not yet cache extracted text across queries. Large document search merits its own trace.

Worker parsing, decoded-content budgets and thumbnail generation should be separate changes with representative real files and cancellation tests. None is claimed as fixed by this UI/performance pass.

### Bundles and startup

The current static renderer graph is approximately 989.3KiB uncompressed: main entry 681.6KiB, React/Redux chunk 289.4KiB, controls 10.0KiB and React shared chunk 8.4KiB. The baseline was approximately 983KiB. Preview chunks remain lazy: model 712.9KiB, PDF 423.5KiB and text 194.0KiB; the PDF worker is 2,177.5KiB. The app ASAR is 18.9MiB.

These are on-disk JavaScript sizes, not measured cold-start times. Gzip sizes are less relevant to a local packaged protocol than parse/compile cost and module execution. Heavy preview libraries are already split from routine browsing. The spatial engine/React graph is the meaningful startup profiling target; changing dependencies or adding dynamic imports without tracing the startup path would not establish a benefit.

## Regression evidence and follow-up

The unit suite covers identity reconciliation, normalized pane reuse, bounded finder ranking, preference migration, optional sidebar persistence, progress gaps/stale snapshots, whole-job throttling and filesystem safety. The packaged-app suite covers search toggle/focus restoration, ring suppression, fixed Settings dimensions, controls persistence/toggles, title dragging, independent plane navigation, face-on opening, duplicate prevention, explicit second views, previews, transfers, undo and workspace restoration. See [verification.md](verification.md).

To reproduce functional checks, run `pnpm check`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm make`, then `pnpm test:desktop`. The native harness uses generated fixtures and an isolated profile. For performance comparison, use the same binary/profile setup, enable CDP Performance/Profiler and a long-task observer, and measure: 14 alternating ±60px menu wheel events with 1px pointer jitter; three seconds of idle in a generated 10,000-file folder; command opening and select-all over one-second windows. Keep window visibility and fixture size identical and distinguish full observations from parser-only Node probes.

The next evidence-driven priorities are decoded thumbnail memory, large CSV/model parsing, multi-preview GPU usage, cold/mounted-folder metadata and large workspace saves. Ordinary menu scrolling and large-folder selection no longer show the previously measured stalls.
