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

## Keep everyday tools close

Open **What can I do here?** from a plane's information button or the Help menu. It lists actions
for the captured folder and selection, including shortcuts. Turn off **Available here** to see why
other actions are unavailable.

Use **Pin** beside an action; expand **Pinned tools** to unpin or change the order. Image, PDF, text
and folder planes keep separate choices. **Use defaults** restores the starting set. A missing
extension keeps its named pin so you can repair it; it never turns into another command.

For persistent position indicators and larger drag targets, choose **Settings → Browsing →
Scrollbars → Always visible**. **Follow system** uses the platform's scrollbar behavior.

## Back up personal work

Choose **Workspace → Backup and Restore…**, then **Create backup…**. Review the workspace and
document counts before choosing a new filename. Keep the resulting JSON file private: it contains
notes, drafts, conversation text, file paths and command history. It does not contain your original
files, credentials, file-access grants, browser sessions or running processes.

On another profile or computer, choose **Open backup…**. Relink folders that moved, then choose
**Restore copies**. Your existing work stays beside the restored workspaces. The optional preference
checkbox also restores appearance, shortcuts, pinned tools and recipes; access must be granted
separately. Terminals, servers and conversations remain stopped.

Reading positions follow relinked files. Unsaved text remains a private draft; an unchanged copied
file can be recognized by its original content hash. If a media file's identity changed, choose
**Apply saved edits to current files** in its recovery view. This checks the current sources and
creates a new draft, keeping the original edits. A shorter file cannot silently truncate a saved
edit.

The backup stays unchanged. A backup that needs a newer Viewer, has missing documents or exceeds the
size limit is refused. [Backup format and limits](../reference/configuration.md#personal-backups)
describe the exact scope.

## Understand what closing means

Closing a preview keeps the file. Closing a note view keeps its note. Closing an embedded terminal
ends that view's shell. Closing a server's controls leaves its running listener available through
**Local servers…** until the owning window shuts down.

Cold restoration opens saved views without replaying terminal input, commands, agents or server
starts. [Task areas](../reference/tasks-and-git.md) retain the logical links between a checkout and
its tools.
