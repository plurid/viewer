# Mixed workspaces, crowded layouts and preview recall

Requested October 26, 2026. All source fixtures, isolated profiles and candidate
builds are retained. This extends the earlier [preview reliability pass](reliability-followup.md).

## Scope and acceptance

1. Exercise 20 mixed planes: four folders, twelve file previews, two browser
   pages and two terminals. Navigate, close ten views and restore them repeatedly.
   Record renderer scheduling, heap, DOM/listeners, worker/page targets and
   aggregate process RSS. Check retained growth after warmup.
2. Keep crowded tiles internally usable, remove crossing spatial lines while
   tiled and retain clear, keyboard-accessible parent/child navigation. Closing a
   tile and arranging its survivors must be one Undo step.
3. Recall file view positions after closing a plane, opening a fresh plane and
   restarting Viewer. Existing copies retain their independent views. A changed
   source resets positions; private notes and unsaved edits retain their existing
   owners. Flushing a closing view must capture pending scroll, playback and
   camera samples.

## Baseline and observed failure

The retained reliability H build loaded 20 planes successfully. Initial hidden
window observations put aggregate process RSS around 0.94–0.97 GiB, with median
and p95 idle frame intervals around 16.7 ms. Early maximum intervals reached
99–163 ms. Closing ten views reduced DOM/listeners, browser targets and process
RSS. These are renderer scheduling and summed process RSS observations, not
physical display FPS, unique physical memory or private GPU allocations.

The first baseline used custom shell profiles without a positive native program
confirmation: its terminal surfaces do not establish live-PTY acceptance. The
corrected workload uses the ordinary own-shell route, with `/bin/sh` supplied to
the isolated test app and no login arguments or startup-file sourcing.

Ten Undo commands restored only five of ten closed planes. Automatic retiling
was recorded after each close as another arrangement change. The first local
layout candidate passes that same close/Undo sequence after grouping both
changes and suppressing redundant geometry history writes.

Evidence retained:

- H baseline: `/private/tmp/viewer-mixed-baseline-20261026.log`, profile
  `viewer-native-mixed-workspaces-z8XblD`.
- First layout candidate A: `/private/tmp/viewer-mixed-20261026-A/Viewer.app`;
  native log `/private/tmp/viewer-mixed-native-A-20261026.log`, profile
  `viewer-native-mixed-workspaces-vLJWIN`.

## Implemented behavior

Crowded tiling preserves at least 420 × 260 logical pixels per plane and fits the
larger arrangement with one camera scale. Existing small layouts retain their
ordinary scale. The engine's public plane-bridge and plane-link visibility
configuration hides crossing geometry in tiled mode and restores it in free
space. Related planes retains the same searchable choice menu, with compact
link/count chrome and the same tool/file titles as plane headers. Frame and Dock
remain in narrow headers; secondary controls remain available through Actions.
Closing a tile and arranging its survivors is one Undo step.

File recall is private optional session metadata, separate from portable project
definitions. Its recent-file cache retains at most 50 entries per workspace and
200 globally, with an 8 KiB UTF-8 bound per entry. A whitelist limits recall to view
positions and presentation; notes, editing buffers and resource capabilities
are not copied. Source identity/version still gates reuse. Window ownership
prevents peer saves from overwriting another window's file recall.

Scroll recall is attached to the actual scroll container, waits for content,
distinguishes chapters/pages and yields to user input. Timers are bounded and
listeners/observers are removed with their view. Close and application flushes
capture fractional media positions and pending orbit updates before disposing
the owning plane.

The metadata-before-content path is covered too: a loading Quick Preview first
creates placeholder state, then hydrates file recall when metadata arrives.
Previously that placeholder could overwrite a remembered Markdown offset with
zero. Code and table scroll restoration follows virtualizer initialization.

## Browser faults found during visual review

The first four candidate D captures exposed blank browser surfaces and a stale
Loading indicator after navigation and resizing. Plurid's `frozen` culling tier
still paints a plane; Viewer had treated it as inactive. Both `visible` and
`frozen` now keep preview/browser content active. Hidden and detached planes
remain inactive.

A separate race let the initial browser-open reply overwrite a newer loaded-page
event. The event now wins, and obsolete deferred viewport callbacks cannot apply
after their effect has ended. A focused test reproduced the stale loading state
before the fix. Candidate E passes real browser pixel and loading checks after
each reopening and at all four capture sizes/appearances. The final four captures
were inspected: both browser pages are visible, all 20 headers have zero measured
overflow and Frame/Dock are accessible. The minimap and viewcube remain existing
optional spatial aids; the overview does not make 20 previews full-size reading
surfaces. Frame or Dock provides the reading view.

## Candidate E measurements and restoration

