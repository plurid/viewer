# Workspace reliability, Office layout and search follow-up

Requested October 26, 2026. Work proceeds in this order; source files, public
references, generated profiles, heap snapshots and build outputs are retained.

1. Run 40 mixed-workspace close/reopen cycles. Compare post-GC heap, detached
   trees, listener counts and owned browser/terminal lifetimes. Trace retained
   objects to their actual owner, add a regression and repeat the same workload.
2. Qualify larger public PDFs, complex Office files, textured models and long
   media. Verify bounded loading, cancellation, restoration, actual rendered
   content, source hashes and useful failure recovery.
3. Exercise external changes, unavailable locations, failed browser navigation
   and stopped servers. Preserve views/drafts and expose explicit recovery.
4. Exercise branch → task → edit → hunk review → checks → reported conversation
   navigation through the real UI, fixing friction between existing services.

The user also requests near-original Office layout, fast worksheet navigation,
content search and useful typo/fuzzy suggestions. The chosen Office renderer
must be bundled, work without a separately installed office application, and
support macOS, Windows and Linux. Local native execution is available on macOS;
other platforms require their own executable CI evidence.

## Starting Office and search baseline

At the start of this work, DOCX provided semantic body text, tables and supported
inline images, without Word pagination. XLSX had a searchable named sheet selector,
original cell coordinates and stored-row paging, omitting charts and much
presentation styling. PowerPoint opened externally. The existing bounded semantic
reader remains useful for evidence and table inspection alongside layout views.

Document-text search already exists for explicitly granted indexed locations.
The follow-up must improve discovery, scoped content results and approximate
matching while preserving content permission, exact queries, original input and
result provenance. Suggestions must not silently rewrite or execute a command.

## Long-session diagnosis

The retained baseline is `<temporary>/viewer-mixed-20261026-F/Viewer.app` with
the expanded native mixed-workspace harness. It completes all 40 cycles and
fails the retained-DOM bound. The first/last reopened groups contain:

| Metric | First | Fortieth |
| --- | --- | --- |
| Renderer heap after GC | 27.23 MiB | 44.16 MiB |
| DOM nodes | 4,048 | 11,302 |
| Event listeners | 4,086 | 21,753 |
| Detached model stages in final heap | — | 120 |

Heap retaining paths identify document key listeners → bound OrbitControls →
change callback → model stage. OrbitControls disconnects keyboard listeners from
`canvas.getRootNode()`. Passive React cleanup runs after the canvas has detached,
so it can target a different root. Model setup/teardown now uses a layout effect,
disposing controls while their original DOM root still exists.

The focused regression renders the real ModelPreview and OrbitControls with
only WebGL mocked. It fails on the old teardown timing and passes after the fix,
including Control-key listeners across three mounts. The first corrected
40-cycle run has zero detached model stages and passes the original DOM bound.
It ends with 3,810 DOM nodes and 3,609 listeners, rather than 11,302 / 21,753.
However, its deeper snapshot still contains 80 detached WebGL canvases, so this
is not treated as a completed resource audit.

The second retaining path is module → shared `DFG_LUT` texture → dispose listener
→ renderer closure → WebGL context → canvas. Three.js r186 shares this lighting
lookup globally, while uploaded textures register context-specific listeners.
Renderer disposal does not dispose that shared texture. The two physically based
material views therefore retain two contexts on each cycle.

A guarded build transform gives each renderer a clone of the lookup texture
sharing the immutable CPU data and disposes that clone before renderer teardown.
Other live renderers keep their own texture. Installed dependencies remain
unchanged. Both development and packaged Vite builds apply the transform; source
markers refuse silent drift on a dependency update. Unit checks verify independent
ownership/disposal and the installed-source guard. The native audit now checks
both detached model stages and detached model canvases, rather than relying on
the coarse DOM bound alone.

The paired 40-cycle B run passes. Its final heap contains zero detached model
stages and zero detached model canvases; context nodes remain at six, rather
than 86 after the first correction. DOM nodes are 3,732 after the first reopen
and 3,730 after both the twentieth and fortieth. Event listeners end at 3,247
instead of the baseline's 21,753. Renderer heap is 24.95 MiB after the first
reopen, 30.87 MiB after the twentieth and 30.92 MiB after the fortieth. The
observed later window is stable; this is not a claim of leak absence for every
format or arbitrarily long sessions.

