# Review findings

Open problems found by a review of the code and documents at commit `c89e21f1`. Each item names its
first place in the code (paths relative to `packages/viewer-electron/app`). An item leaves this page
in the change that fixes it.

How to read an item:

- **S2** a person meets a wrong result or a blocked task in a common feature. **S3** a rare state, a
  rough edge or a page that disagrees with the code.
- Each item was found by one reviewer reading the code and has not yet been checked by a second one
  or by a test, unless it says "checked". Confirm it before you fix it.
- Findings about security, an agent acting beyond its grant, or losing files are kept out of this
  page until they are fixed.

## Decisions for the owner

- **Empty Trash.** The Trash window has **Empty Trash…**, which erases for good after a native
  confirmation (`tools/trash-ui.h`), while `README.md`, `docs/reference/file-operations.md`,
  `capabilities.md` and `terms.md` say Viewer never empties the Trash and nothing is deleted for
  good. Either the pages describe the command or the command goes.

## Agents, actions and automation

- **S2** A request that timed out for the agent still runs in Viewer, with those queued behind it.
  `src/desktop/agents/mcp-client.ts:159-166`
- **S2** report_session refuses every new session once 100 exist, and none can be removed.
  `src/desktop/agents/sessions.ts:83-84`
- **S2** Tools fail with 'outside the authorized folders' when the person views another folder.
  `src/desktop/agents/agent-broker.ts:412-421`
- **S3** A command run from an empty workspace keeps no receipt; Open Receipt fails.
  `src/desktop/actions/receipts.ts:61`
- **S3** A prepared review cannot be discarded; recovered tasks stay pending; 100 block actions.
  `src/renderer/actions/ActionHub.tsx:667`
- **S3** A request near or over 65,536 bytes drops the connection or gets a reply with id null.
  `src/desktop/agents/mcp-client.ts:143-147`
- **S3** A run stopped by a withdrawn approval is marked failed with no reason shown.
  `src/desktop/automation/workflows.ts:324`
- **S3** agents.md omits the metadata capability that seven service tools also require.
  `src/desktop/agents/tool-catalog.ts:292-296`
- **S3** Command output shows replacement characters where a chunk splits a character.
  `src/desktop/actions/executions.ts:296`
- **S3** Create… in a folder that has a workflow fails with a 'changed on disk' message.
  `src/renderer/ui/automation/Workflows.tsx:207`
- **S3** Dead-end errors and gaps in the tool set: no way to list own proposals or tasks.
  `src/desktop/agents/agent-broker.ts:1153-1156`
- **S3** Every agent tool call waits for the whole activity file to be rewritten and synced.
  `src/desktop/agents/agent-broker.ts:617-624`
- **S3** Generating the shared configuration disconnects every named client as well.
  `src/desktop/agents/agent-broker.ts:282-290`
- **S3** Neither the review nor the system dialog says which agent client asked.
  `src/renderer/actions/AgentReview.tsx:59`
- **S3** Quit never finishes when a command left a detached process holding its output.
  `src/desktop/actions/executions.ts:299`
- **S3** Rename as book on a few hundred PDFs fails: Application metadata exceeds its limit.
  `src/desktop/actions/planner.ts:475`
- **S3** The shared connection has no recipe task budget and can fill all 100 plans.
  `src/desktop/agents/agent-broker.ts:1108-1118`
- **S3** The system dialog for a large Trash request cuts its path list without saying so.
  `src/desktop/native/native-confirmation.ts:21-37`
- **S3** Watch rule can never be enabled or removed after its last run's history is removed.
  `src/desktop/automation/watch-rules.ts:361`
- **S3** Watch rule interval: reference says 30 seconds to 24 hours, interface offers three.
  `src/renderer/ui/automation/WatchRules.tsx:267`
- **S3** Watch rule runs one second after the first change, on files still being written.
  `src/desktop/automation/watch-rules.ts:351`

## Files, operations and the Trash

- **S2** Copy Event ID never copies: the ID is sent as a path and the request is refused.
  `src/renderer/journal/JournalPlane.tsx:404`
