# Measure performance

Use a named workload and retain its source, binary, settings, input hashes and raw observations. A
small generated file is a useful regression, not a substitute for large documents, network mounts or
long sessions.

## Responsiveness

`tests/native/responsiveness.ts` measures a packaged build in a hidden window:

- three cold starts;
- plane clicks;
- 50 arrow-key selections;
- typing in the palette;
- opening and scrolling a 10,000-item folder;
- grid thumbnails;
- a 2,000-file copy;
- camera motion.

Run it from the app directory:

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 \
VIEWER_TEST_BINARY="<packaged-Viewer-executable>" \
node --import tsx tests/native/responsiveness.ts
```

For each workload it records:

- React commits;
- main-process IPC calls and bytes by method and event type;
- main-thread delay;
- frame intervals and long tasks.

Startup marks come from both processes: `main:*` and `bootstrap:*` from the main process,
`viewer:bootstrap` and `viewer:first-rows` from the renderer. The scenario sets `VIEWER_PERF=1`,
which makes the main process print a `VIEWER_PERF` JSON report four times a second
(`src/desktop/diagnostics/performance.ts`). Without that variable the meter does nothing.

Results go to `out/perf/<time>/responsiveness.json`. Compare runs of the same scenario on the same
machine, and don't poll the app over IPC during a workload: the polling becomes part of the result.

## Reopen and lifetime audit

The mixed-workspace scenario opens 20 views: folders, document/data/model/media previews, browser
guests and ordinary shells. It supports 3–50 close/reopen cycles and streamed heap snapshots. Run
from the app directory against a packaged binary:

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 \
VIEWER_TEST_BINARY="<packaged-Viewer-executable>" \
VIEWER_MIXED_CYCLES=40 VIEWER_MIXED_HEAPS=1 \
node --import tsx tests/native/mixed-workspaces.ts
```

Inspect post-GC heap, DOM/listeners, detached trees, WebGL retaining paths and owned browser/shell
targets. A passing coarse count can still hide a specific retained context. Compare equivalent
reopened groups after warm-up.

The known model regressions are OrbitControls disconnecting after its original DOM root detached,
and shared lighting-texture listeners retaining old renderers. Layout-effect teardown and
renderer-owned lookup textures remove those paths. The qualified 40-cycle workload finds zero
detached model stages/canvases and bounded DOM/listener counts. Post-GC heap still grows modestly;
do not generalize this into a claim that every cache is stable indefinitely.

## Scheduling and input

Measure a real gesture, confirm it changed the intended state, and count commits, engine emissions,
long tasks and frame gaps together. Menu scrolling should not change the camera. Camera rotation
still has subscriber/commit costs worth tracing.

Routine hidden offscreen windows preserve functional GPU/IPC checks without activating Viewer. Their
frame intervals are renderer scheduling observations, not physical display FPS. Foreground profiling
requires an explicitly requested visible session using the harness's foreground mode.

## Memory

Summed process RSS counts shared pages more than once. Heap snapshots themselves can substantially
increase process memory. Distinguish JavaScript heap, decoded media/geometry, browser guests,
renderer resources and native/GPU allocations. Use retaining paths to assign an object to its actual
owner before changing a cache.

## Index and preview work

`tools/search-benchmark.ts` compares real filesystem traversal and content extraction with common
exclusions enabled and disabled. From the app directory, run:

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 \
node --expose-gc --import tsx tools/search-benchmark.ts 2000
```

The argument is the file count per generated dependency/cache folder, between 100 and 10,000. The
benchmark retains six such trees and a working-document folder. It alternates traversal order,
checks identical useful matches, verifies zero authorization/extraction inside excluded trees and
measures cancellation, event-loop delay and process memory. Spotlight is disabled; content indexing
uses actual file reads with in-memory SQLite. Treat its timings as local synthetic observations, not
application-wide latency or network-volume guarantees. All fixtures and the result remain.

`tools/index-benchmark.ts` measures synthetic SQLite metadata queries independently of filesystem
crawling and content extraction. Keep those costs separate from mounted-provider latency and
first-open parsing.

`tests/native/preview-latency.ts` times Quick Preview from the Space key to the first frame with
content, in the page itself, for a small EPUB, DOCX, XLSX, PDF, DjVu, JPEG and Markdown file, and
one file for each later reader: ODT, notebook, calendar, subtitles, JAR, Scala, SQLite and a WMV
that needs a compatibility copy. A preview whose text says it could not open fails the run. It runs
once with the index idle and once while it crawls 30,000 files, and it counts empty preview frames
while the selection moves through Columns. From the app directory, run:

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 VIEWER_TEST_BINARY=<Viewer executable> \
node --import tsx tests/native/preview-latency.ts
```

Results go to `out/perf/<time>/preview-latency.json`. What keeps it fast:

- **Preview documents are read in their own worker** (`desktop/workers/preview-worker.ts`). In the
  index's worker, a book waited for the index to open and for each step of a crawl.
- **The index counts by root.** It purges excluded rows when the exclusions change, so its status
  needs no per-path filter. On 2.5 million rows that filter took a second per crawl flush. Purges
  run only when the folders, text permission or exclusions changed (`meta` table).
- **Module code loads ahead.** Preview module code loads while the window is idle, and for the
  selected file (`renderer/previews/module-loading.ts`). A module that suspends is held back by
  React until 300 ms after its fallback appeared.
- **The shown preview stays until the next has content** (`renderer/previews/HeldPreview.tsx`), and
  progress appears only after 150 ms.
- **SQLite reads in the preview worker too.** `node:sqlite` is synchronous; in the main process a
  long count would stop every window.
- **An Office engine starts ahead of its document.** Selecting a Word or PowerPoint file, or
  finishing a layout, starts the engine for the next one. It is still destroyed after its one
  document, and closes after a minute unused (`desktop/previews/office-renderer.ts`).

Preview qualification should record cold-to-usable-content time and warm cache read time separately.
A derived-resource read excludes PDF parsing and painting. Large CSV/mesh parsing, image decode,
Office conversion and folder-size scans have separate worker/queue limits; cancellation must release
their work.

Keep raw reports in generated output and publish only the measurements whose method and limitations
are clear. [Testing](testing.md) explains evidence classes.
