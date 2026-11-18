# 0023: Remote planes over the system's OpenSSH

Status: Proposed.

## Context

Viewer currently browses other machines through local mounts. SSH planes need a distinct location
and authority boundary so a server path can never reach the Mac's filesystem. Remote transfers also
need to preserve local operations, receipts and guarded Undo without introducing another mutation
owner. This proposal covers the direct build and stays behind `VIEWER_REMOTE=1` until qualification.
The location and transport foundations implement this boundary. Browsing and other user flows remain
proposed until their work packages and qualification.

## Decision

### System transport and connection authority

Use `/usr/bin/ssh` and an in-repository SFTP v3 client, with no new package dependency. OpenSSH owns
SSH configuration, keys, agent integration, ProxyJump and host-key verification. Viewer parses
`~/.ssh/config` for host suggestions only after the person accepts an explicit offer. OpenSSH still
reads its own configuration normally. Saved server connections belong in the private
`remote-connections-v1.json`, outside editable JSONC. Imported configuration and agents cannot
create connections or connect.

Connect explicitly creates one master per connection with
`ssh -f -N -S <control-path> -o ControlMaster=yes -o ControlPersist=600`, never with `-M`: a `-M`
after `ControlMaster=yes` turns it into `ask`, which asks before every session (a refused one signs
in directly) and refuses `-O exit`. File channels and terminals reuse that master with
`-S <control-path> -o ControlMaster=no`. Only the master gets the port, user, jump hosts and key. A
file channel gets `ProxyCommand=/usr/bin/false` instead and no `-J` (a command-line ProxyJump would
replace it), so a channel whose master is gone fails rather than signing in by itself. The chosen
key goes in as `-o IdentityFile="…"` with `IdentitiesOnly=yes`: `-i` looks for the path before
expanding `%%`, warns when it finds nothing and then offers the person's default keys. Main also
checks that the key file exists and can be opened, without reading it, before ssh starts. Automatic
reconnects use `BatchMode=yes` and `SSH_ASKPASS=/usr/bin/false`; they never prompt. Up to three SFTP
channels separate browse, transfer and walk work because OpenSSH serializes requests within a
channel. One utility process owns SFTP clients and bulk byte movement; desktop services retain
policy and authority. ssh, its askpass helper and the channels get an allowlisted environment: home,
user, path, shell, temporary folder, language, the agent's socket and Kerberos tickets.

A small Swift `viewer-askpass` helper relays prompts over a private socket with a per-attempt token
to a native sheet on the window that clicked Connect. Secret input uses a native secure text field.
Prompts are attributed and quoted. Passwords, passphrases and second factors never reach the
renderer, logs, diagnostics or persistent storage. Changed host keys block connection with no
override. Fixed argument construction, validated connection fields and `--` before the destination
prevent server addresses from becoming options; no free-form SSH options are accepted.

`RemoteConnections` in main owns saved records, connection states and cancellation. Construction
does not load a record, write a file, inspect SSH configuration or connect. Records use
`DocumentStore`, mode 0600, and unreadable records move aside before another save. Settings alone
may save or remove an endpoint. Window IPC refuses agents and agent-driven windows, including
read-only connection discovery. The Store edition and a disabled feature flag have no service.

`RemoteControl` creates explicit masters in a private 0700 temporary folder with short socket names.
OpenSSH first binds a master at its control path plus a 17-byte temporary suffix, so a control path
may use 86 bytes, not 104: a longer one would fail to bind only after the person has signed in, so
Viewer checks it first. `/tmp` replaces a temporary folder whose path is too long, and the empty
folders are removed at Quit. `ssh -f` also exits 0 when it carried on without a socket, so a sign-in
counts only once `-O check` answers; Viewer keeps the process ID it names. When `-O exit` fails and
the socket still names that same process, Viewer sends it SIGTERM; a recorded ID alone could belong
to another program by then. A check with no answer within five seconds counts as unknown, not gone.
Literal percent signs are escaped in control and identity paths. OpenSSH expands `${VARIABLE}` in
both with no escape, so such paths are refused. The worker owns the three lazy SFTP channels and
schedules foreground browse requests ahead of thumbnails, at most two thumbnails at a time. Its
main-process port exposes bounded list, stat, realpath, read and exclusive-write primitives;
failures keep the SFTP code and the server's sanitized message. Large transfer staging belongs to
the operations work packages. Disconnect uses an extensible `quiesceConnection(id)` and the remote
connection prefix for Operations; it never invokes local root revocation or file coordination. Five
minutes after the last plane, terminal or request releases a connection, its SFTP channels close and
its master stays for ControlPersist. A request in that time checks the master with `-O check` and
reopens channels through it. When ControlPersist has ended the master, the connection becomes not
connected without a new sign-in or retry, and a request says to connect again. Editing a
connection's name, starting folder or preferences keeps it connected; a new host, user, port, jump
host or key disconnects it first. Quit closes all masters concurrently within the two-second
transport budget.

