# Task workflow follow-up

Accepted October 26, 2026. Deliver in order and preserve generated fixtures and
builds. This ledger records actual evidence as implementation progresses.

| Delivery | Scope                                                                                       | Status                                         |
| -------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Fixes    | Notes/checklists Trash, Models deep link, blocked creation queue and Ask recents            | Implemented; native creation regression passed |
| 1        | New task from branch: worktree, task, folder, note, terminal and Git views                  | Implemented; packaged acceptance passed        |
| 2        | Pinned-base Git review, stage/unstage hunks, keyboard file navigation and retained position | Implemented; packaged acceptance passed        |
| 3        | Palette folders, typed inputs, directory availability and sequential commands               | Implemented; packaged acceptance passed        |
| 4        | Task conversations, linked source/diff navigation and actual agent-reported status          | Implemented; packaged acceptance passed        |

Use the incumbent Plurid Operate UI and existing resource services. Deleting a
private note must use the OS Trash, wait for open drafts, and remain unavailable
to agent commands. Tests stub the Trash adapter; they do not approve or perform
real file removals. New task creation preserves partially created resources on
failure and reports their location. Git mutations retain source/index identities.
Command inputs are literal values rather than shell source, sequences stop on
failure, and restored state never replays a command. Agent states come from
explicit reports; terminal text is not interpreted as trusted state.

Verification includes focused service/UI tests, retained native acceptance,
complete static/test checks, a preserving package, passing packaged smoke and a
fresh independent interface review.
Qualification remains scoped to the executed platform and scenarios.

## Behavior and boundaries

Folder commands now wait for the operation outcome rather than its admission ID.
A collision opens File operations; only the current command-line step is queued.
The retained packaged collision test creates one manual folder and all 26 letter
folders after the human-equivalent Skip action on its generated fixture. No user
queue is silently resolved. Ask Viewer keeps reviewed request/answer history
separately from command-line history, with a dedicated Clear control.

Task creation retains a partial worktree/task on setup failure and offers Finish
task setup; retry reopens the same note and logical terminal. Hunk review writes
only the index using server-retained patch bytes, with current checkout, HEAD,
index and exact-diff checks. Branch comparison uses a pinned merge base and
includes current working changes. Conflicts, renames, mode changes, binary files
and patches above the bounded text limit use whole-file inspection. The reader
caps a review at 5,000 paths, 4 MiB per patch, 2,000 hunks and 20,000 rendered lines.
Review mode, pinned base, selected file and up to 100 file scroll positions persist.

See [composable commands](composable-actions.md) and
[agent session reports](agent-session-reports.md) for the implemented builder and
adapter boundaries. State version 11 retains exact older state bytes before its
first save. Chat version 3 similarly backs up versions 1 and 2 before adding
explicit current-source references. Private agent transcripts are not exported.

The complete suite currently passes 1,903 tests across 271 files, with
fixtures preserved and positive file removals recorded as unverified. All four
TypeScript targets, the required ESLint command and formatting checks passed.
Native visual acceptance and final package evidence are recorded below. An earlier sandbox-only run
failed native coordination/loopback checks; the authorized native run resolved
those environment failures without relaxing assertions.

## Finder and Quick Look incident, October 26

The user's Desktop thumbnail generation, moving files to Trash and emptying Trash
became slow or stalled while Viewer qualification was in progress. System logs
identify Finder's file move as waiting on a read claim owned by
`com.apple.quicklook.ThumbnailsAgent`. One recorded wait ran from 08:25:41.705 to
08:26:32.930 local time; another ran from 08:46:12.916 to 08:47:13.086.

The image-thumbnail extension, PID 16973, consumed 5.4 GB and 100% CPU. Its sampled
stack remained in RawCamera/CoreImage rendering. It had both Viewer playground
RAW photographs and retained native-test RAW files mapped. These observations
implicate the shared image worker; redacted system URLs do not establish which
particular RAW input triggered its failure. Viewer testing must be treated as a
potential contributor, rather than claiming an unrelated macOS problem.

A normal SIGTERM did not stop the worker. After verifying the exact executable
identity, SIGKILL stopped only that extension. The user confirmed Desktop
thumbnails and file deletion recovered. Finder, Spotlight and file-coordination
services were not restarted; no files or caches were deleted and Trash was not
emptied by the agent. The replacement worker was idle at approximately 18 MB.

