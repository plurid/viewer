# Review findings

Open problems found by a review of the code and documents (commits `c89e21f1` and `f0dbe549`). Each
item names its first place in the code, relative to `packages/viewer-electron/app`. An item leaves
this page in the change that fixes it.

How to read an item:

- **S1** data, safety or the person's authority at risk on a common path. **S2** a wrong result or a
  blocked task people will meet. **S3** a rare state, a rough edge, or a page that disagrees with
  the code.
- **Confirmed** means a second reviewer reproduced it with a test or traced it end to end. Every
  other item was found by one reviewer reading the code: confirm it before you fix it.
- Findings about security, an agent acting beyond its grant, or losing files are kept out of this
  page until they are fixed.

Open here: 132 (S1 0, S2 28, S3 104); 26 confirmed.

## Decisions the owner made

- **Empty Trash.** The Trash window has **Empty Trash…**, which erases for good after a native
  confirmation (`tools/trash-ui.h`). Decision: keep it as a command only the person can choose;
  agents can never reach it, and the pages say so. Done.
- **What an agent may read from the configuration.** Decision: configuration reads show only paths
  inside the agent's granted folders. Done.

## How the open items are handled

The fix waves ended on 27 November 2026. They closed every finding of the highest severity and most
of the next: agents and actions, operations and the Trash engine, previews, windows and saved state,
files and native helpers, models and speech, settings and commands, the CLI with license, updates
and the build, persistence, the explorer and workspaces, canvases, Git and runtimes. Each fix has a
test, and the whole suite runs on every push.

What is listed below stays open on purpose. An item is fixed when a person meets it or when it
blocks a release; a new problem is added here first. Layout, fabrication and media hold the largest
group, because their wave was not finished.

Open decisions for the owner:

- **The search field in menus.** DESIGN.md gives long lists a field reading "Search" and gives menus
  of 8 or fewer choices none; an older checklist asks for "Search speech language…".
- **The Trash address.** `viewer://trash` now opens the Trash from Go to Folder, the command line
  and the terminal, and the reference says so. It can stay documented or become internal.
- **The file index.** It is now compacted and its stored text is bounded per file. Showing its size
  in Settings, or giving it an overall budget, is not built.

See the [roadmap](../research/roadmap.md) for what comes next.

## Files, operations and the Trash

- **S2** Copy Event ID never copies: the ID is sent as a path and the request is refused.
  `src/renderer/journal/JournalPlane.tsx:404` Confirmed.
- **S3** A checkpoint whose removal failed is described as 'This copy was not finished'.
  `src/renderer/ui/operations/Checkpoints.tsx:44`
- **S3** A second click on Skip or Keep Both answers the next file's name prompt unseen.
  `src/renderer/operations/OperationsPanel.tsx:161`
- **S3** After Clear Finished, Command-Z undoes the oldest file operation, not the latest.
  `src/renderer/state/jobs.ts:84`
- **S3** After Move History to Trash…, Command-Z fails every time and blocks Undo of earlier jobs.
  `src/desktop/journal/handlers.ts:90`
- **S3** Backspace while a Trash folder loads jumps to the top of the Trash, not to the parent.
  `src/renderer/ui/trash/Trash.tsx:454`
- **S3** Cancelling a change review leaves its plan pending; large reviews are then refused for
  good. `src/renderer/ui/operations/OperationReview.tsx:31`
- **S3** File Operations and Journal pages name controls and lists the interface does not have.
  `src/renderer/operations/OperationsPanel.tsx:69`
- **S3** Journal search drops each typed space, so a two-word search cannot be typed.
  `src/renderer/journal/JournalPlane.tsx:128`
- **S3** Last hour is stored as a fixed start time and the control then reads Time range….
  `src/renderer/journal/JournalPlane.tsx:171`
- **S3** No test in the suite renders the Trash window or presses Copy Event ID.
  `tests/trash-presentation.test.ts:1`
- **S3** Put Back and Apply Changes wait in silence behind any running job or unanswered name
  prompt. `src/desktop/ipc/access-handlers.ts:102`
- **S3** Put Back still answers 'N items restored.' and its errors still say Restore.
  `src/renderer/ui/trash/Trash.tsx:193`
- **S3** Save Export… after the system panel's Replace shows 'EEXIST: file already exists'.
  `src/desktop/journal/handlers.ts:71`
