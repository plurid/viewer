# Verification

## October 13 parameterized MCP navigation

**391 tests across 51 files pass.** `pnpm check`, `pnpm lint`, `pnpm format:check` and `pnpm package` pass. The 25 new MCP/navigation regressions cover authentication, strict arguments, redacted live discovery, reviewed/rejected execution, literal Unicode selection, canonical scopes/symlink escape, stale or replaced sources, revoked native/agent access, disabled Agents, token rotation, unique workspace names, changed destinations, active columns, root versus linked placement, plane focus and empty-workspace continuation. Native filesystem/coordination tests require ordinary macOS execution; the restricted command sandbox produced native file-open failures, while the final suite with normal OS access passes.

`node --import tsx tests/native-agent-navigation.ts` passes against the rebuilt ordinary package. A real separate `--mcp` process connects to the hidden owned app's private socket. Rendered Reject/Open path/Select files/Focus plane/Change workspace controls drive the shared host state; requests complete only after renderer acknowledgement. The test verifies the actual two-file explorer selection, independent and linked previews, continuation from previews, name/ID switching and root creation from an empty workspace. Generated source contents are unchanged, the private token is absent from client output, both owned processes quit and the temporary profile/files are removed. Evidence: `out/agent-navigation/result.json`. The test does not activate a foreground app or alter the clipboard. Signed Store and physical third-party-client acceptance remain separate.

`node --import tsx tests/native-drag-navigation.ts` also passed the packaged nested list/column hover, retained docking, cancellation/history, nested transfer/Undo and two-axis edge scrolling checks. Trusted injected drag events include a continuing dragover pulse and actual leave delivery before cancellation; this covers Chromium/controller behavior, not physical Finder Escape/drag acceptance. The earlier Finder increment below retains its own test counts and evidence.

## October 13 Finder integration and Chrome Copy Path

The first native integration increment adds editable Get Info (Finder tags/colors, comments, Locked and POSIX permissions), owner/group/allocation details, journaled aliases with guarded cold Undo, native Quick Look/Share commands, checked package inspection and Invert Selection. The locally signed ordinary package was rebuilt. This does not change the signed Store candidate's qualification evidence.

**366 tests across 49 files pass.** All four TypeScript targets, ESLint, formatting and the production package build pass. The new native regressions verify exact tag/comment plist data, Foundation tag names and alias recognition, Unicode spelling equivalence, stale/replaced-item rejection, denied grants, preserved contents/unrelated attributes, lock/unlock and permission recovery after mode zero. The browser clipboard regression was reproduced before the fix; three cases now verify exact multi-path text, denied permission and an unavailable clipboard. Chrome command invocation followed by a real Meta-V paste returned the exact generated selected path.

The hidden packaged test, node --import tsx tests/native-file-information.ts, passes the real preload/main/native bridge, stale-edit rejection, tags/aliases, graceful relaunch and cold alias Undo. It enters Get Info with Command-I and saves a permission edit through the rendered controls. Desktop 1440×900 and narrow 760×640 captures show both the top and scrolled details without horizontal overflow. Fixtures/profile are generated and cleaned; this test leaves the system clipboard untouched.

The first layout capture exposed excessive nested form padding and hidden actions. The compact label/value layout and sticky Save/Reload were confirmed in a second batched capture. Static detection reports only the pre-existing Markdown blockquote border outside this change. Native Quick Look/Share physical interaction and signed sandbox acceptance remain unverified. Tag filtering/sidebar organization, general Trash browsing and the rest of [the parity sequence](finder-integration.md) remain feature work.

Spring-loaded drag/controller regressions cover nested traversal, cancelled selection/history restoration, one final history entry on drop, column-root retention, denied/link/non-folder hover without a picker, workspace/closed/navigation/cancellation races, bounded inspections, hover invalidation and two-axis scale-normalized edge scrolling. The native-renderer probe reproduced a browser `Illegal invocation` from using animation functions as controller methods; a new regression failed before the global-receiver wrappers and passes afterward. Persistence during hover also exposed the existing saved-state invariant requiring `history[historyIndex] === path`; temporary slots now match the folder and cancel restores the original array.

## October 13 guided native acceptance

**All eight guided permissions/Finder checks now pass on signed `2026101318`, macOS 15.1 / 24B2083**, across three sessions with matching candidate identifiers and executable/archive/Info.plist hashes. The aggregate is `out/native-acceptance/summary-2026101318.json`; individual reports retain their original scope and completion/failure status. This completes this guided batch, not all native release acceptance or final qualification.

Earlier attempts remain recorded. In run `0eea4773-2ed2-402f-9233-b669e1f9d4c6`, the operator confirmed Open/Return was used at the cancellation step. Run `3cfe83ef-7ed9-470a-8a38-93481f4461ba` returned cancellation but then failed denial. Instrumented run `6a120204-4edb-40f9-84bd-464cdc6be688` recorded an active saved grant before the scripted picker, and the operator confirmed using the separate Allow folder access action. This changes the test's preconditions and does not establish a Cancel defect.

The harness now starts in its private instructions folder, waits for the rendered workspace, brings its test page forward and records candidate/build/OS identifiers, executable/archive/Info.plist hashes, picker results and saved/session permission snapshots without bookmark contents. It rechecks denial immediately before the cancellation picker and preserves failure stacks. The subsequent clean run `84adba7a-0321-4ab0-be4b-3f025f86b0b0` started with no grants but returned a selection; the operator reports no interaction. This earlier unexpected result is retained without assigning a cause. No acceptance check is counted as passed by those failed runs. Their generated source/destination/profile folders were confirmed removed. Detailed evidence remains under ignored `out/native-acceptance/<UUID>/`.

The directly operated iTerm session `e4ec9b33-2412-4790-b82e-3cd91f67587b` subsequently passed five real signed checks: picker cancellation with continued denial, two independent grants with sibling denial, exact iCloud-root read, nested Unicode copy/Undo and cold ordinary bookmark restore. Its Cancel snapshots contain no grants and a null result. The session stopped at an empty Finder clipboard; the operator confirmed the requested copy was not performed, so this does not establish a clipboard defect. The harness now explicitly opens Finder, requires the exact generated source paths before transferring and allows bounded copy/paste retries. Its `--finder-only` mode covers those steps in a fresh profile without claiming to repeat the other checks. The candidate hashes remain those of signed build `2026101318`. Full/Finder-only preparation and ownership cleanup, 26 permission/native-selection/API regressions, final tools type checking and targeted lint pass. Finder-only preparation is recorded in `out/coordination-probes/native-acceptance-finder-prepare.log`; preparation does not execute the human interactions.

Finder follow-up `89567698-3764-4cd9-af99-787af00e91fd` passed the two genuine grants and both two-item file/folder exchange directions with exact contents. It then exposed a harness error: revocation was requested from the workspace renderer, where the production bridge correctly rejects it with `Manage credentials in Settings`. Revocation now switches to the actual Settings renderer and returns to the workspace to verify folder/preview denial. A negative workspace request must remain rejected without losing its grant. `--revoke-only` needs one actual Open picker and records only revocation; physical Settings interaction is not claimed. Its preparation, final tools type check and targeted lint pass. These changes affect the acceptance harness and documentation, not the shipping app or its permission policy.

Revocation session `dbff453b-ede6-4f33-811f-99bcaf978a39` completed successfully. Its real Open picker created an active grant; the rejected workspace revocation preserved it; the actual Settings renderer removed it; subsequent workspace browsing and preview creation were denied. The three recorded candidate content hashes remain unchanged and deep strict signature verification passes after the session. Generated source/destination/profile cleanup was independently confirmed. Physical Viewer Paste/navigation, larger/ungranted native selections, drag/modifiers, physical Settings/VoiceOver, revocation during ongoing work, full provider recovery, additional supported OS versions and final immutable qualification remain separate gates.

## October 13 file-management refinements

Development build `2026101318` adds configurable Trash confirmation in Browsing/JSONC, Enter/Escape confirmation with visible key hints, individual folder totals shared by list rows and changing selections, inline Columns previews, retained docking during sidebar navigation, viewport-sized new planes and responsive Quick Preview. A modifier-only regression reproduced the reported Command-Shift folder creation: shortcut matching incorrectly accepted `Shift` as the command key. The matcher now compares only the binding's non-modifier key. Size regressions cover mixed selections, batch measurements, empty/partial/unreadable results, overlapping descendants and invalidation/recalculation. Existing JSONC files default to confirmation; an explicit false value survives reload.

**339 unit tests across 46 files**, all four TypeScript targets, ESLint and formatting pass. The rebuilt package passes `daily-file-work` and `file-workflows`. The first scenario uses generated files and native Trash/Undo, real rendered keyboard events, live Settings, inline Markdown/OBJ/image previews, docked sidebar navigation, a generated 2048 × 1280 image, and 2560 × 1440 / 800 × 600 viewports. It checks exact contents, known folder/selection totals, preview replacement, preserved docking and bounds, with no renderer exceptions. The second verifies folder copy/paste/drop, keyboard traversal and removal of deleted branches. These use hidden isolated native windows and do not claim physical Finder, VoiceOver or real monitor configuration coverage. The new scenario is included in future immutable qualification runs.

