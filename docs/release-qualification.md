# Viewer release qualification

The release target is Apple Silicon, macOS 13 or later, with the same core capabilities in direct-download and Mac App Store editions. Existing spatial, preview, model, terminal and agent features remain requirements. Native Finder exchange, operation recovery, volume lifecycle and archive jobs complete the everyday baseline. Wider roadmap capabilities and Intel are deferred.

## Evidence rules

Each check records the artifact hash, runtime/channel, OS, fixtures, result and limitation. A mock, ordinary Electron runtime or source review does not establish native App Sandbox behavior. Missing signing assets, test machines or service credentials remain explicit gates. No public submission or publishing occurs during qualification.

## Work and acceptance ledger

### October 24 Clear backdrop after ⌘H

The latest accepted candidate disables the native alpha-derived window shadow
for Clear backdrops. The operator confirmed that ⌘H → Dock restore → move plane
no longer leaves the former plane rectangle. A native shadow-policy regression,
26 focused tests, static checks, packaging/signature verification and the
packaged spatial scenario pass. Candidate hashes, source-bound native evidence
and the operator's physical result are recorded in [verification](verification.md).

### October 24 Viewcube corner and conceal follow-up

The latest follow-up preserves the engine's Viewcube corner, native conceal and
hover transitions. It protects actual toolbar controls instead of the full-width
click-through band. Twenty-six focused tests, all four TypeScript targets, scoped
lint/format checks, packaging and signature verification pass. Packaged native
resize/drag/conceal/hover checks and isolated Chat Send hit tests pass on the exact
candidate recorded in [verification](verification.md). Clear-floor renderer
captures are uniform; no background/compositor correction is claimed. One earlier
concurrent Chat check exposed an offscreen framing timing concern; isolated checks
pass and the concern remains recorded separately.

### October 24 latest user-report and Git candidate

The latest candidate includes fixed folder Git actions, Chat styling/diagnostics,
sidebar ordering, list-column alignment, protected Viewcube placement, immediate
initial command context and native fullscreen transition tracking. Normal
packaging and signature verification pass; 216 focused regressions and all static
targets pass. The focused packaged Git/Chat/palette scenario also passes, including
both window sizes and actual Send hit testing. [Verification](verification.md)
binds the current hashes and retained evidence. The earlier full-suite/smoke/timing
results below do not apply automatically to these new bytes.

Live Gemini Chat now passes actual no-file generation and bounded generated-folder
inspection after reducing the provider generation grammar; the original local
validation remains enforced. The operator confirmed fullscreen hotkey restoration.
Real native agent Allow followed by Settings revocation is verified, including the
disabled broker endpoint. The Cancel case, positive scoped authenticated read,
shell uninstall and remaining native acceptance are still explicit gates.
Candidate-specific hashes and retained evidence are in [verification](verification.md).
Automatic approval review blocked native Uninstall before dispatch because the
generated script's exact removal path had not been approved. The script is
preserved while that permission is pending.
Journal, worktree/session development and the action-builder/palette extensions
are proposals, with no implementation or acceptance claim.

### October 24 earlier direct-build candidate

The earlier stabilization candidate passed 1,452 tests (four skipped), all four
TypeScript targets, lint, formatting, normal frozen installation, packaging and
the complete packaged desktop smoke. Fresh source/store reproduction and exact
registry-byte verification pass with Plurid data `0.0.0-28` and React `0.0.0-42`.
The stale pnpm metadata warning is resolved without a verification override.

The candidate also passes real rendered HTML and sandbox checks, linked local
server/log/lifecycle acceptance, 780×560 notice/footer hit testing and native owned
window recovery. Matching foreground timing samples show no observed menu/camera
regression. [Verification](verification.md) records the candidate hashes, logs and
retained screenshots; [performance](performance.md) records the paired samples.

Physical hotkey/Dock interaction, live-provider Chat, genuine agent consent and
native shell uninstall remain pending in the coordinated operator session. The
actual generated shell script has passed concurrent named-workspace launch and
independent `--new-window`. Earlier positive terminal confirmation remains separate
evidence. No real owner PATH was modified. New automation retains all fixtures and
cannot perform unapproved Trash operations.

These direct-build results do not qualify a new Store/sandbox candidate, replace
the mandatory signed soak, establish other operating systems, or constitute
notarization/publication readiness.

### Historical signed and native evidence

The following ledger records the earlier candidates identified in each row.
Their passing checks do not transfer automatically to the October 24 binary.