- **S3** Schema text reaches the person: over 1,000 Trash items, or an emptied name in a review.
  `src/desktop/ipc/schemas.ts:965`

## Windows, saved state and the app shell

- **S3** A profile copied while a private store's recovery is interrupted can stay unreadable.
  `src/desktop/persistence/metadata-publication.ts:172`

## CLI, updates, license and the build

- **S3** The three GitHub workflows install pnpm 11.3.0 while package.json pins pnpm 12.23.0.
  `.github/workflows/source-checks.yml:36`

## Commands and the palette

- **S3** Command-line completion reads a path with ~ or a space from the wrong folder.
  `src/renderer/command-line/complete.ts:144`

## Browsing and search

- **S2** Viewer's file index grows without a stated bound: 4.9 GB on the owner's Mac.
  `src/desktop/files/file-services.ts:91`
- **S3** A long name in Grid view breaks its first line inside a word, and one name shows a space
  after the ellipsis.
- **S3** A search plane opened from Find File keeps its first query as its title after the query is
  changed. `src/domain/workspaces/planes.ts:59`
- **S3** First-run tips ignore the Own Keys rule and show stolen default shortcuts.
  `src/renderer/explorer/FolderInsights.tsx:101-108`

## Workspaces and the space

- **S3** Closing a folder-only workspace can leave Manage Workspaces closed after the replacement
  workspace is saved.

## Git and task areas

- **S3** The branch task form shows the new folder as a full home path.

## Layout and fabrication

- **S2** Closing Nesting while reading DXFs leaks desktop resource grants and worker errors hang.
  `src/renderer/layout/nesting/useNestingFiles.ts:40-77` Confirmed.
- **S2** Contact sheet candidate cards drop the active column count and offer 11 to 14 columns.
  `src/domain/layout/candidates.ts:79-102` Confirmed.
- **S2** Failed or canceled correction or handoff hides its Save or Export button permanently.
  `src/renderer/fabrication/CheckPanel.tsx:60-66` Confirmed.
- **S2** Nesting number inputs lost their 76 px width in the NumberField sweep and overflow rows.
  `src/renderer/layout/nesting/nesting.css:36-38` Confirmed.
- **S2** One quantity or thickness finding on a drawing hides other parts' mismatches on it.
  `src/domain/fabrication/reconcile.ts:102-107` Confirmed.
- **S2** Prepare Cut Sheets dead-ends parts lacking quantity, thickness or whole-set counts.
  `src/desktop/fabrication/service.ts:243-248` Confirmed.
- **S2** Run Again on an unchanged check keeps the old handoff ID and hides Export Handoff.
  `src/desktop/fabrication/service.ts:836-844` Confirmed.
- **S2** Search Longer extra time persists across edits, thickness tabs and Search changes.
  `src/renderer/layout/nesting/useNestSearch.ts:31-32,85-86,100-103` Confirmed.
- **S2** Unfittable DXF parts still enable Save Nesting, poison handoffs and break headline.
  `src/renderer/layout/nesting/NestingPanel.tsx:117-129` Confirmed.
- **S3** Agents cannot open Layout/Nesting planes; propose_transform hides layout, lists nesting.
  `src/renderer/layout/commands.ts:16-61`
- **S3** Agents cannot read saved fabrication checks or run deterministic DXF measurements.
  `src/desktop/agents/service-catalog.ts:12-95`
- **S3** Filtering PDF text runs calls quoteOn per run, re-squashing page text up to 3,000 times.
  `src/desktop/fabrication/service.ts:1058-1060`
- **S3** Halves and Thirds collages with a large gap emit negative frames that fail Save.
  `src/domain/layout/collage.ts:355-413`
- **S3** Layout Output name bypasses FileNameField and Output Form Rule, saving bare '.pdf'.
  `src/renderer/layout/LayoutPlane.tsx:206-223,377,495-506`
- **S3** LayoutPlane splits pane.sources on newline, breaking filenames that contain a newline.
  `src/renderer/layout/LayoutPlane.tsx:103,110`
- **S3** Nesting Thickness, Speed in inches, Price and total pieces accept values Save rejects.
  `src/renderer/layout/nesting/NestingSettings.tsx:218-225`
- **S3** Report.pdf breaks Save Nesting past 2,500 parts on a sheet or 2,000,000 drawn points.
  `src/domain/layout/nesting/report.ts:339-376`
- **S3** Requirement review breaks Escape handling, disclosure reuse and primary button rule.
  `src/renderer/fabrication/CheckPanel.tsx:189-195`
