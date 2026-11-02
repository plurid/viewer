# Test the behavior you changed

Run checks from the repository root. Use the smallest relevant regression first, then broaden for
shared contracts, persistence, permissions or runtime changes.

## Source checks

```sh
pnpm check
pnpm lint
pnpm format:check
pnpm test
pnpm docs:check
```

Types cover main, preload, renderer and tooling. Tests cover pure rules, component behavior and
desktop services. Passing these does not qualify native pickers, Finder, physical accessibility or a
distribution package.

Use the [desktop task protocol](usability.md) to qualify complete flows with people. Keep automated
evidence and observed human sessions separate.

Tooling types include both `.ts` and React `.tsx` test files. Lint requires top-level type imports
throughout source, tests and tools. Source CI runs the complete regression suite after preparing the
verified native helpers and audits the full dependency graph, including Electron; see
[runtime dependencies](dependencies.md).

## Kept test folders

Tests and tools never delete what they create (see [AGENTS.md](../../AGENTS.md)). With
`VIEWER_TEST_PRESERVE=1` everything they made is kept and listed in
`$TMPDIR/viewer-kept-test-folders.log`, one line per kept folder, with its time.

- A `pnpm test` run makes its folders inside one run folder, `$TMPDIR/viewer-run-<random>`, and
  lists only that folder. A full run keeps about 900 folders and 200 MB there; move the run folder
  to the Trash when you no longer need it. Without preservation, each test moves its own folder to
  the Trash and the empty run folder follows.
- Native scenarios and tools such as `tests/native/*.ts`, `tools/office-engine-smoke.ts` and
  `tools/docs/capture.ts` list their own folders.
- Release and acceptance tools copy the app with `tools/clone.ts`, an APFS clone that shares the
  original's disk blocks: a kept copy of the 900 MB app takes a few megabytes. DMG and zip archives
  are new data and take their full size.
- Each `pnpm package` moves the previous `out/Viewer-<platform>-<arch>` build, about 900 MB, to the
  Trash. Empty the Trash now and then.

To move a list of kept folders to the Trash, give `trash` the list on its input:

```sh
xargs trash < list.txt
```

Paths with spaces need one `trash` call each.

## Browser and packaged checks

`pnpm test:browser` serves the renderer with isolated filesystem fixtures. Its
picker/clipboard/Trash adapters are synthetic. It is useful for renderer behavior, not proof of real
OS integration.

