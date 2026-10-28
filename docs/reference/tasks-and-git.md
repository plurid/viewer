# Tasks, branches and worktrees

A task area is a named checkout/folder context inside a workspace. It retains its notes and tool
references independently of open plane IDs.

## Create or open a task

**New task area…** groups an existing folder. **New task from branch…** creates a worktree and task
together, then opens folder, notes, terminal and Git tools. **Tasks…** reopens an area, its tools
and private command history.

The overview shows the observed checkout and branch/commit. Refresh checkout updates that
observation. An ordinary non-Git folder can also anchor a task.

From a terminal, `viewer task create NAME --branch BRANCH --path DIR` proposes the complete worktree
and task setup. Choose a workspace with `--workspace ID_OR_NAME`; `--repo` and `--base` select its
repository and local starting branch. The terminal restores stopped, and the Git view waits for
**Load Git changes**. See [CLI task parameters and recovery](cli.md#create-a-task-from-a-branch).

Add a checklist, note, conversation, browser or server view, or attach a supported open plane.
**Arrange open tools** tiles the available views. Closing a tool view keeps its task reference;
closing a note view keeps its saved document. Removing a saved note/checklist uses its separate Move
to Trash review.

## Work on branches beside each other

**Open worktree…** lists registered local checkouts. Choose **Open beside**, **Show existing plane**
or **Another view beside**. Different worktrees have separate working files and indices; views of
one checkout share both.

**Create worktree…** supports a new branch at a pinned local base or an unused existing branch.
Review the destination. An occupied branch offers its existing checkout rather than forcing a second
checkout. Source changes and staging remain in place. Creation does not switch, stash, reset, prune
or remove another checkout.

Missing, bare or prunable registrations have explicit states. A replaced checkout cannot silently
take over a saved task. Refresh when observed identity or branch state changes. Closing a view
leaves the worktree on disk.

## Review Git changes

Folder Git badges are opt-in. Explicit Git review and worktree discovery do not require background
badges. Open a linked **Git changes** view, select a comparison base and navigate changed files.
Supported text hunks expose Stage/Unstage actions. Review position is retained so you can return to
a file.

Working-file edits and index staging are separate operations. Git commit and other actions use the
repository's normal hooks, filters and signing setup; they do not have Viewer file Undo. Review
their actual command output.

## Run checks and revisit the discussion

**Run command…** executes in the task's captured folder. Its private receipt records the literal
script, process exit, times and bounded output. Association comes from explicit task membership, not
similarity of paths or command text. A process exit alone does not establish that a task is
complete.

Attach a Viewer conversation or a reported external session. Current file/line and Git diff links
open beside the task. Status is **Reported**, with a timestamp and sequence; automatic CLI
transcript import/resumption is not implemented.

## Restoration

Tool references outlive their views. Reopening a terminated terminal creates a fresh shell without
replay. Server views restore stopped; an explicit restart can update an associated browser's port.
Private task and receipt state is excluded from portable project exports. See
[terminals](terminals.md), [web views](web.md) and [agent reports](agents.md).
