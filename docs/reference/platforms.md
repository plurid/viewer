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
| **Open With** application choice                                                          | "Application selection is not available on this platform yet."                                               |
| Printing PDFs                                                                             | "Printing PDFs requires macOS."                                                                              |
| Finder aliases                                                                            | "Finder aliases require macOS."                                                                              |
| Instant copies (APFS clones)                                                              | Files are copied byte by byte                                                                                |
| Spotlight name search                                                                     | Not offered                                                                                                  |
| HEIC, HEIF and BMP decoding, RAW rendering, OCR, file tags and the `viewer` shell command | Bundled as macOS helpers only                                                                                |

The image, video, audio and PDF processors are bundled per macOS architecture
(`viewer-processors-darwin-<arch>`, `viewer-optimizers-darwin-<arch>`,
`viewer-raw-v3-darwin-<arch>`, `viewer-speech-v1-darwin-<arch>`). A previewable extension on macOS
is not a cross-platform codec promise. The bundled Office WebAssembly engine is packaged on every
platform; its real-engine macOS smoke passes, and Windows and Linux runs are pending.

## Direct and App Store builds

| Feature                                                    | Direct build                            | App Store build                                    |
| ---------------------------------------------------------- | --------------------------------------- | -------------------------------------------------- |
| Folder access                                              | Folder grants and macOS privacy prompts | Security-scoped bookmarks                          |
| Git review, worktrees, Git actions and branch tasks        | Yes                                     | No                                                 |
| Spotlight name search                                      | Yes                                     | No: the sandbox has no `mdfind`                    |
| The `viewer` shell command                                 | Yes                                     | No                                                 |
| **Open With** from Finder (document types)                 | Yes                                     | No: the sandbox would receive only the opened file |
| **Viewer → Check for Updates…** and the signed update feed | Yes                                     | No: the App Store updates it                       |
| File and terminal workers                                  | Processes                               | Threads                                            |

Store folder bookmarks do not grant Full Disk Access, and direct-build access does not establish
sandbox acceptance.

## Distribution

A local package is signed ad hoc. A direct release is signed with a Developer ID Application
certificate, uses the hardened runtime, is notarized and ships as a disk image that checks a signed
update feed; see [Install and update Viewer](../guides/install.md). Store distribution has its own
signing and release checks. This repository does not represent a local test candidate as a publicly
qualified installer.

**Related:** [Install and update Viewer](../guides/install.md) ·
[Building](../development/builds.md) · [Release gates](../development/releases.md) ·
[Speech input](speech.md) · [Features and where to find them](capabilities.md)