After packaging, run the actual binary with fixture preservation and removal disabled. The default
desktop binary is the regular packaged output; use `VIEWER_TEST_BINARY` for a retained candidate.

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 pnpm test:desktop
```

Routine native tests use hidden offscreen windows, isolated profiles and generated files. They keep
the QA app out of the Dock and check it never becomes active. Run one native scenario at a time when
it owns native dialogs or shared platform resources. Never modify the user's running profile to make
a test pass. When a scenario's Quit takes more than five seconds, the harness records
`quit-sample.txt`, a stack sample of the app, in the run's evidence folder before it terminates the
app.

## Focused native scenarios

`tests/native/mounting-flow.ts` checks canvas DXF review and save, reopening in the drawing preview,
the local supplier page in a real browser plane, a reply-backed deadline comparison, selected-quote
Markdown saving and cold restart. Set `VIEWER_TEST_BINARY` and both preservation variables above. It
uses supplied HTML and illustrative plate dimensions, with no provider calls. It qualifies the host
workflow, not generated controls or the robot's physical mounting fit.

The supplier fixture can also run against a saved drawing:

```sh
cd packages/viewer-electron/app
VIEWER_TEST_PRESERVE=1 node --import tsx tools/mounting/serve-supplier.ts /tmp/mounting-plate.dxf Aluminium 6
```

Open the printed loopback URL in a Viewer browser plane and choose **Request quote**. The server
creates `supplier-reply.json` at the printed output path, only after that action. Attach the file to
the comparison conversation; browser access does not grant agent access. The reply includes the
exact drawing hash, material, thickness, quantity and fictional totals. A changed drawing requires a
new quote. The server has no external messaging or ordering route. Its temporary files are kept.

`tests/native/robotics.ts` loads the pinned SO-101 follower and all visual meshes through canvas
snapshots and assets. It checks articulated motion, hard-limit reporting, exact joint source review,
base translation, cold restart and portable export/import. Its HTML is an explicitly labeled local
test fixture. It makes no model request and is not evidence of generated controls, target solving,
collision checking or the completed film.

Download the checksummed corpus to a new retained folder, then run the scenario with
`VIEWER_ROBOT_CORPUS` pointing to it, `VIEWER_TEST_BINARY` to the candidate, and both preservation
variables above. Commands run from the repository root:

```sh
pnpm exec node --import tsx packages/viewer-electron/app/tools/robotics/fetch-so101.ts /tmp/viewer-so101-corpus
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 VIEWER_ROBOT_CORPUS=/tmp/viewer-so101-corpus pnpm exec node --import tsx packages/viewer-electron/app/tests/native/robotics.ts
```

`tests/native/robot-targets.ts` uses the same corpus and environment. Its supplied HTML fixture
places targets, runs the bounded solver, requests the desktop check, invalidates changed inputs and
reopens the saved work. It records both unresolved and successful searches. This is local fixture
qualification, not a model-generated robot session. `tests/robot-targets.test.ts` compares the
independent checker with SciPy reference poses, exercises invalidation and refuses stale saves.

`tests/native/robot-comparison.ts` uses the same environment and supplied fixture. It branches from
an exact fixture passage, keeps two world targets fixed, changes the alternative base, solves both
poses and compares their independently measured errors. It checks play/pause, scrubbing without
candidate mutation, original-change invalidation, Viewer JSON saving, cold restart and portable
reopening. The fixed targets are in `tests/fixtures/robotics/base-placement.json`: target A is the
second SciPy reference gripper position translated 0.55 m along X; B adds 0.04 m along Y and
subtracts 0.04 m along Z. Neither the fixture passage nor HTML is a live model response. Replay does
not qualify collision safety or motion between endpoints.

Use a new absolute corpus path for each download. `tests/robotics.test.ts` compares every link at
three pinned poses against separately generated NumPy/SciPy matrices, and covers malformed trees,
unsupported semantics, scoped resource attachment and snapshot round trips. The retained reference
JSON does not require Python during tests; its generator is `tools/robotics/reference.py`.

`tests/native/dialogs.ts` checks Viewer folder selection, filtered multiple-file selection, folder
creation, Save As through Enter, editor warnings and Settings window ownership. It captures wide and
narrow light/dark layouts, reads back a newly saved file and retains every fixture. It never
replaces or removes a file and does not qualify native permission prompts. Run it against the
candidate with both preservation variables above. `tests/window-dialogs.test.ts` and
`tests/file-picker.test.tsx` cover cancellation, stale requests, access revocation, keyboard
selection and conflict review.

`tests/native/cli.ts` checks offline help/completion, exit codes, the authenticated packaged CLI,
content-search evidence, read-only Git, a real inspection workflow, proposal cancellation and speech
setup review at normal/minimum window sizes. It uses synthetic authority only inside its generated
profile; it does not qualify human consent or download speech models. Supply the candidate binary
and the preservation variables shown above.

`tests/native/speech.ts` checks the bundled runtime status, unsolicited microphone denial, Settings
at normal/minimum widths, searchable choices and missing-model recovery. With
`VIEWER_SPEECH_TEST_WEIGHTS` pointing to the pinned Tiny GGML fixture, it checks verified import and
selection/language restoration. `VIEWER_SPEECH_TEST_CLIP` adds a 16 kHz mono PCM16 public WAV
through the real AudioWorklet, IPC, recognizer and editable Ask draft. That scenario uses a
foreground window and a synthetic stream, never the live microphone; it skips capture unless macOS
permission has already been granted by the operator. It does not automate consent or qualify human
accents/noise.

`tests/native/stopped-window.ts` crashes a workspace window's renderer through the debugger. Hidden
runs answer **This window stopped working** with `VIEWER_TEST_STOPPED_WINDOW` (`reload` or `close`).
It checks that **Reload** restores the saved workspace, that **Close** closes the window well before
a save could time out, and that Quit succeeds after each.

`tests/speech-signing.test.ts` re-signs a generated runtime bundle, checks package verification and
rejects altered loose resources and tampered sealed files. Every fixture remains retained.

`tests/native/optimization.ts` checks loaded image/PDF comparisons, exact-byte export, source
preservation and normal/minimum-window layouts. `tests/native/optimization-recipes.ts` checks target
misses, individual retry, changed-source rejection, relative-folder outputs and recipe restoration
after restart. Both use generated isolated profiles and retain their evidence.

`tests/native/document-navigation.ts` measures cold and warm EPUB/XLSX opening through fresh
resource leases, alternating with another file for 30 cycles. It checks chapter/worksheet
restoration and unchanged fixture hashes. Set `VIEWER_TEST_WARM_BUDGET_MS` to enforce a
renderer-ready budget; these hidden-window measurements do not measure physical compositor frame
rate.

`tests/native/reader-actions.ts` checks worksheet range selection/copy and named EPUB bookmark
creation/return in the packaged readers, including normal/minimum-width light/dark captures and
retention through reopen, restart and a changed source copy. It uses a generated workbook, a
verified public EPUB copy and an isolated profile. Supply `VIEWER_TEST_BINARY` and both preservation
variables above; `VIEWER_TEST_READER_CORPUS` can select the retained public-book corpus. The
scenario captures requested clipboard text through a test adapter without replacing the person's OS
clipboard, so it does not qualify native clipboard integration. Inputs, captures and results remain
retained.

The app's `tests/native/` directory contains scenario drivers for Office layout, preview
restoration/recovery, mixed workspaces, task workflows, media and other features. Run them with the
same preservation variables and candidate binary. Their result identifies retained inputs, captures
and failures.

Scenario drivers pass page code as typed functions: `pageCall(fn, ...args)` from
`tests/native/runtime/page-function.ts`, or a one-selector read or action from
`tests/native/runtime/page.ts`. The page code is then type-checked against the DOM and formatted.
The function may use only its own body and its arguments, which travel as JSON;
`tests/page-function.test.ts` names any page function that uses something declared outside it. Lint
refuses string page code anywhere in `tests/` and `tools/`.

Mixed-workspace auditing supports 3–50 close/reopen cycles and optional heap snapshots. Track
retaining paths and owned lifetimes, not just total DOM counts. The known OrbitControls and
shared-texture leaks have separate regressions.

Use larger public files as well as generated samples: paginated PDFs, complex Office documents,
textured models and long media. Pin source hashes, preserve originals, inspect actual rendered
content, and test cancellation and a cold restart.

`tests/native/real-file-previews.ts` uses the stable playground by default. Set
`VIEWER_TEST_REAL_CORPUS` to a separate retained corpus with the same relative sample paths to
qualify files without changing the playground. Every input still requires its pinned size and hash.

`tests/native/format-samples.ts` opens one playground sample for each of the later formats (saved
previews, the extra 3D, camera RAW, Office, audio and video formats, mail, books, web archives,
certificates, shortcuts, torrents, profiles and binaries) in Quick Preview. It checks each one shows
its decoded content and expected text, and screenshots any that do not. It reads the same
`VIEWER_TEST_REAL_CORPUS`.

`tests/native/layout-acceptance.ts` checks the Layout plane, nesting, mail attachments and document
packages. It copies playground photos, PDFs, DXF parts, mail and a Pages package into its own
folder, and makes HEIC copies with `sips`, a card and an A1 page. It opens each from its Suggested
row, **More file actions** or ⌘K and saves: a collage as JPEG, PDF and transparent PNG, a contact
sheet, prints, cards, N-up, a booklet, a poster and a nesting folder. Every output is read back:
PDFs with qpdf and pdf.js (pages, page size and source text kept as text), pictures with sharp,
sheets with dxf-parser and the parts list row by row. Saved attachments must match their decoded
parts and carry the `com.apple.quarantine` mark. Undo of a layout and of a nesting folder must be
refused under `VIEWER_TEST_NO_REMOVAL=1`, with the files kept. It captures each mode in dark and
light in the run's `Evidence` folder and reads the same `VIEWER_TEST_REAL_CORPUS`.

`pnpm test:fabrication-native` (`tests/native/fabrication.ts`) checks a laser job end to end. Run it
with the preservation variables above; it uses `VIEWER_TEST_BINARY`, else the regular packaged
output, and qualification runs it on the direct candidate.

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 pnpm test:fabrication-native
```

