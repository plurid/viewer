# Work on a project

Use this guide for a code project: editing files, running commands, reviewing Git changes, giving a
branch its own task and checkout, and looking at a site you are building. Open the project folder
first; the editor, terminal, Git review and local server all start from that folder.

**Find it:** **Edit text** edits the selected file, and **⌘E** the one a preview shows · **⌘K** →
**Run command…**, **Open terminal plane**, **Git changes**, **New task from branch…** · **File → New
Terminal Plane** and **File → Start Local Server**

## Edit and save

1. Select a source file and choose **Edit text** from **⌘K**, or right-click → **More file
   actions**. It opens in a plane, ready to edit. In a preview or Quick Preview, press **⌘E** or
   choose **Edit**.
2. Press **⌘S** to save, or **⇧⌘S** to save it under another name. **Done** ends editing.

Unsaved changes survive quitting Viewer. The first save of an editing session moves the version it
replaces to the Trash, and **File operations** in the title bar offers **Undo** for it. If another
app changes the file while you edit, Viewer keeps your draft and says so: choose **Reload**, **Save
Over It** or **Cancel**.

## Run commands

- **⌘K** → **Run command…** runs one shell line in the current folder. Type the line and choose
  **Run**, or press **⌘Return**. Its output appears in the command progress panel, with a **Stop**
  button while it runs and **Open receipt** for the full record.
- To keep a line for next time, open **Run command…** again, pick it under **Recent**, and choose
  **Save as action…**. [Make repeated work a command](automate.md) has the rest.
- **⌘K** → **Open terminal plane** opens an interactive shell in the folder. **File → New Terminal
  Plane** opens one from the menu.

## Review changes with Git

1. Turn on **Settings → Browsing → Git → Show Git status** to see change badges on files.
2. In the repository folder, press **⌘K** and choose **Git changes**.
3. Choose **Unstaged**, **Staged** or **Against base**, then select a changed file. For **Against
   base**, pick the branch to compare with.
4. Choose **Stage hunk 1** beside a hunk, or **Stage all hunks** for the whole file. In **Staged**,
   the same buttons unstage. **Open diff** opens the file's changes in their own plane.

To stage whole files, select them in the folder and right-click: **Git → Stage selection**. The same
**Git** menu has **Commit staged changes…**, **Pull (fast-forward only)** and **Push to upstream**.
Git runs on the real checkout with its own hooks and configuration.

## Start a task from a branch

A task gives one piece of work its own checkout and tools.

1. In the repository folder, press **⌘K** and choose **New task from branch…**.
2. Type the **Task name** and the **Branch name**, or choose **Existing branch**. Pick the branch to
   **Start from** and check the **Destination** folder for the new worktree.
3. Choose **Create task**. Viewer creates the worktree and opens it with a note, a terminal and its
   Git changes.
4. Come back to it later from **⌘K** → **Tasks…**.

![A branch task with its folder, note, terminal and Git changes](../media/develop.png)

The terminal waits until you choose **Start terminal**, and Git changes load when you choose **Load
Git changes**. Closing a tool's plane keeps it in the task. **Open worktree…** opens an existing
worktree without making a task. [Tasks and Git](../reference/tasks-and-git.md) covers the details.

## Look at a local site

1. In the folder that holds the site, choose **File → Start Local Server**, or **⌘K** → **Start
   local server**. A server plane opens with its address and its **Requests** log.
2. Choose **Open in Viewer** to open the site in a browser plane beside the source. **Open server in
   browser** opens it in your default browser instead.
3. Reopen the server's controls later from **⌘K** → **Local servers…**.

The built-in server serves files as they are. For a framework with its own build and hot reload, run
its development command in a terminal plane, then choose **⌘K** → **Open web page…** and enter its
address. [Browser planes](../reference/web.md) explains the difference between a browser plane and
an HTML preview.

## Keep a conversation with the task

In the task's plane, choose **Attach conversation…** to attach a Viewer conversation, or a session
report from a connected agent. Its file and diff links open as linked planes. A reported status
shows as **Reported** with its time. [Agents](../reference/agents.md) explains how an agent reports.

To run the same test or build steps every time, see [Make repeated work a command](automate.md).