The integration gap was folder thumbnails: full camera previews already used
the private LibRaw helper, but `Thumbnails` still submitted RAW inputs to
Electron's shared Quick Look thumbnail service. Both now share `DerivedPreviews`
and its private helper. RAW thumbnail requests have no system-renderer fallback,
including when the helper is missing or fails. A guard also rejects supported
RAW extensions at the generic Quick Look rendition entry point. Thumbnail scope
cancellation reaches the private decoder, and its cached bytes are unpinned even
if bitmap encoding fails. Other image formats still use Quick Look; this change
does not claim to isolate the whole preview stack.

Five regression cases cover all eight supported RAW extensions, case handling,
missing/failed decoders, revocation, lease release and the system-renderer guard.
The preserved packaged check `tests/native/raw-thumbnails.ts` successfully decoded
one Nikon NEF at 128 and 512 pixels and reused its warm thumbnail, then quit
cleanly. Source hashes remained unchanged. Evidence is retained at
`/private/var/folders/nq/spvmjp8n4w923_2t1nj63l6r0000gn/T/viewer-native-raw-thumbnails-qSmwKj`.
The red and green mocked regression logs are
`/private/tmp/viewer-raw-thumbnail-regression-{red,green}-20261026.log`;
the complete post-fix suite is
`/private/tmp/viewer-task-recovered-tests-20261026.log`.

## Final packaged acceptance

The preserved candidate is
`/private/tmp/viewer-task-workflows-validated-20261026-G/Viewer.app`.
Its source fingerprint before and after packaging is
`b376d3d51d3c2881b2c44c5912e5e21b6cc4d0a27d782263b1ce16e9e756a27e`;
the lockfile fingerprint is
`bf1703c1f919ddaefa0e82f08386939e31145b07333bf3f46f107e1b18daee38`.
Packaging and strict deep signature verification pass. This is a local Apple
Silicon direct rebuild with inherited native dependencies, without notarization
or Store qualification. All previous candidates and generated artifacts remain.

`tests/native/task-workflows.ts` passes against this exact candidate. Its retained
profile, result and six captures are in
`/private/var/folders/nq/spvmjp8n4w923_2t1nj63l6r0000gn/T/viewer-native-task-workflows-oUdIoI`;
the log is `/private/tmp/viewer-task-final-workflows-G-20261026.log`.
It verifies the real branch task and four tools, index-only staging and unstaging
of a hunk, literal parameter handling and Test → Build order, reported session
attachment and linked source navigation. It opens then cancels note Trash review.
Positive OS note removal remains unverified under the removal policy.

The final private RAW thumbnail check passes in
`viewer-native-raw-thumbnails-79PhJZ` under the same temporary root; its log is
`/private/tmp/viewer-task-final-raw-G-20261026.log`. The system image-thumbnail
worker remains idle after the controlled checks.

Complete packaged smoke passes against the same final candidate. The retained
fixture is `viewer-verification-mPerid`; the log is
`/private/tmp/viewer-task-final-smoke-G-20261026.log`; native evidence is in
`packages/viewer-electron/app/out/native-evidence/electron-smoke-2026-10-26T07-21-25-015Z-16ed1ae6-a4ed-4fd3-ba76-ffa03091a140`.
The image-thumbnail extension remains idle at approximately 18 MB after smoke.

The complete 1,903-test suite and four TypeScript targets pass after the RAW
fix. The only subsequent source change corrects the smoke harness: collision
recovery now opens File operations automatically, so the old test's unconditional
Open click closed it. The revised test first asserts automatic opening, then
explicitly closes and reopens the panel. Its earlier failure, fixture and capture
remain preserved in `/private/tmp/viewer-task-smoke-recovered-F-20261026.log` and
`viewer-verification-PVvUiA`. No product code changed for that correction.

Earlier native acceptance found two actual races and retained their failures:
closing the conversation picker restored focus to the opener and interrupted the
destination camera framing; overlapping Git review reads could let an older mode
replace a newer snapshot. The picker now closes before framing the destination,
and server generation checks refuse superseded review reads. Focused regressions
and the final native workflow pass. The independent interface reviewer returns
**ship**, with no material fixes, for the six valid C2 task-workflow captures.
Those captures and the final native checks establish the exercised desktop dark
workflow, not mobile, physical assistive-technology or cross-platform support.
