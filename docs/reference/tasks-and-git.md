# Tasks, notes, branches and Git review

This page lists the commands, controls and limits for task areas, notes and checklists, worktrees,
Git review and Git actions.

## Task areas

A task area is a named context in one workspace: a checkout or folder, plus references to the tools
used for that work. References outlive the planes that show them.

| Command                   | Does                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| **New task area…**        | Opens **Tasks** → **New task…**: a name and a **Task checkout folder** chosen from open folder planes. |
| **New task from branch…** | Creates a worktree and a task together, then opens its tools. See [worktrees](#worktrees).             |
| **Tasks…**                | Lists **Task areas**, and **Command history** for [receipts](terminals.md#command-receipts).           |

The task plane shows the editable name, the checkout path, the branch and commit (or **Folder
task**) and when they were observed. Any folder can anchor a task, Git or not.

| Control                      | Does                                                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Refresh checkout**         | Reads the checkout's branch and commit again.                                                                                                      |
| **Arrange open tools**       | Tiles the task's open planes.                                                                                                                      |
| **Run command…**             | Runs a shell line in the checkout; its receipt joins the task.                                                                                     |
| **Attach open plane…**       | Adds an open plane: folder, preview, note, checklist, chat, terminal, Git changes, diff, browser, server or receipt.                               |
| **Attach conversation…**     | Adds a Viewer chat or an [agent session report](agents.md#report-a-session).                                                                       |
| **+ Folder** … **+ Browser** | Adds a new tool: **Folder**, **Note**, **Checklist**, **Terminal**, **Chat**, **Changes**, **Server** or **Browser** (asks for a **Web address**). |
| **Show**, **Open**           | Shows a tool's open plane, or opens a closed one again.                                                                                            |

| Limit                     | Value               |
| ------------------------- | ------------------- |
| Task areas in a workspace | 50                  |
| Tools in a task area      | 100                 |
| Task name                 | 1 to 100 characters |

Closing a tool's plane keeps its reference. Closing a note's plane keeps the note. A tool belongs to
a task only by explicit membership, never by a matching path or command text. A process exit does
not mark a task done.

The command line's `task-new` and an **Ask Viewer** answer open **Create branch task**, a form
prefilled with the same parameters as [`viewer task create`](cli.md#create-a-task-from-a-branch).
Nothing is created until you confirm. This route uses your own folder access, not agent grants. From
a terminal, `viewer task create` proposes the same setup for review.

## Notes and checklists

| Command                 | Does                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------- |
| **New note plane**      | Creates a private note in the current folder's context.                                |
| **New checklist plane** | Creates a private checklist.                                                           |
| **Notes…**              | Lists saved notes and checklists to reopen or move to the Trash.                       |
| **Plane notes…**        | Edits plain text kept with the active plane, up to 100,000 characters; **Save notes**. |

A note is a private Markdown document in Viewer's own data, not a file in the folder. It saves as
you type; the toolbar shows **Saved privately**, **Saving…** or **Not saved** with **Retry save**.

| Control                     | Does                                                                         |
| --------------------------- | ---------------------------------------------------------------------------- |
| **Document**, **Checklist** | The formatted view.                                                          |
| **Source**                  | The Markdown text.                                                           |
| **Export…**                 | Saves a copy as `TITLE.md` where you choose.                                 |
| **Move to Trash…**          | Saves open drafts, checks the note is unchanged, then moves it to the Trash. |

A checklist item is a Markdown line `- [ ] text` or `- [x] text` (`*` and `+` work too). Ticking,
editing, reordering and removing items changes only those lines. A note holds up to 4 MiB of text
and a title of up to 255 characters. New note and checklist planes are offered while a workspace has
fewer than 200 planes.

## Worktrees

| Command                   | Does                                         |
| ------------------------- | -------------------------------------------- |
| **Open worktree…**        | Lists the repository's registered checkouts. |
| **Create worktree…**      | In that dialog, makes a new checkout.        |
| **New task from branch…** | The same form, ending with **Create task**.  |

Each checkout shows **Current checkout**, **Checkout**, **Bare**, **Prunable** or **Unavailable**,
its lock reason when locked, and whether it is **Clean**. **Open beside** opens it as a plane,
**Show existing plane** goes to one already open, and **Another view beside** adds a second view.
Separate worktrees have their own working files and index; views of one checkout share them.

| Field                               | Rule                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| **New branch**, **Existing branch** | A new branch from **Start from**, or a local branch without a checkout.            |
| Branch name                         | A valid local name up to 200 characters, for example `feature/my-task`.            |
| **Start from**                      | A local branch; its commit is shown and pinned as the **pinned revision**.         |
| **Destination**, **Choose parent…** | A new folder in an existing ordinary parent, outside Git administration.           |
| Occupied branch                     | Offers **Show worktree** (or **Use checkout for task**) for the existing checkout. |

**Create and open** runs `git worktree add` with the repository's own hooks and filters, for up to 2
minutes. The repository needs an initial commit and at most 512 local branches. Creation never
switches, stashes, resets, prunes or removes another checkout, and leaves your changes and staging
where they are. A list expires after five minutes; refresh it. Closing a worktree's plane leaves the
worktree on disk. A replaced checkout cannot take over a saved task.

## Git review

**Git changes** opens a linked review plane for the repository. **Compare with HEAD** opens one
selected file against its committed version. Both commands appear when **Settings → Browsing → Git →
Show Git status** is on, which also turns on Git badges in folders. **Git changes** appears only for
a folder Viewer already knows is in a repository: the folder plane's own folder, a folder inside it,
or a folder whose listing shows `.git`. Right-click one folder to review its repository; the
**Suggested** row names the branch and its changes, such as `main · 3 changes`. A task's Git changes
plane waits for **Load Git changes**.

| Control                                          | Does                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **Unstaged**, **Staged**, **Against base**       | What to review. **Against base** compares with the merge base of a local branch and includes working changes. |
| **Review base**                                  | The local branch for **Against base**; defaults to `main` or `master`.                                        |
| **Refresh**                                      | Reads the changes again.                                                                                      |
| **Previous changed file**, **Next changed file** | Moves between files; also **⌥↑** and **⌥↓**.                                                                  |
| **Open diff**                                    | Opens the whole file as a diff plane.                                                                         |
| **Stage hunk N**, **Unstage hunk N**             | Stages or unstages one hunk in **Unstaged** or **Staged**.                                                    |

| Limit                       | Value                                                                |
| --------------------------- | -------------------------------------------------------------------- |
| Changed files in one review | 5,000                                                                |
| Hunk review of one file     | 20,000 lines; larger files need **Open diff**                        |
| Untracked file hunks        | A regular text file up to 4 MiB                                      |
| Whole-file only             | Conflicts, renames, mode changes, links, submodules and binary files |
| Open reviews                | 16                                                                   |

A review is tied to the index it read. If `HEAD`, the index or the file changes, staging is refused
until you refresh. Git review is in the direct build only.

## Git actions

These commands run Git in a terminal plane on the repository containing the current folder. They
work whether or not **Show Git status** is on.

| Command                             | Runs                                                     | Limits                                                |
| ----------------------------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| **Git status**                      | `git status --short --branch`                            | 15 s, 256 KiB, read-only                              |
| **Git history**                     | `git log` of the last 100 commits                        | 15 s, 256 KiB, read-only                              |
| **Stage selection**                 | `git add` of the selected files and folders              | 1,000 paths, 128 KiB of paths; 10 min, 1 MiB output   |
| **Stage all changes in repository** | `git add --all`, including deletions                     | 10 min, 1 MiB output                                  |
| **Commit staged changes…**          | `git commit -m` with your message, only what is staged   | message up to 16,000 characters; 10 min, 1 MiB output |
| **Pull (fast-forward only)**        | `git pull --ff-only` from the configured upstream        | 10 min, 1 MiB output                                  |
| **Push to upstream**                | `git push --no-force` of `HEAD` to its upstream, no tags | 10 min, 1 MiB output                                  |

Commit, pull and push need a branch, and pull and push need a configured upstream. These are your
own Git commands: they run the repository's hooks, filters and signing, and Viewer's Undo does not
reverse them. Read their output in the terminal. Agents cannot run them.

## Restoration

A terminal reopened after Viewer restarts starts a fresh shell; nothing is replayed. A server plane
restores stopped until you start it; a restart can give it a new port, and a linked browser plane
follows it. A [project file](../guides/workspaces.md#share-a-project-folder) keeps only folder,
preview, search, terminal, diff, Git changes and collection planes; task areas, notes, receipts,
chats, browser and server planes stay out of it.

**Related:** [Work on a project](../guides/develop.md) · [Terminals](terminals.md) ·
[Browser planes and local servers](web.md) · [CLI](cli.md#create-a-task-from-a-branch) ·
[Agents](agents.md#report-a-session) · [Terms](terms.md)
