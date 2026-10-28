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
throughout source, tests and tools. Source CI also checks production dependency advisories; see
[runtime dependencies](dependencies.md).

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
a test pass.

## Focused native scenarios

`tests/native/cli.ts` checks offline help/completion, exit codes, the authenticated packaged CLI,
content-search evidence, read-only Git, a real inspection workflow, proposal cancellation and speech
setup review at normal/minimum window sizes. It uses synthetic authority only inside its generated
profile; it does not qualify human consent or download speech models. Supply the candidate binary
and the preservation variables shown above.

`tests/native/optimization.ts` checks loaded image/PDF comparisons, exact-byte export, source
preservation and normal/minimum-window layouts. `tests/native/optimization-recipes.ts` checks target
misses, individual retry, changed-source rejection, relative-folder outputs and recipe restoration
after restart. Both use generated isolated profiles and retain their evidence.

`tests/native/document-navigation.ts` measures cold and warm EPUB/XLSX opening through fresh
resource leases, alternating with another file for 30 cycles. It checks chapter/worksheet
restoration and unchanged fixture hashes. Set `VIEWER_TEST_WARM_BUDGET_MS` to enforce a
renderer-ready budget; these hidden-window measurements do not measure physical compositor frame
rate.

The app's `tests/native/` directory contains scenario drivers for Office layout, preview
restoration/recovery, mixed workspaces, task workflows, media and other features. Run them with the
same preservation variables and candidate binary. Their result identifies retained inputs, captures
and failures.

Mixed-workspace auditing supports 3–50 close/reopen cycles and optional heap snapshots. Track
retaining paths and owned lifetimes, not just total DOM counts. The known OrbitControls and
shared-texture leaks have separate regressions.

Use larger public files as well as generated samples: paginated PDFs, complex Office documents,
textured models and long media. Pin source hashes, preserve originals, inspect actual rendered
content, and test cancellation and a cold restart.

`tests/native/real-file-previews.ts` uses the stable playground by default. Set
`VIEWER_TEST_REAL_CORPUS` to a separate retained corpus with the same relative sample paths to
qualify files without changing the playground. Every input still requires its pinned size and hash.

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
