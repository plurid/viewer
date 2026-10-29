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

## A local web page stopped loading

Reopen the server's controls from **⌘K** → **Local servers…**, start it if it stopped, then reload
the browser plane. Servers stay stopped after Viewer restarts until you start them.

## Settings stopped changing

Open **Settings → Configuration** to see which line of the settings file is invalid. Viewer keeps
using the last valid settings until you fix it. Keep API keys in the model settings, never in the
settings file.

## Report a problem

1. Choose **Help → Show Diagnostic Log** to find Viewer's local error log. It is never sent
   anywhere.
2. Choose **Help → Report an Issue…** and describe the Viewer version, macOS version, the steps,
   what you expected and what happened.
3. Attach a small sample file if you can, and the log if it helps. Remove personal paths, keys and
   anything private from screenshots and logs first.