- **Its job.** It writes `fabrication/Job 1042` and `fabrication/Evaluation` from the playground
  samples into its own folder. A loopback stub answers for the model with the test fixture's answer
  for Job 1042, and for SAM 3.1 with a recorded mask over the box asked about. The generated profile
  names the stub as a local Chat Completions endpoint that outlines with `sam-3.1`, and already
  allows it pictures, so no dialog is answered.
- **What it checks.** **Check laser job…** is not offered on the folder of jobs: **⌘K** lists it
  greyed out with why, and a click runs nothing. On Job 1042 it is offered with what it compares.
  The panel lists 7 files and finds one confirmed pitch, named by file, its feature outlined by SAM
  3.1. The title collapses the panel. The tour shows its 3 stops on the real engine, the drawing
  drawn with its text and feature outlined, the panel down while it plays. The correction is saved
  beside the unchanged original. **Nest and export handoff** nests each thickness and writes the
  folder, its tour pointed at the `Evidence/` copies. The kept check opens again. The Layout plane
  takes millimetres and inches, picks a part and has no sheet format without failing. **Dark pages**
  turns the PDF page dark and back. The panel stays with its workspace and returns as it was left.
- **Beside it.** A second instance runs in another generated profile.
- **Evidence.** Each step's screenshot, the app's logs and `result.json` go to its folder under
  `out/native-evidence/`. Every wait is bounded and names its step when it fails.

`tests/native/reader-qualification.ts` checks the published EPUBs pinned in
`tools/playground/reader-samples.ts`: long chapter lists, supported illustrations, internal notes,
Unicode links/search, query replacement, warm reopening and cold restart. Obtain these references
with `pnpm playground:qualify`; set `VIEWER_TEST_READER_CORPUS` to an alternative corpus root with
the same `qualification/readers/` paths. An optional filename argument selects one book. Source
hashes remain checked before and after every run.