- **S2** Copy then Paste in the same folder fails: “Source and destination are the same.”.
  `src/desktop/operations/destinations.ts:31`
- **S2** Copying a locked file, a read-only folder or a Home folder such as Documents always fails.
  `src/desktop/operations/file-transfer.ts:279`
- **S2** Direct build: Allow Folder Access… cannot open a folder that macOS refused.
  `src/renderer/ui/permissions/FolderAccessButton.tsx:18-31`
- **S2** Document-text search with two or more words shows no passage unless the words are adjacent.
  `src/domain/files/inspection.ts:215`
- **S3** A batch rename that swaps or shifts names leaves lens groups and Map places on the wrong
  files. `src/domain/files/lenses.ts:294`
- **S3** A checkpoint cut short by a crash leaves its partial copy in private data for good.
  `src/desktop/operations/checkpoints.ts:220-232`
- **S3** A checkpoint whose removal failed is described as 'This copy was not finished'.
  `src/renderer/ui/operations/Checkpoints.tsx:44`
- **S3** A closed or reloaded window leaves its folder watches running until Viewer quits.
  `src/desktop/files/watchers.ts:13-40`
- **S3** A folder check canceled by one query fails the next query's check of the same folder.
  `src/domain/files/folder-checks.ts:59`
- **S3** A plane keeps a folder's old rows after Finder ejects its disk or another app renames it.
  `src/desktop/files/directory-watch.ts:48-54`
- **S3** A save, Undo or Clear Finished fails while New Folder waits at its name prompt.
  `src/desktop/operations/operations.ts:1416`
- **S3** A second click on Skip or Keep Both answers the next file's name prompt unseen.
  `src/renderer/operations/OperationsPanel.tsx:161`
- **S3** After Clear Finished, Command-Z undoes the oldest file operation, not the latest.
  `src/renderer/state/jobs.ts:84`
- **S3** After Move History to Trash…, Command-Z fails every time and blocks Undo of earlier jobs.
  `src/desktop/journal/handlers.ts:90`
- **S3** An interrupted job loses its Undo at the second launch and gains an error at every launch.
  `src/desktop/operations/operations.ts:281`
- **S3** An Undo refused while it runs turns its job into a failed, interrupted one at relaunch.
  `src/desktop/operations/operations.ts:979`
- **S3** Backspace while a Trash folder loads jumps to the top of the Trash, not to the parent.
  `src/renderer/ui/trash/Trash.tsx:454`
- **S3** Cancelling a change review leaves its plan pending; large reviews are then refused for
  good. `src/renderer/ui/operations/OperationReview.tsx:31`
- **S3** Columns view shows only "Can't open this folder" for a folder whose path holds a backslash.
  `src/domain/files/paths.ts:27`
- **S3** Compress to ZIP fails with “Unsafe archive path.” for a name with a slash or colon.
  `src/desktop/operations/archive-jobs.ts:33`
- **S3** Copying a locked item fails: its staged copy inherits the lock and cannot be published.
  `tools/macos-files.mm:295`
- **S3** Eject and Revoke wait for a running duplicate or compare hash to finish its file.
  `src/desktop/files/content-hash.ts:21-63`
- **S3** File Operations and Journal pages name controls and lists the interface does not have.
  `src/renderer/operations/OperationsPanel.tsx:69`
- **S3** Folders under a linked folder on another disk are refused as a 'mounted volume' root.
  `src/desktop/files/protected-paths.ts:73-78`
- **S3** Journal export's default file name carries the UTC date, not the person's date.
  `src/desktop/bridge.ts:2541`
- **S3** Journal search drops each typed space, so a two-word search cannot be typed.
  `src/renderer/journal/JournalPlane.tsx:128`
- **S3** Keep both and Duplicate split a folder's or dotted name at its last dot: “v1 copy.2”.
  `src/desktop/operations/file-transfer.ts:152`
- **S3** Last hour is stored as a fixed start time and the control then reads Time range….
  `src/renderer/journal/JournalPlane.tsx:171`
