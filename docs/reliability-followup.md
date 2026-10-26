# Preview reliability and recovery follow-up

Requested October 26, 2026. Deliver in order; preserve all fixtures, sources,
profiles and build artifacts. This ledger separates implemented changes,
executed checks and remaining acceptance.

| Step | Scope                                                                    | Status                                                                                                            |
| ---- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| 1    | Replace shared image-thumbnail decoding with bounded private helpers     | Passed native pixels, seven-format C packaged acceptance and complete H smoke, including SVG                      |
| 2    | Measure and reduce CSV/model interface stalls; bound decoded allocations | Implemented; paired A/B renderer measurements passed                                                              |
| 3    | Sustained preview/plane lifecycle, resource ownership and restoration    | Thirty cycles/worker teardown passed on B; complete H smoke, G multi-tool restoration and browser acceptance pass |
| 4    | File-operation failure/recovery acceptance and private-note Trash review | B permission/recovery checks pass; operator confirms H note Trash, both generated documents' library/views clear  |
| 5    | Reconcile roadmap and bug status with current evidence                   | Updated roadmap and this ledger; final validation record below                                                    |

## Step 1: private image rendering

Ordinary image thumbnails and rendered image resources share a versioned private
cache, separate from camera/video decoding. The read-only ImageIO helper receives
an already-open descriptor, has a CPU limit and a 10-second parent deadline, and
checks source/output pixel and byte limits. OpenEXR uses the bundled FFmpeg with
a fixed demuxer, descriptor-only protocols, one frame and allocation/pixel limits.
SVG uses the existing private image utility process with an 8 MiB input bound,
32 MiB output bound and 10-second deadline. Buffer input has no base URI, so
librsvg cannot resolve filesystem or network companions. This follows
[librsvg's documented reference rules](https://gnome.pages.gitlab.gnome.org/librsvg/Rsvg-2.0/class.Handle.html).
A real pixel regression verifies that an absolute local image reference is not
loaded. Raster conversion retains its separate raster-only checks.
None of these paths falls back to Quick Look. Bundle icons use NSWorkspace in the private
helper, with a bounded serial queue, instead of a shared thumbnail request.

The source tree has no remaining `nativeImage.createThumbnailFromPath` calls.
Explicit human commands that open macOS Quick Look remain available. Native
frameworks/codecs may still use OS services; this does not claim isolation of
macOS itself or universal decoder coverage.

The routing regressions fail on the old path and pass after replacement. Real
pixel checks cover PNG, JPEG, WebP, AVIF, GIF, BMP, TIFF, HEIC, PSD, JP2, EXR, TGA,
ICNS and ICO at 64 and 512 pixels, plus correctly sized bundle icons, unchanged
source hashes and corrupt-image recovery. Command-sandbox codec/coordination
failures were followed by real native checks without weakening assertions.

Retained logs:

- `/private/tmp/viewer-image-isolation-routing-red-20261026.log`
- `/private/tmp/viewer-image-isolation-routing-green-20261026.log`
- `/private/tmp/viewer-image-resource-native-20261026.log`
- `/private/tmp/viewer-image-pixels-native-20261026-C.log`
- `/private/tmp/viewer-reliability-package-A-20261026.log`

The current local candidate is
`/private/tmp/viewer-reliability-20261026-H/Viewer.app`. Its image-helper hash is
recorded by the preserving build alongside source/lockfile fingerprints. This
inherits the prior direct bundle's native dependencies and is not Store or
distribution qualification. The user's ordinary Viewer instance is untouched.

Packaged acceptance also passes, with retained profile, six source copies,
repeated cold/warm thumbnails and rendered-resource reads, expired-child denial,
real Quick Preview open/close and a graceful quit. HEIC and EXR screenshots were
visually inspected. Evidence:
`viewer-native-image-isolation-G8LiSf` under the macOS temporary root; log
`/private/tmp/viewer-image-isolation-packaged-A-20261026.log`. Final C acceptance
adds SVG to those six formats and passes in `viewer-native-image-isolation-Mcww2T`;
log `/private/tmp/viewer-image-isolation-packaged-C-20261026.log`.

## Step 2: table and mesh work off the interface thread

CSV/TSV parsing and filtering now use an owned worker. Compact strings cross the
worker boundary; rich source-addressed cells are materialized lazily with a
512-row cache. Parsing retains at most 100,000 records / 500,000 cells, with a
visible partial-data notice; the omitted suffix is still scanned for malformed
quotes. Search results retain original row numbers. Loading, failure/Retry,
cancellation, file replacement and A → B → A regressions are covered.

OBJ/STL/PLY parsing and normal generation use one-shot workers with transferable
typed buffers. The renderer reconstructs objects while retaining geometry,
material names, groups and existing appearance defaults. Geometry and texture
budgets are 128 MiB each; source dimensions and companion-image limits reject
oversized allocations before ordinary texture decoding where headers permit.
Worker timeouts/crashes abort pending requests; closing views terminates their
workers. Non-RAW image requests now cancel when their view is culled or closed.

Paired hidden-window measurements on this Mac use a 3.37 MB / 55,000-record CSV
and a 2.41 MB / 96,800-triangle OBJ grid. Warm CSV script work fell from
43–45 ms to about 16 ms; warm OBJ renderer task work fell from 81–94 ms to
33–37 ms. The paired baseline recorded 50/57 ms long tasks for warm OBJ opens;
the candidate recorded none above 50 ms. Filtering stays around 10 ms by a
renderer MutationObserver measurement. Native polling adds roughly 100 ms to
some wall-clock samples, so it is not treated as filter latency.

These are fixture-specific renderer CPU observations, not physical display
FPS, end-to-end INP, GPU memory or universal format guarantees. Raw results:

- `/private/tmp/viewer-preview-performance-paired-before-20261026.log`
- `/private/tmp/viewer-preview-performance-paired-after-B-20261026.log`

## Step 3: lifecycle and ownership

Candidate B passes 30 repeated resource rounds, 30 Quick Preview opens/closes
over ten document/media/data/model/image types, rapid file switching and sixteen
held streams overlapping a foreground Office request. CDP target inspection
confirms table/mesh workers disappear after each close. After warmup and owned
garbage collection, retained JS heap grew about 0.98 MB, backing storage 2,138 B,
DOM nodes 649 → 726 and listeners 506 → 510 between cycles 10 and 30.

Evidence: `/private/tmp/viewer-preview-lifecycle-B-20261026.log`, fixture
`viewer-native-preview-lifecycle-at6lEC`. This is bounded lifecycle evidence;
many simultaneous heavy planes, VRAM and physical display traces need separate
measurement. Cold workspace/multi-tool restoration is checked independently.

## Step 4: operation recovery and remaining human acceptance

The packaged B recovery scenario exercises an actual POSIX permission-denied
mkdir, a succeeding next job, and a cold restart with a pre-seeded interrupted
copy receipt. Startup marks interruption as failure, retains recovery evidence,
keeps source and partial output bytes, and does not replay the operation.
The generated directory's original permissions are restored. Evidence:
`/private/tmp/viewer-operation-recovery-B-20261026.log`, fixture
`viewer-native-operation-recovery-BznWVn`.

The unit suite also covers receipt/disk-full failure, collisions, cancellation
and interrupted Undo. A physical unplug, provider outage or actual full volume
has not been tested by this scenario.

**The operator confirmed the remaining generated note moved to Trash on H.**
The user approved exactly two generated note documents and clicked the actual
confirmation; the agent did not confirm removal. Read-only verification finds
both the note and checklist absent from their source paths, live library and
saved open views. The other note document remains. The exact Trash destination
was not independently inspected. The retained acceptance report is
`viewer-note-trash-operator-WBg1M7/operator-result-H.json` under the macOS test
root. Automated checks keep `VIEWER_TEST_NO_REMOVAL=1`; all other generated
files, folders, profiles and builds remain retained.

## Candidate and combined validation

The G preserving-build result is
`packages/viewer-electron/app/out/preserved-package-gEmvqK/result.json`:

- Source before/after build: `fc1d3cfea478502c4c0364eebfc183c1506ec9d1589c7f96dbd12bfc3c5d191f`.
- Lockfile: `bf1703c1f919ddaefa0e82f08386939e31145b07333bf3f46f107e1b18daee38`.
- Image-helper build input: `e93de8e377e41b6bbff5d65646c507e74d50c3033565dd96e3efb24edfabf110`.
- Packaged, signed helper: `5504c0ee37ab852a200fb23706d607469ee1f0b2b3d38d603b590817efcac8d0`.

The G suite passes **1,935 tests in 278 files**. Four TypeScript targets,
full lint and required formatting pass. The C combined suite passes
1,931 tests in 277 files; the SVG-focused native run passes eleven tests,
including existing real image/media conversion. C's complete packaged smoke
passes. Six C table/model captures were inspected in dark, light and 760 px
layouts, including filtered and no-result tables. The mechanical detector
reported no issues. Captures are retained in `viewer-preview-ui-zchtg1`.

### Additional failures found during final task acceptance

C's multi-tool scenario exposed a newly spawned receipt with zero measured
dimensions beyond the culling distance. Framing waited for measurement while
culling prevented the first measurement. The adapter now uses the engine's
public configured-size framing fallback once to reveal that single target,
then waits for its real box before fitting. It keeps cancellation and the
bounded frame budget. Two regressions fail before the fix and pass afterward:
`/private/tmp/viewer-unmeasured-framing-{red,green}-20261026.log`.

D then exposed browser publication after webContents destruction, and a browser
guest preventing clean application exit. Lifecycle guards and detaching guests
before destroying them eliminate the destroyed-object error. A minimal F probe
proved the remaining exit problem: every save/disposal stage completed, but
Chromium stayed alive unless the guest closed before the owning app window.
Bitmap and texture modes both reproduced it, so switching transports was not a
fix. G closes browser guests after all window saves succeed and before Electron
closes those windows. Browser storage still flushes, and final disposal joins
the same close promise. Two browser service regressions pass.

The minimal G browser-open/quit probe passes, as does the complete G task-area
scenario with note/checklist retention, terminal/server reattachment, command
receipt output, cold restart, no command replay, explicit server restart and
missing-receipt recovery. Logs:

- `/private/tmp/viewer-browser-lifecycle-{red,green}-20261026.log`
- `/private/tmp/viewer-browser-quit-probe-F-20261026.log`
- `/private/tmp/viewer-browser-quit-probe-bitmap-F-20261026.log`
- `/private/tmp/viewer-browser-quit-probe-close-first-F-20261026.log`
- `/private/tmp/viewer-browser-quit-probe-G-20261026.log`
- `/private/tmp/viewer-reliability-task-areas-{C,D,E,G}-20261026.log`

All failed profiles and candidates remain available; none were silently
discarded. [Verification](verification.md) records the final complete suite,
packaged smoke and remaining human/physical gates.

The final complete G packaged smoke and dedicated browser scenario pass, logs
`/private/tmp/viewer-reliability-smoke-G-20261026.log` and
`/private/tmp/viewer-reliability-browser-G-20261026.log`. The final suite report is
`/private/tmp/viewer-reliability-suite-G2-20261026.json`. Its preceding run found
the main lifecycle test fixture lacked the newly used browser-close port;
updating that fixture also strengthens save-before-guest-before-window ordering
and verifies failed saves keep guests open. All 26 focused lifecycle/framing
tests and the subsequent complete suite pass.

### User-reported navigation and diagnostic-pipe follow-up

H additionally fixes navigation visibility not carrying over to new folders or
task folder views. Hide/Show now applies to folder panes in the active workspace,
preserves widths and remembers the new-plane default using the existing setting
scope. New folders read the resolved preference, including workspace overrides.
A dedicated packaged check passes over existing/new planes and cold restart;
the H complete suite passes **1,939 tests in 279 files**.
H's complete packaged smoke, four TypeScript targets, full lint and formatting
also pass. The source witness matches its build exactly; the smoke log is
`/private/tmp/viewer-reliability-smoke-H-20261026.log` and the generated fixture
is retained as `viewer-verification-Wo6Zfo`.

During manual acceptance, stopping the test observer left the app with a closed
diagnostic pipe. Temporary shutdown logging caused the user's EPIPE alert. This
was an investigation error, not a successful acceptance: the logging is removed,
GUI diagnostic streams handle closed pipes, and real disconnected-pipe tests
verify the behavior. MCP protocol streams keep their normal error handling.
The corrected H app is open with the existing isolated profile preserved and
regular log files instead of observer-owned pipes. Opening the remaining
generated note's review succeeds after its launcher exits. The operator then
confirmed its Trash action; read-only source, library and saved-view checks
pass without affecting the other note. No new diagnostic pipe error is logged.
See the latest [verification entry](verification.md) for H's exact build,
logs, retained profile and remaining manual acceptance.