- **S3** Run Again on a stale check plane pops up a duplicate floating check panel.
  `src/renderer/fabrication/check.ts:470-486`
- **S3** Sheet formats table puts role='cell' directly on inputs, hiding their textbox role.
  `src/renderer/layout/nesting/NestingSettings.tsx:201-225`
- **S3** verifyNest checks one point per part, missing multi-outline and open-path overlaps.
  `src/domain/layout/nesting/verify.ts:74-109`
- **S3** Zero-piece quantity renders '0 sets × NaN pieces = 0 pieces' and fails handoff nesting.
  `src/domain/fabrication/part-values.ts:15-20`

## Media, transforms and PDF tools

- **S2** Add Audio… with Cut set to Fast leaves the media draft invalid for every later edit.
  `src/desktop/transforms/media-documents.ts:188-196` Confirmed.
- **S2** Adding an audio-only segment in Edit Media leaves Format on MP4 and fails export.
  `src/renderer/media/MediaPlane.tsx:260-267` Confirmed.
- **S2** Agents cannot read media duration or codecs, so media propose_transform must guess.
  `src/desktop/agents/tool-catalog.ts:59-71` Confirmed.
- **S2** Image Tools hides export errors and prints raw job status like 'cancelled'.
  `src/renderer/media/ImageToolsDialog.tsx:222` Confirmed.
- **S2** Optimize Limit image dimensions rejects every value over 10,000 px as over 100 MP.
  `src/domain/operations/optimization.ts:67` Confirmed.
- **S3** Edit Media lets Export each segment and Export current frame run together, misnaming PNG.
  `src/renderer/media/MediaPlane.tsx:768-799`
- **S3** Files saved by Optimize are written with mode 0600, unlike every other export (0644).
  `src/desktop/transforms/optimization-reviews.ts:400`
- **S3** Optimize disclosures are neither grouped nor closed on Escape, breaking One Disclosure.
  `src/renderer/media/OptimizeDialog.tsx:214-218`
- **S3** Optimize Lossless strips DateTimeOriginal from JPEGs while Balanced and Smaller keep it.
  `src/desktop/transforms/jpeg-metadata.ts:25-65`
- **S3** Optimize results table CSS targets wrong columns after adding the Select column.
  `src/renderer/media/optimization.css:201-215`
- **S3** PDF Tools Add PDFs… after a failed load leaves the preview stuck on No PDF pages loaded.
  `src/renderer/pdf-tools/PDFToolsDialog.tsx:152-166`
- **S3** PDFPagePreview never clears its 15 s slow-load error if the PDF finishes loading later.
  `src/renderer/pdf-tools/PDFPagePreview.tsx:35-37`
- **S3** The Optimize dialog's result table scrolls sideways with long names.

## Previews

- **S2** A supplied preview resource still has no Try Again action after a transient read failure.
  `src/renderer/previews/PreviewHost.tsx:544`
- **S3** The grant card drops the file provider’s instruction to refresh the folder when a file
  moves during coordination. `src/renderer/previews/useResource.ts:62`
- **S3** The registry table can pass when a registered sentence is dropped by the action that
  actually shows it. `tests/reader-cards.test.tsx:289`

## Interface controls and styles

- **S2** NumberField turns comma-grouped integers like 1,920 into 2.
  `src/renderer/ui/NumberField.tsx:9-17` Confirmed.
- **S2** Pressing outside a button menu still runs controls that act on pointerdown.
  `src/renderer/ui/Popover.tsx:267-278` Confirmed.
- **S2** Refocusing NameDialog after editing resets the cursor using the initial text.
  `src/renderer/ui/primitives.tsx:307-337` Confirmed.
- **S2** Searchable menus omit combobox role before typing, hiding items from VoiceOver.
  `src/renderer/ui/ContextMenuResults.tsx:306-315` Confirmed.
- **S3** File Operations count badge renders square due to undefined --radius-menu.
  `src/renderer/styles/base.css:660-673`
- **S3** FileNameField counts UTF-16 units instead of UTF-8 bytes on APFS.
  `src/renderer/ui/FileNameField.tsx:18-30`
- **S3** Keyboard focus strips primary accent fill and danger ink in most dialogs.
  `src/renderer/styles/base.css:160-164`
- **S3** NumberField inside FormField stretches full width instead of staying compact.
  `src/renderer/ui/form-fields.css:23-33`
