# Keep your work together

A workspace remembers the views you have open and where you put them. The files stay in their
ordinary folders.

## Open a second view

Use **Open linked plane** from a preview, or Option-double-click a file. The new view belongs to its
parent. **Related planes** helps you follow parents and children; closing a child returns to the
parent.

**Open in another plane** creates an independent root. Use it when you want a separate browsing
context instead of another branch of the current folder. Opening a file again within the same root
normally reveals its existing view.

## Focus or spread out

Dock a plane for ordinary focused work. **⌘Return** switches between focused and spatial views.
**Frame all** brings the open planes into view. Tiling arranges them face-on, and tile dividers
resize the available work area.

![A folder and its linked document in spatial view](../media/hero.png)

In spatial view, click inside a plane to give its content scrolling and keyboard input. Click the
background or press Escape to return navigation to the space. Use the header to move the plane
rather than dragging its file contents.

You can hide navigation controls in Settings and still reach their commands from **⌘K**. Appearance
and control visibility are preferences, not prerequisites for using a workspace.

## Give different work its own home

Use the workspace menu to create and switch workspaces. A writing workspace might contain a folder,
PDF and notes. A development workspace might add an editor, browser and terminal. New folder planes
use the starting-folder choices in **Settings → Browsing**.

Named arrangements, saved views and presentation profiles help you return to a useful layout. A
profile changes presentation; it does not grant file access or start commands.

## Save a portable project

A Viewer project records relative file references and workspace presentation in
`viewer.project.jsonc`. It does not pack your files into a library or copy private terminal,
conversation or credential state into the project.

## Understand what closing means

Closing a preview keeps the file. Closing a note view keeps its note. Closing an embedded terminal
ends that view's shell. Closing a server's controls leaves its running listener available through
**Local servers…** until the owning window shuts down.

Cold restoration opens saved views without replaying terminal input, commands, agents or server
starts. [Task areas](../reference/tasks-and-git.md) retain the logical links between a checkout and
its tools.
