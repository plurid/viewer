# 0023: Remote planes over the system's OpenSSH

Status: Proposed.

## Context

Viewer currently browses other machines through local mounts. SSH planes need a distinct location
and authority boundary so a server path can never reach the Mac's filesystem. Remote transfers also
need to preserve local operations, receipts and guarded Undo without introducing another mutation
owner. This proposal covers the direct build and stays behind `VIEWER_REMOTE=1` until qualification.
It records the intended architecture, not a completed transport or a qualified user flow.

## Decision

### System transport and connection authority

Use `/usr/bin/ssh` and an in-repository SFTP v3 client, with no new package dependency. OpenSSH owns
SSH configuration, keys, agent integration, ProxyJump and host-key verification. Viewer parses
`~/.ssh/config` for host suggestions only after the person accepts an explicit offer. OpenSSH still
reads its own configuration normally. Saved server connections belong in the private
`remote-connections-v1.json`, outside editable JSONC. Imported configuration and agents cannot
create connections or connect.

Connect explicitly creates one master per connection with
`ssh -f -N -M -S <control-path> -o ControlPersist=600`. File channels and terminals reuse that
master with `-S <control-path> -o ControlMaster=no`. Automatic reconnects use `BatchMode=yes` and
`SSH_ASKPASS=/usr/bin/false`; they never prompt. Up to three SFTP channels separate browse, transfer
and walk work because OpenSSH serializes requests within a channel. One utility process owns SFTP
clients and bulk byte movement; desktop services retain policy and authority.

A small Swift `viewer-askpass` helper relays prompts over a private socket with a per-attempt token
to a native sheet on the window that clicked Connect. Secret input uses a native secure text field.
Prompts are attributed and quoted. Passwords, passphrases and second factors never reach the
renderer, logs, diagnostics or persistent storage. Changed host keys block connection with no
override. Fixed argument construction, validated connection fields and `--` before the destination
prevent server addresses from becoming options; no free-form SSH options are accepted.

Before enabling SSH planes, update `NSLocalNetworkUsageDescription` to explain SSH connections to
servers on the local network alongside model endpoints. Qualify the purpose text and attribution
with spike S1. Downloads receive the quarantine attribute before publication.

There is no connection at launch by default. Each connection has a **Connect when a plane needs it**
opt-in, initially off. BatchMode can still cause an SSH agent, hardware key, Kerberos or Local
Network prompt, so it does not justify an automatic connection without that choice. Remote shells
need no additional native execution confirmation, but start only after a click in the current window
session. Restored terminal planes offer Start. Disconnect quiesces the connection's operations,
resources, watches, search, terminals and cache before closing its master. Quit requests master
exit; ControlPersist bounds the lifetime after a crash.

### Locations and routing

A **remote location** is `viewer-sftp://<connectionID><absolute-path>`. Its saved connection ID is
opaque; the absolute path is normalized and raw, with no percent-encoding. Never parse this internal
string with `URL`. A typed `ssh://` or `sftp://` address resolves to a server connection first.
Remote identities are opaque and scoped to that connection, not local inode identities.

Pure location, address, connection-record and identity validation, limits and protected-path rules
belong to `src/domain/remote/`. Its
[`limits.ts`](../../packages/viewer-electron/app/src/domain/remote/limits.ts) is the authoritative
source of bounds. Local access checks require absolute local paths even when native access is
unscoped. Shared local services and definition-command entry points refuse the reserved scheme with
`VIEWER_REMOTE_NOT_LOCAL` before resolving a path. Widen only the schemas needed by remote-capable
methods; all other methods retain local-only schemas. Invalid internal locations in throwing domain
helpers use `VIEWER_REMOTE_INVALID_LOCATION` with a plain message. Typed addresses never retain URL
passwords; macOS asks for share credentials.

Exact saved-name matches are distinct from unknown names. A bare `host:/path` whose host is a known
URL scheme word is refused, avoiding accidental interpretation of `file:/` or `mailto:/` as SSH
endpoints. Use an explicit `user@host:/path` or a complete SSH URL for those host names.

Use thin routes for listing, stat, watches, search, thumbnails and identity in IPC handlers. Ports
inside Operations, Resources, Terminals and Trash retain each owner's shared state. The proposed
`src/desktop/remote/` services own connections, the askpass broker, SFTP worker coordination, server
Trash and remote executors. Poll visible folders with backoff and refresh immediately after Viewer
changes. Preview resources use SFTP range reads or a bounded private session-only cache.

### SFTP channel boundary

