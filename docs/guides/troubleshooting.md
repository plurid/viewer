# Get back to your work

## Viewer will not start from source

- Check the versions: Node 22.22 or later and pnpm 11. Run `node --version` and `pnpm --version`.
- Install the Xcode command-line tools with `xcode-select --install`, then run `pnpm install` again.
- Read the first error `pnpm start` prints; [Build and run Viewer](../development/builds.md) lists
  the requirements.

## A folder shows nothing, or the Trash is empty

- In a sandboxed build, choose **Allow folder access…** and pick the folder.
- To browse the Trash, give Viewer Full Disk Access in **System Settings → Privacy & Security → Full
  Disk Access**. This is a separate permission from folder access.

## A file or folder is unavailable

Reconnect its disk or share, then choose **Check again**. Choose **Locate file** if it moved, or
**Find renamed file** if it was renamed in the same folder. Your unsaved edits stay attached to the
original file.

## A preview is slow or fails

- Choose the preview's retry button.
- For an Office file, try the **Reading** or sheet view.
- Very large, encrypted, damaged or unsupported files can be beyond a preview's limits. Choose
  **Open With…** to use another app.

A thumbnail does not mean the full preview is supported;
[Supported formats](../reference/formats.md) lists what is.

## A copy or move failed

Open the **File operations** button in the title bar, read the error, and use the recovery it
offers. Keep partly copied files until you have looked at them. Viewer never repeats an interrupted
operation on its own when it restarts.

**Undo** can be unavailable when a file it would restore has changed since.

## A window stopped working

If a window freezes or goes blank, Viewer asks **This window stopped working.**

- Choose **Reload** to go on from what the window saved last: its planes and folders come back.
- Choose **Close** to close it. Closing it and quitting Viewer no longer wait for it.

A web page's own window asks the same, and a browser plane shows **Reload** for a page that stopped.

## A share has no Trash

Many network shares have no Trash, and Viewer never deletes files instead.

- **Move to Trash** fails and leaves the item where it is. Delete it from another app, or move it to
  a disk with a Trash first.
- Saving over a file, or choosing **Replace**, keeps the previous version beside it, such as
  `Notes (previous).md`. **File operations** names the file it kept. Remove it yourself when you no
  longer need it.
- An agent cannot replace or remove items on such a share.

## A local web page stopped loading

Reopen the server's controls from **⌘K** → **Local servers…**, start it if it stopped, then reload
the browser plane. Servers stay stopped after Viewer restarts until you start them.

## Viewer does not quit

Viewer quits once your work is safe. It first finishes a backup being written, saves every window
and closes its browser planes.

- With file operations still running, Viewer asks whether to wait for them, cancel them or keep
  Viewer open.
- If a step fails, Viewer stays open and says which: choose **Retry**, or **Keep Open** and quit
  later.
- **⌘Q** asks for a second press. Choose **Quit Viewer** in the menu to quit at once.

## Check for Updates could not check

- Check your internet connection, then choose **Viewer → Check for Updates…** again.
- If it says the update information is not signed by the publisher of Viewer, Viewer ignored it.
  Download the latest version from the Viewer website instead.
- If it says updates are not configured for this build, this copy was built without an update feed.
  Check the Viewer website for new versions.

## Settings stopped changing

Open **Settings → Configuration** to see which line of the settings file is invalid. Viewer keeps
using the last valid settings until you fix it. Keep API keys in the model settings, never in the
settings file.

## Viewer hit a problem

When something unexpected stops Viewer's own process, Viewer says **Viewer hit a problem**, records
it in its diagnostic log and quits after saving your windows. Choose **Show Diagnostic Log** to see
the entry, then open Viewer again.

## Report a problem

1. Choose **Help → Show Diagnostic Log** to find Viewer's local error log. It is never sent
   anywhere. After a crash, **Help → Show Crash Reports** opens the crash reports Viewer kept on
   this Mac; they are never sent either.
2. Choose **Help → Report an Issue…** and describe the Viewer version and build from **Viewer →
   About Viewer**, the macOS version, the steps, what you expected and what happened.
3. Attach a small sample file if you can, and the log if it helps. Remove personal paths, keys and
   anything private from screenshots and logs first.
