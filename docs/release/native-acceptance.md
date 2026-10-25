# Native release acceptance

Run these scenarios on the exact hashed candidate in a qualification report. Use generated folders and disposable Viewer profiles; never ordinary user files or a normal tmux session. Record candidate hash/channel, macOS version/build, machine, date, scenario result, screenshot/log and limitation. A browser simulation or injected bookmark is not native PowerBox/Finder evidence.

The owner authorized a coordinated visible native acceptance session. macOS initially denied command-runner Accessibility access; the owner subsequently confirmed the Finder inspection command works from restarted iTerm. `pnpm exec tsx tests/manual-native-acceptance.ts` runs from `packages/viewer-electron/app` and opens the actual signed MAS development build with an isolated profile and new generated iCloud/local folders. It prompts for actual picker cancellation/grants and human Finder copy/paste, automatically checks content/denial/cold bookmark restore/revocation, writes step evidence under ignored `out/native-acceptance/<UUID>/`, then moves its `/private/tmp` folder to the Trash; the iCloud `Viewer-QA-<id>` folder and the container profile are kept and listed in `$TMPDIR/viewer-kept-test-folders.log`. It does not require UI automation permission or inject bookmarks. Read its prompts before selecting a folder; the first picker must be cancelled. Human keyboard/drag/VoiceOver coverage and complete provider behavior remain separate.

The test window starts in a private instructions folder. Press Enter in the terminal at each picker prompt; the script then opens that native picker. Do not use sidebar or permission buttons to grant other folders during the sequence. It waits for the rendered workspace and records the bundle ID/build, macOS version/build and SHA-256 hashes of the executable, application archive and Info.plist. Permission observations before/after pickers include paths and statuses, never bookmark contents. Unexpected access records current grants and failure logs retain the stack. A separate grant before cancellation invalidates that step's preconditions; it is not proof that Cancel conferred access.

Finder is opened explicitly rather than relying on the default folder handler. Copy requires the exact two generated paths before any transfer. Empty or unrelated selections prompt up to three retries without counting a pass; paste similarly waits for exact contents and permits up to three attempts. `--finder-only` uses two Open pickers, then checks Finder copy/paste and revocation. Its report marks the scope and retains cancellation/read/Undo/cold restore as requiring separate full-scope evidence. Evidence from separate sessions can be combined only when the candidate hashes and OS match; a completed Finder-only session is not a completed full native suite.

Revocation uses the actual Settings renderer, preserving the production restriction on workspace requests. The harness first verifies that workspace revocation is rejected and its grant still works; after Settings revokes it, the workspace must receive `FILE_ACCESS_REQUIRED` for browsing and preview creation. `--revoke-only` uses one Open picker to repeat just this check. It does not count the other scenarios or physical interaction with the Settings control as passed.

On October 13, all eight guided checks completed on signed `2026101318`, macOS 15.1 / 24B2083, across three matching-candidate sessions. `out/native-acceptance/summary-2026101318.json` records the per-check session, hashes and limitations; the underlying partial/failed reports remain unchanged. Candidate content/signature and generated-folder cleanup were checked afterward. The broader scenarios below, including physical Settings/Viewer input, drag/VoiceOver, provider recovery and supported OS coverage, remain separate acceptance work.