Eight captures were directly reviewed under `.impeccable/review/`: Trash keyboard controls, measured mixed selection, root/nested Columns previews, the large new plane, large/small Quick Preview and a large decoded image. A low-contrast shortcut tint was changed to the existing muted text token. The mechanical UI detector reports only an existing blockquote accent outside this change; it is not a general design or accessibility conformance result. All 65 relative documentation links resolve.

The rebuilt signed development app passes the short MAS baseline: private configuration, unselected-folder/file denial, permission recovery UI, volume inventory, PTY/owned-child disposal, 40 preview lifecycles, 2,304 generated files under the 512-handle limit (**75 open handles**), nested watches, workspace saves, native metadata copying, Trash Undo after cold relaunch, separate authenticated/denied signed MCP clients and graceful Quit. The distribution app/installer also pass local signature checks; `Viewer-2026101318-macOS-arm64.pkg` has SHA-256 `d46d90ac028cf4f888334098e96c1dc4b5cedc62aa8c997c408b3ccbc0e1346b`. No upload or public submission occurred. This is not a new two-hour qualification. The earlier development build is retained under ignored `out/mac-app-store/retained/2026101317/`.

The later guided permissions/Finder batch is recorded above and completes eight checks across matching-candidate sessions. Earlier failed runs and the automated sandbox baseline retain their original limitations. Remaining native/provider/OS/distribution requirements stay in [readiness](mac-app-store-readiness.md).

## October 13 coordination and Store signing

Build `2026101317` adds native file coordination after the qualified `2026101316` candidate. **331 tests across 46 files**, all four TypeScript checks, ESLint and formatting pass. The rebuilt ordinary package passes the `file-workflows` and `store-file-services` scenarios. The updated signed MAS development bundle passes its real sandbox baseline: container configuration, unselected path denial, permission-recovery UI, volume inventory, embedded PTY/owned-child disposal, 40 preview lifecycles, 2,304 generated files under the 512-descriptor limit (**75 open handles**), recursive watches, workspace saves, modes/xattrs/resource forks/ACLs/links, Trash Undo after cold relaunch and independent signed MCP clients. This is not a new two-hour qualification or genuine picker/Finder proof.

The native coordination probe passes seven groups: actual reader/writer claim lifetime, independent writer progress, waiting-writer cancellation, eight concurrent parent/intermediate claims without queue starvation, existing/new Unicode aliases and case-only rename, Worker termination releasing its live claim and 100 repeated read/dispose cycles. Ten unit boundary cases cover relocation rejection, symlink preservation, cancellation/timeout/cleanup, scoped revocation, nesting and request bounds. The experiment that used batch preparation alone failed to retain a reader claim; the implemented bridge uses real synchronous accessors instead. During integration, expired-resource Promise behavior, macOS decomposed Unicode names and stale hard-link test injection were corrected; the original source-preservation/collision assertions still pass.

An owner-authorized generated **iCloud Drive** fixture was confirmed ubiquitous and uploaded, then evicted using Foundation. Before the actual coordinated content read it had download status `NotDownloaded`, logical length 180,224 and **zero allocated blocks**. The read restored status `Current` and exact SHA-256 `490f2cdbcb0dc4b5b4bdf6a7a9ef3d33317beab455d130703e6fc7dc4f69443a`. The ownership-checked generated folder was removed afterward. Evidence is in `packages/viewer-electron/app/out/coordination-probes/icloud-result.json` and `icloud-cleanup.json`. This proves a real standalone-backend placeholder read on this Mac, not complete signed picker-backed cloud/offline/conflict/reconnect acceptance.

Store application and installer certificates were created under **Propal Invest SRL / 49W9L8Z9J5**, paired with their own Keychain keys, and checked against the public signing requests. `Viewer Store Distribution` targets `com.pluridviewer.app`, authorizes the application certificate and has no development device list. Store preflight passes. Both copies of the distribution `.app` pass deep strict signature verification. `productbuild` creates `out/mac-app-store/mas/arm64/Viewer-2026101317-macOS-arm64.pkg`; normal trust-service verification shows the Propal installer, Apple Worldwide Developer Relations CA and Apple Root CA chain. Package SHA-256 is `e8cfa868be544179af6a0e91ae4bdb8aa2a455117e27035bf98554a010141d0d`. The restricted command sandbox initially reported an untrusted leaf; normal Keychain/trust access verified the full Apple chain and `security verify-cert` passed. No trust settings were bypassed or altered. Private keys were not exported and provisioning/certificate artifacts are ignored by Git.

App Store Connect is signed in under Propal and currently has no Viewer app record. No record, upload or public submission was made. Native Finder/permissions/VoiceOver, other supported macOS versions, remaining preview/provider/LAN/external-terminal cases and Apple validation/listing still block release. `tests/manual-native-acceptance.ts` provides the owner-assisted actual picker/Finder session. Its preparation/type checks pass; its initial interactive run returned a selected folder during the cancellation step and failed without claiming native acceptance. The script now pauses with clearer instructions and retains failures in `out/native-acceptance/`.

This engineering pass does not inherit build `2026101316`'s two-hour result. Run final qualification on the completed candidate after the outstanding acceptance work.

## October 13 release qualification

Store development build `2026101316` completed automated qualification from `2026-10-13T08:52:30.201Z` to `2026-10-13T10:57:35.891Z`. Source SHA-256 is `6e468d1e752bf1be6527cec6dacee00fbf26ff84bcf2c57c74e3ba4a38b6f672`; direct candidate SHA-256 is `85497f80a8c533194bf1284110ca3f026a80f2a760599532bc6abd1a3c81b9f8` and signed MAS development candidate SHA-256 is `1f2a9dcffa368a5b5e746f8cf41945965c8dabfdb95706c667613beb8ea6a853`. Final source and bundle immutability checks passed. Evidence lives in `packages/viewer-electron/app/out/qualification/2026-10-13T08-52-30-200Z/`, including `report.json`, `final-summary.json`, logs and immutable candidates. All 26 automated qualification steps passed; exit 2 records the remaining native/distribution gates and `releaseReady: false`.

The final candidate passed **321 tests across 45 files**, strict TypeScript, ESLint, formatting, both dependency advisory audits and 151 production dependency notices. All **11 packaged workflow groups**, native window placement, **five disposable-volume checks**, **ten preview-limit/input checks**, **four native low-space/relaunch checks** and **nine signed loopback model-consent checks** passed. Both bundles declare the LAN model connection purpose and require macOS 13.0 or later. The supplemental **94-case preview corpus** also passed against this frozen direct candidate.

The signed **120 real awake minute** soak completed **239 watch/read/save cycles**, including **2,390 resource read/release cycles** and **48 rendered STL open/close cycles**. Native `mach_absolute_time` and awake/wall continuity checks include the final delay; no sleep interruption occurred. Samples contain **61–62 file handles** (62 initially, then 61) and **four owned processes** throughout. Owned process RSS ranged from **379 to 578 MiB**, including renderer/GPU/helpers, and ended at **434 MiB**. Instrumented cycle latency was **97 ms median / 216 ms p95**; these values include observation overhead and are not click or frame-time benchmarks. Signed startup readiness was **627 ms** in this isolated-profile run. Metadata copying, private container access/denial, the 512-descriptor regression with 2,304 generated files, actual PTY output/exit and child disposal, cold native Trash receipt recovery, independent authenticated/denied MCP clients and graceful Quit passed. `cleanup-verification.json` confirms the frozen candidate processes exited and generated disk images were detached.

The run retains **107 hashed captures**, including **65 Settings captures**. Four current captures were directly reviewed: minimum-width Browsing in light appearance, Models in dark appearance, the minimum-size DXF viewer and bounded-image recovery. The capture manifest records their observations and limits; it does not claim all 107 were manually reviewed or establish physical keyboard, VoiceOver, contrast conformance or original-image fidelity. A focused permission/persistence/native exchange/packaging source review is recorded in `security-review.json`; it established no additional defect and is not an exhaustive security audit. All **109 local documentation links across 24 Markdown files** resolve.

Automated qualification of build `2026101316` is complete. Its remaining gates at that point included genuine PowerBox/Finder/VoiceOver acceptance, file-provider coordination engineering and distribution assets. The subsequent engineering/signing work above updates those areas without changing the historical candidate or qualifying new code through its old results. Public Store submission is still pending.

Build `2026101315` passed **321 tests across 45 files**, all 11 packaged workflows, window placement, five disposable-volume checks, ten preview-limit/input checks, four native low-space/relaunch checks and nine signed loopback model-consent checks. Its supplemental 94-case preview corpus also passed. A final packaging review found that configured HTTPS LAN model endpoints lacked `NSLocalNetworkUsageDescription` in both editions. The candidates were deliberately quit before source edits, with unchanged source/bundle hashes and 75 lifecycle cycles over 37 minutes; `INTERRUPTED.json` and `local-network-declaration-red.json` preserve this partial evidence in `packages/viewer-electron/app/out/qualification/2026-10-13T08-08-16-351Z/`. The purpose declaration is now shared by both channels and checked in actual candidate metadata. macOS LAN permission interaction remains a genuine native acceptance gate; adding a declaration does not grant that permission. [Apple local-network guidance](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy).