`tests/native/document-recovery.ts` uses mutable copies of the public note-linked EPUB and large
workbook. It checks retained reading/selection state through a rename and a temporarily parked
folder, then changes document bytes to check cache invalidation. Pinned originals and before-edit
copies remain intact. An interrupted external save must show an error and recover after valid bytes
return; the owned app must still quit cleanly. It uses the same reader-corpus override; the workbook
comes from the stable playground. `tests/native/worksheet-pages.ts` separately covers deep public
worksheet pages, sparse rows, empty/malformed sheets, source citations and worksheet switching.

### Independent Office references

`tests/native/office-layout.ts` opens pinned public DOC/DOCX, XLS/XLSX and PPT/PPTX samples in the
candidate, exercises page/sheet navigation and retains the rendered PDFs. Set
`VIEWER_TEST_OFFICE_CORPUS` to the retained public corpus and use the preservation variables above.
Pass known sample filenames as arguments to rerun only those cases; no arguments runs the corpus.

On macOS, `tests/native/office-references.ts` exports independent PDFs with installed Microsoft
Word, Excel and PowerPoint. It opens verified copies, never saves the sources and closes only its
own documents. The operator may need to grant Office access to the generated inputs. Native
reference exports require those applications; they are not part of routine unit tests.

Word references exclude revision/comment markup. Excel exports the complete workbook: identify the
selected worksheet's native page range before comparing it with Viewer's single-sheet layout.
Copying a worksheet into a new workbook can change its theme and is unsuitable as a reference.
Rasterize matching pages and inspect images, tables, charts, typography and page breaks; extracted
text or matching page counts alone do not establish fidelity.

Set `VIEWER_TEST_OFFICE_REFERENCE_RETRY` to an earlier reference run to reuse its input copies and
granted file access. Each retry creates new output. `VIEWER_TEST_OFFICE_REFERENCE_FORMATS` accepts a
comma-separated format subset such as `doc,xls,xlsx`.

### Live model acceptance

`tests/native/live-model.ts` requires `VIEWER_TEST_LIVE_MODEL=1` and an explicit candidate binary.
It uses the saved Gemini provider and encrypted key from the normal macOS profile, creates a private
test profile and asks for native data-sharing approval. No saved data grant or agent access is
copied. The test sends generated filenames/metadata and short test prompts to the configured
endpoint; it can consume provider credits.

It checks discovery, default selection, structured output, Ask Viewer, an unavailable remote model
and revocation. The native Allow decision belongs to the operator. Test grants are revoked at the
end; the original configuration, encrypted credentials and sharing permissions must remain
unchanged.

## Canvas evaluation and replay

The **Workshop kits** supplier case is a regression and evaluation sample, not the current
[hackathon screenplay](../release/hackathon-demo.md). It keeps independently calculable results for
the generic canvas foundation. Paths in this section are relative to `packages/viewer-electron/app`;
run its commands from that package.

### Source and service checks

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 pnpm exec vitest run \
  tests/canvases.test.ts tests/canvas-productivity.test.ts tests/canvas-writes.test.ts \
  tests/chat.test.ts tests/chat-ui.test.ts tests/model-providers.test.ts --maxWorkers=2
```

These cover input retention, revisions, source snapshots, quote branches, result validation and the
provider protocol with fixtures. They make no paid model requests and do not qualify robot motion or
native file dialogs.

`tests/native/canvas-productivity.ts` uses a hand-authored calculator to exercise startup and rapid
input updates, source-driven totals, result review and restart in an isolated packaged profile.
`tests/native/canvases.ts` uses fixtures for sandbox isolation, quote branches, comparison,
conflict-aware application, portable content and bundled 3D rendering. Set `VIEWER_TEST_BINARY` to
the candidate being tested and retain both preservation variables. Neither fixture is
model-generation evidence.

### Shared canvas actions and station study

Run the service, protocol and independent placement checks without a provider:

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 pnpm --filter viewer-electron exec vitest run tests/canvas-actions.test.ts tests/robot-placement.test.ts tests/chat.test.ts
```