The Swift helper only relays a prompt and its answer. Main attaches an AppKit secure sheet to the
requesting window through `macos-files`, using `NSSecureTextField` with a placeholder naming what
was asked (password, passphrase, PIN or verification code); host-key questions use
`dialog.showMessageBox` with Cancel as the default button. Questions OpenSSH asks on the Mac (a
key's passphrase, a security key's PIN, a password, an unknown host key) are worded as Viewer's own:
"Passphrase for key “id_ed25519”", never "Build box asks:". OpenSSH prefixes a server's
keyboard-interactive questions with `(user@host)`, so a server cannot word one as a Mac question:
those and anything unrecognized are quoted and attributed to the server. OpenSSH's
`SSH_ASKPASS_PROMPT` hint reaches the relay. `none`, such as a request to touch a security key,
shows a notice that closes when OpenSSH ends the helper. `confirm` comes only from
`ControlMaster ask`, which Viewer never uses: it is answered no without a sheet and ends the sign-in
as an error. A helper that ends closes its question without ending the sign-in; choosing Cancel ends
the sign-in. Each clicked attempt has a random token with a 120-second expiry and one prompt at a
time. Disconnect, a closed window or agent ownership cancels it. The token is per attempt, not per
question, because OpenSSH starts every askpass of an attempt with the same environment; Node cannot
tell which process is at the other end of a Unix socket, so the 0700 folder, the 256-bit token and
its expiry stand in for a peer check. Server text is quoted, its line breaks become spaces,
controls, bidi and other invisible characters are removed, and it is capped at 2,000 characters.
Inherited askpass variables and `DISPLAY` are removed. Reconnects receive neither token nor socket.
Relay fields are redacted from diagnostic exports; answers and raw SSH stderr are never logged. The
helper ships only in the direct build.

