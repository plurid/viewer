# Platform and build status

This page records which platforms and builds Viewer is qualified on, and which features depend on
macOS or on the direct build.

Viewer is a desktop application with platform-specific native services. A shared renderer or passing
source test does not establish complete support on another OS.

| Target              | Current qualification                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Apple Silicon macOS | Local developer packages, the notarized disk image and native workflows exercised             |
| Intel macOS         | Native helpers build for `x64` (`VIEWER_BUILD_ARCH=x64`); native acceptance is still required |
| Windows             | Shared application work and adapters need executable qualification                            |
| Linux               | Shared application work and adapters need executable qualification                            |
| Mac App Store       | Separate sandbox, entitlement, signing and release gates                                      |

Viewer requires macOS 14 or later (`LSMinimumSystemVersion` 14.0). Its native helpers are built for
that target, not for the build machine's SDK, and the build stops if the Electron runtime needs a
newer macOS. [Building](../development/builds.md) describes the supported development setup.

## Features that need macOS

On another platform these report the message shown and the rest of Viewer stays available.

| Feature                                                                                   | Elsewhere                                                                                                    |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Local speech recognition                                                                  | "Local speech has not been bundled for this platform."                                                       |
| Agent `git_status` and `git_diff`                                                         | "Contained agent Git inspection is currently available on macOS. Use the Git review plane on this platform." |
| External terminal apps                                                                    | "External terminal adapters currently support macOS. Embedded terminals remain available."                   |
| **Open With** application choice                                                          | "Viewer can't list apps on this system. Use Open in Default App instead."                                    |
| Printing PDFs                                                                             | "Printing PDFs requires macOS."                                                                              |
| Finder aliases                                                                            | "Finder aliases require macOS."                                                                              |
| Pasting a picture as a PNG                                                                | Not offered until clipboard files can take priority over picture renditions                                  |
| Instant copies (APFS clones)                                                              | Files are copied byte by byte                                                                                |
| Spotlight name search                                                                     | Not offered                                                                                                  |
| HEIC, HEIF and BMP decoding, RAW rendering, OCR, file tags and the `viewer` shell command | Bundled as macOS helpers only                                                                                |

The image, video, audio and PDF processors are bundled per macOS architecture
(`viewer-processors-darwin-<arch>`, `viewer-optimizers-darwin-<arch>`,
`viewer-raw-v3-darwin-<arch>`, `viewer-speech-v1-darwin-<arch>`). A previewable extension on macOS
is not a cross-platform codec promise. The bundled Office WebAssembly engine is packaged on every
platform; its real-engine macOS smoke passes, and Windows and Linux runs are pending.

## Direct and App Store builds

| Feature                                                    | Direct build                                     | App Store build                                                        |
| ---------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| Folder access                                              | Folder grants and macOS privacy prompts          | Security-scoped bookmarks                                              |
| Git review, worktrees, Git actions and branch tasks        | Yes                                              | No                                                                     |
| Spotlight name search                                      | Yes                                              | No: the sandbox has no `mdfind`                                        |
| Local network sharing marks, Get Info and setup guidance   | Yes, on macOS                                    | No: system share-point tools are outside this edition's sandbox policy |
| The `viewer` shell command                                 | Yes                                              | No                                                                     |
| **Open With** from Finder (document types)                 | Yes                                              | No: the sandbox would receive only the opened file                     |
| **Viewer → Check for Updates…** and the signed update feed | Yes                                              | No: the App Store updates it                                           |
| 30-day trial and pay-once offline key                      | When both publisher configuration fields are set | No UI or license record                                                |
| File and terminal workers                                  | Processes                                        | Threads                                                                |

Store folder bookmarks do not grant Full Disk Access, and direct-build access does not establish
sandbox acceptance.

Network sharing follows the direct-only system-tool rule used for Spotlight. It reads
`/usr/sbin/sharing -l -f json`, the `com.apple.smbd` launch job, the local host name and physical
network interfaces with bounded, shell-free calls. Empty share lists are confirmed with
`/usr/bin/dscl . -list /SharePoints`. The explicit `AllowGuestAccess` SMB preference is read with
`/usr/bin/plutil` when available. Missing preferences remain unknown. Empty, malformed, inconsistent
or unsupported output means unknown sharing state. Unescaped text records cannot safely identify
sharing permissions. It opens the installed macOS Sharing settings for the person to make changes.
Tools receive SIGTERM after two seconds and SIGKILL after a further 250 ms if they do not exit.
Opening the fixed Settings pane requires no folder metadata or access grant. The Store edition runs
none of these tools and offers no sharing mark, section or command.

The current helper reads cached kernel mount data with `getmntinfo(MNT_NOWAIT)` before sharing
metadata walks. Network-volume rows and their ancestors are excluded without contacting those
filesystems. Older or absent helpers use a bounded `/sbin/mount` fallback, cached for five seconds.
Its unescaped network records yield unknown sharing state for those paths, never a definite
negative. A share point whose canonical path cannot be resolved makes the whole sharing state
unknown. Known missing points are retried at most once a second without rerunning the share tools.

Both macOS editions can read the native hidden flag when built with the current file helper. The
helper reads directory flags in bulk and falls back to native per-entry flags on filesystems that do
not support bulk attributes. After changing `tools/macos-files.mm`, rebuild the helper before
shipping: an older or unavailable helper only supplies the existing dot-name rule. Flag-read
failures also keep listings available with the dot-name rule. Source tests with a separately
compiled helper do not qualify a signed Store build.

The shipped source leaves license configuration empty. Such a direct build has no trial, license
menu, Settings page or reminder, and writes no license record. Configured direct builds keep all
features available after the trial. See [license keys and trial state](license.md).

## Volumes without exclusive rename

Both macOS editions use exclusive rename where supported. Only `ENOTSUP` or `EOPNOTSUPP` enables
reservation publication, including on exFAT: Viewer creates an empty reservation exclusively,
verifies its identity and emptiness, then renames the complete item over it. Existing names and
final links are refused. Native coordination and the Store move notifications remain in place.

The reservation check and rename leave a short race with an outside process replacing that
reservation and losing that entry's content. Supporting volumes retain their atomic guarantee. A
helper built from this source is required. An older helper lacks the recovery capability, so Viewer
keeps the original "Could not move the item: Operation not supported" failure and never enters that
helper's reservation fallback. It replaces nothing through that fallback. Signed Store and physical
volume acceptance remain separate from source tests and the generated-image native scenario. See
[file operations](file-operations.md#volumes-without-exclusive-rename) and the
[decision](../adr/0017-publication-without-exclusive-rename.md).

In the Store edition, permission for one file does not grant permission to its parent folder. The
fallback must open that folder and fails if that access is missing. **File operations** shows "Could
not move the item: Permission denied" or "Operation not permitted". The source or complete stage
stays available at the job's recovery path. Choose **Allow Folder Access…**, grant the parent
folder, then retry. Viewer never broadens a single-file grant itself.

## Distribution

A local package is signed ad hoc. A direct release is signed with a Developer ID Application
certificate, uses the hardened runtime, is notarized and ships as a disk image that checks a signed
update feed; see [Install and update Viewer](../guides/install.md). Store distribution has its own
signing and release checks. This repository does not represent a local test candidate as a publicly
qualified installer.

**Related:** [Install and update Viewer](../guides/install.md) ·
[Building](../development/builds.md) · [Release gates](../development/releases.md) ·
[Speech input](speech.md) · [Features and where to find them](capabilities.md)