From the app directory, point the native test at a current preserved app and the pinned SO-101
corpus used by the robot rehearsal:

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 \
VIEWER_TEST_BINARY=/path/to/Viewer.app/Contents/MacOS/Viewer \
VIEWER_ROBOT_CORPUS=/path/to/SO-101 \
node --import tsx tests/native/station-actions.ts
```

The test verifies every corpus file against the pinned manifest, creates an isolated profile and
retains all outputs. It exercises real registered handlers, a visible control using the same action,
independent checks, takeover, an exact quote branch, compatible comparison, saved JSON, portable
reopen and a native cold restart. `summary.json` records outcomes and `providerRequests: 0`.
Screenshots cover the wide tool, its report, a narrow view, the alternative and the reopened tool.

The interface in `tests/fixtures/robotics/station.html` is supplied test code. These checks qualify
the action mechanism and station calculations, not Meta generation. Use the
[station generation gates](../research/workshop.md#station-generation-and-acceptance) and an
explicit new allowance before paid creation, revision or branching.

The live station runner starts with attached public source snapshots and meshes, without the
supplied HTML. Build a separately named qualification app so its main-process transport records and
caps actual provider requests before calling the unchanged desktop entry:

```sh
VIEWER_QUALIFICATION_BOOTSTRAP=tools/robotics/station-bootstrap.ts \
node --import tsx tools/build-preserving.ts /path/to/seed/Viewer.app out/station-live/Viewer.app

VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 \
node --import tsx tools/robotics/station-live.ts --serve \
  --corpus /path/to/SO-101 --binary /path/to/station-live/Viewer.app/Contents/MacOS/Viewer
```

Only use this runner after approval for three sessions of at most eight requests each. It copies the
selected Meta provider's encrypted credential, endpoint binding and existing data permission into an
isolated profile. It does not modify the original profile. In the runner, enter `create`, review the
retained native result, then enter `refine` and `branch` separately after each preceding gate
passes. `quit` ends the runner. Its process retains ownership of the generated profile across
stages. Failed and canceled outgoing requests consume the allowance; restarting the request
transport cannot reset it. Request headers are omitted and the API key is redacted from retained
bodies and responses. This instrumented build is for qualification only.

For separate invocations, use `--prepare --corpus <folder>`, then
`--live --run <run> --stage create|refine|branch --binary <executable>`. `--guidance <file>` appends
recorded instructions to the frozen stage prompt. `--resume <prompt-file>` continues the existing
stage and conversation within its remaining request allowance. A native repair of an already
generated result additionally needs `--repair-reason <reason>`; its saved canvas ID, revision and
HTML hash must still match. Neither continuation route starts another session or refunds failed
calls.

`--verify-selection` exercises the initial Central selection through the generated user control. Its
evidence attributes that action to the operator, not the model. Do not use it to claim an autonomous
model selection.

After all stages pass, run the actual generated artifacts through export and restart using an
ordinary packaged app:

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 \
node --import tsx tools/robotics/station-handoff.ts --run /path/to/live-run \
  --binary /path/to/Viewer.app/Contents/MacOS/Viewer
```

This creates another retained profile with no configured providers. It exports Front and Rear, saves
and reads back their independently checked JSON, imports the exact generated HTML and assets, and
checks both tools before and after restarting Viewer. Inputs must match exactly. Recomputed
floating-point measurements may differ by at most `1e-12` metres between Node and Electron; pass
counts, selected mounts and constraints must agree. No model requests are made. Native captures wait
for the framed plane to be inside the viewport and fully opaque.

Add `--presentation` to prepare a separate copy with the station's local visual corrections. The
runner first verifies the unchanged imported artifact, then applies `station-presentation.ts` to
that copy. It adds readable scene annotations, the fictional-station label, saved-state wording and
accessible control labels. Evaluation and action code must remain byte-for-byte identical; saved
inputs must match. The resulting copy is independently checked and exercised before and after
restart.

Each alternative retains `provider.html`, `presentation.html` and `presentation-edits.json` with
both hashes, plus an export in its `Presentation` folder. These are local presentation edits, not
model-authored improvements. This transformation accepts the qualified station HTML; it is not a
general styling pass for arbitrary canvases.

The chat regression covers a quoted canvas with repeated historical snapshots larger than the
model-context limit. Identical snapshot data can reference the current canvas; changed values and
check failures remain present. Saved transcripts and exact quote context remain unchanged. Meta's
current-turn results stay paired with native calls without a second copy in message history.

### Supplier sample and arithmetic

`tools/canvases/sample.ts` exports `canvasProject` and `canvasGoldenCases`; it is not a standalone
generator command. The evaluator and native replay call it to create **Request.pdf**, **North.csv**
and **East.csv** in their retained folders. The request identifies the suppliers and prices as
fictional, with CC0-1.0 sample provenance. Shipping is charged once per order; all prices are EUR
and include tax.

| Quantity | Budget | Deadline | North: 42 × quantity + 180, 7 days | East: 48 × quantity + 40, 2 days | Cheapest eligible |
| -------- | ------ | -------- | ---------------------------------- | -------------------------------- | ----------------- |
| 20       | 2,000  | 10 days  | 1,020, eligible                    | 1,000, eligible                  | East              |
| 40       | 2,000  | 3 days   | 1,860, late                        | 1,960, eligible                  | East              |
| 40       | 2,000  | 7 days   | 1,860, eligible                    | 1,960, eligible                  | North             |