`desktop/remote/sftp` accepts a Node duplex byte stream without owning SSH or authentication. Call
`connect()` before operations; readiness includes version and advertised-limit negotiation. Offsets
and sizes use unsigned 64-bit bigints. File opens permit reading or exclusive creation. Attribute
changes permit permissions and paired access/modification times. Extension calls check advertised
versions; link calls require OpenSSH extension evidence for its argument ordering. Wire layouts
follow the [v3 draft](https://www.ietf.org/archive/id/draft-ietf-secsh-filexfer-02.txt) and
[OpenSSH protocol reference](https://github.com/openssh/openssh-portable/blob/master/PROTOCOL).

The codec caps strings at 64 KiB, wire names at 4 KiB and extension/extended-attribute pairs at 128.
Identity-name lookups allow 1,024 IDs per list. The client bounds its waiting queue and local
open-handle budget at 1,024 each, in addition to the shared request and packet limits. Advertised
server limits can lower packet, read, write and handle budgets. Zero server limits mean unspecified.
`pread` and `pwrite` keep caller-owned handles, apply byte backpressure and share a progress-based
stall clock. They default to 32 KiB blocks, lowered by server limits. Sent cancellations retain wire
credit until a reply arrives; an undrained cancellation retires the channel after its deadline. An
ownerless handle from a cancelled open also retires the channel. Metadata timeouts and malformed
replies close it; protocol errors use `VIEWER_REMOTE_PROTOCOL`, cancellation uses `ABORT_ERR`.

Names remain Buffers through decoding. `decodeListingName` exports a strict UTF-8 boundary with the
domain's 1,024-byte name limit. Invalid names produce inert error entries without a usable child
name. The in-memory fake server and policy scan exercise this boundary without SSH or network
access. Transport integration and real-server qualification belong to later packages.

### Operations and concurrency

Keep one Operations owner, one journal and one job model. Remote executors share source pins,
collision decisions, intent checkpoints, receipts, cancellation and validate-all-first Undo with
local operations.

This amends the single mutation queue in [ADR 0007](0007-spatial-workbench-resources.md). Transfers
to or from a server may run beside local jobs only when their footprints are disjoint. Compare
footprints per source, including source paths, destination paths and their parents; ancestor overlap
also serializes. Overlapping work retains execution and Undo order for that footprint. Global
exclusive work, quiesce and cancellation must cover every lane. WP8 and WP9 must establish these
invariants with concurrency tests before enabling parallel mutation. Separate lanes do not introduce
another journal or executor authority.

Cross-source moves copy and verify first, then move originals to their own side's Trash. Never
permanently unlink originals after a Mac-to-server or server-to-Mac transfer. Downloads receive the
quarantine attribute. Server Replace stages the new content and preserves the previous item in
server Trash; when server Trash is unavailable, a person's Replace keeps a previous-name copy.
Failed partial transfers go to server Trash; if that fails, preserve and report their recovery path.

### Server Trash and Undo

The SFTP client has no removal primitives. Do not encode `REMOVE`, `RMDIR`,
`posix-rename@openssh.com`, `hardlink`, `lsetstat`, `TRUNC` or `APPEND`, or size/uid/gid changes in
setstat. File creation uses exclusive creation; publication uses non-replacing rename. Policy scans
and fake-server packet assertions must enforce the forbidden set.

Resolve the SFTP home with `REALPATH(".")`. Try `<home>/.local/share/Trash/{files,info}`, then
`<home>/.viewer-trash/{files,info}`. Candidate directories must not be links, must belong to the
home's uid and must not be group- or world-writable; the Trash root has mode 0700. Use a candidate
only when its `files` directory is on the item's filesystem, proved through statvfs fsid. Refuse
read-only, cross-filesystem, unsafe, full or otherwise unusable Trash and report the server's
reason. There is no permanent-delete fallback and no Empty Trash action for a server.

Sync the intent before creating `info/<name>.trashinfo` with exclusive creation. The record contains
the original absolute path and deletion time in freedesktop Trash format. Then rename the item into
`files/<name>` without replacing anything. If rename fails, keep the orphan `.trashinfo` and report
its path. Restoration also keeps the info file. Trash receipts retain source, destination, info,
identity, size, mtime, permissions and a bounded proof.

Undo validates every step before moving anything. It checks the ready connection, source version,
proof, free original name and original parent. A disconnected connection leaves Undo offered with a
request to connect. Remote outputs go to server Trash on Undo; same-filesystem moves rename back.
Cross-source Undo restores originals from their Trash before trashing the copied output. Proofs
cover at most 10,000 entries and include relative paths, types, sizes, mtimes, permissions and link
targets. SFTP v3's one-second mtimes mean a same-second change that preserves size can go
undetected. The restore list restores only to original locations in v1.

### Persistence and edition boundaries

Write any job involving a remote location as `<id>.rjsonl`. New builds load local `.jsonl` and
remote `.rjsonl` receipts; older builds skip `.rjsonl` silently, without treating remote receipts as
damaged local logs. The journal remains a projection, not execution authority.

Widen saved folder, preview, terminal and search plane paths without a saved-state version bump.
When an older build reads that state, its salvage drops entire workspaces containing remote planes,
keeps other valid workspaces and preserves a backup. This downgrade behavior must be documented
before release. Remote planes stay outside portable project exports, definitions, captures,
favorites, recents, collections, baskets and agent roots.

SSH planes are direct-build-only in v1. The Store edition hides Servers and explains that SSH is
available in the direct download. Agents gain no remote browse, operation, terminal or connection
authority. WebDAV is a separate NetFS mount path; after mounting it uses local-volume rules. Store
WebDAV support depends on spike S4 and is not assumed by this decision.

## Spikes to run

The S0 spikes below are pending. This draft records no spike results or implementation evidence.

| Spike | Question to resolve                                                                                                        |
| ----- | -------------------------------------------------------------------------------------------------------------------------- |
| S1    | Exercise `ssh -f -M` with ControlPersist and the askpass relay; establish Local Network attribution on macOS 15 and later. |
| S2    | Measure `READDIR` pipelining and reply ordering on OpenSSH.                                                                |
| S3    | Verify HTML5 custom-type drag between BrowserWindows.                                                                      |
| S4    | Exercise NetFS WebDAV in direct and Store builds.                                                                          |
| S5    | Check statvfs fsid on ext4, xfs, btrfs subvolumes, zfs, NFS homes and macOS.                                               |
| S6    | Compare Swift helper startup time with the Electron binary.                                                                |

## Consequences

System OpenSSH preserves existing authentication and host-key policy without another SSH dependency.
The reserved location boundary keeps local authority explicit. Remote metadata offers weaker change
evidence than local identities, and server Trash can be unavailable. Those cases require refusal or
preserved recovery paths. Concurrent lanes require footprint and cancellation evidence in addition
to transport tests. Native authentication, real-server behavior and interactive flows remain
unqualified until their later packages and spikes provide evidence.