- **S3** Seven screens show full home paths instead of ~.
- **S3** Text CopyButton hides failure reasons from sighted users, especially in Settings.
  `src/renderer/ui/primitives.tsx:391-394`
- **S3** The speech language menu's search field reads 'Search' where its checklist expects 'Search
  speech language…', and the View menu of 7 choices has a search field.
- **S3** useListKeys fails to cycle repeated letters within 1 s and misses NFD names.
  `src/renderer/ui/useListKeys.ts:8-15`

## Developer tools

- **S2** Accepting a variant-filtered or errored review run drops baselines or saves broken shots.
  `tools/review/baseline.ts:89-105` Confirmed.
- **S2** name-extension check misses FileName drops because visually-hidden holds the full name.
  `tools/review/checks.ts:572-595` Confirmed.
- **S2** Trash review scene and palette Trash command fail because viewer://trash hits stat.
  `tools/review/scenes/files.ts:24` Confirmed.
- **S2** Two checklist scenes always fail on stale selectors for FileNameField and ChoiceMenu.
  `tools/review/scenes/checklists.ts:309-313` Confirmed.
- **S2** Uncaptured review scenes show No problems found and count as covered in coverage.
  `tools/review/coverage.ts:177-180` Confirmed.
- **S3** Architecture import check allows desktop to import renderer and skips preload files.
  `tools/architecture/imports.ts:69-89`
- **S3** boxOf mixes scaled coordinates with unscaled dimensions in expectGap and outlines.
  `tools/review/page.ts:81-101`
- **S3** Review sheet blocks keyboard zoom, hides mark state and leaves empty headings on filter.
  `tools/review/sheet-script.ts:189-220`
- **S3** Scenes added in wave 4 were written without a run and several of their checks misfire.
  `tools/review/scenes/wave4-explorer.ts`
- **S3** The review run cannot show the Trash's rows: its sample Trash 'could not be verified'.
- **S3** Wildcard covers.commands entries never match runtime command IDs in coverage.
  `tools/review/coverage.ts:189-193`

## Documents and the pages that describe the code

- **S2** Page and code disagree: the turn that creates a canvas gets two minutes, not eight.
  `src/desktop/chat/service.ts:488` Confirmed.
- **S2** Settings → Privacy says only a model receives data; recordings and photos also leave the
  Mac. `src/renderer/ui/settings/PrivacyInformation.tsx:4` Confirmed.
- **S3** $$ stays two dollar signs in a named line that has no $1 to $9 or $*.
  `src/domain/command-line/lex.ts:146-150`
- **S3** A 70 MB OBJ is read whole twice, then refused with a message naming a 128 MB limit.
  `src/renderer/previews/modules/ModelPreview.tsx:556`
- **S3** A bare pnpm test by an agent moves about 900 test folders to the Trash unasked.
  `tools/temporary.ts:31`
- **S3** A canvas over about 131,000 characters fails every turn in which the model reads it.
  `src/domain/models/chat.ts:19`
- **S3** A non-ASCII command or commit message under 16,000 characters is refused past 16,000 bytes.
  `src/desktop/actions/executions.ts:100-103`
- **S3** ADRs 0009 to 0012 have no status line at all. `docs/adr/0009-window-owned-speech.md:1-3`
- **S3** AGENTS.md names two exceptions; removal.ts removes without the Trash in five named cases.
  `src/desktop/operations/removal.ts:120`
- **S3** Audio or video export is stopped after 10 minutes of processing, whatever its length.
  `src/desktop/transforms/transforms.ts:417`
- **S3** Contact sheet on a screen size is saved at paper resolution, not at its pixels.
  `src/domain/layout/planner.ts:335`
- **S3** DESIGN.md gives two minimum window sizes; the window's own minimum is 780 × 560.
  `DESIGN.md:509`
- **S3** DESIGN.md states seven rules twice in different words. `DESIGN.md:324`
- **S3** docs/reference/agents.md is loaded as agent instructions (AGENTS.md) on a case-insensitive
  volume. `docs/reference/agents.md:1`
- **S3** Editing a sequence's Commands in Settings drops its :Name and splits lines at commas.
  `src/renderer/ui/settings/AutomationSettings.tsx:468-481`
- **S3** Eight kept speech-model attempts end local model setup; nothing in Viewer removes one.
  `src/desktop/speech/models.ts:232`
