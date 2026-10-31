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
