# Spatial workbench implementation

Accepted October 25, 2026. This ledger records implementation and actual
qualification; generated fixtures and build artifacts remain retained.

## Current ordered follow-up

| Delivery | Status and evidence |
| --- | --- |
| 0 · Commands and documents | Complete: redundant menu tooltips removed, Layout naming, manual shell commands with progress/Stop/save-as-action, private Markdown notes/checklists kept after view closure. 1,837 tests and packaged smoke pass; isolated native acceptance `viewer-native-notes-commands-Acsrkw`. |
| 1 · Independent RAW | Complete: pinned LibRaw helper, camera/RAW modes, bounded shared cache, all-eight-orientation pixel checks and camera recovery after failed RAW rendering. 1,842 tests pass; final native `viewer-native-raw-gYVvRk`, candidate `/private/tmp/viewer-raw-20261025-E/Viewer.app`. |
| 2 · Video compatibility | Complete: bounded local H.264/AAC copy, actual picture/audio/seeking, cancellation, warm reuse and error recovery. 1,847 tests pass; native `viewer-native-video-copy-J9M9kk`, candidate `/private/tmp/viewer-video-20261025-C/Viewer.app`. |
| 3 · Office fidelity | Complete: 1,855 tests pass; actual formatted/stored values, cross-page merges, embedded images, source-bound authority, dark/light/narrow views and public Office files pass. Native `viewer-native-office-fidelity-ydDDzz`; independent UI review ship. |
| 4 · Worktree creation | Complete: typed new/existing branch creation, pinned revisions, editable sibling paths, occupied-branch recovery, linked folder/Git views and cold restore. 1,861-test stage suite passes; final review correction passes native/25 targeted tests and is scored resolved/ship. |
| 5 · Task areas | Complete: named checkout contexts, durable tool references, private receipts/history, reopen/arrange and no automatic command replay. The combined 1,873-test suite, seven native lifecycle checks, packaged smoke and independent UI review pass. |

These statuses describe delivered evidence, not feature promises for the running
older app. Isolated candidates never replace the user's normal Viewer instance.

The combined follow-up candidate is
`/private/tmp/viewer-followup-validated-20261025-A/Viewer.app`.
Its sibling `candidate.json` records the source/lockfile hashes and retained
reports. `runtime-equivalence.json` proves its executable, frameworks, resources,
ASAR and Info.plist are identical to the final native/smoke-tested task candidate.
Only test assertions, capture settling and test-code formatting changed after
that candidate; production code did not change.