Changing the allowed deadline from three to seven days adds four days. North's delivery itself is
five days slower than East's. Check both arithmetic and eligibility, not just whether a canvas
loads.

### Reuse saved responses first

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 pnpm exec tsx \
  tests/native/canvas-live.ts /path/to/retained/evaluation
```

The current driver expects `session-7.json` and `session-8.json` from the retained supplier
evaluation. It is not a generic session selector or a robot rehearsal. It imports the actual saved
HTML and source snapshots into a separate credential-free profile without changing the generated
HTML or contacting a provider.

The replay changes inputs, checks the visible totals, saves CSV and Markdown through the Viewer save
dialog, reads back the files, reopens the report and checks state after restart. It interacts only
with the owned test application's dialogs. Retain inputs, failures and results.

Add `--record` to retain frames, MP4, GIF and screenshots with the result report. This captures
existing output, not a fresh model call or a newly generated branch. The renderer recording includes
the Viewer save dialog; restart is checked after that capture. Do not imply restart appears in the
video without recording it separately. Inspect captures at their delivery resolution and remove
personal information from the public edit, while preserving the original evidence.

### Fresh provider evaluation

For a manual run, select the sample files and choose **Build tool from selection**. A configured
Meta model needs the appropriate data approval. Credentials stay outside the recording.

The automated entry is `tools/canvases/evaluate.mjs`, which loads `evaluate-main.ts` inside Electron
without a main-process debugger. It requires `--live`; `--profile` selects the local Viewer profile.
The default limit is three sessions, each bounded to eight model rounds. Run it only with an
explicitly approved budget. Extensions and recovery sessions consume that budget; prior approval
does not reset it for another case.

Retain actual requests, replies, failures, canceled requests and provider-reported usage. A
successful supplier evaluation says nothing about a robot solver. Use
[the implementation audit](../research/workshop.md#implementation-audit) to identify the additional
qualification required for the proposed film.

### Mounting and quote generation

`tools/mounting/rehearse.mjs` runs the real Chat service with an isolated profile and an explicit
allowance of two sessions, at most eight provider requests per session. Obtain approval before
`--live`. Preparation and credential checks make no provider requests:

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 pnpm --filter viewer-electron exec electron tools/mounting/rehearse.mjs --prepare /path/to/pinned/SO-101
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 pnpm --filter viewer-electron exec electron tools/mounting/rehearse.mjs --check-credentials --run /path/to/prepared/run --profile /path/to/credential/profile
```

Run `--live` with the same run and credential profile, first with `--stage mounting`. Qualify that
canvas in Viewer, save its draft drawing and request the local simulated supplier reply. Then use
`--stage comparison --reply /path/to/supplier-reply.json`. The reply is hashed before model access.
The review profile contains no credentials or configured providers.

Requests are reserved before network access, including cancellations, timeouts and rejected output.
`--resume-same-session` continues the same interrupted conversation using only its unspent request
allowance. It retains every earlier result and continuation record; it cannot refund requests, add a
session or continue an extended budget. A generated result still requires native interaction,
save/reopen and restart checks. It does not establish physical mounting fit or a real supplier
offer.

Qualify each generated stage with
`tools/mounting/qualify.ts --run <run> --binary <executable> --stage mounting|comparison`. It copies
the profile, exercises the generated controls and retains screenshots and a result report. Mounting
checks edit the width, review and save the DXF, reopen it in the native preview and restart.
Comparison checks deadline eligibility, selected-offer export and input persistence. These checks
make no provider requests.

Between stages,
`tools/mounting/request-supplier.ts --binary <executable> --drawing <saved.dxf> --material <material> --thickness <mm> --quantity <count>`
opens an isolated browser plane, requests the local simulated quote and reports its saved JSON path.
Supply the reviewed stock values explicitly; a DXF outline does not establish material or thickness.

After qualification,
`tools/mounting/prepare-review.ts --run <run> --mounting-profile <profile> --comparison-profile <profile> --binary <executable>`
assembles a separate review copy. It verifies that the qualified HTML, sources and assets match the
retained provider output, keeps the edited inputs and copies the saved files. The two workspaces
open directly on their canvas; **Conversation** opens the retained exchange. The report lists local
metadata changes and request counts. It does not start another generation session.

### Robot creation, revision and quoted alternative

The robot runner is separate from the supplier evaluation. Prepare an isolated project from the
retained pinned SO-101 corpus. Preparation copies and checks only the manifest files plus the fixed
world-target task; it reads no credentials and sends no requests.

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 pnpm --filter viewer-electron exec node --import tsx tools/robotics/prepare-rehearsal.ts --corpus /path/to/retained/so101
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 pnpm --filter viewer-electron exec electron tools/robotics/rehearse.mjs --check --run /path/to/prepared/run
```

The second command checks Electron startup and the desktop URDF reader without loading credentials.
Check access to the configured credential without contacting the provider:

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 pnpm --filter viewer-electron exec electron tools/robotics/rehearse.mjs --check-credentials --run /path/to/prepared/run --profile /path/to/credential/profile
```