Build `2026101314` passed **316 tests across 44 files**, strict/static checks, both audits, dependency notices, all 11 packaged workflows, window placement, five volume checks, ten preview-limit checks, four native low-space/relaunch checks, Store packaging and nine signed local model-consent checks. Its evidence is retained in `packages/viewer-electron/app/out/qualification/2026-10-13T07-32-38-695Z/`, with source SHA-256 `18fbd5aba8bd6840578c22512ef73dd26adb66a7992538e1b6be8b3458f07a62`, direct candidate SHA-256 `ad715fc1b706a8efbfa5d503b237e311e7594bc00154160d611c9cc792355741` and signed candidate SHA-256 `a356741cccd125b4dc67899b3ec7a12a0eb3ba5afd10a022501d15d1f476cfcd`. Its supplemental 94-case preview corpus passed. The native sleep log records **Clamshell Sleep at 07:37:34 UTC**; the runner stopped at 07:54:01 UTC after one lifecycle sample. `host-sleep.json` records the interruption; it is not two-hour acceptance or proof of an application stability failure.

Additional packaged input checks against that retained candidate exposed wheel zoom failing after a delayed thumbnail and image dragging blocked by a native listener intercepting React's delegated pointer handling. Wheel zoom and dragging now pass for both bounded and ordinary images, with a fit reset after each check. Five clock regressions, including an actual advancing macOS timer, also pass. The soak now uses `mach_absolute_time`, which excludes system sleep, and records awake and wall elapsed time. A sleep/clock discontinuity aborts qualification even during its final delay; idle sleep prevention does not override lid closure.

The image byte-limit and bounded-thumbnail captures were visually inspected. Failed copy/move preserves the generated source and leaves no partial output; cold relaunch retains the original known-failure status and error count. These regressions are now required steps before the signed soak, and their final-candidate results are recorded in its report.

Store development build `2026101313`, with evidence in `packages/viewer-electron/app/out/qualification/2026-10-13T06-35-02-722Z/` and source SHA-256 `520f02a911ce0d50ae0ca8f95a0d15e613f6e12184e3efa7b562b28bf68dd3ad`, passed **313 tests across 44 files**, strict/static checks, both advisory audits, dependency notices, all 11 packaged workflows, native window placement, five disposable-volume checks and nine signed local model-consent checks. It was deliberately stopped after a supplemental limit check exposed a blank oversized-image preview. Its unchanged candidates, partial soak, failed regressions and `INTERRUPTED.json` are retained; this run does not establish 120-minute acceptance.

The correction adds explicit byte-limit and missing-thumbnail states, a loading state, and a bounded-thumbnail positive control. The permanent ten-case packaged limit check also exercises oversized DXF/CAD/mesh inputs, bounded text, a disabled oversized ZIP member, expanded 3MF limits and normal-image recovery. Two blank-image cases fail against the retained old candidate. A native low-space cold-relaunch check also exposed known failures gaining an extra “interrupted” error. Three receipt regressions fail before the journal correction: known failure history, partial-success Undo after restart, and reporting a final receipt-save failure. The corrected journal separates terminal recovery paths from in-flight mutation intents and reports a failed final commit. **40 targeted tests across operations, resources and thumbnails**, strict types, lint and the rebuilt packaged checks passed at that stage. Build `2026101316` subsequently completed the final signed qualification recorded above.

Store development build `2026101312` was deliberately stopped after a supplemental packaged regression exposed cross-root preview invalidation. Its evidence is retained in `packages/viewer-electron/app/out/qualification/2026-10-13T05-34-21-827Z/`, including source SHA-256 `0674d51b2db23ca9eaec6f7cf2b39e9d764a2fdee32ecc5c1c2e83dda6679c3e` and `INTERRUPTED.json`. It passed strict TypeScript, ESLint, formatting, both advisory checks, generated notices, **308 tests across 43 files**, all required packaged checks, native window placement and signed startup/terminal/Trash checks. Its partial soak is not two-hour acceptance. The correction below required a new full qualification, subsequently completed by build `2026101316`.

Two independent packaged reproductions showed that revoking Images expired an existing Documents preview ID while a fresh Documents preview still worked. Root-scoped cleanup now preserves independent text/media resources and thumbnail caches, purges affected archive/companion bytes, and accounts for canonical aliases including macOS `/var` versus `/private/var`. The original packaged reproduction passes after rebuilding. A committed packaged Settings regression also verifies that unrelated decoded UI stays visible and affected decoded text disappears after access is denied. Its access-error capture was visually inspected. Three resource and two thumbnail regressions exercise the disposal and pending-read races.

The sequential signed loopback test passed nine model-consent checks against build `2026101313`: zero file-data traffic before private approval, names-only payload, denied/approved excerpts, actual in-flight connection abort and future denial, endpoint-change invalidation, 429/invalid responses, and Settings-only key removal invalidating consent. It uses generated local responses and text, never a paid provider or ordinary files, and verifies private file permissions and unchanged input contents. It now runs before the signed soak as a permanent qualification check; genuine consent-dialog and dedicated live-provider acceptance remain separate requirements.

The final direct candidate also passes the permanent disposable HFS+ image test: native inventory/capacity and writable state, an externally held descriptor preventing eject, preservation of an independent preview after that failure, watcher/preview cleanup on successful eject, read-only reconnect without resurrecting stale resource IDs, and final eject. The busy error is now a typed `EBUSY` with a clear recovery message. Each detach verifies the generated image/device, uses no force option, and cleans up only the generated fixture. Signed picker-granted mounts, physical/network volumes and provider behavior remain separate acceptance requirements. The final candidate's dark/light keyboard-feedback captures and STEP surface-measurement capture were also directly inspected; settings spacing, the focused navigation state, toolbar controls and the measured model remain legible.

A separate supplemental native low-space probe constrains only an owned HFS+ image to 2 MiB free, then attempts a 16 MiB copy and cross-volume move. Both report `ENOSPC` after 2 MiB, preserve the generated source hash, publish no partial destination and remove their private staging directories. The queue then completes a generated folder creation and quits cleanly. `low-space.json`/`.log` record these three passing checks against the same frozen direct candidate. Signed picker transfers, system/profile-space failures, interruptions and provider failures remain separate acceptance requirements. No ordinary volume or user file was filled or changed.

Earlier October 13 runs were deliberately interrupted while the audit found invisible keyboard focus and native selections restoring revoked access. Each affected run retains `INTERRUPTED.txt` and its partial evidence; none establishes the two-hour soak. The current source adds ring-free keyboard feedback through raised surfaces/accent text, preserving the owner's no-focus-ring design. Packaged Settings keyboard captures were visually inspected in both appearances. A separate Chromium accessibility-tree probe inspected all 13 Settings categories in both themes: 26 page/theme combinations and 570 controls including repeated navigation, without unnamed controls in those default states. This is structural evidence, not a VoiceOver/conformance verdict.

Build `2026101309` passed **306 tests across 42 files** and static checks, then exposed an intermittent STEP surface-measurement failure. A minimized packaged reproduction withheld the first animation frame: both native pointer sequences reached the ready canvas, but stale camera matrices caused both surface picks to miss. Two regressions fail with the old raycast logic and pass when picking refreshes camera/model world matrices. The rebuilt packaged reproduction and original refinements scenario pass. The failed run retains its log and interruption note. Qualification now skips the signed soak when an earlier required check has failed.

Build `2026101310` passed the STEP workflow and static checks but stopped at the resize performance assertion. Tracing showed that the global React counter included host/virtualizer work during scrollbar layout. The corrected probe tracks the production file-table component, excludes reused bailout fibers, separates pointer moves into rendered frames and still requires zero measured drag commits. It must also observe the real width commit on release, which validates the probe itself. Three fresh packaged sessions passed before restarting qualification; the failed run remains recorded and did not start a signed soak.

Build `2026101311` passed all packaged checks and the signed startup/terminal/Trash checks, then stopped during its nineteenth soak cycle with a debugger timeout. macOS records Idle Sleep at 07:48:21 +0300 and user wake at 08:29:34; the last successful sample was written at 04:47:53 UTC. The report preserves this incomplete run. The qualification runner now holds a temporary `caffeinate -i` assertion owned by its process, allows display sleep and releases the assertion on exit. This changes no system power preferences and does not establish application sleep/wake acceptance.

This pass also fixes denied native clipboard discovery blocking unrelated navigation. Quiet background discovery clears stale copied items, while Paste still propagates permission errors. Revoked clipboard/drag capabilities cannot be restored from an unchanged native selection; pending native imports and delayed canonical reads cannot approve a scope released during revocation. The focused permission regressions passed 24 cases across three test files. The signed integration check calls revocation from the real Settings window and exercises native pasteboard-generation metadata without reading/changing the owner's clipboard; genuine native picker/Finder revocation still requires separate acceptance. Native startup, embedded terminal child cleanup and Trash restoration after graceful Quit/cold relaunch passed in earlier signed checks. All 13 Settings categories were checked in both appearances at normal and narrow/minimum test sizes, followed by a batched visual review.

Build `2026101313`'s frozen direct candidate also passed a supplemental 94-case preview corpus: all registered image extensions, generated H.264/VP8 video and common audio samples with actual playback, every text-extension route, valid STEP/STP/IGES/IGS and mesh/printing samples, PDF/EPUB, ZIP/TAR aliases and nine malformed-input error states. Input hashes, encodings and converter-fixture provenance are recorded in `preview-corpus.json`; the valid IGES capture was visually inspected. Its black material matches the converter’s exported RGB `(0, 0, 0)`. The Settings structural accessibility probe was also rerun against that candidate: 26 page/theme combinations, 570 named controls and four simulated native Tab observations. OGV/Theora, additional codec variants, large/adverse/provider-backed assets and genuine native accessibility are still explicit gaps.