| Area                         | Required evidence                                                                                              | Status                                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plurid dependency provenance | Exact published graph, fresh checkout/store, registry byte comparison, packaged plane input/tiling regressions | October 18 used data `0.0.0-27` and React `0.0.0-41`; its fresh source/store passed byte verification for ten packages, 690 tests and source/browser gates. The October 24 direct candidate and updated pins are recorded above; final distribution qualification remains pending.                                              |
| Resource lifetime            | 512-descriptor signed regression; repeated watcher/preview/worker/terminal disposal; two-hour soak             | Final build 2026101316 passed the signed 512-descriptor regression and 120 awake minutes: 239 watch/read/save cycles, 48 rendered STL cycles, 61–62 handles and four owned processes throughout; final immutable candidates and cleanup verified                                                                                |
| Native Finder exchange       | Multiple files/folders in both directions; native drag; copy/move intent; denied access                        | Native URL exchange, drag and bounded session grants implemented; signed 2026101318 passes basic two-item native file/folder exchange in both directions with actual Finder Copy/Paste; physical Viewer Paste, larger/ungranted selections and drag/modifiers remain pending                                                    |
| Transfers and recovery       | Metadata fidelity; durable receipts; source changes; collisions; safe Undo/restart; low disk space             | Journal/guarded Undo/private staging implemented; signed metadata/Trash/cold-relaunch checks and four direct native low-space/relaunch checks passed; terminal failures preserve their history and partial-success Undo; signed/physical/provider adverse I/O pending                                                           |
| File coordination            | Real content claims, source/destination mutations, cancellation and cleanup; provider materialization          | Bounded native accessor bridge implemented; ten boundary cases and seven native groups pass; actual iCloud zero-block placeholder hydrates with exact content; complete signed/provider failure/recovery acceptance pending                                                                                                     |
| Volumes and archives         | Capacity/availability/eject/reconnect; ZIP creation; bounded safe ZIP/TAR extraction                           | Five permanent direct native disk-image checks cover inventory, busy failure, cleanup and read-only reconnect; signed inventory and archive regressions passed; genuine signed mount grants/physical/provider lifecycle pending                                                                                                 |
| File permissions             | Grant/cancel/cold restore/stale/revoke; two independently granted roots; index/cache revocation                | Private saved/session permissions, diagnostics, repair/revoke and purge implemented; actual signed 2026101318 Cancel/denial, two native grants/sibling denial, cold ordinary bookmark restore and Settings-origin revocation/denial pass; stale repair, physical Settings interaction and revocation during work remain pending |
| Model consent                | No data request before approval; endpoint/data changes; revocation during requests; private storage            | Private consent implemented; contract regressions and nine signed local-endpoint checks passed, including actual connection abort; genuine consent interaction/live dedicated-provider acceptance pending                                                                                                                       |
| Terminals and agents         | Actual MAS PTY and external handoff; private tmux sessions; independent authenticated client                   | Signed PTY/output/exit/owned-child disposal and separate signed authenticated/denied MCP clients passed; external handoff/tmux pending                                                                                                                                                                                          |
| Previews                     | Corpus for every registered module; malformed/oversized inputs; measurements; cancellation; GPU lifecycle      | Final candidate passed the 94-case representative corpus, ten packaged limit/recovery checks and rendered STL disposal during the completed two-hour signed soak; remaining codec/adverse/provider corpus pending                                                                                                               |
| Interface                    | All surfaces, both themes, minimum window and narrow plane; keyboard/VoiceOver/contrast/reduced motion         | Established UI preserved; 13-category/two-theme normal/minimum-size checks and batched visual review passed; real accessibility acceptance pending                                                                                                                                                                              |
| Distribution                 | Binary dependency/license/privacy inventory; distribution signing; installation; listing                       | 151 production dependency notices plus Electron/Chromium/CAD generated; both advisory audits passed; build 2026101317 Store app/profile/installer signing and Apple package chain verified; Propal App Store Connect access confirmed; Apple validation/install/listing, direct notarization and publication pending            |
| Supported OS                 | Native acceptance on macOS 13 and current stable macOS                                                         | Other test environments needed                                                                                                                                                                                                                                                                                                  |

## Release gate

No unresolved critical/major defect or unverified mandatory native scenario may be marked ready. Every regression from the user reports must pass. Record live-provider versus mocked-provider coverage separately. Keep all test files, application profiles and tmux sessions disposable and independent of normal user data. Routine tests stay hidden; the owner has authorized a coordinated visible native acceptance session.

## Reproduce qualification

From `packages/viewer-electron/app`, run `pnpm qualify --mas` with `VIEWER_MAS_IDENTITY`, `VIEWER_MAS_PROFILE` and a unique `VIEWER_MAS_BUILD`. Keys remain in Keychain; the profile stays outside source control. See [Store builds](mac-app-store-build.md) for the identity/profile preflight.

