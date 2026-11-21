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

Open here: 211 (S1 0, S2 68, S3 143); 68 confirmed.

## Decisions for the owner

- **Empty Trash.** The Trash window has **Empty Trash…**, which erases for good after a native
  confirmation (`tools/trash-ui.h`). Decision: keep it as a command only the person can choose; the
  pages that say Viewer never empties the Trash are to say so.
- **What an agent may read from the configuration.** Decision: configuration reads show only paths
  inside the agent's granted folders.

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
- **S3** Journal export's default file name carries the UTC date, not the person's date.
  `src/desktop/bridge.ts:2541`
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

- **S2** Backup relinking updates Layout sources but leaves quantities and thicknesses unmapped.
  `src/desktop/persistence/backup-state.ts:116-117` Confirmed.
- **S2** Restoring a backup with an agent session plane breaks it and blocks all future backups.
  `src/desktop/persistence/backup-state.ts:60-72` Confirmed.
- **S3** Backup restore writes all documents before validating config, stranding copies on failure.
  `src/desktop/persistence/backup.ts:470-478`
- **S3** Closing or quitting traps Viewer in a Retry loop when saved state is newer or unmovable.
  `src/desktop/persistence/storage.ts:471-498`
- **S3** ModelPermissions and Updates overwrite unreadable or newer-version files without backup.
  `src/desktop/models/model-permissions.ts:67-76`
- **S3** Names of 92-100 characters fail to save for profiles, layouts and themes via slugID.
  `src/domain/ids.ts:15-26`
- **S3** Non-atomic backup writes leave corrupt files that block later backups; check index races.
  `src/desktop/persistence/backup.ts:322-331`
- **S3** One failed DocumentStore save poisons all later load() calls for the rest of the session.
  `src/desktop/persistence/document-store.ts:16-17`
- **S3** Storage.save checks UTF-16 length while load checks UTF-8 bytes, quarantining valid state.
  `src/desktop/persistence/storage.ts:538`

## CLI, updates, license and the build

- **S2** CLI exits with code 1 instead of 3 on disconnect and 1 instead of 124 on 120 s timeout.
  `src/desktop/cli/client.ts:40` Confirmed.
- **S2** Compiled binary assets/viewer-image-preview is tracked in Git and rewritten by builds.
  `tools/build-helpers.ts:47-61` Confirmed.
- **S2** forge.config.ts omits continueOnError: false, so pnpm package and make succeed unsigned.
  `forge.config.ts:42-60` Confirmed.
- **S2** processors.ts and speech-runtime.ts reuse old binaries after sharp, libvips or C++ edits.
  `tools/processors.ts:124-137` Confirmed.
- **S2** Store build ships speech runtime and mic plist text while policy says direct-only.
  `forge.config.ts:75` Confirmed.
- **S3** DiagnosticLog rotates by UTF-16 characters against a UTF-8 byte limit and rewrites on every
  entry. `src/desktop/diagnostics/diagnostics.ts:62`
- **S3** eslint.config.mjs omits src/report-preload.ts from Electron 45 sandboxed preload rules.
  `eslint.config.mjs:109-134`
- **S3** Overlapping Check for Updates and launch check open two update dialogs.
  `src/desktop/updates/updates.ts:187`
- **S3** pnpm make and forge osxNotarize permanently delete prior ZIPs and notarization archives.
  `package.json:56`
- **S3** redactCredentials erases the rest of a log entry after an empty credential value.
  `src/domain/diagnostics/secrets.ts:89`
- **S3** tools/build-preserving.ts packs @napi-rs inside app.asar and writes stale mic text.
  `tools/build-preserving.ts:226`
- **S3** VIEWER_BUILD_ARCH=x64 packs x64 helpers into an arm64 app and skips Trash for it.
  `package.json:55-56`

## Settings and keys

- **S2** Exported recipes cannot be re-imported because Import Recipes appends duplicate IDs.
  `src/renderer/ui/settings/RecipeSettings.tsx:191-226` Confirmed.
