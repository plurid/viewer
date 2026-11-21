# File-manager gaps

Everyday file-manager features that Viewer lacks. The list comes from comparing Viewer with
[Dux Files](https://duxlabs.dev/docs/dfiles) 2.1, a keyboard-first file manager for Linux desktops.
Each row was checked against Viewer's source, not only its guides. These are proposals; current
behavior is in the [capability reference](../reference/capabilities.md).

## Small additions

Each is about a day of work, and each is something a person meets in the first hour.

| Feature                | Viewer today                                                                         | Proposal                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Recent files           | Only folders are remembered.                                                         | A **Recent files** list of what was opened or saved in Viewer, kept on this Mac. |
| Change the default app | **Open With…** marks the default app and cannot change it.                           | **Always open with** for the file's kind, where macOS allows it.                 |
| Timed lyrics           | A video reads the subtitle file beside it. A song ignores the `.lrc` file beside it. | Read `.lrc` as timed lines and show the current line while the song plays.       |

## Larger additions

| Feature                          | Viewer today                                                                                                                                                                                                                                                                                                  | Proposal                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| More archive formats             | **Extract Here** opens ZIP, TAR and gzip-compressed TAR. **Compress to ZIP** is the only way to make an archive. 7-Zip, xz and bzip2 files are recognized by their first bytes and cannot be opened.                                                                                                          | Extract 7z, RAR, cpio and TAR compressed with xz, bzip2, zstd or lzma. Create `.tar.gz`, `.tar.xz` and `.tar.zst`. In a test, the `bsdtar` in macOS 15 (libarchive 3.5.3) read 7z, cpio and TAR compressed with xz, bzip2 or lzma, so those need no new dependency. It has a RAR reader, not yet tried on a sample, and no zstd. Entry names and sizes still pass Viewer's own checks before anything is written. |
| Tags you can see                 | **Tags and Comments…** edits Finder tags and their colors; **Find Files with Tag…** and `tag:` in search find tagged files. Folder views show no tags, and the context menu has no tag row.                                                                                                                   | Show tag dots in List, Grid and Columns, and add a color row to the context menu. The tags stay Finder's own. Custom folder icons can follow.                                                                                                                                                                                                                                                                     |
| Search that follows `.gitignore` | Search skips **Excluded names and paths**. A rule is a plain name or a full path, and a project's `.gitignore` is not read.                                                                                                                                                                                   | Inside a Git repository, skip what its `.gitignore` files ignore, with a switch to include them.                                                                                                                                                                                                                                                                                                                  |
| WebDAV and SFTP shares           | **Connect to Server…** accepts `smb`, `afp`, `nfs`, `ftp` and `cifs` addresses and hands them to macOS. The location model, SFTP v3 client and OpenSSH transport (packages 1 to 3) are built in the direct build behind `VIEWER_REMOTE=1`, off by default; browsing, operations and WebDAV are not wired yet. | Finish packages 4 to 14 of [Remote planes](remote-planes.md): SFTP browsing, previews, server Trash and Undo, transfers, remote terminals, remote filename search and NetFS WebDAV mounts.                                                                                                                                                                                                                        |
| Reveal from other apps           | **Show in Finder** in another app opens Finder.                                                                                                                                                                                                                                                               | An opt-in setting that makes Viewer the file viewer for apps that honor the `NSFileViewer` default, as ForkLift and Path Finder do. macOS has no supported setting for this, so investigate first.                                                                                                                                                                                                                |
| Retry as administrator           | A refused copy or move reports the error and stops.                                                                                                                                                                                                                                                           | Offer one retry through the macOS authorization prompt, in the direct build only. Agents never get this route.                                                                                                                                                                                                                                                                                                    |
| Help inside the app              | **Help → Getting Started** and **Help → Keyboard Shortcuts** open pages on GitHub, so both need a network. **Help → What Can I Do Here?** lists actions locally, Settings lists every shortcut, and prefix keys show their next keys.                                                                         | Bundle the guides and open them in a plane. A key such as **?** can then show the shortcuts for the plane in front.                                                                                                                                                                                                                                                                                               |

## Reach

These decide who can use Viewer at all, and each is weeks of work.

| Feature            | Viewer today                                                                                                                                | Proposal                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Translations       | Every label is English, and there is no translation layer.                                                                                  | Move interface text into a catalog, add the languages people ask for, and mirror the layout for right-to-left scripts. The wording rules in `pnpm docs:check` need an answer for each language first. |
| A gallery of tools | The **Tool Library** manages the tools saved on this Mac, and a tool travels as an exported folder. There is no place to find or share one. | Document the tool format so a person can write one by hand, then add a gallery with first-party and reviewed marks. An installed tool keeps today's sandbox.                                          |
| Phones and cameras | A connected phone or camera is not a place in Viewer.                                                                                       | Show cameras and iPhones as read-only places and import from them, through ImageCaptureCore in the native helper. Android needs MTP, which macOS does not provide.                                    |

## Already covered

The same comparison suggested these, and Viewer has them. Do not add a second version.

- Redo for file jobs: **Redo File Operation**, ⇧⌘Z.
- Near-miss matching of file names, in ⌘K and **Find File…**.
- A modal key layer: [prefix keys](../reference/shortcuts.md#prefix-keys) with modes, in place of a
  fixed vim mode.
- Renaming many files: **Batch rename…**.
- Tabs and split view: planes, paired folders that can follow each other, and workspaces.
- **New Folder with Selection…**, **Duplicate**, **Make Alias** and **Put Back** from the Trash.
- Emptying the Trash: Viewer never deletes a file for good unless you choose **Empty Trash…**
  yourself in the Trash window, after a confirmation; agents cannot reach it.

## Not planned

- **Replacing the open and save panels of other apps.** macOS does not let an app take them over.
- **A system monitor, wallpaper theming, a login screen, quick settings and calendar sync.** They
  belong to a desktop shell, not to a file app.

**Related:** [Product priorities](roadmap.md) · [Format coverage](formats.md) ·
[Desktop quality](desktop-quality.md)