The default signed soak is **120 real awake minutes**, measured with the native macOS `mach_absolute_time` clock. Its runner holds a temporary idle-sleep assertion for the run, allows display sleep and releases it on exit; system power preferences are unchanged. Keep the Mac's lid open: clamshell sleep overrides that assertion. Awake/wall time discontinuities abort the check, including during its final delay; an interrupted or sleeping-host run cannot establish acceptance. `--soak-minutes=1` checks the harness without claiming two-hour acceptance. `--no-build` can inspect an existing candidate but explicitly leaves its source-to-artifact provenance unverified. A public candidate must be rebuilt and qualified; any source/bundle change invalidates that run.

Required packaged checks, native window placement, disposable-volume checks, preview-limit checks and native low-space/relaunch checks run before Store packaging. The packaged checks are the `test:desktop` scenarios `published-plane-input`, `file-workflows`, `daily-file-work`, `chrome`, `menus-models`, `refinements`, `drawings-workspaces`, `foundations`, `store-file-services`, `shutdown`, `alignment`, `size` and `entry` (`tools/qualification.ts`). Qualification does not run the `model-lighting` and `spatial` scenarios, the default smoke suite, or the native agent, project, workflow, Office, PDF and Trash gates: run those separately before a release that changes them. Signed loopback model-consent checks run sequentially before the signed soak. A known failed check blocks that long phase; fix the recorded failure and qualify a fresh candidate. Partial or deliberately interrupted runs retain their evidence but cannot satisfy final acceptance. The volume and low-space harnesses own generated images and verify their devices before any detach; they never force-eject or fill an ordinary volume. The model harness sends only generated fixture data to its loopback server.

Each ignored `out/qualification/<UTC timestamp>/report.json` records environment, source hash, immutable copied `.app` candidates, bundle hashes, native Mach-O signatures/hashes, checks, durations, logs and explicit gates. `mas-lifecycle.json` records descriptor/process/memory/latency samples, including owned renderer/GPU/helper memory, during actual resource/watch/save and rendered STL open/close cycles. Failure returns exit 1; completed automated checks with remaining gates return exit 2. `releaseReady` remains false until mandatory independent/native/distribution evidence is reviewed; do not turn exit 2 into a false test failure or false ready status.

Build `2026101316` completed all automated steps on October 13, 2026. Its final immutable source/candidate hashes, 321 tests across 45 files, 11 packaged workflow groups, 94-case supplemental preview corpus, resource statistics and cleanup are recorded in [verification](verification.md) and `out/qualification/2026-10-13T08-52-30-200Z/final-summary.json`. The preserved incomplete runs remain historical evidence. Native/provider/distribution acceptance is still pending.

Subsequent `2026101317` implements native file coordination and has a locally verified Store distribution package. Its 331 regression tests, targeted packaged workflows, seven native coordination groups, real standalone iCloud placeholder read and updated signed baseline pass. The interactive picker/Finder session is available as `pnpm exec tsx tests/manual-native-acceptance.ts`; it needs the operator’s actual clicks/clipboard actions. This changed candidate still needs final qualification; the previous two-hour run does not cover it.

Current build `2026101318` adds the file-management refinements, with 339 tests, targeted packaged workflows and a signed sandbox baseline. Its eight guided permission/read/copy/Undo/cold-restore/Finder/revocation checks pass across three matching-candidate sessions; individual failures retain their historical status. The updated harness records candidate hashes and permission observations, starts in a private instructions folder, opens Finder explicitly and supports bounded clipboard retries plus `--finder-only`. The aggregate `out/native-acceptance/summary-2026101318.json` binds all eight guided checks to matching candidate/OS evidence. Physical navigation/drag/VoiceOver, provider recovery, other supported OS versions and final immutable qualification remain pending.

`pnpm direct:release` requires `VIEWER_DIRECT_IDENTITY` and `VIEWER_NOTARY_PROFILE` (a notarytool Keychain profile). It produces a local Developer ID signed/notarized/stapled DMG, checks Gatekeeper, and records its hash and accepted notarization receipt. It fails before release packaging when credentials are absent. It does not publish a download or upload a Store listing.

Build prerequisites are the pinned package lock/runtime, Xcode command-line tools and matching Electron headers used by native helpers. This machine's header cache is available; clean-machine build reproducibility remains part of supported-environment validation. Store distribution packaging additionally needs the application and installer identities/profile; development signing cannot substitute.

## Reviewable release records

Use [native acceptance](release/native-acceptance.md), [current readiness](mac-app-store-readiness.md), [privacy policy draft](release/privacy-policy.md), [support draft](release/support.md) and [Store metadata/review notes](release/app-store-metadata.md). Draft policy/support records are prepared for owner review and stable HTTPS publication; they are not published URLs. Distribution upload, policy publication and Store submission require approval after concrete artifacts and listing are ready.