Candidate: `/private/tmp/viewer-mixed-20261026-E/Viewer.app`. Preserving-build
record: `packages/viewer-electron/app/out/preserved-package-ffvy1F/result.json`.
Build source before/after is
`ada8a454171b79c7788883c1adf5b0984e1bf89c00dfb428af1e59ff46708bfc`.
This is a local JS rebuild from the retained H runtime, not a distribution build.

The final 20-plane workload includes 480 folder entries, twelve file previews,
two real browser guests and two live ordinary shells. It passes three cycles of
20 → 10 → 20 planes, including ten Undo actions restoring ten closed views.
Each ten-view closure stops both shell children and removes both browser targets;
reopening creates fresh shells without replaying commands. Keyboard search in
Related planes reaches a terminal and its parent.

| Observation | Candidate E |
| --- | --- |
| Navigation frame intervals, 80 samples | Median 16.7 ms; p95 16.7 ms; maximum 16.8 ms |
| Observed navigation long tasks | None |
| Renderer heap, first/third reopened groups | 25.01 / 27.52 MiB |
| DOM nodes, first/third reopened groups | 4,048 / 4,420 |
| Summed process RSS, reopened groups | 1,156 / 1,194 / 1,150 MiB |
| Summed process RSS, ten-plane groups | 892 / 883 / 950 MiB |

These are hidden-window renderer scheduling and summed process observations.
They do not establish physical compositor FPS, unique physical memory, private
GPU allocation or absence of leaks in a long-running session. The small retained
DOM/listener growth remains recorded rather than being described as zero growth.

Cold-restart acceptance closes each preview, gracefully quits, restarts the same
isolated profile and opens fresh plane IDs. It verifies:

- Source text at 640 px, Markdown at 500 px, CSV at 960 px and DOCX at 600 px.
- EPUB chapter two at 500 px, and PDF page three at 200% with 400 px scroll.
- Video and audio at 0.125 seconds, including close before normal sample debounce.
- A model camera changed through real orbit input, retained after reopening.

Source fixture hashes remain unchanged. Existing simultaneous copies keep their
own views; changed file versions reset recall. Recent-file limits can evict old
positions, and view metadata over the entry budget is not retained in file recall.

Evidence roots are under the system temporary directory and are retained:

- Mixed stress and final four captures: `viewer-native-mixed-workspaces-Zs8PhR`;
  log `/private/tmp/viewer-mixed-native-E-20261026.log`.
- Restoration: `viewer-native-preview-restoration-fqHYT9`, `result-1.json`;
  log `/private/tmp/viewer-preview-restoration-native-E-20261026.log`.
- Browser input/culling/Back/zoom/bitmap/cookie restart:
  `viewer-native-browser-Z0GU63`;
  log `/private/tmp/viewer-browser-planes-native-E-20261026.log`.
- Full suite: `/private/tmp/viewer-mixed-suite-E2-20261026.{log,json}`:
  1,948 passed, four conditional native-binding tests skipped, no failures.

All four TypeScript targets and full lint pass. The final packaged smoke and
source witness are recorded in [Verification](verification.md). Real-file corpus,
physical assistive technology, other platforms and Store qualification remain
separate work.

## Compact navigation correction

The broader E smoke found an additional compact-header regression: at a 420 px
docked width the new secondary-control rule hid the entire folder navigation
strip, including its direct visibility toggle. Candidate F retains that strip
at this width, while continuing to hide secondary preview/view controls. The
existing smoke checks the toggle through actual hit-testing, hides and shows
navigation, and verifies that neither files nor topology change. The correction
changes CSS only; candidate E's restoration and browser lifecycle evidence above
still describes the same JavaScript implementation. F's full suite again has
1,948 passed tests and four conditional native-binding skips. Final native
results and exact source/build witness are in [Verification](verification.md).

F's final mixed-workspace run also passes all three cycles and all four header
geometry checks: 20 headers, zero overflow, Frame/Dock available. Its 80 navigation
samples again have median/p95 16.7 ms, maximum 16.8 ms and no observed long tasks.
Heap after the first/third reopen is 25.26 / 29.09 MiB, DOM nodes 4,050 / 4,420,
and listeners 3,733 / 4,992. Reopened summed RSS is 1,132 / 1,121 / 1,124 MiB;
ten-plane summed RSS is 880 / 922 / 929 MiB. These retain the same short-run
limits described above. Both shell children and browser guests close and return
in the expected groups. Dark 1440 px and light 900 px final captures were
inspected after the CSS correction; folder navigation remains visible and browser
pages remain painted.

Final fixture: `viewer-native-mixed-workspaces-lGts8s`, with `result.json` and four
captures. Log: `/private/tmp/viewer-mixed-native-F-20261026.log`. Complete F
packaged smoke passes in `viewer-verification-rC07iE`; log:
`/private/tmp/viewer-mixed-smoke-F-20261026.log`. All earlier failures, fixtures
and candidates remain retained.