This reads the endpoint-bound key inside Electron and reports only readiness. The entry sets the app
name before asynchronous imports so macOS selects Viewer's keychain service. The prepared
`plan.json` contains the exact prompts and source hashes. Inspect it before authorizing paid work.
There is no default live allowance. For example, after explicit approval for three sessions of at
most eight provider requests each:

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 pnpm --filter viewer-electron exec electron tools/robotics/rehearse.mjs --live --run /path/to/prepared/run --profile /path/to/credential/profile --stage create --sessions 3 --requests-per-session 8
```

Use `--provider <id>` when several Meta models are configured. Credentials are read only in
Electron's main process, without an inspector. The attached project is public and bounded; terminal,
command, rename and configuration proposals are unavailable. The copied meshes are local canvas
assets, not pictures sent to the provider. Source snapshots, tool metadata and the generated
conversation are sent through the normal Chat protocol.

Each invocation runs one stage and stops. `sessions/NN` retains the prompt, transport requests,
provider envelopes including usage, failures, generated documents and a review workspace. Headers
and the captured API key are excluded from retained records. Failed, rejected and canceled requests
consume the allowance. An interrupted session blocks automatic continuation. Restarting cannot
increase `budget.json`; inspect saved responses before considering a separately approved recovery.

After the original session allowance is exhausted, one explicit extension can add a bounded number
of sessions and a shared request allowance. Record the user's approval without changing the original
budget. For example, after approval for three more sessions and ten more requests total:

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 pnpm --filter viewer-electron exec node --import tsx tools/robotics/extend-rehearsal.ts --run /path/to/prepared/run --sessions 3 --requests 10 --approval 'User approved three additional sessions and ten additional requests total.'
```

This offline command exclusively creates `budget-extension.json`, bound to the completed session and
request counts. It refuses an unfinished attempt or a second extension. Subsequent live commands
keep the original budget flags. Each session retains its original per-session limit, and all
extended sessions together must fit the additional request allowance, including failed requests.

An explicit approval can distribute the remaining requests across more sessions without raising the
total request cap. `RobotRehearsalLedger.reallocate(maximumSessions, maximumRequests, approval)`
exclusively records `budget-reallocation.json`, bound to the preceding allowance. It requires the
same total request cap and refuses an unfinished attempt or a second reallocation. This is an
offline bookkeeping operation, not permission for more requests.

The runner prepares its own `Profile` with no configured models. Quit the live runner before opening
this profile in the candidate Viewer:

```sh
VIEWER_DATA_DIRECTORY=/path/to/prepared/run/Profile /path/to/Viewer.app/Contents/MacOS/Viewer
```

Review the actual generated HTML in its sandbox. Move a joint, confirm its source limit, change a
saved input, inspect errors and capture the result. Quit that isolated Viewer before starting
another runner invocation. Read the current saved state and its review token:

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 pnpm --filter viewer-electron exec node --import tsx tools/robotics/prepare-rehearsal.ts --status /path/to/prepared/run
```

Run `--stage refine` with the same budget flags and `--reviewed <token>` only after the native
review passes. The token binds the exact saved conversation and canvas; it does not execute tests or
prove the geometry correct. Existing inputs may change during review; edited HTML or source
snapshots cannot be passed off as the model's original output.

For `--stage branch`, first verify the refined targets, candidate poses and Viewer-owned checks.
Provide the latest review token plus
`--quote-message <id> --quote-start <offset> --quote-end <offset>`. Offsets use JavaScript string
indexing, with an exclusive end. Select a meaningful passage from the actual attributed assistant
reply printed by the status command. The runner uses Chat's branch operation and verifies that the
original canvas remains unchanged. It never supplies a fictional assistant passage.

Generation alone is recorded as `generated`, not qualified. Native checks of the actual output, base
comparison, pose replay, exported results and cold restart remain required. The runner's
`tests/robot-rehearsal.test.ts` uses an explicitly labeled offline provider fixture to test
ownership, input retention, quote selection and budget enforcement. Those tests are not live Meta
evidence.

If a generated revision fails native review, retain the observed error in a JSON file with
`canvasID`, `revision`, `htmlHash` (SHA-256 of the generated HTML) and `message`. Repeat the same
stage with `--repair /path/to/error.json` and its current `--reviewed` token. This sends the
diagnostic to the same conversation, preserves the failed output and consumes another approved
session. It does not extend the budget or permit progression to later stages. Review the repaired
output in Viewer before continuing. The standalone runner does not execute a preview while the model
is generating; `not-observed` is not successful execution.

After fixing a local parser rejection, `recoverRobotCanvas` in `tools/robotics/recover-canvas.ts`
can apply the latest failed session's intact saved `canvas_write` response without another provider
request. It requires the current review token, unchanged documents and the expected canvas revision.
It preserves the failed result and raw response, records the response hash in
`recovered-result.json`, and adds a tool recovery note without inventing an assistant reply. The
recovered HTML still needs native review. An interrupted recovery blocks further paid sessions.

### Prepare a presentation copy

After all three robot stages pass native review, prepare a separate profile for layout refinement:

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 pnpm --filter viewer-electron exec node --import tsx tools/robotics/prepare-presentation.ts --run /path/to/qualified/run
```