- **S2** KeyCapture records Shift+punctuation as the shifted symbol, bypassing conflict checks.
  `src/renderer/ui/settings/KeyCapture.tsx:5-21` Confirmed.
- **S2** Multi-key root bindings and non-canonical leader keys pass validation but never run.
  `src/renderer/keys/sequences.ts:170,179` Confirmed.
- **S2** Reset a section for Search indexes / or keeps a custom root instead of resetting to Home.
  `src/renderer/ui/settings/AutomationSettings.tsx:725-731` Confirmed.
- **S2** Shortcut hints and Speech Settings still show shipped keys yielded under Own Keys.
  `src/renderer/keys/hints.ts:9-13` Confirmed.
- **S3** Go to Folder alternate Cmd+Shift+G never yields under Own Keys or when turned Off.
  `src/domain/preferences/shortcuts.ts:70,404-408`
- **S3** normalizePreferences truncates ui.list.order to 6 columns, dropping the 7th column.
  `src/domain/preferences/ui.ts:222`
- **S3** Reset All Shortcuts, Prefix Keys, Remove Mode and Reset Navigation act without asking.
  `src/renderer/ui/settings/ShortcutSettings.tsx:91`
- **S3** Session Keep and Discard in Settings report errors to the unrendered workspace store.
  `src/renderer/ui/settings/KeymapSettings.tsx:30-66`
- **S3** validate_config and propose_config succeed while config.jsonc is broken, then Apply fails.
  `src/desktop/preferences/settings.ts:375-407`

## Commands and the palette

- **S2** :set termlinespace=<value> always fails validation because :set sends a string.
  `src/domain/command-line/set.ts:105-119` Confirmed.
- **S2** In a preview plane, Copy Path (⌥⌘C and ⌘K), Inspect File and Suggested do not work.
  `src/renderer/commands/copy-path.ts:4-10` Confirmed.
- **S2** Plane toolbar appears twice in Settings search and neither row applies Essential or Full.
  `src/renderer/commands/window-commands/settings.ts:110-124` Confirmed.
- **S2** Typing %/ or %:h/ in the command line without an active plane path crashes the window.
  `src/renderer/command-line/complete.ts:144-147` Confirmed.
- **S3** Custom action folders in ⌘K hide the Recent heading and copy the first child's shortcut.
  `src/renderer/commands/folders.ts:24-36`
- **S3** Found workspace roots in ⌘K and Change Workspace skip PathLabel and cut the folder name.
  `src/renderer/commands/window-commands/catalog.ts:76-87`
- **S3** Open non-file planes in ⌘K ignore paneTitle and show raw folder names instead.
  `src/renderer/commands/window-commands/catalog.ts:107-132`
- **S3** Smart palette Go to row shows raw home path and passes command text through FileName.
  `src/renderer/commands/CommandPalette.tsx:597-635`

## Browsing and search

- **S2** CollectionExplorer selection is O(N^2) and Check Files Again stats 10,000 items serially.
  `src/renderer/explorer/CollectionExplorer.tsx:135-140` Confirmed.
- **S2** Editing a search plane query keeps invisible prior selections active for file actions.
  `src/renderer/explorer/SearchExplorer.tsx:45-47` Confirmed.
- **S2** Incomplete query with Subfolders on pops error notice and claims 1 item not readable.
  `src/renderer/explorer/useSearch.ts:17-18` Confirmed.
- **S2** Live scan mismatches small keys and folder symlinks and hides Spotlight tag errors.
  `src/desktop/search/search.ts:160-180` Confirmed.
- **S2** One unreadable entry (such as ~/.Trash) stops deleted files leaving the search index.
  `src/desktop/search/index-core.ts:723-753` Confirmed.
- **S2** search_files drops scanLimited and root coverage so agents misread partial results.
  `src/desktop/agents/agent-broker.ts:1091-1100` Confirmed.
- **S2** z jump suggestions stay empty and checking forever if an unknown rank precedes ten known.
  `src/renderer/explorer/useFolderSuggestions.ts:53-62` Confirmed.
