# Task areas

A task area is a named development context inside a Viewer workspace. It records
one checkout/folder and links its documents and tools. It does not create another
workspace or an agent harness. **New task area…** captures an open folder; **Tasks…**
finds areas and private command history. Saved task names are also palette entries.

The overview shows the checkout path and the observed branch/commit, with an
explicit Refresh checkout action. Directory identity is retained: a replaced
checkout cannot silently take over the old task. Observed Git metadata is a
snapshot, not a claim to freeze external Git changes. Ordinary non-Git folders
can also anchor a task, with no branch claim.

## Documents and views

The overview can add notes, checklists, terminals, Viewer conversations, Git
changes, browsers and stopped local-server views. Attach open plane links an
existing supported view, including a file preview or diff. Arrange open tools
tiles this area's open views using the existing spatial layout machinery.

Tool references belong to the area independently of plane IDs. Documents use
their private document IDs, diffs retain their typed sources, terminals have
logical session IDs, and command results have receipt IDs. View IDs are hints for
Show; they are not the resource's identity. Closing an overview or tool view
preserves the area and its references. Open creates a fresh view when needed.
Private notes keep their document and updated title, including recovered copies.

Reopening a terminal is an explicit request for a fresh shell when its old process
has ended; prior input is never replayed. Codex/Claude can run in that terminal
like other CLI programs. Viewer does not yet provide structured external-agent
conversation adapters or infer agent phases from terminal text. Conversations
created through Chat retain their existing provider and data-sharing permissions.

Server creation adds a stopped view. Start remains explicit. Closing and reopening
its view reattaches the window's existing listener when available. Quit stops the
listener; cold restoration does not start it. Browser references reopen ordinary
isolated Viewer browser planes. Local-server browser references retain their
logical listener and route, so an explicit restart updates a changed port.
Current server lifecycle and process outcomes can appear in the overview;
missing signals are not guessed as agent progress.

## Command receipts

Run command… opens the existing manual shell form in the task's checkout. The
source view's explicit membership determines receipt association. Commands from
an unrelated view are not attached merely because their paths or text look alike.

Manual commands retain private receipts with the exact script, canonical working
folder, observed folder identity, start/end times, bounded output, exit code and
actual outcome. Receipt views allow copying output and explicit Markdown export.
Command history in Tasks finds receipts independently of any open area or view.
Exit 0 records a process outcome; it does not certify tests or complete a task.
The working folder's identity is observed before launch; file contents are not
snapshotted or attributed to a command by guesswork.

Running output coalesces into atomic app-owned metadata. A cold-open receipt with
no final outcome is labeled Interrupted and remains unreplayed. Receipt files
use mode 0600. At most 1,000 records are admitted, with the last 256 KiB output
per command; storage errors remain explicit. No automatic removal or pruning is
performed. The manual form explains that commands and output are saved privately.
Session recent-command clearing does not remove durable receipts.

## Persistence and authority

Saved state v10 adds task/receipt planes and up to 50 areas per workspace, 100 tool
references per area and 16 view hints per tool. Loading v9 first preserves an
exact `.before-task-areas-v10-*` backup. Closing a view never removes a document,
checkout or receipt. Task areas and private document/result views are excluded
from portable project definitions.

Task links confer no file, model, browser or execution authority. Existing source
access checks still apply on open and refresh. The receipt API accepts validated
IDs and viewer-window requests only; it has no execution or removal method.
Agent shell, executable and terminal-input routes remain unavailable, including
through aliases and saved grants. No restored task automatically starts a
command, agent or server.

Implementation is split across `domain/workspaces/tasks.ts`,
`renderer/tasks/`, the existing state/spatial adapter, and
`desktop/actions/receipts.ts`. Existing execution, note, chat, Git, terminal,
browser and server services keep their own resource lifecycles. Tests cover
stable reference keys, fresh-view reopening, command association, source identity,
v9 backups, private output persistence and interrupted outcomes. Native
acceptance is `tests/native/task-areas.ts`; the implementation ledger records its
actual qualification state.
