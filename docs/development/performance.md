# Measure performance

Use a named workload and retain its source, binary, settings, input hashes and raw observations. A
small generated file is a useful regression, not a substitute for large documents, network mounts or
long sessions.

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

`tools/index-benchmark.ts` measures synthetic SQLite metadata queries independently of filesystem
crawling and content extraction. Keep those costs separate from mounted-provider latency and
first-open parsing.

Preview qualification should record cold-to-usable-content time and warm cache read time separately.
A derived-resource read excludes PDF parsing and painting. Large CSV/mesh parsing, image decode,
Office conversion and folder-size scans have separate worker/queue limits; cancellation must release
their work.

Keep raw reports in generated output and publish only the measurements whose method and limitations
are clear. [Testing](testing.md) explains evidence classes.