- **S3** aria-activedescendant points to nonexistent IDs in Grid, Gallery, and Map views.
  `src/renderer/explorer/FolderExplorer.tsx:577`
- **S3** CollectionExplorer double-click ignores nativeOpening and blank space fails to clear.
  `src/renderer/explorer/CollectionExplorer.tsx:202`
- **S3** First-run tips ignore the Own Keys rule and show stolen default shortcuts.
  `src/renderer/explorer/FolderInsights.tsx:101-108`
- **S3** MapView retains a stale creating promise if unmounted before the new lens arrives.
  `src/renderer/explorer/map/MapView.tsx:63`
- **S3** Select by Pattern globs use backtracking JS RegExp with no length cap, bypassing RE2.
  `src/domain/search/query.ts:527-550`

## Workspaces and the space

- **S2** Choosing a non-folder plane from Overview or minimap drops keyboard focus.
  `src/renderer/workspace/WorkspaceSurface.tsx:488-495` Confirmed.
- **S2** Creating a project fails on external collections and binds terminal parents.
  `src/renderer/workspace/projects.tsx:160-198` Confirmed.
- **S2** Editing or opening evidence in a project or tour file runs it instead of opening it.
  `src/renderer/workspace/controller.ts:772-785` Confirmed.
- **S2** Hidden or plain definition hides a second definition sharing the same root from offers.
  `src/domain/workspaces/ownership.ts:12-41` Confirmed.
- **S2** Missing terminal subfolder reports “This terminal changed in the definition.”.
  `src/desktop/workspaces/definition-commands.ts:105-112` Confirmed.
- **S2** Saving a project arrangement with any non-portable plane open silently drops it.
  `src/renderer/workspace/projects.tsx:500-515` Confirmed.
- **S2** Started deferred terminals revert to Start Terminal after culling or workspace switch.
  `src/renderer/workspace/WorkspaceSurface.tsx:330-358` Confirmed.
- **S3** Agent open-path on a project or tour file reports success before reading it.
  `src/renderer/workspace/agent-navigation.ts:80-89`
- **S3** Explicit collision with an opened found key breaks fresh opens on unreadable memory.
  `src/desktop/workspaces/defined-workspaces.ts:221-251`
- **S3** Long file or tour names in TourStops footer buttons overflow the 380 px panel.
  `src/renderer/workspace/tours/TourStops.tsx:71-78`
- **S3** Manage Defined tab and DefinitionDialog match links by key alone, ignoring found source.
  `src/renderer/ui/workspace/WorkspacesDialog.tsx:530`
- **S3** Manage Workspaces Defined search input does not fill its row and ignores Enter.
  `src/renderer/ui/workspace/WorkspacesDialog.tsx:502-526`
- **S3** Minimap and Overview label non-file planes by folder name and root / as folder.
  `src/renderer/workspace/WorkspaceSurface.tsx:477-487`
- **S3** Rekeying a found key named like Object.prototype breaks all definition commands.
  `src/desktop/workspaces/defined-workspaces.ts:227`
- **S3** ViewsDialog Escape closes the whole dialog during rename and row buttons omit view names.
  `src/renderer/ui/workspace/ViewsDialog.tsx:30-72`

## Canvases

- **S2** Disabling a tool does not stop a running model turn and allows later model writes.
  `src/desktop/bridge.ts:2631-2643` Confirmed.
- **S2** Invalid canvas action definitions and outputs hide validation details from the agent.
  `src/renderer/canvases/CanvasPlane.tsx:171-176` Confirmed.
- **S2** Stopping a canvas while an action runs leaves the canvas body permanently inert.
  `src/renderer/canvases/CanvasPlane.tsx:41` Confirmed.
- **S3** Mounting scripts still match the old Open saved file button label.
  `tools/mounting/qualify.ts:174`
- **S3** One unreadable file in reconstruction-jobs blocks listing and resuming paid jobs.
  `src/desktop/canvases/reconstruction.ts:183-200`
- **S3** Photo to 3D shows raw states including UK cancelled and blank empty choice buttons.
  `src/renderer/canvases/ReconstructionPanel.tsx:108-126`