- **S3** Lens name rules and member matching fold case by the system language, so img* misses IMG
  files on a Turkish system. `src/domain/files/lenses.ts:394`
- **S3** Map view stalls on large folders: placing items is quadratic, and it throws past about
  125,000 items. `src/domain/files/lens-layout.ts:84`
- **S3** Names that collate equal (1.png and 01.png, a and A, resume and résumé) have no defined
  order. `src/domain/files/entries.ts:11`
- **S3** No test in the suite renders the Trash window or presses Copy Event ID.
  `tests/trash-presentation.test.ts:1`
- **S3** Permissions rows mislabel an unplugged disk, a saved file and a panel choice.
  `src/renderer/ui/permissions/FilePermissions.tsx:82-90`
- **S3** Put Back and Apply Changes wait in silence behind any running job or unanswered name
  prompt. `src/desktop/ipc/access-handlers.ts:102`
- **S3** Put Back forgets where an item came from once 100 later jobs have finished.
  `src/desktop/operations/operations.ts:384-397`
- **S3** Put Back still answers 'N items restored.' and its errors still say Restore.
  `src/renderer/ui/trash/Trash.tsx:193`
- **S3** Put Back waits without a word while any job sits at its collision prompt.
  `src/desktop/ipc/access-handlers.ts:102-104`
- **S3** Save Export… after the system panel's Replace shows 'EEXIST: file already exists'.
  `src/desktop/journal/handlers.ts:71`
- **S3** Schema text reaches the person: over 1,000 Trash items, or an emptied name in a review.
  `src/desktop/ipc/schemas.ts:965`
- **S3** Sort by Kind orders by extension, so the Kind column reads out of order and splits one kind
  in two runs. `src/domain/files/entries.ts:119`
- **S3** Store: a looping link cannot be trashed, and trying releases the folder's permission.
  `src/desktop/files/file-access.ts:232-245`
- **S3** Undo of a large job rewrites the whole remaining Undo list after every step.
  `src/desktop/operations/operation-journal.ts:483-488`

## Found while checking the documents

- **S2** Page and code disagree: the turn that creates a canvas gets two minutes, not eight.
  `src/desktop/chat/service.ts:488`
- **S2** Privacy policy says model requests run only when you invoke an action; two settings send
  without one. `docs/release/privacy-policy.md:72`
- **S2** Settings → Privacy says only a model receives data; recordings and photos also leave the
  Mac. `src/renderer/ui/settings/PrivacyInformation.tsx:4`
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
- **S3** CONTEXT.md names no owner for folder history, the report window or diagnostics.
  `src/desktop/files/folder-history.ts`
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
- **S3** git_diff advertises a base of at most 200 characters; the service accepts 300.
  `src/desktop/agents/service-catalog.ts:8`
- **S3** Go to Folder… cannot open ./ or ../ paths, which the guide lists and ⌘K opens.
  `src/renderer/explorer/GoToFolderDialog.tsx:54`
- **S3** Interface keeps UK spellings the lint list misses: Aluminium, neighbour, neighbouring.
  `src/domain/layout/nesting/plan.ts:169`
- **S3** More UK spellings on these pages than the confirmed list holds. `DESIGN.md:453`
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
- **S3** Page and code disagree: testing.md tells readers to run three robot scenarios on the
  candidate. `docs/development/testing.md:195-228`
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
- **S3** speech.md, a reader's reference, carries a developer harness walkthrough.
  `docs/reference/speech.md:106`
- **S3** Store build offers New Task from Branch…, which can only fail there.
  `src/renderer/commands/programs.ts:81-89`
- **S3** The guide comments Viewer writes into config.jsonc are stale in six places.
  `src/desktop/preferences/configuration-comments.ts:272`
- **S3** tools/list advertises 200 characters for git_diff base; the parser accepts 300.
  `src/desktop/agents/service-catalog.ts:8`
- **S3** ui.recentCommands: validation accepts 30 IDs, the app keeps 20.
  `src/domain/preferences/presentation/ui-schema.ts:103`