The final combined suite passes **1,873 tests in 266 files**, without failures
or skips. The task native run retains 11 captures and seven checks in
`viewer-native-task-areas-r6q4gh`, including cold restoration, durable documents
and receipts, terminal no-replay, server reattachment and browser-port rebinding.
The settled receipt-error supplement is in `viewer-task-recovery-capture-6nyRDv`.
The complete packaged smoke passes with fixture `viewer-verification-vzqoN0`.
All generated files and earlier attempts remain retained. See
[verification](verification.md#october-25-ordered-follow-up-video-and-office-fidelity)
for exact logs and scope.

## Delivered behavior

- Foreground previews no longer share their bounded native read queue with
  long-lived media response streams. Cancellable resource generations, deadlines,
  recovery, source watching and a shared versioned document cache cover Quick
  Preview and embedded Office/document views.
- Columns distinguish the active directory and ancestor route from file-operation
  selection. Reading text has independent 16px/20px defaults and zoom/wrap controls.
  CSS syntax has theme roles. JSON/JSONC/JSON5/YAML share bounded virtual trees with
  expand/collapse, search, path/value copy and retained state. Worksheets virtualize
  columns as well as rows while retaining original cell addresses.
- Linked creation anchors to its source row or header. Related planes exposes the
  parent and direct children; closing a child returns to its parent. Server view
  IDs are independent of window-owned listener IDs. Local servers reattaches a
  closed view without duplicating or restarting its listener; quit/window closure
  stops it, and restored descriptors start stopped.
- Real offscreen Chromium pages paint into plane canvases and accept projected
  pointer/keyboard/IME input under perspective. Navigation, zoom, selection,
  culling and persistent cookies operate in an isolated Viewer browser profile.
  There is no application preload, resource protocol or agent DOM route in guests.
- Private revisioned media drafts support exact cuts, ordered/joined or separate
  segments, frame/audio extraction, mute, replacement/mixed audio and export.
  Image tools support format, quality, resize, rotation, crop and explicit metadata.
  Fixed bundled processors run through guarded file operations with progress,
  cancellation, collision handling and durable receipts; originals stay intact.
- Optimize handles mixed PDF/JPEG/PNG/WebP/AVIF batches locally. Presets, optional
  raster dimensions, original/output sizes, savings and individual errors are
  explicit. Larger candidates are not published. Lossless JPEG preserves encoded
  coefficients; PDF optimization retains text/vectors and does not rasterize pages.
  Signed PDFs are refused. Existing JPEG scans may not shrink.
- Workflows and MCP can prepare reviewed typed transformations. They gain no raw
  execution, removal-approval bypass or authenticated-browser access. Saved state
  is now v10 for private note/task/receipt views, with pre-migration backups and
  private browser/draft references excluded from portable projects.

## Executed evidence

All commands use `VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1`.

| Check                    | Result and retained evidence                                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reader starvation        | Old candidate fails with sixteen held response streams; fixed candidate passes the foreground deadline and thirty Quick Preview open/close cycles. `/private/tmp/viewer-preview-stream-fixed-20261025.log`                            |
| Complete automated suite | 1,765 tests in 246 files pass, with no failures or skips, using the real macOS and recording-review bindings. `/private/tmp/viewer-spatial-suite-4.log`                                                                               |
| Actual codecs            | Four real FFmpeg/Sharp/qpdf/jpegtran tests pass: cut/join/mix/frame, normalized orientation, pixel/coefficient preservation and searchable/vector PDF. `/private/tmp/viewer-optimization-native-2.log`                                |
| Async cancellation       | Optimize Cancel during job admission stops the late job and prevents the next format group. Media editor mount/edit/cull/restore passes. `/private/tmp/viewer-optimize-dialog-test.log`                                               |
| Browser                  | Real rotated clicks/typing/IME/double-click selection, displayed pixel changes, culling, navigation/zoom, cookie restart and bitmap fallback pass. `/private/tmp/viewer-browser-native-6.log`; fixture `viewer-native-browser-58C7iL` |
| Server                   | Actual command and linked child, loopback requests, log controls, stop/restart, close/reattach and owner shutdown pass. `/private/tmp/viewer-spatial-web-native-1.log`; fixture `viewer-native-web-OYWFX0`                            |
| Inspection               | Column scope/route/selection, YAML aliases and controls, CSS metrics/color and horizontal workbook IV2 selection pass. `/private/tmp/viewer-inspection-native-4.log`; fixture `viewer-native-inspection-ZNxyCw`                       |
| Media/image UI           | Packaged range editing, exact-duration clip, filmstrip, AVIF resize and private draft restore pass, with unchanged input hashes. `/private/tmp/viewer-media-native-6.log`; fixture `viewer-native-media-tools-AzX6F9`                 |
| Optimize UI              | Mixed PDF/PNG batch reports smaller outputs and retains searchable text and original hashes. `/private/tmp/viewer-optimize-ui-native-2.log`; fixture `viewer-native-optimization-naDTQe`                                              |
| Base packaged smoke      | Complete desktop smoke passes. `/private/tmp/viewer-spatial-smoke-4.log`; fixture `viewer-verification-3Nmv7R`                                                                                                                        |
| Static/build             | TypeScript, lint and package pass. Latest package log `/private/tmp/viewer-spatial-package-9.log`; final type/lint/format checks and deep strict signature verification pass                                                          |

Native fixtures above live under the generated macOS temporary root; native
reports and screenshots remain under `app/out/native-evidence` and the fixture
roots. The interface finish-review matrix is retained in
`.impeccable/review/spatial-workbench-20261025-review/`.

## Interface review

The independent initial review requested three material fixes: retain the image
bitmap through theme/resize changes, make playback/recovery truthful and replace
a stale export acknowledgement with actual job results. All three were scored
**resolved**, with disposition **ship** for that fix list. Corrected dark/light/
narrow captures are in `.impeccable/review/spatial-workbench-20261025-fix1/`.
The native driver verifies actual advancing playback, visible completed-output
feedback and source pixels in captured images. A real-store regression covers
playback failure/Retry and running/completed/cancelled/failed jobs. The detector
ran once: its sole finding was an unchanged citation accent-border advisory.

The validated app and copied reports are retained at
`/private/tmp/viewer-spatial-validated-20261025-etmsgsbs/`. `candidate.json` binds
the source/lockfile hashes, app hashes, exact test totals and evidence paths. See
[verification](verification.md#october-25-spatial-workbench-media-and-optimize).

## Qualification limits

The current direct-package evidence is Apple Silicon macOS. Intel build support
is present but has not been runtime-qualified; Store, Windows/Linux, physical
picker/assistive-technology behavior and every website/login flow require their
own gates. New image tools do not decode HEIC/HEIF; older native quick actions
remain available. PDF optimization is not scan resampling. See
[media tools](media-tools.md), [web previews](web-previews.md) and
[Office previews](office-previews.md) for exact capabilities and limits.