Both live shells and browser guest targets end in each ten-view closed group
and return in reopened groups, with no command replay. All 40 browser readiness
checks pass. This completed the paired resource diagnosis before the real-file
qualification described below.

Baseline evidence: system temporary folder
`viewer-native-mixed-workspaces-ODRErT`, `result.json` and heap snapshots at warm,
five, twenty and forty cycles; log
`<temporary>/viewer-soak-baseline-20261026-A.log`.
Regression evidence: `<temporary>/viewer-soak-model-{red,green}-20261026.log`.
Candidate: `<temporary>/viewer-followup-20261026-A/Viewer.app`, preserving-build
record `packages/viewer-electron/app/out/preserved-package-DatDrn/result.json`.

The first A launch stopped on initial browser paint readiness in
`viewer-native-mixed-workspaces-byNj5W`; it is retained as a failed startup probe.
The complete A repeat is `viewer-native-mixed-workspaces-L5KMFv`, log
`<temporary>/viewer-soak-fixed-20261026-A2.log`. Its final snapshot reproduces the
second leak with 80 canvases and 86 WebGL contexts. The strengthened negative
check is `<temporary>/viewer-soak-texture-red-20261026.log`; texture ownership
unit checks pass in `<temporary>/viewer-soak-texture-green-20261026.log`.
The second candidate is `<temporary>/viewer-followup-20261026-B/Viewer.app`,
build record `packages/viewer-electron/app/out/preserved-package-fYRkGi/result.json`.
Its complete audit is `viewer-native-mixed-workspaces-3MNVZF`, including warm,
five/twenty/forty-cycle heap snapshots and `result.json`; log
`<temporary>/viewer-soak-fixed-20261026-B.log`. The build source witness is
`2feeeaf9e7a5ceae6c3dc0e3d9269b0e8418c89daed05e65fd7f215b7ca023ba`.
The later tools-only TypeScript option permits explicit `.ts` configuration
imports and does not change the tested runtime.

Measurements concern hidden-window renderer scheduling and summed process RSS.
They do not measure physical compositor FPS, private GPU allocations or unique
physical memory.

## Real-file qualification and bundled Office layout

The combined implementation adds layout previews for DOC/DOCX, XLS/XLSX and
PPT/PPTX, using the same bundled, checksum-pinned WebAssembly engine on all three
desktop operating systems. DOCX retains Reading and XLSX retains its bounded
stored-value grid. Worksheet tabs and a searchable menu share the selected-sheet
state; keyboard navigation preserves focus during loading. New opening defaults
use Viewer for all six formats; explicit existing native-app choices remain.

Layout input is copied from its authorized, pinned handle within the captured
64 MiB size. The helper has a disposable sandbox, no preload/Node/host filesystem,
macros disabled and external document updates disabled. A nonce-scoped loopback
server admits only the engine/job assets. Conversion is serial, cancellable and
limited to 45 seconds/32 MiB output; source-version cache leases share 128 MiB.
See [Office previews](office-previews.md) for limits, licensing and the difference
between layout rendering and stored-content inspection. The derivation kind is
one shared domain type, imported at the top of resource/decoder modules.

The real Office corpus caught a functional export error: changing the selected
tab initially still exported the whole workbook. The strengthened native check
compares actual first-page text. Export now passes an explicit UNO Selection and
typed FilterData, with the selected sheet made visible only in the RAM document.
The sample Home worksheet renders as two pages rather than 31/36 workbook pages.

Final packaged Office evidence: `viewer-native-office-layout-TEOoQ9` and
`out/native-office-layout-F.log`. All seven public references pass: floating-picture
DOC, embedded-picture DOCX, conditional-formatting XLS/XLSX, legacy PPT and two
PPTX image/chart samples. Input hashes match their pinned catalogs and remain
unchanged. Cold checks take 2.76–3.60 seconds from the post-launch connection
checkpoint to qualified page pixels. Warm derived-resource reads take 0.9–1.3 ms;
that measurement excludes PDF.js parsing and painting.

Larger-file restoration uses the 178-page qpdf manual, the 121 MB / ten-minute
Big Buck Bunny movie and the 10 MB textured Khronos BoomBox GLB. PDF page/zoom/
scroll, exact media time 245.125 seconds and model camera survive fresh plane IDs
and a cold app restart. The initial model screenshot exposed missing embedded
textures despite successful geometry/camera checks. ImageBitmapLoader's fetch of
owned blob URLs was blocked by application CSP. Local blob/data connections are
now admitted; remote connections and script-evaluation policy retain their prior
restrictions. The final native check requires no missing-texture warning, and
the captured GLB has its actual textures. Source bytes and all failed evidence
are retained. Logs: `out/real-restoration-{C,F}.log`.

