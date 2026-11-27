# Get back to your work

Use this guide when something in Viewer is not working: a folder that shows nothing, a window that
stopped, a failed copy, a model that asks for permission, or Viewer that will not quit. Each section
names what you see and what to choose.

**Find it:** **Help → Copy Report…** · **Help → Show Diagnostic Log** · **Help → Show Crash
Reports** · **Help → Report an Issue…** · the **File operations** button in the title bar

## A folder shows nothing, or the Trash is empty

- Choose **Allow Folder Access…** and pick the folder in the native macOS folder panel.
- If macOS still refuses the folder after you choose it (for example if you chose **Don't Allow**),
  **Open Privacy Settings…** appears beside **Allow Folder Access…** with a one-line reason. Choose
  it to open **System Settings → Privacy & Security → Files & Folders** (or **Full Disk Access** for
  the Trash and protected system folders) and turn Viewer on.
- To browse the Trash, give Viewer Full Disk Access in **System Settings → Privacy & Security → Full
  Disk Access**, then quit and reopen Viewer. This is a separate permission from folder access.

## A file or folder is unavailable

Reconnect its disk or share, then choose **Try Again**. Choose **Locate File…** if it moved, or
**Find Renamed File** if it was renamed in the same folder. Your unsaved edits stay attached to the
original file.

## A preview is slow or fails

- Choose **Try Again** in the preview.
- For an Office file, try the **Reading** view, or **Sheet** for a workbook; those controls stay
  reachable even if content extraction fails.
- For a PostScript file, if moving Ghostscript scratch to the Trash fails, Viewer reports that
  failure even after **Cancel Rendering**.
- Very large, encrypted, damaged or unsupported files can be beyond a preview's limits. Choose
  **Open With…** to use another app, or **Show as Hex** to see its bytes.

A thumbnail does not mean the full preview is supported;
[Supported formats](../reference/formats.md) lists what is.

## A copy or move failed

Open the **File operations** button in the title bar, read the error, and use the recovery it
offers. Keep partly copied files until you have looked at them. Viewer never repeats an interrupted
operation on its own when it restarts.

**Undo** can be unavailable when a file it would restore has changed since.

If a copy or paste to an exFAT disk fails with "Could not move the item: Operation not supported",
use a build whose native file helper was built from the updated source. An older helper still fails
with the same message and replaces nothing. Keep any incomplete stage the failed job names until you
have inspected it. In the Store edition, a permission error can mean only the file was granted:
choose **Allow Folder Access…**, grant its parent folder, then retry. See
[volume publication](../reference/file-operations.md#volumes-without-exclusive-rename).

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

Reopen the server's controls from **⌘K** → **Local Servers…**, start it if it stopped, then reload
the browser plane. Servers stay stopped after Viewer restarts until you start them.

## Viewer does not quit

Viewer quits once your work is safe. It first finishes a backup being written, saves every window
(including open editors, notes, drafts, lenses and settings) and closes its browser planes.

- If Viewer reports that a newer or unreadable workspace file is protected, closing or quitting
  still saves your open editors and settings. Layout changes from that session are lost when you
  close.
- With file operations still running, Viewer asks what to do: **Wait for them**, **Cancel them and
  quit** or **Keep Viewer open**.
- If a window fails to save or does not answer in time, Viewer reports the failure instead of
  closing silently and stays open so you can choose **Retry**, or **Keep Open** and quit later.
- **⌘Q** asks for a second press. Choose **Quit Viewer** in the menu to quit at once, or turn off
  **Settings → Browsing → Warn before quitting with ⌘Q**.

## Check for Updates could not check

- Check your internet connection, then choose **Viewer → Check for Updates…** again.
- If it says the update information is not signed by the publisher of Viewer, Viewer ignored it.
  Download the latest version from the Viewer website instead.
- If it says updates are not configured for this build, this copy was built without an update feed.
  Check the Viewer website for new versions.

## A license key is not accepted

- Copy the complete key from your purchase into **Settings → License → License key**, then choose
  **Save License Key**. Line breaks are accepted; missing characters are not.
- A key for another product is not a Viewer key. A changed or foreign signature is refused. Copy the
  original again and check that it is the key for this build's publisher.
- No connection is needed to enter or check a key. If the error remains, contact support with the
  order reference and the error sentence. Keep the complete key out of public reports.

A key this build cannot verify stays saved. Unreadable records are kept under a recovery name before
a fresh trial starts. If Viewer says the record could not be preserved, keep the original, restore
access to the data folder and relaunch. This session will not save over it. See
[record recovery](../reference/license.md#stored-record).

An ended trial never blocks work. **Hide** dismisses its bar until the next launch. If **License**
is absent, this is the Store edition or a build without license configuration. See the
[license guide](license.md).

## Settings stopped changing

Open **Settings → Configuration** to see which line of the settings file is invalid; **Validate**
checks it again and **Open config.jsonc** opens the file. Viewer keeps using the last valid settings
until you fix it. Keep API keys in the model settings, never in the settings file.

## Viewer will not start from source

- Check the versions: Node 22.22 or later and pnpm 12. Run `node --version` and `pnpm --version`.
- Install the Xcode command-line tools with `xcode-select --install`, then run `pnpm install` again.
- Read the first error `pnpm start` prints; [Build and run Viewer](../development/builds.md) lists
  the requirements.

## Report a problem

1. Choose **Help → Copy Report…**. Read the Markdown report, then choose **Copy** (Return). Escape
   closes without copying. Copy puts the text on the clipboard, which other apps can read and macOS
   may carry to your other devices through Universal Clipboard.
2. Choose **Help → Report an Issue…** and paste the report. Describe the steps, what you expected
   and what happened. Attach a small generated sample if you can.

By default, the report contains no personal file names or message text. It includes Viewer's
version, build, edition and trial or licensed status, macOS, display count and scales, language and
region. Model, chip and memory appear when available. Up to 20 recent failures appear newest first,
with their time, kind and known error class. Codes come only from recorded error fields and a fixed
list of known codes. Recorded stack locations inside Viewer keep the code path, line and column;
function names are omitted. Other stack frames are counted without their paths. Both the direct and
Mac App Store editions use this report; the default needs no user, computer-name or volume lookup.

Turn on **Include message text** only if you want excerpts. Message text can contain file names,
addresses and other private text. Viewer removes what it can recognize. Read it before you share it.
Viewer hides quoted filenames and shortens recognized paths. It omits text before or after a path
when spaces or line breaks could be part of a filename. Frame locations come from the recorded
stack. Text that resembles a stack frame in a message receives the same path checks as other text.
Worker stderr records show structured failure details only. A worker can split one filename across
multiple records. Complete code paths inside Viewer's bundle retain their diagnostic names, and the
data folder keeps only fixed Viewer folder names. Failed privacy checks omit excerpts and name what
could not be checked. Turning the checkbox off restores the default report. Copy copies exactly the
displayed text.

In the Mac App Store edition, message text needs the same additional privacy checks: account and
Home details, the real Home path, full name, computer and host names, and mounted volume names.
These use local account information, `id`, `scutil`, a Home realpath check and `/Volumes`. If macOS
refuses any check, Viewer names it and leaves out message text. The default failure details remain
available. Both views use the same log snapshot. A report that exceeds the window's size limit says
it was shortened and ends at a whole line.

Viewer sends neither report to its developer. The report does not add settings, file listings,
clipboard contents, environment variables or license buyer details.

**Help → Show Diagnostic Log** reveals the original local log. Viewer masks recognized credentials
as each record is written. An open credential quote can continue onto the next line. A trailing
backslash, an unfinished field or a license marker alone leaves the following diagnostic readable.
**Help → Show Crash Reports** opens crash reports kept on this Mac. These original files and
screenshots can contain private paths, names and unfamiliar credential formats. Read and edit them
before sharing. See [diagnostic log and report privacy](../reference/diagnostics.md).
