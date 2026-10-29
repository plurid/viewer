# Work on a project

Open the project folder. The editor, terminal, Git review and local server all start from that
folder.

## Edit and save

1. Select a source file and press **⌘E** to edit it in a plane.
2. Press **⌘S** to save, or **⇧⌘S** to save a copy elsewhere.

Unsaved changes survive quitting Viewer. If another app changes the file while you edit, Viewer
keeps your draft and asks what to do with it.

## Run commands

- **⌘K** → **Run command…** runs one shell line in the current folder and shows its output, with a
  **Stop** button. Choose **Save as action…** to keep it for next time.
- **⌘K** → **Open terminal plane** opens an interactive shell in the folder. **File → New Terminal
  Plane** opens one from the menu.

## Review changes with Git

1. Turn on **Settings → Browsing → Git → Show Git status** to see change badges on files.
2. In the repository folder, press **⌘K** and choose **Git changes**.
3. Choose **Unstaged**, **Staged** or a branch to compare with, then select a changed file.
4. Choose **Stage** or **Unstage** beside a change, or **Stage selection** for lines you selected.

Git runs on the real checkout with its own hooks and configuration.

## Start a task from a branch

A task gives one piece of work its own checkout and tools.

1. In the repository folder, press **⌘K** and choose **New task from branch…**.
2. Name the task and the new branch, pick the base, and check the folder for the new worktree.
3. Choose **Create task**. Viewer creates the worktree and opens it with a note, a terminal and its
   Git changes.
4. Come back to it later from **⌘K** → **Tasks…**.

![A branch task with its folder, note, terminal and Git changes](../media/develop.png)

The terminal starts stopped, and Git changes load when you choose **Load Git changes**. Closing a
tool's plane keeps it in the task. **Open worktree…** opens an existing worktree without making a
task. [Tasks and Git](../reference/tasks-and-git.md) covers the details.

## Look at a local site

1. Choose **File → Start Local Server** in the folder that holds the site.
2. Choose **Open server in browser** to open it in a browser plane beside the source, with the
   server's request log.
3. Reopen the server's controls later from **⌘K** → **Local servers…**.

The built-in server serves files as they are. For a framework with its own build and hot reload, run
its development command in a terminal plane, then choose **⌘K** → **Open web page…** and enter its
address. [Browser planes](../reference/web.md) explains the difference between a browser plane and
an HTML preview.

## Keep a conversation with the task

Attach a Viewer conversation, or a session report from a connected agent, to the task. Its file and
diff links open as linked planes. A reported status shows as **Reported** with its time.
[Agents](../reference/agents.md) explains how an agent reports.

To run the same test or build steps every time, see [Make repeated work a command](automate.md).