## Recovery, search and continuous task acceptance

Missing preview sources now show that the retained view is the last loaded
version, with Check again, Locate file and identity-based Find renamed file.
Only a unique regular sibling with the same identity can be offered as a rename.
Source checks cannot publish after their watcher unmounts. A dirty editor keeps
its original draft; locating another path opens a separate view. External writes
still use the existing conflict UI. The native case preserves the unsaved marker
and verifies the file on disk is not overwritten.

`viewer-native-preview-recovery-Lr9cKm` / `out/native-recovery-D3.log` pass external
writes/renames, a temporarily unreachable generated folder, dirty-draft retention
and failed-browser retry at the same address. Folder unavailability is simulated
by renaming the owned fixture; no real volume was unmounted. Earlier retained
attempts exposed two harness setup issues (early browser-state polling and a
quoted selector), rather than additional product fixes. A separate regression
covers restarting an associated server at its unchanged URL; the page navigates
again and obsolete errors clear.

Folder search gains a direct Search contents action. Search planes expose an
editable query, a Document text toggle and scoped Search settings recovery.
Content grants, exact query meaning, source excerpts and purge behavior remain.
File/command discovery adds bounded adjacent-transposition/word-typo ranking;
exact matches retain priority and a suggestion never executes itself. Shared
did-you-mean uses the same distance function. Query/root changes withhold old
matches and source evidence until the new result arrives.

The packaged search UI probe passes in `viewer-native-search-discovery-P3h0IW`
with `content-result.png`, `result.json` and `out/search-discovery-F2.log`.
It uses two generated files and an explicitly scoped content grant: the content
action finds a phrase absent from its filename, selection shows its source quote,
the Document text toggle removes that match, and an edited query replaces results
without retaining the old quote. The first incomplete folder-state fixture and
its failed probe remain preserved; the corrected setup requires its expected
folder before proceeding.

`out/native-task-workflow-D.log` passes one continuous branch → worktree/task →
tracked on-disk edit → hunk stage/unstage → typed test/build sequence → attached
reported conversation/current-source link workflow. Index and working-file bytes
are checked independently, parameters remain literal, and the note Trash review
is cancelled. This check removes nothing and retains its checkout, profile and
command receipts.

The final 40-cycle repeat passes in `viewer-native-mixed-workspaces-QeoCEX`, log
`out/mixed-soak-F.log`. Its first/twentieth/fortieth reopened groups have 3,735 /
3,733 / 3,733 DOM nodes, 3,264 / 3,260 / 3,622 listeners and 25.17 / 30.36 /
32.14 MiB post-GC heap. Final ownership analysis finds zero detached model stages,
zero detached model canvases and six WebGL context nodes. Heap still grows
modestly; the fixed retaining paths and bounded counts do not establish that
every cache is stable indefinitely. All browser/shell lifecycle checks pass.

Real-file F restoration evidence is `viewer-native-preview-restoration-QfS0io`,
including the inspected `textured-model.png` and two restart results.

The final app is `packages/viewer-electron/app/out/followup-office-F/Viewer.app`.
Its preserving-build record is `out/preserved-package-WApdfU/result.json`, with
identical source witnesses before/after:
`afd6a4172750461feb511ed29c397dd31e5d25f40d9111552b3959774243b97a`.
The complete F suite passes 1,965 tests with four conditional skips; all four
TypeScript projects, full package ESLint and full package formatting pass.
The complete packaged smoke passes in `out/packaged-smoke-F.log`, with fixture
`viewer-verification-Ga8u3p` and retained native captures. The portable engine
smoke passes all six formats on macOS/arm64, including different first-page text
for both workbook sheets; log `out/office-engine-matrix-local-F.log`, outputs
`out/viewer-office-engine-smoke-G8GwEX`.
The Windows/Linux engine smoke matrix is included as a workflow; those native
runs remain pending and are not inferred from macOS results.

The consolidated receipt is `out/followup-final-F.json`, relative to the Electron
app. It records source/lock/ASAR hashes, reports, retained fixture identities and
qualification limits. Final source matches the packaged witness, deep strict
local signature verification passes, and changed-source review finds no inline
import types or absolute machine paths. All removals remain disabled.
