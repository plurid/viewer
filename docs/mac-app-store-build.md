# Mac App Store builds

The owner selected **Propal Invest SRL — 49W9L8Z9J5**. Public build identity lives in `packages/viewer-electron/app/mac-app-store.json`:

| Setting | Value |
| --- | --- |
| Team | `49W9L8Z9J5` |
| Registered Store bundle ID | `com.pluridviewer.app` |
| macOS application group | `49W9L8Z9J5.com.pluridviewer.app` |

Apple rejected `com.plurid.viewer` as unavailable under the selected Propal team, and that identifier is absent from Propal's App ID list. The owner selected `com.pluridviewer.app`, now confirmed in Propal's registered App ID list as **Viewer**. The Store configuration and macOS application group match that selection. App Store Connect ownership still needs confirmation. The direct-download build retains `com.plurid.viewer` and its existing data location.

Viewer uses the macOS `TEAM_ID.group` convention: the application group above is authorized by the signing team's identity and needs neither portal registration nor a profile group entry. This differs from `group.`-prefixed, provisioned app groups. [Apple macOS app-group guidance](https://developer.apple.com/documentation/xcode/accessing-app-group-containers).

Private keys stay in Keychain; profiles and passwords do not belong in the repository. EAS's completed CT Dentar iOS build confirms that its remote release works, but its app-specific iOS profile cannot authorize this macOS bundle. [Expo credential storage](https://docs.expo.dev/app-signing/syncing-credentials/).

## Supply the signing assets

For a locally runnable Store development build:

1. Make the Propal team's **Apple Development** identity available, including its private key, using Xcode → Settings → Accounts → Manage Certificates or a Keychain-generated CSR in Apple Developer. The owner has completed this step on the current Mac.
2. Use the already registered explicit App ID **Viewer — `com.pluridviewer.app`**. The initial **Viewer development Mac** entry used the Hardware UUID; macOS rejected it for this Apple Silicon machine. With the owner's approval, the correct **Provisioning UDID** is now registered as **Viewer development Mac (Provisioning UDID)** and the incorrect entry is inactive. This uses two annual Mac slots because Apple cannot edit a registered UUID or reclaim a disabled device's slot. Identifiers are not stored in this repository. The team-prefixed application group needs no separate portal App Group.
3. **Viewer Development** has been regenerated with the matching development certificate and only the corrected device entry; it expires October 12, 2027. The owner downloaded the replacement outside the repository. Its local preflight and the rebuilt signed application's native baseline test now pass. [Apple development-profile instructions](https://developer.apple.com/help/account/provisioning-profiles/create-a-development-provisioning-profile).

The October 12 local inventory contains **Apple Development: Ioan Pavel (YQ79LQ8A7M)** with its private key. Its certificate's `OU` is `49W9L8Z9J5`, SHA-1 fingerprint is `73F2194C8987542A13C52931452B28A739EB4D01`, and expiry is October 12, 2027. The parenthetical certificate-name suffix is not its Team ID. Propal's Developer ID Application identity is also present; Developer ID signs direct distribution and cannot substitute for the Store development identity. The replacement Viewer profile passes local platform, expiry, certificate, app, team and Provisioning UDID checks. The signed bundle's embedded profile is byte-identical to that replacement and authorizes exactly one matching certificate and one device.

For submission packaging, additionally make **Apple Distribution / Mac App Distribution** and **Mac Installer Distribution** identities available for the same team and obtain a **Mac App Store Connect** profile for the same explicit Viewer App ID. The distribution profile does not register a test device. A distribution-signed MAS application is tested through Apple's distribution, not by launching that bundle locally. [Apple Store-profile instructions](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile), [Electron signing guide](https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide).

## Development build

Run from the repository root. Replace the example certificate name and absolute profile path with the actual local assets. A certificate SHA-1 identity is also accepted; no private key/password is passed on the command line.

```sh
export VIEWER_MAS_IDENTITY='Apple Development: Your Name (certificate suffix)'
export VIEWER_MAS_PROFILE='/absolute/path/Viewer-Development.provisionprofile'
export VIEWER_MAS_BUILD='1'
pnpm mas:preflight
pnpm mas:dev
```

The preflight verifies profile platform, expiry, team, explicit bundle identifier, certificate membership, signing-certificate role/Team ID and this Mac's device registration. Configuration validation binds the macOS application group prefix to the signing team; no profile group entry is required for this naming convention. It emits only a public summary, generates/lints main/helper entitlements and refuses missing or mismatched inputs. Profiles are decoded in memory; device IDs, full profiles, passwords and private keys are not logged.

`mas:dev` builds the native helpers, packages the MAS Electron runtime, embeds the development profile and verifies signatures before and after copying the bundle. Relative framework symlinks are preserved. Default architecture is the host architecture; `VIEWER_MAS_ARCH=arm64` or `x64` selects a target explicitly, including native Swift helper compilation.

Output: `packages/viewer-electron/app/out/mac-app-store/mas-dev/<architecture>/Viewer.app`. The current Apple Silicon development artifact uses the corrected profile, passes deep strict signature verification and launches successfully on this Mac. The native baseline test below passes; full picker/bookmark, helper, terminal and agent acceptance remains required before submission.

## Submission package

After the development sandbox and release gates pass, use distribution assets and an unused Store build number:

