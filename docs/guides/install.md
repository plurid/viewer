# Install and update Viewer

Use this guide to put Viewer on your Mac, let it read your folders, keep it up to date and remove
it. Viewer needs a Mac with Apple silicon and macOS 14 Sonoma or later.

**Find it:** **Viewer → Check for Updates…** · the daily check in **Settings → Privacy** · folder
access in **System Settings → Privacy & Security**

## Install

1. Download the Viewer disk image, `Viewer-<version>-<build>-arm64.dmg`, from the
   [Viewer website](https://plurid.com/viewer).
2. Open the disk image and drag **Viewer** onto **Applications**.
3. Eject the disk image: select it in the Finder sidebar and press **⌘E**.

The disk image is signed, and Apple has notarized it. To check the download, compare its checksum
with the `SHA256SUMS.txt` published beside it:

```sh
shasum -a 256 ~/Downloads/Viewer-*.dmg
```

The Mac App Store edition installs and updates through the App Store instead.

## Open Viewer for the first time

1. Open **Applications** and double-click **Viewer**.
2. macOS says Viewer was downloaded from the internet. Choose **Open**. macOS asks this once; it has
   already checked that Apple notarized the app.
3. Viewer opens on your Home folder.

If macOS refuses to open Viewer, the download is damaged or incomplete. Move it to the Trash and
download it again.

### Allow access to your folders

macOS asks before Viewer reads your Desktop, Documents or Downloads folder, an external drive or a
network share for the first time. Viewer indexes your Home folder for search in the background, so
these questions can appear soon after the first launch.

1. Choose **Allow** for each folder you want to browse, preview and search in Viewer.
2. To change an answer later, open **System Settings → Privacy & Security → Files & Folders**, find
   **Viewer** and turn each folder on or off.
3. To browse the Trash, add Viewer to **System Settings → Privacy & Security → Full Disk Access**,
   then quit and reopen Viewer.

In the App Store edition, a folder Viewer may not read yet shows **Allow folder access…**. Choose it
and pick the folder. **Settings → Permissions** lists the folders you allowed, and **Revoke** takes
one back.

Viewer asks for the microphone only when you start dictation, and for your local network only when a
model endpoint you added is on it.

## Update Viewer

Viewer looks for a newer version once a day when it opens. When there is one, it says which version
is available and what changed.

1. Choose **Download**. Your browser downloads the new disk image. If you choose **Later**, the
   daily check does not show that version again; **Viewer → Check for Updates…** still does.
2. Quit Viewer with **⌘Q**.
3. Open the new disk image and drag **Viewer** onto **Applications**. Choose **Replace**.
4. Open Viewer. Your settings, workspaces and notes stay as they were.

To check at any time, choose **Viewer → Check for Updates…**. It also tells you when you have the
latest version, or when it could not reach the update server.

To stop the daily check, turn off **Settings → Privacy → Check for updates when Viewer opens**. The
check downloads a small signed file and sends nothing about your files. Viewer ignores an update
that is not signed by its publisher, and says so when a newer version needs a newer macOS.

The Mac App Store edition has no **Check for Updates…** item: the App Store updates it.

## Where Viewer keeps its data

| What                                            | Where                                       |
| ----------------------------------------------- | ------------------------------------------- |
| Settings, workspaces, notes, indexes, receipts  | `~/Library/Application Support/Viewer`      |
| The editable configuration                      | `config.jsonc` in that folder               |
| The diagnostic log                              | `Logs/diagnostics.log` in that folder       |
| The `viewer` shell command, if you installed it | `~/.local/bin/viewer`                       |
| App Store edition data                          | `~/Library/Containers/com.pluridviewer.app` |

Your own files stay where they are. The data folder holds Viewer's own records: indexes, preview
caches and, when you choose them, recovery copies of reviewed changes.

## Uninstall Viewer

1. To keep your workspaces and settings, choose **Workspace → Backup and Restore…** and save a
   backup first.
2. If you installed the shell command, choose **Settings → Navigation → Uninstall shell command…**.
3. Quit Viewer with **⌘Q**.
4. Move **Viewer** from **Applications** to the Trash.
5. To remove its data as well, move `~/Library/Application Support/Viewer` to the Trash. In the
   Finder, press **⌘⇧G** and enter that path to find it.

Removing Viewer never removes your files.

[All guides](README.md)