See the [qualification ledger](release-qualification.md), [current Store readiness](mac-app-store-readiness.md) and [native acceptance scenarios](release/native-acceptance.md) for remaining gates. Genuine PowerBox/Finder/VoiceOver behavior, file-provider coordination, external terminal handoff, live models, complete preview corpus, adverse native I/O, other supported macOS versions and distribution artifacts are not established by these automated checks. Store submission remains blocked until the mandatory evidence is complete.

## Earlier verification history

The sections below retain the October 12 implementation history. Counts and limitations describe their individual passes; the current qualification and readiness records above supersede them. In particular, the current signed test exercises macOS Trash using generated fixtures, and native clipboard/drag implementation now exists; full Finder acceptance and Trash browsing remain separate work.

Verified on October 12, 2026, on Apple Silicon, macOS 15.1, Node 26.8.2 and pnpm 11.3.0. Native tests launch the packaged Electron binary with generated fixtures and a separate application profile. They do not use the user's normal Viewer profile, existing files or native Trash. Content hashes, directory paths and symlink targets protect the fixture inventories across layout changes and recovery.

## Automated checks

Strict TypeScript, ESLint, formatting and the production package build passed. The unit/service suite passed 250 tests across 35 files. Coverage includes filesystem operations and safe Undo; IPC and scoped resources; state/settings migration and concurrent updates; root-scoped preview matching; selection/session retention and path remapping; command targeting and ranking; index scopes, pagination, content grants and revocation; document extraction; action evidence, conflicts, cycles and durable recovery; structured provider adapters; and authenticated MCP transport. Lifecycle regressions cover repeated Close/Quit, saving before native destruction, retaining services after window Close, macOS reopening, refusing new windows during Quit, and bounded read-only worker disposal. Settings and root tests cover legacy defaults, absolute custom-folder validation, persistence and independent first-plane/populated-workspace locations. The latest cases cover shared folder presentation with independent sessions, strict JSONC/schema/watch/recovery/conflicts, safe literal custom-process arguments and cancellation, terminal-launch adapters, captured agent requests and executor-specific grants. Comment-generation tests preserve parsed values, user comments, compact formatting, CRLF and trailing commas, including adding guidance to an already documented configuration. CAD tests use the actual packaged conversion library and reject invalid mesh data. Three delayed-save tests use the actual configuration service to verify that rapid nested action/profile/tmux edits survive, removed items stay removed, and failed saves recover before subsequent edits.

Store-foundation tests cover private mode-0600 picker-grant persistence, paired acquisition/release, corrupt/stale recovery, separate source/destination permissions, selected-file limits, canonical symlink containment, transfer denial before writing and permission checks during Undo. Reader tests verify that ungranted index roots report offline without modifying user preferences and that denied reads/sizes/updates/queries never start a worker. A real SQLite restart test hides cached rows until a permitted scope is configured while retaining previously authorized cached text. Store configuration cases reject wrong channel/team/platform/bundle/group, expired or mismatched profiles, ad-hoc/Developer ID inputs and invalid build numbers; main/helper entitlement generation is tested. API boundary tests preserve cloned error codes alongside successful values, synchronous helpers and callback cleanup. Shared watcher recovery retains other subscribers and ignores retired errors.

The 16 targeted native-window/lifecycle cases passed. Before the fix, the new Close/reopen regression returned the hardcoded 1440 × 940 frame, and the immediate-Quit case produced no window-placement file. After the fix, those cases retain the last geometry. Placement coverage also includes changed/missing displays, negative monitor coordinates, smaller available screens, normal geometry for maximize/fullscreen, ignored minimized/transient bounds, atomic final saves, retry after failed persistence, and missing/corrupt/oversized state recovery.

`pnpm audit --prod --json` completed with zero known advisories across 162 production/optional dependencies. The local report is saved in `.impeccable/review/dependency-audit.json`. This registry check excludes the development-declared Electron runtime and is not an audit of Chromium/native/WASM internals or unknown vulnerabilities.

Settings initialization and listing credential IDs are tested to avoid secure-storage calls. Provider encryption/decryption occurs on an explicit key save/use. Local agent authentication uses a private token file rather than Electron safe storage.

DXF tests cover actual geometry bounds rather than stale header extents, modern/legacy text encoding, rotated partial ellipses, wrapping arcs, signed polyline bulges, exact circular length/area, block transforms/layer inheritance, recursive blocks, unsupported entities and invalid/binary files. Measurement tests cover degenerate angles, large-coordinate polygon area and squared unit conversions. Registry coverage verifies that a DXF extension wins over an ambiguous text/image MIME type.

The menu/provider pass verifies that grouping retains each applicable command in its normal placement and adds Recent shortcuts with distinct row IDs. Search ranks each command once. Pinned actions and scoped view/column pickers remain direct, and search reaches nested commands. Provider tests cover z.ai, DeepSeek, Qwen, Gemini and OpenRouter transport/output contracts with mock responses; all eight provider identities persist through validated JSONC. Tests also cover missing keys, model discovery beyond 200 entries, supported OpenRouter parameters, permitted regional endpoints, rejection of unrelated credential destinations, and refused/truncated output.

## Packaged application

The watcher/Volumes follow-up passes 250 tests across 35 files, all strict TypeScript projects, ESLint, Prettier and a rebuilt signed MAS development package. The generated-tree Node reproduction exhausts a 512-handle limit with Chokidar and fails a state write with `EMFILE`; native directory watching passes the same write. Against the real signed MAS runtime, the expanded `pnpm test:mas` reaches 511 handles before the fix, then passes with 62 handles after it. The test indexes 2,304 generated files (1,024 in one flat folder), verifies workspace saves and nested add/rename/delete reconciliation, retains external-file denial and quits cleanly. Only the owned test process receives the lower handle limit. Unit regressions also cover immediate failure cleanup, stale watcher ownership, bounded event bursts, atomic file replacement and incremental symlink containment.

Browser interaction in `VIEWER_TEST_SCENARIO=folder-access pnpm test:browser` confirms that the generated Volumes destination retains Studio after a cancelled simulated picker and opens the actual selected Models fixture after acceptance, without alerts or renderer errors. Navigation tests cover already authorized destinations, linked/root placement, picker errors, denied files and origins closed/navigated/switched while awaiting authorization. Real native picker grants and physical volumes remain separate MAS acceptance checks.

Store signing follow-up: `pnpm --filter viewer-electron test` passed 233 tests across 32 files; the tools type check and affected ESLint checks passed. The initial signed launch caught an OS rejection: the profile registered the Hardware UUID rather than the Apple Silicon Provisioning UDID. The corrected preflight rejects that old profile, and a synthetic regression verifies the actual `provisioning_UDID` field takes precedence. With the owner's approval for the additional annual Mac slot, Apple Developer now shows the correct device registered, the incorrect entry inactive and Viewer Development regenerated with one matching certificate and only the correct device. The owner's replacement download passes `pnpm mas:preflight`; `pnpm mas:dev` rebuilds successfully with deep strict signatures verified before and after copying the bundle. The embedded profile is byte-identical to the validated replacement. The Electron/login/Swift helper entitlement inventory contains only sandbox and inheritance rights; the main entitlement identifiers match the selected team, app and group.

`pnpm test:mas` now passes against that real signed MAS bundle: startup and the initial folder permission request, actual user-home paths, container-private `config.jsonc` with mode `0600`, ungranted folder/file listing and resource denial with `FILE_ACCESS_REQUIRED`, closing the initial plane, creating a new plane from the empty workspace, permission-recovery controls and graceful Quit. The generated external fixture stays unchanged; no renderer exception is observed. The test runs hidden with disposable fixtures/profile, cleans up its own data and leaves the ordinary Viewer profile untouched. The corrected harness uses the real renderer API and the actual initial workspace/configuration contract. Its tools type check, ESLint and Prettier checks pass. Native picker grants, cold bookmark restoration and terminal/MCP acceptance are not claimed by this baseline.

The final ordinary Apple Silicon build passed `pnpm make`, deep strict signature checks and refreshed ZIP/DMG verification. The 148.8 MiB DMG was mounted read-only without opening Finder: app/ASAR/native hashes, JIT-only app/helper entitlements, the Applications link and the mounted application helper passed. SHA-256 checksums are refreshed under `out/make/`. This remains an ad-hoc local installer, without Store signing or notarization.

The hidden `store-file-services` scenario passed against the real packaged app with Node threads: recursive sizes, SQLite scopes, PDF/EPUB extraction, OCR over stdin, proposal review/apply/Undo, modeless Settings and a separate authenticated MCP client. A chmod-denied PDF verified that `EACCES` survives both the worker and context-bridge boundaries. Before the transport fix, the native negative test returned the permission message without its code; after the fix, the renderer receives a proper Error and code. A denied folder shows **Folder access required** and **Allow folder access…**. After synthetic permission recovery, its listing reloads and a subsequently created file appears through the restarted watcher. Both denied/recovered captures were inspected. Actual PowerBox bookmarks and Apple sandbox behavior were not exercised on this ordinary runtime.