A failed keepalive check marks a connection offline. So does a lost channel or worker when the
master no longer answers `-O check`; while it answers, the lane's next request opens a new channel
through it, so a server that needs a password is not asked again. Reconnects wait 2, 5, 15, 30 and
then 60 seconds, stopping after ten attempts. A click replaces an automatic attempt. Authentication
and changed-host-key failures stop retries. A jump host that fails leaves standard error empty,
because ControlPersist sends the jump's own messages to /dev/null: exit 255 with nothing to read on
a connection with jump hosts counts as needs sign-in, with no automatic retries. The pure exit
classifier consumes bounded stderr and publishes only `needs-sign-in`, `host-key-changed` or
`unreachable`, plus, for a changed key, the key type and SHA256 fingerprint OpenSSH printed. At
`LogLevel=ERROR` a server's own words reach stderr only in a disconnect message or a channel open
failure; when either is present no fingerprint is shown. A channel's loss is classified once its
process has closed, when all of standard error has arrived. Connection snapshots also carry when
their state began. Fixtures substitute portable endpoints in OpenSSH 9.9
[connection messages](https://github.com/openssh/openssh-portable/blob/V_9_9_P2/sshconnect.c),
[authentication messages](https://github.com/openssh/openssh-portable/blob/V_9_9_P2/sshconnect2.c)
and [resolution messages](https://github.com/openssh/openssh-portable/blob/V_9_9_P2/ssh.c), with the
CRLF line endings and unknown-key wording seen against a loopback sshd. `tests/remote-sshd.test.ts`
runs the transport against a scratch loopback sshd when `VIEWER_TEST_SSHD=1`.

SSH host suggestions require an explicit yes, remembered with the saved record. The reader stays
inside `~/.ssh`, caps Include depth at four and combined bytes at 1 MiB, and excludes wildcard and
Match hosts. It never runs SSH configuration directives. Saved-record and reader enumeration bounds
also live in `domain/remote/limits.ts`.

`NSLocalNetworkUsageDescription` names SSH servers on the local network alongside model endpoints.
Spike S1 qualifies the purpose text and attribution. Downloads receive the quarantine attribute
before publication.

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
versions; SYMLINK requires OpenSSH extension evidence for its argument ordering. READLINK is plain
v3. An error status from the advertised limits extension leaves limits unspecified. Wire layouts
follow the [v3 draft](https://www.ietf.org/archive/id/draft-ietf-secsh-filexfer-02.txt) and
[OpenSSH protocol reference](https://github.com/openssh/openssh-portable/blob/master/PROTOCOL).

The codec caps metadata strings at 64 KiB, wire names at 4 KiB, DATA at 256 KiB and extension pairs
at 128. A packet keeps at most 128 extended-attribute pairs to bound Buffer views; it reads and
drops the rest, so a server that attaches a pair to every entry still lists. Identity IDs must fit
in one bounded string. Handle budgets and the queue budget for requests outside streams derive from
the shared channel and resource limits. Only a stream lifetime can name a stream; each stream's
window bounds its blocks, so they skip the queue budget. Each stream is a flow and other requests
form one more; flows take turns for wire credit, least recently served first, and a new flow joins
at the current turn. Any number of streams and a listing share a channel without refusals, and a
listing request waits one turn per stream with queued work when the request was queued. Streams on a
channel split a 16 MiB byte budget evenly, each within its own 8 MiB window; a stream holding
nothing may always take one block, so streams wait for room and are never refused. Advertised limits
can lower packet, read, write and handle budgets; an open waits for a free handle slot. Zero server
limits mean unspecified. OPEN and MKDIR accept only creation permissions, because OpenSSH ignores
other creation attributes; set times with FSETSTAT or SETSTAT afterwards. OpenSSH applies its umask
to both. `pread` and `pwrite` keep caller-owned handles, apply byte backpressure and share a
progress-based stall clock. Their default block is 128 KiB, lowered by server limits, filling the 8
MiB window at 64 requests. The clock runs only while waiting for outstanding wire requests, pausing
for a local consumer, producer or credit wait; sending a block is not progress. Server-side copy
uses positive blocks of at most one stream window with the same stall rules; an explicit zero length
checks the extension and sends nothing. OpenSSH answers copy-data OK when the last 64 KiB of a
request fail or end early, so the client verifies sizes: FSTAT of both handles first, then of the
destination after every block, which must reach the bytes copied so far. Progress counts only
verified blocks. A source that ends before the range, or an END OF FILE answer, fails with
`VIEWER_REMOTE_SHORT_SOURCE`; a short destination with an intact source fails with
`VIEWER_REMOTE_FAILURE`; an unreported size, or a destination already past the copy offset, gives
`ENOTSUP`, and the caller copies by streaming. Queue expiry rejects only its waiter, unless the
channel held credit through a whole metadata timeout without one reply: then the server is hung and
the channel closes. A metadata wire deadline starts when written and restarts while requests written
before it are still being answered. Sent cancellations retain wire credit until a reply arrives; an
undrained cancellation retires the channel after its deadline. A late handle from a canceled open is
closed by the client. Every CLOSE reply releases its tracked generation, including failed closes and
reused server slots. Metadata wire timeouts and malformed replies close the channel. Protocol errors
use `VIEWER_REMOTE_PROTOCOL`, cancellation `ABORT_ERR`. Server error messages are bounded display
text with control, format, line and paragraph separator, and default-ignorable characters stripped.
Raw bytes remain separate; callers must branch on codes. OpenSSH is single-threaded: the listing and
preview owners in packages 4 and 6 must LSTAT before OPEN, because opening a FIFO can block its
channel.

Names remain Buffers through decoding. `decodeListingName` exports a strict UTF-8 boundary with the
domain's 1,024-byte name limit. Invalid names produce inert error entries without a usable child
name. Exact `.` and `..` entries return `skip`; an empty READDIR NAME reply is a protocol error.
REALPATH results must be absolute; REALPATH and READLINK results reject NUL and paths over 4 KiB. A
packet-type allowlist on framing and on each writer's first byte, the desktop/domain source scan and
automatic fake-server assertions enforce the packet policy. The opt-in `VIEWER_TEST_SFTP_SERVER=1`
interop test uses the system SFTP subsystem over stdio, with a deny list and a temporary-root
request guard. SSH transport, authentication and full application qualification remain separate.

This corrects design fact 12: OpenSSH's plain v3 RENAME uses link/unlink only for regular files.
Other sources use a destination STAT, which follows links, then rename. Viewer first LSTATs the
destination and refuses unless it is absent, preserving dangling and looping links. A destination
created after that check can still race a non-regular source's rename, as with folder publication;
plain v3 offers no atomic no-replace guarantee for those sources.

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
setstat. File creation uses exclusive creation; publication uses guarded plain rename with the
non-regular-source race documented above. Policy scans and fake-server packet assertions must
enforce the forbidden set.

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
