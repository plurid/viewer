# Words Viewer uses

The words in Viewer's labels, guides and references, with where each shows in the app and where it
is taught. Every command, key and menu is in [Features and where to find them](capabilities.md).

**Index:** [Action](#commands-and-automation) · [Agent](#models-and-agents) ·
[Agent access](#three-separate-permissions) · [Branch task](#text-notes-and-tasks) ·
[Camera](#planes-and-the-space) · [Checklist](#text-notes-and-tasks) ·
[Checkpoint](#changes-and-recovery) · [CLI](#commands-and-automation) ·
[Columns preview](#looking-at-files) · [Command](#commands-and-automation) ·
[Command language](#commands-and-automation) · [Docked](#planes-and-the-space) ·
[File overview](#suggestions) · [Folder access](#three-separate-permissions) ·
[Insight](#suggestions) · [Job](#changes-and-recovery) · [Journal](#changes-and-recovery) ·
[Layout of planes](#planes-and-the-space) · [Lens](#looking-at-files) ·
[Linked plane](#planes-and-the-space) · [Model](#models-and-agents) ·
[Model data](#three-separate-permissions) · [Model data levels](#models-and-agents) ·
[Note](#text-notes-and-tasks) · [Plane](#planes-and-the-space) ·
[Prefix key](#commands-and-automation) · [Project](#planes-and-the-space) ·
[Proposal and review](#models-and-agents) · [Quick Preview](#looking-at-files) ·
[Receipt](#changes-and-recovery) · [Recipe](#commands-and-automation) ·
[Root plane](#planes-and-the-space) · [Scratch buffer](#text-notes-and-tasks) ·
[Sequence](#commands-and-automation) · [Space](#planes-and-the-space) ·
[Stop](#planes-and-the-space) · [Suggested](#suggestions) · [Task area](#text-notes-and-tasks) ·
[Tiled](#planes-and-the-space) · [Tour](#planes-and-the-space) · [Trash rule](#changes-and-recovery)
· [Undo and Redo](#changes-and-recovery) · [Watch rule](#commands-and-automation) ·
[Workflow](#commands-and-automation) · [Workspace](#planes-and-the-space) ·
[Worktree](#text-notes-and-tasks)

## Planes and the space

- **Plane**: one open view in a workspace: a folder, a file, a note, unsaved text, a terminal, a web
  page, a search, a chat, Git changes, the Journal and more. Closing a plane closes the view; the
  file stays, and a note keeps its text. _In Viewer:_ each plane's header, with its title, **Frame
  plane**, **Dock plane** and **Close plane** (**×**). _Learn:_
  [Keep your work together](../guides/workspaces.md)
- **Linked plane**: a plane opened from another, such as a file opened from its folder. It is that
  plane's child: a line joins them, **Back to parent plane** (**⌥⌘↑**) returns to the parent, and
  opening the same file again in that branch shows the plane it already has. _In Viewer:_ **Open
  linked plane**, **Related planes** in the header, **View linked plane** beside a file's name.
  _Learn:_ [Keep your work together](../guides/workspaces.md)
- **Root plane**: a plane with no parent, the start of its own branch of linked planes. A file
  opened again in another root gets a plane of its own there. _In Viewer:_ **New folder plane**
  (**⌘N**), **Open in another plane**, **Open in new root plane** in the sidebar. _Learn:_
  [Keep your work together](../guides/workspaces.md)
- **Docked** and **tiled**: docked, one plane fills the window while the rest wait in the space;
  **⌘Return** switches between that plane and all of them. Tiled, the planes in view sit face-on in
  a layout such as **Side by side** or **Grid** until **Stop tiling**. _In Viewer:_ **Dock plane**
  and **Reveal space**; **Tile the planes in view**. _Learn:_
  [Keep your work together](../guides/workspaces.md)
- **Space** and its **camera**: the space is the surface the planes sit in, each where you put it.
  The camera is your view of it: after working inside a plane, click the background or press
  **Escape** to move around again, and **Frame all planes** (**⌘0**) brings every plane into view. A
  saved view keeps a camera position to fly back to. _In Viewer:_ the space toolbar, minimap and
  viewcube; **Save view…**. _Learn:_ [Keep your work together](../guides/workspaces.md)
- **Workspace**: a named set of planes and where you put them. Viewer saves it as you go and brings
  it back at launch; your files stay in their own folders. _In Viewer:_ the workspace menu in the
  title bar, and the **Workspace** menu. _Learn:_ [Keep your work together](../guides/workspaces.md)
- **Project**: a `viewer.project.jsonc` file in a folder that records which files are open and how
  they are arranged, with paths relative to that folder, so the arrangement opens the same way on
  another computer. It never copies your files, terminal history, conversations or keys. _In
  Viewer:_ **File → Create Project…**, **Open Project…**, **Save Project**. _Learn:_
  [Keep your work together](../guides/workspaces.md)
- **Tour** and **stop**: a tour shows files one stop at a time. A stop is a file opened at a place
  in it (a page, an outlined region, highlighted drawing entities, a camera view of a model) with a
  caption. A tour is a `.viewer-tour.jsonc` file beside its files and plays when opened; it never
  runs commands. A stop whose file is gone is skipped; one whose file changed opens without its
  place. **Tour the views** tours the saved views instead. _In Viewer:_ **Record a tour**, the tour
  bar, **Profile: Present**. _Learn:_
  [Show someone around: tours](../guides/workspaces.md#show-someone-around-tours)
- **Layout of planes**: where the planes sit and how large they are. **Size & Position** sets one
  plane's width, height and alignment; a layout template keeps an arrangement of plane kinds to
  apply to other folders. A **Layout** plane is something else: it lays out photos and PDFs on
  pages. _In Viewer:_ **View → Size & Position**, **Layout** in a plane's header, **Save layout as
  template…**. _Learn:_ [Keep your work together](../guides/workspaces.md)

## Looking at files

- **Quick Preview**: a look inside the selected files over the folder, opened with **Space**. **←**
  and **→** step through the selection; **Space** or **Escape** closes it. Its footer offers
  **Edit** for text, the best **Suggested** action and **Open linked plane**. _In Viewer:_
  **Space**, **File → Quick Preview**, **Quick preview** in **⌘K**. _Learn:_
  [Read and inspect files](../guides/previews.md)
- **Linked plane from a preview**: **Open linked plane** in Quick Preview, or
  **Option**-double-click on a file, keeps the file open in a plane of its own, linked to the folder
  it came from. _In Viewer:_ **Open linked plane**. _Learn:_
  [Your first five minutes](../guides/getting-started.md)
- **Columns preview**: in Columns view (**⌘3**), the selected file's preview sits beside the folder
  trail, so you browse and read at once. _In Viewer:_ **Columns view**. _Learn:_
  [Your first five minutes](../guides/getting-started.md)
- **Lens**: a set of named groups for a folder's own items, made without moving a file. Groups can
  nest, follow rules and become regions on the Map view. A writable folder keeps its lenses in
  `.viewer/lenses/`; any other folder keeps them on this Mac. _In Viewer:_ **Lenses** in a folder's
  header, **New lens…**, **Group by**. _Learn:_ [Lenses and Map view](lenses.md)

## Suggestions

- **Suggested**: the actions that fit the selection, each with its reason, such as **Extract here**
  for an archive. What you choose for a kind of file rises for that kind next time, and a model can
  add picks once you allow it. _In Viewer:_ **Suggested** in the right-click menu and in **⌘K**
  before you type; the best one as a button in Quick Preview. _Learn:_
  [Browse and organize](../guides/files.md)
- **Insight**: a card above a folder's files that points out something that may need attention, such
  as old installers or five or more screenshots, with one action. The action selects the files
  first, then opens the same command as the file menu; nothing runs by itself. _In Viewer:_ the
  cards, **×** to hide one in that folder, **Show hidden insights**. _Learn:_
  [Explore a folder](../guides/explore.md)
- **File overview**: a plane that searches the filename index for what may need a look across your
  indexed locations, such as old installers, files over 1 GB and old downloads. It reads only the
  index. _In Viewer:_ **File overview** in **⌘K**. _Learn:_ [Explore a folder](../guides/explore.md)

## Changes and recovery

- **Job**: one file operation, such as a copy, a move, a conversion, an extraction or a move to the
  Trash, with its progress, name conflicts, finished outputs, errors and Undo. _In Viewer:_ **File
  operations** in the title bar, **Recent file operations**. _Learn:_
  [File operations](file-operations.md)
- **Undo** and **Redo**: **⌘Z** undoes the latest file operation or lens edit, after checking that
  its files are still as it left them; **⇧⌘Z** does it again, a file operation as a new job. Moving
  and closing planes has its own Undo, **⌥⌘Z**; Git actions and other apps' changes have none in
  Viewer. _In Viewer:_ **Edit → Undo**, **Undo file operation**, **Undo arrangement**. _Learn:_
  [File operations](file-operations.md)
- **Receipt**: Viewer's private record of work it did. An operation receipt is written before a file
  change and holds what Undo needs; a command receipt keeps a command's script, exit, times and
  bounded output. Viewer never replays a receipt. _In Viewer:_ **File operations**, the **Command
  receipt** plane. _Learn:_ [File operations](file-operations.md) · [Terminals](terminals.md)
- **Journal**: a bounded, private history of what Viewer did, filtered by source, severity,
  workspace, plane or time. It only records: it cannot apply, undo or replay anything. _In Viewer:_
  **Open Journal**, **Journal for workspace**, **Journal for plane**. _Learn:_ [Journal](journal.md)
- **Trash rule**: Viewer never deletes your files permanently. A removal goes to the system Trash,
  where **Restore** brings it back; on a volume without a Trash it fails and the item stays. Viewer
  has no command that empties the Trash, and an agent's removal waits for your approval of the exact
  items. _In Viewer:_ **Move to Trash…** (**⌘⌫**), **Trash** in the sidebar. _Learn:_
  [Browse and organize](../guides/files.md) · [File operations](file-operations.md)
- **Checkpoint**: a copy of files' contents and mode that Viewer keeps before it applies a reviewed
  batch change, when you ask for one. It leaves out Finder tags and ACLs, and all checkpoints share
  a 5 GB budget by default. _In Viewer:_ **Keep a content checkpoint** or **Save a content
  checkpoint first** in a review; **Content checkpoints…** restores one to a folder. _Learn:_
  [Custom actions](actions.md) · [Configuration](configuration.md)

## Text, notes and tasks

- **Scratch buffer**: a plane of text that is not a file yet. Viewer keeps it privately, through
  quitting, until you save it as a file or discard it. _In Viewer:_ **New scratch plane** (**⌘T**);
  it shows as **Unsaved text** in **⌘K**. _Learn:_ [Make a quick change](../guides/create.md)
- **Note**: a private document that saves as you type. It lives in Viewer's data, apart from the
  planes that show it: closing its plane keeps the note, and **Move to Trash…** in the note removes
  it. _In Viewer:_ **New note plane**, **Notes…**. _Learn:_
  [Make a quick change](../guides/create.md)
- **Checklist**: a note made of items you tick off; a dictated phrase becomes an unchecked item. _In
  Viewer:_ **New checklist plane**. _Learn:_ [Make a quick change](../guides/create.md)
- **Task area**: a named piece of work in a workspace: a folder or checkout with its notes,
  checklists, terminals, browsers, servers and conversations. Closing a tool's plane keeps it in the
  task. _In Viewer:_ **New task area…**, **Tasks…**. _Learn:_
  [Tasks, branches and worktrees](tasks-and-git.md)
- **Branch task**: a task area made with a new Git branch in its own worktree, opened with its
  folder, a note, a terminal and its Git changes. The terminal starts stopped, and Git changes load
  when you ask. _In Viewer:_ **New task from branch…**, **Create task**. _Learn:_
  [Work on a project](../guides/develop.md)
- **Worktree**: a second checkout of a Git repository in its own folder, on its own branch, with its
  own working files and staging. Views of one worktree share them; different worktrees do not. _In
  Viewer:_ **Open worktree…**. _Learn:_ [Tasks, branches and worktrees](tasks-and-git.md)

## Commands and automation

- **Command**: one thing Viewer can do, such as **Copy path**, with an id such as `copy-path`. The
  same command runs from **⌘K**, a menu, a key, a typed line or an agent's proposal, and shows only
  where it applies. _In Viewer:_ **⌘K**, **Help → What Can I Do Here?**. _Learn:_
  [Features and where to find them](capabilities.md)
- **Prefix key**: **⌃B**, then one more key, runs a command, as in tmux: **⌃B** then **x** closes a
  plane. _In Viewer:_ **Show key sequences** (**⌃B** then **?**). _Learn:_
  [Keyboard shortcuts](shortcuts.md)
- **Action**: a command you make in **Settings → Actions**. It runs a built-in command, a recipe, a
  shell line, a program with literal arguments, a terminal profile, a sequence or a workflow, and
  can ask for inputs and show only where it applies. _In Viewer:_ **Save as action…**, the
  **Actions** menu. _Learn:_ [Make repeated work a command](../guides/automate.md)
- **Recipe**: a prepared change to the selection, such as **Batch rename…** or **Organize files…**,
  that becomes a proposal for you to review. Some recipes ask a model. _In Viewer:_ the **Actions**
  menu, **Action tasks…**. _Learn:_ [Custom actions and sequences](actions.md)
- **Sequence**: an action that runs commands in order, such as Test then Build, asking for its
  inputs once and stopping at the first step that fails. _In Viewer:_ **Settings → Actions**.
  _Learn:_ [Custom actions and sequences](actions.md)
- **Workflow**: a `viewer.workflow.jsonc` file of typed steps, such as inspections, comparisons,
  copies, conversions and recipes. Running it prepares reviews: you apply each, then resume. Opening
  a workflow never runs it. _In Viewer:_ **File → Workflows…**, **Run workflow**. _Learn:_
  [Workflows and watch rules](automation.md)
- **Watch rule**: a rule that starts a workflow when new files arrive in a folder, for example to
  propose names for new scans. It prepares a review and never applies it. _In Viewer:_ **Watch a
  folder…** in **Workflows…**. _Learn:_ [Workflows and watch rules](automation.md)
- **Command language**: lines you type after `:` in **⌘K**, in the style of vim and tmux, such as
  `:set grid!` or `:vs ~/Documents`. Any command id also works as a line. _In Viewer:_ **Command
  line…**. _Learn:_ [The command language](command-line.md)
- **CLI**: the `viewer` command for your terminal. `viewer .` opens a folder; with a client token
  from **Settings → Agents** it also searches, reads and prepares reviews in the running app. _In
  Viewer:_ **Install Viewer CLI**. _Learn:_ [Viewer CLI](cli.md)

## Models and agents

- **Model**: a language model you add in **Settings → Models**, from a provider or a local endpoint.
  It answers **Ask in words…**, chats, **Explore this folder** and model recipes; what it returns is
  a proposal for you to review. _In Viewer:_ **Add model**, **Use for Ask Viewer**. _Learn:_
  [Make repeated work a command](../guides/automate.md)
- **Model data levels**: what a model may receive from your files: **filenames and file metadata**,
  **filenames, metadata and document excerpts**, **filenames, metadata and extracted document
  text**, or **filenames, metadata, document text and pictures (photos and rendered drawing
  pages)**. Each level includes the one before; until you allow one, no file data is sent. Pictures
  come last, so an approval of text never sends a photo. _In Viewer:_ **Data access**, **Allow
  selected data**, **Revoke access**. _Learn:_ [Explore a folder](../guides/explore.md)
- **Agent**: a program on your Mac, such as a coding assistant, that connects to Viewer with a token
  from **Settings → Agents**. It looks around, reads what it may and proposes changes; it cannot run
  programs or type into a terminal, and it removes nothing without your approval. _In Viewer:_
  **Settings → Agents**, **Agent sessions…**. _Learn:_ [Models and agents](agents.md)
- **Agent access and folders**: agents connect only after you turn on **Allow local agent clients**
  and confirm it. Each named client, and the shared connection, has its own folders and
  capabilities; a path outside them is refused, and narrowing them stops the work in progress. _In
  Viewer:_ **Authorize folder…**, **What the connection may do**. _Learn:_
  [Models and agents](agents.md)
- **Proposal and review**: a proposal is a change prepared for you by a recipe, a workflow, a model
  or an agent. You review it, untick what you do not want and apply the rest; Viewer checks the
  files again first and refuses to act on a selection that changed. _In Viewer:_ **Review** in the
  title bar, **Apply** and the count of changes, **Review proposal** in a chat. _Learn:_
  [Custom actions and sequences](actions.md)

## Three separate permissions

Viewer asks for each on its own. None of them grants another.

- **Folder access**: macOS's permission for Viewer to read a folder such as Documents, an external
  drive or a share. Full Disk Access, needed to browse the Trash, is a separate grant. _In Viewer:_
  the macOS dialog, **Allow folder access…**, **Settings → Permissions**. _Learn:_
  [Install and update Viewer](../guides/install.md)
- **Model data**: which data level a model may receive, for that model and endpoint. Changing its
  endpoint or clearing its key revokes it, and requests an agent starts need **Allow agent-started
  actions to send the same data** too. _In Viewer:_ **Settings → Models → Data access**. _Learn:_
  [Explore a folder](../guides/explore.md)
- **Agent access**: what a connected agent may do, and in which folders. An agent still reads only
  folders Viewer itself can read, and reaches a model only with that model's agent permission. _In
  Viewer:_ **Settings → Agents**. _Learn:_ [Models and agents](agents.md)