The hidden `foundations` scenario passed again on the final ordinary build: per-folder views, Finder keys, column resizing, real PTYs/Ctrl-C, culling, independent roots and JSONC live reload. Native window placement also passed five cold-restart/Close/Quit checks after the API change, retaining ordinary and full-work-area frames without activating a window. Store preflight was exercised without signing inputs and failed closed with a specific development-identity requirement. This ordinary-build pass predates the initial signed MAS artifact described above; no Store submission package was produced.

The native harness exercises these paths through actual rendered controls:

- The native window-state harness passed five hidden, inactive packaged process launches with graceful Quit. A 1512 × 982 full-work-area frame persisted through consecutive cold restarts, as did an ordinary 1000 × 700 frame at (40, 40). Each restart compares renderer dimensions and the main process's actual native frame captured on Quit, using a disposable profile. Offscreen Chromium reports screen coordinates as zero, so those renderer coordinates are not used as native placement evidence. Physical Rectangle gestures and macOS fullscreen Space transitions were not automated; native-mode handling has unit coverage.

- The rebuilt bundle passed deep strict signature checks and explicit entitlement checks for the app, Electron helpers and Swift tools: JIT permission only, without the signer's unused device/location/Photos defaults. The hidden `foundations` scenario passed again on that build, including real PTYs, Ctrl-C, culling, Finder navigation, per-folder preferences and live JSONC. The updated 148.7 MiB DMG passed compression/CRC verification and a read-only hidden mount: strict signatures, app/ASAR/native hashes, minimal entitlements, the Applications link and the mounted application helper all passed. ZIP integrity and refreshed SHA-256 checksums passed. See [mac-app-store-readiness.md](mac-app-store-readiness.md) for the Store audit and its remaining blockers.

- The October 12 installation build passed `pnpm make`, producing an Apple Silicon app and ZIP. A compressed DMG includes the same app, an Applications shortcut and installation notes. `hdiutil verify` passed, and a read-only mount passed deep strict bundle signature verification; app/ASAR/native-binary hashes match the build, the Applications link points to `/Applications`, and the mounted application-discovery helper executes successfully. ZIP integrity and SHA-256 artifact checksums also passed. Both Swift helpers and both PTY binaries declare macOS 13.0, matching the app. The hidden `foundations` scenario passed on the rebuilt app; its external-edit check now parses generated JSONC comments correctly. Tooling TypeScript, affected ESLint and formatting passed. The bundle uses local ad-hoc signing; Apple notarization and runtime testing on macOS 13 were not performed.

- The hidden `model-lighting` scenario checks a read-only copy of the user's five-part STEP hopper through front, reverse, underside and oblique views, plus framing at 780 × 560, in both appearances. The original renderer made 81.2% of the sampled reverse-view geometry nearly black in dark appearance (76.5% in light appearance). Correct linear CAD color assignment and neutral camera-relative lighting reduced that fraction to 0 in all ten sampled views. Dimensions stay identical, model orbit leaves the Plurid camera unchanged, GLB/STL fixtures still load, no renderer exceptions occur, the process stays inactive and the fixture inventory/content hashes remain unchanged. This is evidence for the supplied colored model, not a guarantee that deliberately dark materials render brightly. An actual STEP-to-material test also reproduces and fixes the extra color decoding: the source Orange material retains `#ff9900` instead of becoming `#ff5100`.

- The hidden `drawings-workspaces` scenario checks DXF worker loading, snapped 200 mm distance, 90° angle, 20,000 mm² polygon area, inch conversion, layer visibility, invalid drawing feedback and a measurement command in a linked plane header. Every chosen vertex remains hit-testable while measuring. Opening Drawing details and resizing to 780 × 560 preserve fit and correct coordinates. A focused canvas handles Shift-arrow without rotating the Plurid camera. A read-only copy of the user's panel renders its three lines and two ellipses with millimetre units and 464.023 × 689.246 mm bounds. Command-K switches by workspace name or Change workspace, filters the dedicated picker and restores the previous workspace. The process remains inactive and fixture inventory/content hashes remain unchanged.

- The complete packaged suite passed using hidden, GPU-backed offscreen Viewer and Settings windows. Read-only macOS activation probes confirmed that the QA process remained inactive at startup, after closing Settings and before quit. Reloads do not activate it. Tests use the real production renderer, sandboxed bridge and utility process; foreground timing is a separate opt-in workload.
- The hidden `foundations` scenario verifies remembered per-folder views, Finder Command-Down/Up and column traversal, persisted keyboard column resizing, and real packaged PTYs. A terminal handles Ctrl-C and over 1 MB of output while detached, then restores its screen; independent roots own separate PTYs and child planes open at 90.1° relative to their parent. Live JSONC replacement updates the renderer. Enabling Agents starts MCP in the running app; reviewed custom-process commands report real task completion and output, reviewed terminal commands retain their captured root, and configuration proposals cannot authorize themselves.
- Shift-arrow range extension, reversal/shrinking and cursor-driven scrolling in all four views without camera rotation; blank file-space deselection and background menus without stale file targets. A 320-file fixture unmounts the selected virtual row before opening: the row is revealed, and the new preview opens at 90.1° relative to its parent with source-level vertical placement.
- An unknown selected folder reports an uncalculated size rather than 0 B. Calculate Size produces a measured 2.5 KB result through the packaged utility process, and Get Info reuses it. Actual macOS compatible-app discovery drives an autofocus searchable Open With dialog; empty search disables Open, retains its dimensions and closes without launching an app.
- Toolbar Rotate, command-palette Finish/Translate and Escape use one mode state. The regression reproduced a synchronous preference publication that reverted a mode update; coalescing preference synchronization after the engine transaction makes both the isolated spatial check and full suite pass.
- Separate previews for the same image under two roots, reuse within each root, and exact topology/identity restoration after reload. Space preview retains the selected file after header framing and Plurid culling. Existing deliberately oblique camera views and explicit copies remain distinct. Recovery and consolidation of legacy duplicate layouts are reversible.
- Independent root creation through the workspace plus, Command-N, commands and sidebar actions. Per-plane navigation, history and width; shared Favorites/order/folding; camera-projected sidebar resizing; narrow docked navigation; title dragging; minimap facing and context; default-on toolbar/minimap/viewcube; and persisted spatial settings. Plane backs remain visible.
- New folder plane from an empty workspace requires no picker. Browsing Settings has separate starting-folder preferences for the first plane and for an already populated workspace. The empty-state button, workspace plus and Command-N use the first-plane preference while empty; subsequent roots use the other preference. Custom paths remain visible in Settings.
- Folder headers and filename/metadata values have zero measured offsets at 960, 640 and 420px, both with and without vertical scrolling. Configured fields remain available through the shared horizontal viewport at narrow widths. Actions recipe expansion/collapse keeps identical horizontal summary coordinates despite changing overflow. Quick Preview has one footer, no duplicate external-open icon and a native default-app label (Open in Code on this machine); its controls remain visible without overflow at 780×560.
- The hidden `chrome` scenario toggles the view menu closed on its second button press, hides/restores all nine toolbar controls independently, changes optional metadata columns, and verifies column resizing with no React commits during pointer movement. Width persistence, double-click reset and long-name wrapping pass. A regression reproduced a cached 69px row after disabling wrapping; resetting virtual measurements restores the normal 36px row. The rename picker filters recipes by applicability, keeps its captured EPUB target despite a changed live selection, and enters a local book-name proposal for review without changing any fixture file.
- The hidden `file-workflows` scenario reproduces the previous Up/Down failure against the old bundle, then verifies folder revelation, Left/Right traversal, Command-C/Command-V into the shown column, and dropping a generated folder onto another folder. A second regression reproduces keyboard ownership returning to the root column after Plurid detachment; preserving the active scope makes the same hide/restore/Down sequence stay in its child column. Moving that fixture out of the parent listing prunes its old column and selection without an unavailable-folder error. Native Trash is not exercised.
- A right-click Calculate Size command completes while the owned index utility process is suspended. The original regression stayed at Size not calculated until that process resumed. Renderer tests verify immediate pending progress, failed-start feedback, early completion before the acknowledgement, shared starts and cancellation before a native task ID is available.
- Command-K, contextual two-letter action search, promoted recent actions, captured targets, filename/subfolder finding and suppressed focus outlines. List, grid, columns and gallery share the browsing context.
- The hidden `menus-models` scenario verifies View and Columns flyouts, their direction and bounds at 780×560, keyboard entry/return/dismissal, global search into hidden columns, command execution with captured targets, and recent-action deduplication. It reproduces Plurid's delayed docking focus and verifies that the open menu retains its search input. It adds all five new provider profiles through Settings, confirms their endpoints and persistence with content off and no credentials, and checks actionable missing-key feedback. Fixture hashes remain unchanged; the test process never activates.
- The hidden `refinements` scenario verifies that Recent and normal Copy path entries coexist, while search returns one result. File, folder and background path commands write the actual macOS text clipboard and clear an older cut operation. Folder and STL Open in another plane actions create three independent engine roots with no child links. A bundled STEP fixture renders 300 mm bounds; two surface picks produce a visible distance. A 3MF declared in inches normalizes to 25.4 mm, PLY uses explicit unknown units, and malformed STEP shows an error. A read-only copy of the user's panel renders 700 × 1191.206 × 1.5 mm bounds. GLB, glTF, OBJ, STL and FBX retain their visible statistics. All eleven Settings categories fit at 900 × 640 and 760 × 540, with separated paragraph/actions, readable authorized-folder choices and toolbar SVGs that visibly change state. First-plane and populated-workspace custom paths stay independent. Fixture hashes remain unchanged and the process remains inactive.
- Palette searches with many and zero results have identical top, left, width and input positions. Returning to more results grows downward. At 780×560, command and file palettes retain the same top edge and bottom clearance; the longer file list scrolls independently of its search and context controls.
- A separate modeless Settings window with searchable categories. Index folders, document-content grants, recipes, model profiles, agent access and shortcut editing are exposed there. Changes propagate to the main window; closing Settings drains queued edits before destroying the window.
- PDF text extraction and generated scanned-PDF OCR; a local EPUB book-name proposal with evidence; filename-first review, native text selection and full-path editing; explicit Apply and byte-identical Undo; granted EPUB content indexing and revocation while paused; saved search root planes; Quick Preview and Get Info from virtual results.
- The packaged stdio MCP client initializes, lists tools, reads an explicitly granted fixture, and rejects an outside path. It creates no provider-credential file and needs no Keychain access. Unit tests cover invalid tokens, scoped search, proposal ownership and revocation.
- GLB, glTF, OBJ/MTL, STL and FBX previews, malformed models and missing assets; independent model orbit; images, SVG, Markdown, EPUB, PDF, JSON, code, CSV, archives, audio and video. PDF selection/search, image zoom, media decoding, archive navigation and cleanup use representative synthetic inputs.
- Unsupported/malformed media shows an explicit error with Default App, Open With and Retry. Retry returns to a recoverable error state; valid WAV/WebM playback pauses and releases its source when closed.
- Copy and rename, collision review with cancelled replacement and safe Skip, Undo, IPC validation, blocked renderer network access, resource escape rejection and byte ranges. Workspace deletion changes application layout only, retains all fixture files/jobs, and supports recovery. Native application quit saves pending state.