| ID | Scenario and expected result |
| --- | --- |
| P01 | Open a generated ungranted folder, cancel the real folder picker, verify unchanged navigation and no writes. Select that folder, verify browse/read/watch/preview. Quit/relaunch the same profile and verify the saved native permission. |
| P02 | Grant source and destination separately. Copy then move a generated tree across these roots; exercise collision skip/keep-both/replace, cancellation, copy Undo and Viewer Trash Undo. Neither root grants their siblings. |
| P03 | Rename/move/remove a saved root externally. Permissions reports unavailable access and **Choose again…** repairs it. Revoke while indexing, reading, planning, transferring and running a terminal; verify stopped work and no names/text/thumbnail leaks. With copied/dragged items still in the native selection, refocus Viewer and open menus: access stays revoked. A fresh native copy/drag or explicit picker grant can authorize again. Pending old reads/imports must remain denied even after a later selection. Record any separately authorized parent explicitly. |
| F01 | Copy multiple generated files and folders in Finder; paste in Viewer. Copy in Viewer; paste in Finder. Verify exact filenames/contents and no extra items. Repeat with 256 items and Unicode/quotes/long names. Plain-text paths are not treated as native file objects. |
| F02 | Copy then Option-Command-V to move; verify origin removal only after successful destination completion. Drag Finder→Viewer and Viewer→Finder, multiple files/folders, folder targets, Option-copy and Command-move. Cross-volume default transfer copies. Verify drop feedback agrees with the result. |
| K01 | Physical keyboard: Up/Down, Shift ranges, PageUp/PageDown, type-ahead/repeated letters, Left/Right in Columns, Command-Down enter and Command-Up parent in List. Delete the selected folder and verify its unavailable child branch is removed. |
| V01 | Create and attach a disposable disk image, allow only its generated folder, verify inventory/capacity/read-only state. Start work and eject via Viewer; work drains first. Test a busy-volume failure, external disconnection and reconnect without automatically widening permissions. Delete only the generated image after detaching it. The direct candidate already passed five owned-image native checks, including typed busy recovery and read-only reconnect; repeat the genuine picker flow on the signed MAS candidate and record physical/network devices separately. |
| C01 | Use a disposable cloud/file-provider folder. Exercise placeholder download, coordinated copy/move/rename, provider conflict/offline/reconnect and revocation. Verify source preservation and visible errors. Native coordination is implemented and real iCloud zero-block placeholder hydration passes in the standalone backend; signed picker-backed transfers and complete provider failure/recovery still require this scenario. |
| T01 | From the signed MAS candidate, run generated commands in an embedded terminal, resize, close, switch workspace and Quit; no owned child remains. Launch the same generated cwd in Terminal and iTerm, including spaces/quotes. |
| T02 | Configure a unique private tmux socket and session; create a window from Viewer, verify its cwd and iTerm handoff. Repeated invocation must not duplicate failed fallback handoffs. Tear down only that unique test server/session. |
| A01 | Connect a separately launched authenticated local client, list/read config, propose an operation, deny/approve capability and revoke it. Wrong token and sibling paths fail. Native automated coverage currently proves the bundled independent signed MCP client, not every third-party agent client. |
| M01 | Use a dedicated test provider account and generated text. Deny before consent; approve each data level and inspect what reaches the endpoint. Change endpoint, remove key, revoke during a slow request and verify cancellation/no later request. Check failed/invalid/429/time-out responses. With an owned HTTPS LAN endpoint on macOS 15 or later, verify the system purpose message, deny/allow and explicit retry; do not change global privacy settings to bypass the check. Nine signed loopback checks already cover private approval, payload limits, real connection abort, endpoint/key invalidation and failed responses. Genuine consent interaction, LAN authorization and external-provider behavior remain pending; neither local checks nor contract tests exercise a paid live provider. |
| U01 | VoiceOver and physical keyboard through folders, menus/flyouts, dialogs, model consent, operation conflicts, Settings and terminal planes. Check accessible names, focus return, reading order, disabled states and announcements. |
| U02 | Both appearances, minimum window, narrow/resized planes, long labels/paths, empty/error/loading states, scrolling and reduced motion. Inspect all 13 Settings pages, previews and menus. Verify text/control contrast against actual rendered surfaces; no claim of conformance from overflow tests alone. |
| R01 | Repeat mandatory scenarios on macOS 13 and the current stable macOS version, using the same release candidate. The local machine runs macOS 15.1. As checked October 13, Apple's current-version table lists 27.0.1; verify again at execution time. [Apple version table](https://support.apple.com/en-us/109033). |
| D01 | Signed Store distribution build/profile and installer pass local verification and App Store Connect validation; direct DMG passes notarization/stapling/Gatekeeper. Test clean installation, first launch, upgrade/relaunch and retained window placement on a disposable user/profile. |

## Shared local agent consent

From `packages/viewer-electron/app`, run the direct-build scenario against an
explicit immutable candidate:

```sh
VIEWER_TEST_PRESERVE=1 \
VIEWER_TEST_NO_REMOVAL=1 \
VIEWER_TEST_BINARY=/absolute/path/to/Viewer.app/Contents/MacOS/Viewer \
pnpm exec tsx tests/native/agent-consent.ts --interactive
```

The supervised terminal starts each scenario only after the operator has read
its instruction. The operator must personally Cancel the first native Enable
dialog, Allow the second, then Allow only the named generated folder. The harness
never chooses an affirmative native response. Without `--interactive`, it runs
only the pending-consent denial preflight and marks the native steps unverified.

The authenticated client is the candidate's actual `--mcp` process, separate from
the GUI. Enable alone must authorize no folder. The folder grant permits metadata
for the generated file; sibling paths, symlink escapes, private Viewer data and
invalid tokens must fail. Executable and terminal commands remain unavailable,
and a proposed refresh is rejected through the rendered review UI. Folder
revocation affects the existing client; full disable closes access. After a cold
restart, editable configuration cannot restore the revoked approval. Content,
execution and terminal capabilities are never granted by this scenario.

The scenario uses a new profile, leaves the regular profile unchanged, and ends
with test access disabled. Every generated folder and socket directory is
retained. Reports record paths, hashes and outcomes without tokens. The October
25 direct candidate passed with the operator's real responses; exact hashes and
scope are in [verification](../verification.md). This does not establish Store
sandbox or third-party-client acceptance.

Automated native metadata checks already exercise modes, xattrs, resource forks, ACLs and relative links. Actual Trash receipts, cold relaunch and owned terminal-child disposal have automated signed tests. Run the whole qualification command against the final candidate to bind that evidence to its source and hashes.

No critical/major failure or unverified mandatory scenario can be marked ready. Attach explicit evidence to each ID rather than changing a general readiness flag by judgment alone.