This offline command preserves the provider responses and canonical profile. It copies the qualified
creation, refinement and branch into a new retained profile, then applies the static layout in
`tools/robotics/presentation.ts` and `presentation.css`. Generated scripts stay byte-for-byte
unchanged. Saved target inputs and candidate poses are retained, camera framing is adjusted, and
Viewer recomputes both robot checks and their comparison.

The resulting `presentation.json` records the original and edited HTML hashes, unchanged script
hashes, revisions and zero provider requests. The generated interface identifies the layout as
locally refined. A presentation copy is not evidence that the model authored those edits. Exercise
its controls, inspector scrolling, narrow layout and pose replay in the rebuilt app before filming.

Run the foreground interaction rehearsal against a qualified packaged binary:

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 pnpm --filter viewer-electron exec node --import tsx tools/robotics/rehearse-presentation.ts --run /path/to/qualified/run --binary /path/to/Viewer.app/Contents/MacOS/Viewer --record
```

This makes another presentation copy without contacting a provider. Plane framing is setup outside
the recorded takes. It drives the visible controls with pointer and keyboard input: all six joints,
camera orbit, a captured joint definition, target coordinates, independent checks, comparison save,
portable export and import. It restarts its owned app to verify the task and paused replay. Outputs
go into the new copy's **Handoff** folder. The folder chooser must display that destination before a
save proceeds.

`--record` retains continuous renderer clips at 1440 × 900 and 30 output frames per second, plus
delivered-frame timestamps and input traces. Idle frames may repeat; the timestamps retain actual
elapsed time. It includes Viewer file pickers, but not operating-system dialogs or an
operating-system restart recording. Omitting the flag runs the same interaction checks without video
encoding. `foreground-review.json` retains partial results after a failure; only `completed.json`
marks the whole run passed. Keep the recordings, source hashes and failures. These silent rehearsal
takes are saved-session evidence, not a finished film or live model-generation footage.

## What evidence means

| Check                     | Establishes                                            |
| ------------------------- | ------------------------------------------------------ |
| Source/unit/component     | The exercised rule and mocked/service contract         |
| Browser harness           | Renderer behavior with its stated fixture adapters     |
| Packaged native           | The exercised binary, OS, architecture and integration |
| Foreground trace          | Physical-window observations for the exact workload    |
| Cross-platform CI         | Only the platforms and cases that actually ran         |
| Signed release acceptance | Separate distribution/runtime gates                    |

Hidden-window intervals are scheduling observations, not display FPS. Summed process RSS includes
shared pages and heap-snapshot overhead; it is not unique physical or private GPU memory. Record
residual growth instead of claiming all caches stabilize indefinitely.

## Preserve useful evidence

Write run-specific logs, profiles, heap snapshots, hashes and screenshots to generated output.
Public docs explain reproduction and current limits rather than accumulating candidate names and
historical test counts. Report passed, failed, skipped and unexecuted checks distinctly.

Fixtures and failed artifacts remain until exact-path removal is approved. Human removal/consent
confirmations must be clicked by the operator when required; agents never approve their own removal.
See [AGENTS.md](../../AGENTS.md) and [release gates](releases.md).

`tests/native/save-recovery.ts --interactive` prepares a generated original and draft, then waits
for exact-path approval before opening the operator Save step. Its recovery check copies the
verified original from Trash to a new file; it never empties Trash or replaces a recovery target.
`VIEWER_TEST_PRESERVE=1` keeps staging and abandoned temporary artifacts even during an operator
session where explicitly approved Trash actions are enabled.

`tests/native/agent-consent.ts --interactive` exercises denial, grants, scoped reads and revocation.
Add `--deny-only` to check native cancellation without granting any access. Its receipt marks the
remaining grant checks unverified; an operator denial check is not full consent acceptance.

`tests/native-agent-navigation.ts`, `tests/native-agent-clients.ts` and
`tests/native-agent-safety.ts` need agent access, which only the native Allow grants: neither
configuration nor a Settings patch turns it on. Run them with `--interactive` in a supervised
terminal and click Allow twice, once for the shared client and once for the generated folder.
Without `--interactive` they stop before creating anything.