A separate shutdown scenario freezes only the isolated app's own read-only utility worker before native Quit, with both Viewer and Settings open. Before the fix it reproduced the reported `No handler registered for 'viewer:request'` error while the window remained open. After the fix, windows close with their bridge intact and the stalled worker cannot hold the process open; the regression exits successfully within eight seconds. This establishes the shutdown failure mechanism under a controlled stall, rather than proving why a worker stalled in the user's earlier session. File mutations are never force-stopped by this shutdown path.

The fixture HTTP bridge also verifies indexed EPUB lookup, read-only proposals and explicit document-content grants/revocation. Its sorted before/after metadata inventory remains identical.

The installed Plurid engine emits transient unregistered-route warnings while dynamic planes enter its tree. Tests check the settled and restored identities and record renderer exceptions separately.

Rendered evidence includes the desktop, contextual actions, search, action review, Settings categories, EPUB, dark/light appearance, the 780×560 minimum window and a 420px docked navigation stress case. The interface inherits the existing Plurid application design. An independent finishing review identified three changes: editable filenames before directory context, current modeless Settings documentation, and singular Apply copy. The affected native view was recaptured, documentation was synchronized, and the reviewer confirmed all three resolved with no visible regressions. Its ship disposition applies to those scored fixes. The detector pass remained degraded because its HTML parser dependencies were unavailable; computed contrast and live providers remain unverified.

That independent review belongs to the preceding pass. This reliability pass adds captures for file-level anchoring, measured folder information, native application choices and media recovery, inspected directly after the hidden packaged run. The subsequent shutdown and placement fixes add inspected captures for the empty workspace, new-plane folder Settings, expanded/empty palettes with the same top edge, and a scrolling file palette at the minimum window size.

The October 12 pass adds directly inspected captures of the Plane toolbar settings, wrapped filenames, the compact rename-action footer and a cleaned-up column branch. These are implementation checks against the established interface, without claiming a new independent review.

The subsequent foundations pass adds six valid, directly inspected native captures for Terminals, Configuration, Agents, custom actions, captured command approval and a running terminal plane. A fresh finishing reviewer accepted the established style and identified one settings persistence defect. The correction preserves rapid queued edits, including nested fields; all three delayed-save tests passed. The reviewer's final `ship` verdict scores that single material fix as resolved, rather than certifying the entire application or performance.

The menu/provider pass adds directly inspected captures for grouped actions, nested column flyouts, the minimum viewport, the provider picker and z.ai/Qwen/Gemini profiles. These are implementation checks against the established style, without a new independent review or a new physical frame-rate benchmark. Live provider calls still require separate credentialed verification.

The DXF/workspace pass adds directly inspected captures at 1440 × 940 and 780 × 560, including live light appearance, measurements, the supplied panel, a linked plane and the workspace picker. A fresh finishing review found a cached-palette theme-order defect and a measurement label hidden by the floating readout. Dirty-frame palette sampling and readout-aware annotation placement fixed them; native checks compare actual canvas pixels in both theme directions and observe actual text positions outside the readout. The reviewer's final `ship` verdict scores both material fixes resolved. A single static interface detector run on the new preview and modified palette reported no findings; this is not a whole-app accessibility or performance certification.

The toolbar/footer correction adds directly inspected linked-plane and minimum-window Area-draft captures. The hidden drawing scenario verifies equal control heights and vertical alignment (28px in plane headers, 30px in Quick Preview), a 34px status bar inside the dialog, units beside instructions, and filename/type/size aligned as one group. Enabled Finish area and Cancel controls remain visible with converted units at 780 × 560. The hidden alignment scenario also passed its existing list, Quick Preview and Settings checks. Targeted preview, drawing and projected-coordinate tests passed all 17 cases; renderer/tools TypeScript, affected ESLint, formatting and the package build also passed.

The settings/model pass adds directly inspected native captures of compact and expanded Settings, inactive toolbar icons, additive Recents, separated list-header backgrounds, STEP surface measurement, 3MF and the user's STEP panel. The layout assessment informed one shared spacing/field treatment; these are implementation checks against the established interface, without a new independent finishing score. Settings fit was checked across every category at both tested sizes. G-code toolpaths and exact CAD feature snapping remain outside this pass.

The lighting correction adds one directly inspected batch of before/after native captures showing the supplied hopper from the front and underside in both appearances and at the minimum window size. Reverse faces retain their color, the reference tube keeps visible curvature and the existing preview controls remain legible. The existing hidden `refinements` scenario also passed after the change, including real CAD surface measurements and the other model loaders. These are implementation checks against the established interface, without a new independent finishing score or performance benchmark.

## Performance evidence

[performance.md](performance.md) distinguishes historical before/after fixes from fresh measurements. Native probes count React commits and engine emissions, observe frame intervals and long tasks, and test menus with pointer jitter. SQLite benchmarks use disposable databases at 100,000 and 1,000,000 entries. These are single-machine samples, not a claim that all interaction, parsing or GPU costs are solved.

## Unverified or incomplete

Live paid-provider requests and metadata accuracy on a representative real book library have not been tested; provider contract tests use mock responses. Local model discovery does not prove that a server supports structured outputs. Agents currently share one local authentication/grant set; per-client grants remain future work. Commands and configuration changes require review by default, with optional separately stored execution grants for an exact custom executor or terminal capability. An approved process runs with the user's OS permissions; its working directory is not containment. Cloud providers require explicit configuration and content permission.

Real removable-drive disconnection, network filesystem failures, mixed filesystem/server behavior, large decoded model textures, long-session GPU memory and cold-start traces need additional evidence. Windows/Linux packaging, distribution signing, notarization and public distribution remain unverified; the signed MAS development baseline is described above. Open With discovery/search/cancel and the launch adapter's literal arguments were tested; the native application picker and an actual selected/default external-player launch were not automated because they can show system UI or activate another application. Codec coverage is representative rather than comprehensive. Finder clipboard interoperability, tags, Trash browsing and additional preview families remain in the [roadmap](roadmap.md). Automated Trash tests use an owned disposable adapter.

External iTerm/Terminal/tmux launch behavior has adapter-level coverage; this pass did not activate those applications or change their preferences. Embedded terminals use real packaged native PTYs in the hidden regression. Offscreen checks do not establish physical compositor smoothness or long-session GPU stability.

DXF support is bounded 2D model space, not a full CAD renderer. Large production drawings, legacy CAD fonts, paper-space layouts, SPLINE/HATCH, binary DXF/DWG and 3D solids need separate implementation or verification. Ellipse lengths are visibly approximate; manually picked areas measure polygons. Measurement annotations are session-only. See [drawings.md](drawings.md) and [preview-roadmap.md](preview-roadmap.md).

## Reproduce

```sh
pnpm check
pnpm lint
pnpm format:check
pnpm test
pnpm package
pnpm test:desktop
```

Run `pnpm test:browser` for an interactive fixture server; stopping it removes only its generated workspace. `pnpm test:desktop` defaults to hidden windows without native activation. It supplies an isolated profile plus `VIEWER_RENDER_TEST=1` and `VIEWER_BACKGROUND_TEST=1`, which keep offscreen RAF rendering active. Normal launches retain visible windows, background throttling and the same isolation boundaries.

After `pnpm make`, run `node --import tsx tests/window-state-native.ts` from `packages/viewer-electron/app` for hidden cold-restart placement checks. It creates and removes only its own fixtures/profile, writes `.impeccable/review/desktop-native-window-state.log`, and never activates or changes the installed Viewer.

