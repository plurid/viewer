# Remote planes over OpenSSH and WebDAV

Viewer currently reaches other machines only through macOS network mounts (**Connect to Server…**
for `smb`, `afp`, `nfs`, `ftp` and `cifs`). This page records the remote planes plan from
[ADR 0023](../adr/0023-remote-planes-over-system-openssh.md): native SSH/SFTP browsing, file
operations, previews, remote terminals, bounded search and WebDAV mounts.

Remote planes stay off in shipped builds (`VIEWER_REMOTE=1` required, direct macOS build only) until
every package and its qualification finish.

## What is built (packages 1 to 3)

Three foundational packages are in the codebase behind `VIEWER_REMOTE=1` in the direct build:

1. **Location model and fail-closed hardening (package 1).** Defines the internal
   `viewer-sftp://<connectionID><absolute-path>` location scheme, typed address parsing, saved
   connection schemas, opaque per-connection identities and shared bounds in
   `src/domain/remote/limits.ts`. Shared local services and definition-command entry points reject
   remote locations with `VIEWER_REMOTE_NOT_LOCAL` before touching local disk paths.
2. **SFTP v3 client and fake server (package 2).** Adds an in-repository SFTP v3 client in
   `src/desktop/remote/sftp/` with no new package dependency, bounded codecs, fair multi-stream
   credit scheduling, size-verified server-side copy, strict UTF-8 name decoding and an opt-in
   system-subsystem interop test (`VIEWER_TEST_SFTP_SERVER=1`). The client encodes no removal or
   truncation primitives (`REMOVE`, `RMDIR`, `posix-rename@openssh.com`, `hardlink`, `lsetstat`,
   `TRUNC` and `APPEND` are forbidden and checked by source scans and fake-server assertions).
3. **SSH transport and connections (package 3).** Uses the system's `/usr/bin/ssh` with one explicit
   master per server (`ControlMaster=yes`, `ControlPersist=600`, never `-M`), three lazy SFTP lanes
   (browse, transfer, walk) in a utility worker, `RemoteConnections` in
   `src/desktop/remote/connections.ts` (`remote-connections-v1.json`, mode 0600, person-only IPC),
   the Swift `viewer-askpass` helper relaying prompts to native AppKit sheets, an exit classifier,
   an opt-in `~/.ssh/config` host-suggestion reader and loopback `sshd` tests
   (`VIEWER_TEST_SSHD=1`).

## Rechecks due before continuing

Before work resumes on packages 4 to 14:

- Recheck the SFTP client (`src/desktop/remote/sftp/`) and the SSH transport (`src/desktop/remote/`)
  from packages 2 and 3.
- Complete the six S0 spikes listed in
  [ADR 0023](../adr/0023-remote-planes-over-system-openssh.md#spikes-to-run): master reuse with
  `ControlPersist`, the askpass relay and macOS 15 Local Network attribution (S1); OpenSSH `READDIR`
  pipelining and reply ordering (S2); cross-window HTML5 custom drags (S3); NetFS WebDAV in direct
  and Store builds (S4); `statvfs` `fsid` behavior across filesystems (S5); and Swift helper startup
  time against Electron (S6).

## Remaining packages and order (packages 4 to 14)

| Package | Scope                                                                                                                                                                                                                                                            | Order and milestone                    |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 4       | **Desktop read path.** Routed listing and stat, visible-folder polling with backoff and immediate refresh after Viewer changes, and saved-state persistence for remote planes.                                                                                   | First                                  |
| 5       | **Renderer browsing.** Connect, Connecting, Offline, Slow and host-key-changed plane states; **Servers** sidebar group (shown once saved); **Settings → Servers**; **Connect to Server…** SSH/SFTP input; command gates.                                         | After 4                                |
| 6       | **Previews.** SFTP range reads for images, video, audio and PDFs; private session-only cache (256 MiB per file, 1 GiB total) for local-file decoders; image thumbnails up to 16 MB.                                                                              | After 5. **First usable browse slice** |
| 7       | **Server Trash and Undo.** Freedesktop `~/.local/share/Trash` (or `~/.viewer-trash`) verified on the same filesystem via `statvfs` `fsid`, exclusive `.trashinfo`, restore list and guarded Undo (up to 10,000 entries).                                         | After 6                                |
| 8       | **Same-server operations.** Rename, server-side copy-data or streaming copy, Replace moving old items to server Trash, `.rjsonl` remote receipts and concurrent-lane footprint tests amending [ADR 0007](../adr/0007-spatial-workbench-resources.md).            | After 7                                |
| 9       | **Mac and server transfers.** Mac-to-server, server-to-Mac and server-to-server copies and moves; cross-source moves copy, verify and trash originals on their own side; downloads receive macOS quarantine; disjoint-footprint transfers run beside local jobs. | After 8                                |
| 10      | **Clipboard and drag.** Copy, paste and drag between local and remote planes, including across windows.                                                                                                                                                          | After 9, in parallel with 11 and 12    |
| 11      | **Remote terminals.** `ssh -t` over the shared master opening a login shell in the plane's folder (quoted for bash, zsh, dash, ksh and fish); restored remote terminals return to a Start panel.                                                                 | After 9, in parallel with 10 and 12    |
| 12      | **Remote search.** Bounded filename search by walking over SFTP.                                                                                                                                                                                                 | After 9, in parallel with 10 and 11    |
| 13      | **WebDAV.** `https://` WebDAV mounts through macOS NetFS, using local-volume rules once mounted.                                                                                                                                                                 | Independent, after spike S4            |
| 14      | **Qualification and release.** Real loopback `sshd` tests, packaged-build interactive checks, user documentation, release notes and removal of the `VIEWER_REMOTE=1` gate.                                                                                       | Last                                   |

## What stays off until finished, and out of v1

- **Feature gate.** Everything stays behind `VIEWER_REMOTE=1` in the direct build until package 14
  qualifies the full flow. No browsing, preview, transfer, terminal, search or WebDAV UI is active
  today.
- **No launch connections by default.** Saved servers never connect on startup unless the person
  enables **Connect when a plane needs it** for that server.
- **No permanent delete on servers.** Server removals go only to a verified same-filesystem server
  Trash. When server Trash is unavailable, Viewer refuses and reports why; there is no permanent
  delete fallback and no Empty Trash action for a server.
- **Direct build and person only in v1.** The Mac App Store sandbox cannot run `/usr/bin/ssh` or
  read `~/.ssh`, so SSH planes stay direct-build-only. Connected agents gain no remote browse,
  operation, terminal or connection authority.
- **Out of v1.** Editing files in place on a server, **Open With…**, dragging out to Finder,
  restoring server Trash to a chosen folder, folder sizes, Git, content search, Finder tags,
  compress/extract/convert on servers, server favorites and recents, stored passwords, port
  forwarding, resumable transfers, `sudo` and other protocols (such as S3 or FTP).

**Related:** [ADR 0023](../adr/0023-remote-planes-over-system-openssh.md) ·
[Product priorities](roadmap.md) · [File-manager gaps](file-manager-gaps.md)