```sh
export VIEWER_MAC_CHANNEL='mas'
export VIEWER_MAS_IDENTITY='Apple Distribution: Propal Invest SRL (49W9L8Z9J5)'
export VIEWER_MAS_INSTALLER_IDENTITY='Mac Installer Distribution: Propal Invest SRL (49W9L8Z9J5)'
export VIEWER_MAS_PROFILE='/absolute/path/Viewer-AppStore.provisionprofile'
export VIEWER_MAS_BUILD='2'
pnpm mas:preflight
pnpm mas:package
```

The package command also validates the installer certificate's role/team, runs `productbuild`, checks the package signature and writes its SHA-256 checksum. Output is under `out/mac-app-store/mas/<architecture>/`. These commands do not upload, create a listing or submit for review.

Use the direct channel when returning to ordinary packaging:

```sh
VIEWER_MAC_CHANNEL=direct pnpm make
```

## File permissions and reader strategy

MAS mode is selected by Electron's `process.mas`, not by a preference or renderer request. Native folder, application and import/export pickers request security-scoped bookmarks. `FileAccess` stores them atomically with mode `0600` in `file-access-v1.json` under the app's private user-data directory. They are not part of `config.jsonc`, exported settings, agent proposals or renderer API arguments.

Grants are acquired lazily and reused for the desktop session. Canonical checks reject sibling-prefix paths and symlink escapes. A selected file grants that file alone. Transfers check sources and destinations before writing; Undo checks both roots again. Scopes are released only after watchers, readers and queued work stop. The direct channel performs no bookmark I/O and retains its ordinary filesystem behavior. [Electron picker API](https://www.electronjs.org/docs/latest/api/dialog), [paired bookmark access/release API](https://www.electronjs.org/docs/latest/api/app#appstartaccessingsecurityscopedresourcebookmarkdata-mas).

An ungranted restored folder, favorite or configured starting location presents **Allow folder access…**. Selecting its folder retries listing/watching; selecting an indexing root reconfigures the authorized index. Missing indexing permissions report offline roots without changing JSONC preferences. Cached index contents remain scoped before permission configuration. Revoked or relocated bookmarks need re-selection; automatic relocation and a permission-management screen are not implemented.

File-reader/indexing and recursive-size workers use Node threads in MAS builds so reads occur within the main process. Direct builds retain separate utility processes. PDF OCR receives bounded PDF data on stdin, avoiding a helper reopening a dynamically authorized path. Helper inheritance alone does not establish later picker access. Actual OS grants, physical stalled reads and other subprocess behavior still need the signed development test. [Apple sandbox inheritance](https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/EnablingAppSandbox.html).

## Acceptance evidence

The first signed run failed before renderer startup. macOS reported “Provisioning profile does not allow this device.” The registration helper and preflight had looked for `provisioning_udid`, but `system_profiler` actually exposes `provisioning_UDID`; the old fallback therefore used the separate Hardware UUID. The corrected preflight prioritizes the proper Provisioning UDID and rejects the initial profile. With explicit approval for one additional annual Mac slot, the correct device is now registered, the incorrect entry is inactive and Viewer Development has been regenerated with one matching certificate and only the correct device. The replacement passes preflight; the rebuilt bundle passes deep strict signature verification before and after its symlink-preserving copy, and its native baseline passes. Identifiers are never logged or stored in the repository.

macOS development profiles may also omit `com.apple.security.get-task-allow`, an unrestricted macOS entitlement. Preflight now accepts that absence while distinguishing device-bound development from device-free Store distribution, rejecting unrestricted profiles and verifying the authorized certificate's actual role. [Apple provisioning-profile details](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles).

`pnpm test:mas` passes against the corrected development bundle. It verifies signatures, identifier and main entitlements, then launches the real MAS app hidden with a disposable profile inside its own container. It checks the initial folder's permission request, actual home location, container-private `config.jsonc` with mode `0600`, denied unselected folder/file listing and resource access, closing the initial plane, creating a new plane from the empty workspace, access-recovery UI and graceful Quit. The external synthetic fixture is unchanged and no renderer exception is observed. A separate entitlement inventory confirms the Electron helpers, login helper and both Swift tools carry only sandbox and inheritance rights. Native picker/bookmark persistence and terminal/MCP parity require further acceptance checks; this baseline does not exercise a native grant.

`VIEWER_TEST_SCENARIO=store-file-services pnpm test:desktop` passed with real threads, SQLite/index scopes, recursive sizes, PDF/EPUB/OCR, reviewed actions/Undo, worker/preload permission errors and access-recovery UI, including resumed watching after access returns. It uses the ordinary packaged runtime, hidden windows and disposable fixtures. This is an implementation regression check; it is not a signed MAS sandbox test.

The signed development acceptance run must cover picker cancel/denial, first-plane locations, workspace restore, moved/revoked grants, previews and adjacent assets, external volumes, independent transfer/Undo roots, indexing/OCR, PTYs/custom executables, external terminals and a separate authenticated MCP client. Drag/drop, open-file events and agent/config paths need a saved native grant or a picker authorization; a stored path is never OS permission.

Before submission, also complete provider consent/privacy policy, accurate privacy manifests and dependency notices, minimum/current macOS and architecture coverage, listing/review metadata and Apple's upload validation. The [readiness assessment](mac-app-store-readiness.md) is the release checklist; successful packaging alone does not make the app submission-ready.