`VIEWER_TEST_SCENARIO=alignment pnpm test:desktop` checks column geometry, the named single Quick Preview footer and Settings scrollbar stability. `VIEWER_TEST_SCENARIO=size pnpm test:desktop` runs Calculate Size with the isolated index worker stalled. `VIEWER_TEST_SCENARIO=spatial pnpm test:desktop` runs the short mode regression in the background. `VIEWER_TEST_SCENARIO=entry pnpm test:desktop` checks direct plane creation, starting folders, palette placement/scrolling and linked-preview anchoring. `VIEWER_TEST_SCENARIO=shutdown pnpm test:desktop` runs the owned-worker stall regression. `VIEWER_TEST_FOREGROUND=1 pnpm test:desktop` explicitly enables visible windows, PID activation and physical frame observations; request a foreground profiling session before using it. Ordinary offscreen runs do not overwrite the foreground performance artifact.

`VIEWER_TEST_SCENARIO=chrome pnpm test:desktop` checks the view-menu toggle, toolbar preferences, column visibility/resizing/wrapping and the rename-action handoff. `VIEWER_TEST_SCENARIO=file-workflows pnpm test:desktop` checks column traversal/restoration, folder copy/paste, folder drop targets and removed-branch cleanup. Both run in hidden windows with generated fixtures.

`VIEWER_TEST_SCENARIO=foundations pnpm test:desktop` checks shared folder presentation, Finder navigation, browser-column resize, real PTY output/interruption/backpressure and culling, independent roots, live JSONC changes and reviewed MCP command completion.

`VIEWER_TEST_SCENARIO=store-file-services pnpm test:desktop` checks main-process reader threads, recursive sizes, SQLite scope, PDF/EPUB/OCR, reviewed actions/Undo, worker/preload permission codes, access-error controls and resumed watching after permission recovery. It launches the ordinary runtime with isolated test flags; it cannot replace the signed MAS development acceptance run. Follow [mac-app-store-build.md](mac-app-store-build.md) for real signing inputs and remaining release gates.

After `pnpm mas:dev`, run `pnpm test:mas` for the signed development baseline. It verifies the real bundle and container boundaries using a hidden window and disposable data. Native picker/bookmark and subprocess/agent acceptance remain separate checks.

`VIEWER_TEST_SCENARIO=menus-models pnpm test:desktop` checks grouped menu flyouts, keyboard/search/target behavior, minimum-window positioning, delayed docking focus and all five new provider profiles in hidden windows. No provider key or paid request is used.

`VIEWER_TEST_SCENARIO=drawings-workspaces pnpm test:desktop` checks drawing measurements, units, layers, keyboard ownership, resize/appearance and workspace switching in hidden windows. Optional `VIEWER_TEST_DXF_FILE=/absolute/path/to/drawing.dxf` reads a local file into the disposable fixture; it never edits that source. Development captures include drawing/measurement, compact/light appearance, linked-plane and workspace-picker states.

`VIEWER_TEST_SCENARIO=refinements pnpm test:desktop` checks additive Recents, the native text path clipboard, independent root opening, CAD/printing previews and measurements, Settings layouts at normal and minimum sizes, toolbar icon states and independent first-plane preferences. Optional `VIEWER_TEST_STEP_FILE=/absolute/path/to/model.step` copies a local file into the disposable fixture without editing its source. Clipboard checks retain and restore every original pasteboard item/type when the user has not copied something else during the check.

`VIEWER_TEST_SCENARIO=model-lighting pnpm test:desktop` checks rendered CAD geometry through several orbit angles, both appearances and minimum-window framing. It preserves dimensions and isolates orbit gestures from the Plurid camera, then checks existing GLB/STL loading. Optional `VIEWER_TEST_STEP_FILE=/absolute/path/to/colored-model.step` copies a local file into the disposable fixture without editing its source; the near-black-face assertion is intended for models whose original materials are visibly colored. Bitmap analysis crops a full viewport capture rather than changing the offscreen WebGL surface for a cropped capture.

Development captures and review output live in the ignored `.impeccable/review/` directory. Durable interface guidance lives in [DESIGN.md](../DESIGN.md). Feature documentation is in [actions.md](actions.md), [search.md](search.md), [configuration.md](configuration.md), [terminals.md](terminals.md), [model-previews.md](model-previews.md) and [architecture.md](architecture.md).

## Office reader and preview checks

The Office delivery passed 459 tests across 64 files, TypeScript and lint. The direct
macOS package builds successfully. New Office checks cover package relationships,
body paragraphs/tables, sparse worksheet addresses, saved/uncached formulas,
original content-index citations and revocation purge, malformed/unreadable
containers, XML/content limits and cancellation. Named-agent worksheet windows
preserve sheet/row/column anchors and content capabilities.

A generated FIFO reproduced a native wait before the archive descriptor reader
could reject the source. Content coordination now rejects existing special files
before calling the native accessor, including links to pipes; a binding regression
proves no native request starts, and the real archive test completes without a
writer. Archive opens also
use nonblocking/nofollow descriptors and validate regular files. Compressed TAR
uses the same bounded descriptor instead of reopening its pathname. This does not
prove every provider failure or noncooperating external-writer race is resolved.

After `pnpm package`, `pnpm exec tsx tests/native-office.ts` passes four owned direct
checks: rendered DOCX metadata/body/table and passage citations, XLSX evidence
and filtering/formula details, durable sheet/cold citation state, and visible
coverage/empty/error recovery. The script leaves completed evidence and nine
captures in `out/office-acceptance`. Captures wait for full ancestor opacity and
stable camera transforms; earlier transition captures were replaced.

On this same package, `tests/native-workflows.ts` passes five checks, including
CSV row 61/column 2, image regions, shared DXF facts and actual workflow review/
apply/resume/receipt restoration. `tests/native-agent-clients.ts` passes five
checks for the actual MCP/worker, named XLSX windows with original anchors and
saved/uncached formulas, content scopes, actor ownership and credential
revocation. Owned apps quit gracefully and generated profiles are removed.

The Office finish reviewer disposition is `ship` for its single scored correction:
the previously clipped Preview details is visible as an inline body disclosure.
The compact Word capture now frames the whole docked plane. Loading captures,
physical assistive-technology interaction, real native folder pickers, cloud edge
cases, supported macOS versions and immutable Store distribution qualification
remain outside these checks. See [Office previews](office-previews.md) for reader
coverage and limits.

## PDF fit and context-menu icon checks

The October 14 correction passes 465 tests across 65 files, `pnpm check`,
`pnpm lint` and `pnpm package`. The six PDF viewport regressions cover tall,
landscape and compact hosts, explicit width fitting, fixed percentages and
unrecognized saved values. PDF percentages now use PDF.js's CSS unit conversion;
the old width-relative `pdf.zoom` values do not override the new Fit page default.

`pnpm exec tsx tests/native-pdf.ts` first reproduced the old package rendering
a 3,109px-tall page in 1,061px of available height. The rebuilt package passes five
checks: distinct Workspace/Project menu glyphs, whole-page Quick Preview on large
and compact windows including the search row, landscape/rotated/large-format
page fitting, explicit Fit width and fixed percentage sizing, and linked-plane
zoom retention through graceful Quit and a fresh process. All fixtures and
profiles are generated; owned app processes quit and profiles are removed.

Completed evidence and seven settled dark/light captures are in
`out/pdf-acceptance`. A fresh finish reviewer returned `ship` with no material
fixes for this PDF fitting and menu-icon refinement. These direct-package checks
do not replace native picker, assistive-technology, supported macOS or Store
distribution qualification.

## Agent removal safeguards

`pnpm exec vitest run tests/agent-safety.test.ts` passes 13 in-memory security
regressions. The tests exercise the actual command/proposal broker and operation
service with simulated file metadata, coordination and dispatch. They verify
mandatory per-request review with the manual confirmation preference disabled,
legacy-grant and custom-alias handling, rejection and replay protection, changed
sources/executors, revoked scope, canonical escapes/private data, protected roots and Trash contents,
blocked shell/external-app/terminal routes and the advertised Trash-only policy. Operation
checks reject a source changed inside coordination and verify that a Trash error
never calls permanent deletion. Additional checks cover actual failed job outcomes,
early completion and cancellation before queued removal. No actual files or folders are removed; mocked
filesystem deletion calls fail the tests.

`pnpm check` and `pnpm lint` pass, including the new verification/build tools.
The filesystem integration suites were not rerun because their old fixture cleanup
permanently removes generated folders. The user approved only the old `.vite` and
`out/Viewer-darwin-arm64` folders for native Trash; both remain recoverable there.

`node --import tsx tools/build-preserving.ts <seed.app> <fresh-output.app>` builds
the current JS using the installed Vite configuration with cleanup disabled,
copies an existing direct bundle to a fresh output and repacks its archive. It
updates both the plist archive hash and Electron's framework integrity digest,
then verifies the local ad-hoc signature. The seed and all intermediate/generated
folders remain intact. Native libraries, SDK and version are inherited; this is
a local development rebuild, not Store/distribution packaging. Earlier failed
rebuilds are preserved. The verified bundle is
`out/Viewer-safety-v5-darwin-arm64/Viewer.app`.

