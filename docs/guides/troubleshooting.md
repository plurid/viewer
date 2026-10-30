# Get back to your work

Use this guide when something in Viewer is not working: a folder that shows nothing, a window that
stopped, a failed copy, a model that asks for permission, or Viewer that will not quit. Each section
names what you see and what to choose.

**Find it:** **Help → Show Diagnostic Log** · **Help → Show Crash Reports** · **Help → Report an
Issue…** · the **File operations** button in the title bar

## A folder shows nothing, or the Trash is empty

- In the App Store edition, choose **Allow folder access…** and pick the folder.
- If macOS asked about a folder and you chose **Don't Allow**, turn Viewer on for it in **System
  Settings → Privacy & Security → Files & Folders**.
- To browse the Trash, give Viewer Full Disk Access in **System Settings → Privacy & Security → Full
  Disk Access**, then quit and reopen Viewer. This is a separate permission from folder access.

## A file or folder is unavailable

Reconnect its disk or share, then choose **Check again**. Choose **Locate file** if it moved, or
**Find renamed file** if it was renamed in the same folder. Your unsaved edits stay attached to the
original file.

## A preview is slow or fails

- Choose **Try again** in the preview.
- For an Office file, try the **Reading** view, or **Sheet** for a workbook.
- Very large, encrypted, damaged or unsupported files can be beyond a preview's limits. Choose
  **Open With…** to use another app, or **Show as hex** to see its bytes.

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

A web page's own window asks **This page stopped working.** with the same choices. In a browser
plane, a page that stops answering says **This page is not responding.** Choose **Retry** to reload
it.

## Viewer hit a problem

When something unexpected stops Viewer's own process, Viewer says **Viewer hit a problem**, records
it in its diagnostic log and quits after saving your windows. Choose **Show Diagnostic Log** to see
the entry, or **Quit**, then open Viewer again. Your workspace comes back as you left it.

## A model asks for permission

A model receives file data only at the level you approved for it, in **Settings → Models**.

- If an action says **Allow this provider to receive the selected data before running the action.**,
  open the model's **Data access**, choose the level the action names, choose **Allow selected
  data**, and confirm with **Allow**. Then run the action again.
- If it says **Allow agents to send this data to the provider…**, an agent started the action. Turn
  on **Allow agent-started actions to send the same data** under the model's **Data access**.
- If you chose **Cancel** in the system dialog, Viewer says **Model data access was not allowed.**
  Nothing was sent.
- Changing a model's endpoint or clearing its key revokes its access. Allow it again.

[What a model may read](automate.md#what-a-model-may-read) explains the levels.

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

- With file operations still running, Viewer asks what to do: **Wait for them**, **Cancel them and
  quit** or **Keep Viewer open**.
- If a step fails, Viewer stays open and says which: choose **Retry**, or **Keep Open** and quit
  later.
- **⌘Q** asks for a second press. Choose **Quit Viewer** in the menu to quit at once, or turn off
  **Settings → Browsing → Warn before quitting with ⌘Q**.

## Check for Updates could not check

- Check your internet connection, then choose **Viewer → Check for Updates…** again.
- If it says the update information is not signed by the publisher of Viewer, Viewer ignored it.
  Download the latest version from the Viewer website instead.
- If it says updates are not configured for this build, this copy was built without an update feed.
  Check the Viewer website for new versions.

## Settings stopped changing

Open **Settings → Configuration** to see which line of the settings file is invalid; **Validate**
checks it again and **Open config.jsonc** opens the file. Viewer keeps using the last valid settings
until you fix it. Keep API keys in the model settings, never in the settings file.

## Viewer will not start from source

- Check the versions: Node 22.22 or later and pnpm 11. Run `node --version` and `pnpm --version`.
- Install the Xcode command-line tools with `xcode-select --install`, then run `pnpm install` again.
- Read the first error `pnpm start` prints; [Build and run Viewer](../development/builds.md) lists
  the requirements.

## Report a problem

1. Choose **Help → Show Diagnostic Log** to find Viewer's local error log; it says **No problems
   have been recorded.** when there is none. After a crash, **Help → Show Crash Reports** opens the
   crash reports Viewer kept on this Mac. Neither is ever sent anywhere.
2. Choose **Help → Report an Issue…** and describe the Viewer version and build from **Viewer →
   About Viewer**, the macOS version, the steps, what you expected and what happened.
3. Attach a small sample file if you can, and the log if it helps. Remove personal paths, keys and
   anything private from screenshots and logs first.
