# Get back to your work

## A file or folder is unavailable

Reconnect its disk or mounted share, then use **Check again**. A preview can keep its last loaded
content while clearly marking that the source is unavailable. Use **Locate file** for a moved
source, or **Find renamed file** for a uniquely identified sibling. An unsaved editor draft stays
attached to its original file.

In a sandboxed build, use **Allow folder access…** when the application needs native folder
authorization. macOS Full Disk Access is a different permission; it can be required for the system
Trash.

## A preview is slow or fails

Use its retry action. For Office files, try Reading or Sheet view when available. Large, encrypted,
damaged or unsupported files can exceed a preview's limits. **Open in…** remains useful for
specialized formats.

Check the [format reference](../reference/formats.md) before expecting a different extension or
codec to work. A thumbnail is not proof of full preview support.

## A local webpage stopped loading

Check its server. **Local servers…** reopens the controls of a running listener; the browser's retry
action reloads the page. A saved server is stopped after an application restart until you explicitly
start it.

## A file operation failed

Open **Operations**, read the source/destination and error, then use the offered recovery. Keep
partial outputs until you inspect them. An interrupted operation does not replay itself at launch.

If a destination already exists, choose the collision behavior deliberately. Undo can be unavailable
when an output changed outside Viewer.

## Settings stopped updating

Open **Settings → Configuration** for validation diagnostics. An invalid external edit stays
available for correction while Viewer keeps its last valid settings. Do not paste API keys into
shared configuration; use the model credential controls.

## Report a problem

Open an [issue](https://github.com/plurid/viewer/issues) with the application version, operating
system, steps, expected result and actual result. A small non-private sample is more useful than a
whole personal folder. Remove personal paths, credentials and unrelated content from screenshots and
logs.

The [development testing guide](../development/testing.md) explains reproducible checks for
contributors.