With `VIEWER_TEST_BINARY` pointing at that bundle,
`node --import tsx tests/native-agent-safety.ts` passes four owned native checks:
actual authenticated MCP discovery/denial despite imported capabilities, fresh
exact-path review despite hidden manual confirmation and a valid legacy alias
grant, compact large-selection scrolling, and the rendered unavailable/inactive permission controls. Reject leaves
the generated file and nested folder contents intact; a second request requires
new approval. Nine selected items with long exact paths scroll within the compact
review body while the header and approval footer remain visible. The owned app
quits gracefully. All fixtures and its isolated profile are preserved, with ten
settled dark/light desktop/compact captures and
[completed evidence](../packages/viewer-electron/app/out/agent-safety-acceptance-PF57QS/result.json).

The scored UI evidence remains
[`qChZqY`](../packages/viewer-electron/app/out/agent-safety-acceptance-qChZqY/result.json).
The finish reviewer marked its one clipping correction resolved and returned
`ship` at that scope. The final rebuild additionally corrects generated JSONC
guidance about execution/write grants; its renderer entry hash and referenced
asset names match the reviewed build. The final native repeat also verifies that
the saved configuration states the fresh-approval rule.

No real removal was approved by the agent during native verification. Positive
native Trash execution, physical approval, assistive technology and Store
qualification remain unverified by this pass. The in-memory operation checks
prove failure/cancellation handling at the service boundary rather than a real
filesystem removal.

## Model shading, linked navigation and Trash

The October 14 extension passes `pnpm check`, `pnpm lint` and 60 selected
regressions across eight files: Trash service/agent boundaries, model appearance,
linked navigation, picking, CAD, workspaces and agent workspace/safety. These
checks do not remove real files. Older integration suites with permanent fixture
cleanup were not rerun.

`tests/native-trash-guard.ts` compiles the actual macOS inventory/confinement
guards with `unlinkat` replaced by a recording no-op. All 13 checks pass, covering
changed identities/inventories, forged roots, symlink leaves, wrong ownership and
a generated directory moved outside Trash. Generated file contents and the
outside sentinel remain intact. This proves refusal and confinement logic without
performing permanent removal.

The preserving build tool now accepts an optional freshly compiled macOS N-API
binding after the seed and fresh output arguments. The final local direct app is
`out/Viewer-model-navigation-trash-v3-darwin-arm64/Viewer.app`, using
`out/viewer-macos-files-trash-v2.node`. Compilation and local ad-hoc signature
verification pass. The seed, intermediates, generated profiles and fixtures are
preserved. This is not a Store or notarized distribution artifact.

With `VIEWER_TEST_BINARY` pointing at that app, `tests/native-model-navigation.ts`
passes four owned native groups. STEP/STL surface and lighting changes retain the
live canvas, dimensions and source bytes; linked appearance and camera survive
cold restart. Configurable Back to parent preserves docking. File/folder link
markers render in list, grid, columns and gallery; marker activation and View
open plane focus the existing plane without increasing its count. Completed
[model/navigation evidence](../packages/viewer-electron/app/out/model-navigation-acceptance-MigAQR/result.json)
includes fourteen settled desktop/compact captures.

`tests/native-trash-readonly.ts` passes actual sidebar Trash display, absence of a
public erasure method and navigation into `/Applications`. macOS privacy denied
the user's Trash in this isolated app: zero visible items, one unavailable
location and emptying disabled. This is denial evidence, not an empty system
Trash. No native action menu, confirmation, erasure or grant picker was invoked.
Completed [read-only evidence](../packages/viewer-electron/app/out/trash-readonly-acceptance-qEwPUo/result.json)
includes three settled native captures. Four browser captures exercise populated
read-only generated inventories in dark/light desktop and compact windows with
native actions disabled.

The finish reviewer returned `ship` with no material UI fixes after inspecting
the source boundary and all 21 current captures. Positive post-grant system
Trash browsing, physical emptying/confirmation, Windows/Linux runtime behavior,
assistive technology and signed Store access remain unverified. No user data was
removed. See [Trash and Applications](trash.md) for the native-only action design
and platform limits.

## Project exit and macOS Trash permission recovery

The original model/navigation/Trash direct bundle reproduces the reported project
bug in an owned hidden instance: dismissing a missing-definition warning hides it
until an unrelated real folder-watch notification. The default
`tests/native-project-exit.ts` assertion fails against that original app. Missing
definition fixtures are absent from the start; reproduction performs no deletion.

The corrected `out/Viewer-project-recovery-v2-darwin-arm64/Viewer.app` passes four
native groups in `tests/native-project-exit.ts`: stable dismissal across the real
folder notification, the visible Close project command with persisted detachment
and the folder/root/active plane retained, cold restart without reattaching the
missing project, and actual macOS privacy denial presented as Full Disk Access
recovery with emptying disabled. The normal-flow notice also passes a geometry
assertion that it does not cover the plane toolbar. Completed
[native recovery evidence](../packages/viewer-electron/app/out/project-exit-acceptance-W3gqwv/result.json)
includes seven desktop/compact dark/light captures. The earlier first-build
captures and all generated profiles and files are preserved.

68 tests across seven selected files pass: project session, missing/empty
definition reads, Trash safety, workspaces, agent workspace/safety and commands.
The state tests preserve preview notes and engine storage and close only the
active association; no project-file or operation service is called. Simulated
privacy denial opens only the fixed settings URL, invokes no folder picker,
grants no permission and never calls the native erasure menu or confirmation.
Unverified Trash roots expose no grant action. Missing definitions now carry a
stable error code through desktop IPC; an empty existing file is invalid rather
than missing.

`pnpm check`, `pnpm lint` and the preserving production build/local ad-hoc signature
verification pass. The build retains its seed, native binding and intermediates.
Existing Vite config-loader, CJS import-meta and large-chunk warnings remain;
this correction does not qualify a Store or notarized package. No physical
Privacy Settings navigation, Full Disk Access grant, positive system Trash
browsing or emptying was performed. FDA and independent App Sandbox
authorization remain separate release checks. See
[Apple's macOS security guidance](https://developer.apple.com/videos/play/wwdc2019/701/?time=1995).

The fresh finish reviewer returned `ship` for current source/render behavior and
the independently reproduced old-build failures, with no material fixes. All seven
current and four old-build captures were reviewed. Direct comparison with the
three original user screenshots is unavailable: their Desktop files disappeared
after the initial inspection. Old-build reproductions are not presented as
original user pixels. The missing historical comparison and native permission /
platform limits do not receive a passing verification claim.

## Folder-style Trash browser (October 14)

The Trash browser now supports directory breadcrumbs, filtered/virtualized file
rows, ordinary range and multi-selection, keyboard navigation, Quick Look,
read-only Get Info, Copy Path, Restore, and Restore to…. These contextual actions
stay inside the dialog and are not published as agent commands. Empty Trash… is
centered between the item count and right-aligned Refresh/Done controls. It opens
native confirmation directly; synthetic renderer clicks are ignored. No bridge,
MCP method, approval response, shortcut, or editable grant can directly erase
Trash. macOS keeps its affirmative continuation entirely in native code, with
Cancel as the default and unchanged inventory/confinement checks before erasure.

Restore accepts opaque, versioned inventory IDs. It checks private Trash roots,
ancestors, item identity/version, destination identity, existing names, and disk
identity before moving. It never replaces or merges a destination, recreates
missing parents, or falls back to copy-and-delete. Known original destinations
come from exact Viewer Trash receipts or platform metadata. A macOS item deleted
outside Viewer may have no known original location; Restore to… asks for a folder
instead. Cross-disk restoration is deliberately refused. Linux orphan metadata is
retained rather than permanently removed by Viewer.

`pnpm check` and `pnpm lint` pass. The selected Trash, selection, commands,
agent-safety and API-boundary regressions pass 65 tests across five files. The
native erasure guard harness passes 13 checks with `unlinkat` replaced by a
recording no-op; it performs no erasure. With
`VIEWER_TEST_MAC_BINDING=out/viewer-macos-files-trash-folder-v1.node`, the generated
`trash-restore-native.test.ts` fixture also passes using the real macOS exclusive
rename: nested Unicode content restores intact, a symbolic link stays a link,
and a colliding destination and its source are both preserved. This check never
uses the owner's system Trash; all fixtures remain available.

The preserving production build creates
`out/Viewer-trash-folder-v2-darwin-arm64/Viewer.app` and passes local ad-hoc signature
verification. `tests/native-trash-browser.ts` passes against that build. Its
[native renderer evidence](../packages/viewer-electron/app/out/trash-browser-acceptance-2vUfyl/result.json)
contains eight desktop/compact dark/light captures and covers the centered
footer, selection, contextual preview/info, folder navigation, restore collision
and success states, and disabled empty state. The renderer fixture intercepts
Trash calls before opening the view; Empty/Restore are stubs and only a generated
text file uses the real preview service. It asserts that synthetic Empty button
activation is ignored and that trusted activation reaches only the presenter
stub. No real native confirmation or affirmative erasure was invoked.

Positive system Trash restoration, Full Disk Access/App Sandbox grants, actual
erasure, physical assistive technology, Windows/Linux execution and Mac App Store
qualification are not established by this pass. Existing Vite config-loader,
CJS import-meta and large-chunk warnings remain. Earlier failed fixture setup
attempts and every intermediate/profile/generated file are retained.