- **S3** Fast cut is offered or withheld by the clip shown under Source, not the segment's clip.
  `src/renderer/media/MediaPlane.tsx:257`
- **S3** Four decisions of the last three days have no ADR; two had no record outside code.
  `src/domain/preferences/shortcuts.ts:355-372`
- **S3** Go to Folder… cannot open ./ or ../ paths, which the guide lists and ⌘K opens.
  `src/renderer/explorer/GoToFolderDialog.tsx:54`
- **S3** Interface keeps UK spellings the lint list misses: Aluminium, neighbour, neighbouring.
  `src/domain/layout/nesting/plan.ts:169`
- **S3** Page and code disagree: a custom workflow stopped by a workspace or plane change has no
  step prefix. `src/renderer/commands/programs.ts:359-366`
- **S3** Page and code disagree: a duplicated tool is called separate, yet it shows Apply to
  Original. `src/desktop/chat/service.ts:312`
- **S3** Page and code disagree: a GLB with unsupported compression is said to be refused; nothing
  checks it. `src/desktop/canvases/glb.ts:38`
- **S3** Page and code disagree: a refused model line is still shown, and Tab opens it to run.
  `src/renderer/command-line/PromptFinder.tsx:159-178`
- **S3** Page and code disagree: a session folder given as a link is accepted.
  `src/desktop/agents/sessions.ts:47-50`
- **S3** Page and code disagree: empty Executable falls back to /bin/sh for Run Command, /bin/zsh
  elsewhere. `src/desktop/actions/executions.ts:159`
- **S3** Page and code disagree: full command-record message; nothing clears the 1,000 records.
  `src/desktop/actions/receipts.ts:86-89`
- **S3** Page and code disagree: one refusal for the shared connection has five wordings.
  `src/desktop/agents/agent-broker.ts:550`
- **S3** Page and code disagree: speech system dialog buttons differ in case from the review
  buttons. `src/desktop/native/native-confirmation.ts:46-51`
- **S3** Page and code disagree: Step and repeat starts at a 5 mm margin for one photo, the page
  says 10 mm. `src/domain/layout/suggest.ts:75`
- **S3** Page and code disagree: Tab takes the first completion, not the highlighted one.
  `src/renderer/command-line/LineFinder.tsx:295-301`
- **S3** Page and code disagree: the Journal shows “cancelled” where the page says “canceled”.
  `src/domain/journal/events.ts:165`
- **S3** Page and code disagree: the message of a file-changing step cut off by Quit.
  `src/desktop/automation/workflows.ts:118-122`
- **S3** Page says tools/list schemas are exact; the service tools' advertised limits differ from
  what is parsed. `src/desktop/agents/service-catalog.ts:22`
- **S3** pnpm qualify runs the test suite without the preservation flags and never exits with 0.
  `tools/qualification.ts:136-143`
- **S3** pnpm start and the Store package delete the previous .vite for good, not to the Trash.
  `package.json:34`
- **S3** Poster drops sheet labels and trim marks under a small margin and says nothing.
  `src/domain/layout/planner.ts:708`
- **S3** Reset Space, Previews and Browsing Defaults leave settings of their own page unchanged.
  `src/renderer/ui/settings/Settings.tsx:343`
- **S3** Robot Check Rule governs panels the shipped app never mounts. `DESIGN.md:431`
- **S3** Rules disagree: DESIGN.md keeps a Robot Check Rule for a report the app no longer has.
  `DESIGN.md:431`
- **S3** Smoke script expects 'approve agent access', a message Viewer no longer prints.
  `tests/electron-smoke.ts:5259`
- **S3** Some ⌘K command labels stayed in sentence case after the change to Title Case.
  `src/renderer/previews/modules/ModelPreview.tsx:783`
- **S3** Speech Setup Rule asks for MiB; Settings → Speech shows decimal MB. `DESIGN.md:734`
- **S3** Store build offers New Task from Branch…, which can only fail there.
  `src/renderer/commands/programs.ts:81-89`
- **S3** The guide comments Viewer writes into config.jsonc are stale in six places.
  `src/desktop/preferences/configuration-comments.ts:272`
- **S3** tools/list advertises 200 characters for git_diff base; the parser accepts 300.
  `src/desktop/agents/service-catalog.ts:8`
- **S3** ui.recentCommands: validation accepts 30 IDs, the app keeps 20.
  `src/domain/preferences/presentation/ui-schema.ts:103`