## Git and task areas

- **S2** Comparing SVG, TIFF or ICO files fails with "Images too large to compare".
  `src/renderer/diff/useComparisonSession.ts:122` Confirmed.
- **S2** Create Worktree and New Task from Branch clip their footer off-screen with no scroll.
  `src/renderer/git/worktrees/worktrees.css:6` Confirmed.
- **S2** New Task from Branch auto-starts terminal and Git changes instead of waiting.
  `src/renderer/tasks/controller.ts:134` Confirmed.
- **S2** New Task from Branch hides creationProblem, flashes list view and creates untitled tasks.
  `src/renderer/git/worktrees/WorktreesDialog.tsx:51` Confirmed.
- **S2** Repo-wide Git actions fail when folder selection changes or exceeds 1,000 paths.
  `src/desktop/comparison/git-actions.ts:453` Confirmed.
- **S3** Find Duplicates prints "0 items couldn't be read" on scan cap and leaks stale results.
  `src/renderer/ui/comparison/Duplicates.tsx:140`
- **S3** Git Changes "Against base" fails completely when any file has a merge conflict.
  `src/desktop/comparison/review.ts:324`
- **S3** Git hunk review blocks text files whose path or blob hash contains 120000 or 160000.
  `src/desktop/comparison/review.ts:433`
- **S3** Task overview, worktree dialogs and Git commands show raw paths instead of PathLabel.
  `src/renderer/tasks/TaskPlane.tsx:333`

## Terminals, servers and remote planes

- **S2** Linked browser plane misses stopped-server banner and Start Server fails after restart.
  `src/renderer/browser/BrowserPlane.tsx:46-49` Confirmed.
- **S2** Makefile targets below blank comment lines are omitted from declared commands.
  `src/domain/terminals/declared-commands.ts:166-176` Confirmed.
- **S2** Ninth browser plane replaces limit error with closed error and breaks Try Again.
  `src/renderer/browser/BrowserPlane.tsx:51-54` Confirmed.
- **S2** Open in tmux drops default profile environment and fails if unused shell is missing.
  `src/desktop/terminals/terminal-launch.ts:116-120` Confirmed.
- **S3** AskpassRelay caches failed socket setup forever and drops server error listener.
  `src/desktop/remote/askpass.ts:88-115`
- **S3** Browser plane never reattaches CDP debugger after renderer crash or hung reload.
  `src/desktop/browser/browser-planes.ts:252-261`
- **S3** Definition command approval mounts blank terminal instead of waiting state.
  `src/renderer/terminals/definition-command-session.ts:285-337`
- **S3** Failed terminal start caches rejection and quiesce cancel marks dead session started.
  `src/renderer/terminals/TerminalPlane.tsx:71-92`
- **S3** Missing custom terminal app path throws raw ENOENT instead of Settings guidance.
  `src/desktop/terminals/terminal-launch.ts:188-198`

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
- **S3** Text CopyButton hides failure reasons from sighted users, especially in Settings.
  `src/renderer/ui/primitives.tsx:391-394`
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
- **S3** A request just under 65,536 bytes, or several large ones at once, disconnects the agent.
  `src/desktop/agents/mcp-client.ts:144`
- **S3** A slow call is reported as "Viewer request timed out." while Viewer goes on with it.
  `src/desktop/agents/mcp-client.ts:160-164`
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
- **S3** Page and code disagree: a new shared configuration also disconnects named clients.
  `src/desktop/agents/agent-broker.ts:282-290`
- **S3** Page and code disagree: a refused model line is still shown, and Tab opens it to run.
  `src/renderer/command-line/PromptFinder.tsx:159-178`
- **S3** Page and code disagree: a session folder given as a link is accepted.
  `src/desktop/agents/sessions.ts:47-50`
- **S3** Page and code disagree: a watch rule's interval range against the form's three choices.
  `src/renderer/ui/automation/WatchRules.tsx:262-276`
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
- **S3** Sample job page linked from the guide keeps its labels in the old letter case.
  `examples/laser-job/README.md:16`
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
