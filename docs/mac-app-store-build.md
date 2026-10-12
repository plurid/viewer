# Mac App Store builds

The owner selected **Propal Invest SRL — 49W9L8Z9J5**. Public build identity lives in `packages/viewer-electron/app/mac-app-store.json`:

| Setting | Value |
| --- | --- |
| Team | `49W9L8Z9J5` |
| Intended bundle ID | `com.plurid.viewer` |
| Intended macOS application group | `49W9L8Z9J5.com.plurid.viewer` |

Identifier/group registration and App Store Connect ownership have not been verified. Private keys stay in Keychain; profiles and passwords do not belong in the repository. EAS's completed CT Dentar iOS build confirms that its remote release works, but its app-specific iOS profile cannot authorize this macOS bundle. [Expo credential storage](https://docs.expo.dev/app-signing/syncing-credentials/).

## Supply the signing assets

For a locally runnable Store development build:

1. In Xcode → Settings → Accounts, select the Propal team and use Manage Certificates to make that team's **Apple Development** identity available, including its private key.
2. Register the intended explicit Viewer App ID and enable its macOS application group in Apple Developer. Register the test Mac using its provisioning UDID from System Information → Hardware. These are account changes, not repository settings.
3. Create a **Mac App Development** provisioning profile for Viewer, selecting the matching development certificate, application group and test Mac. Download it outside the repository. [Apple development-profile instructions](https://developer.apple.com/help/account/provisioning-profiles/create-a-development-provisioning-profile).

The October 12 local inventory contains Propal's Developer ID Application identity and another team's Apple Development identity. Developer ID signs direct distribution; it cannot substitute for this Store development identity. The existing development certificate's parenthetical name suffix is not its Team ID; the certificate's `OU` is `87MLM8KZ2T`.

For submission packaging, additionally make **Apple Distribution / Mac App Distribution** and **Mac Installer Distribution** identities available for the same team and obtain a **Mac App Store Connect** profile for the same explicit Viewer App ID and group. The distribution profile does not register a test device. A distribution-signed MAS application is tested through Apple's distribution, not by launching that bundle locally. [Apple Store-profile instructions](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile), [Electron signing guide](https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide).

## Development build

Run from the repository root. Replace the example certificate name and absolute profile path with the actual local assets. A certificate SHA-1 identity is also accepted; no private key/password is passed on the command line.

```sh
export VIEWER_MAS_IDENTITY='Apple Development: Your Name (certificate suffix)'
export VIEWER_MAS_PROFILE='/absolute/path/Viewer-Development.provisionprofile'
export VIEWER_MAS_BUILD='1'
pnpm mas:preflight
pnpm mas:dev
```

The preflight verifies profile platform, expiry, team, explicit bundle identifier, application group, certificate membership, signing-certificate role/Team ID and this Mac's device registration. It emits only a public summary, generates/lints main/helper entitlements and refuses missing or mismatched inputs. Profiles are decoded in memory; device IDs, full profiles, passwords and private keys are not logged.

`mas:dev` builds the native helpers, packages the MAS Electron runtime, embeds the development profile and verifies signatures before and after copying the bundle. Relative framework symlinks are preserved. Default architecture is the host architecture; `VIEWER_MAS_ARCH=arm64` or `x64` selects a target explicitly, including native Swift helper compilation.

Output: `packages/viewer-electron/app/out/mac-app-store/mas-dev/<architecture>/Viewer.app`. No successful signed MAS artifact exists until these real assets pass the preflight.

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

MAS mode is selected by Electron's `process.mas`, not by a preference or renderer request. Native folder, application and import/export pickers request security-scoped bookmarks. `FileAccess` stores them atomically with mode `0600` in `file-access-v1.json` under the app's private user-data directory. They are not part of `viewer.config.jsonc`, exported settings, agent proposals or renderer API arguments.

Grants are acquired lazily and reused for the desktop session. Canonical checks reject sibling-prefix paths and symlink escapes. A selected file grants that file alone. Transfers check sources and destinations before writing; Undo checks both roots again. Scopes are released only after watchers, readers and queued work stop. The direct channel performs no bookmark I/O and retains its ordinary filesystem behavior. [Electron picker API](https://www.electronjs.org/docs/latest/api/dialog), [paired bookmark access/release API](https://www.electronjs.org/docs/latest/api/app#appstartaccessingsecurityscopedresourcebookmarkdata-mas).

An ungranted restored folder, favorite or configured starting location presents **Allow folder access…**. Selecting its folder retries listing/watching; selecting an indexing root reconfigures the authorized index. Missing indexing permissions report offline roots without changing JSONC preferences. Cached index contents remain scoped before permission configuration. Revoked or relocated bookmarks need re-selection; automatic relocation and a permission-management screen are not implemented.

File-reader/indexing and recursive-size workers use Node threads in MAS builds so reads occur within the main process. Direct builds retain separate utility processes. PDF OCR receives bounded PDF data on stdin, avoiding a helper reopening a dynamically authorized path. Helper inheritance alone does not establish later picker access. Actual OS grants, physical stalled reads and other subprocess behavior still need the signed development test. [Apple sandbox inheritance](https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/EnablingAppSandbox.html).

## Acceptance evidence

`VIEWER_TEST_SCENARIO=store-file-services pnpm test:desktop` passed with real threads, SQLite/index scopes, recursive sizes, PDF/EPUB/OCR, reviewed actions/Undo, worker/preload permission errors and access-recovery UI, including resumed watching after access returns. It uses the ordinary packaged runtime, hidden windows and disposable fixtures. This is an implementation regression check; it is not a signed MAS sandbox test.

The signed development acceptance run must cover picker cancel/denial, first-plane locations, workspace restore, moved/revoked grants, previews and adjacent assets, external volumes, independent transfer/Undo roots, indexing/OCR, PTYs/custom executables, external terminals and a separate authenticated MCP client. Drag/drop, open-file events and agent/config paths need a saved native grant or a picker authorization; a stored path is never OS permission.

Before submission, also complete provider consent/privacy policy, accurate privacy manifests and dependency notices, minimum/current macOS and architecture coverage, listing/review metadata and Apple's upload validation. The [readiness assessment](mac-app-store-readiness.md) is the release checklist; successful packaging alone does not make the app submission-ready.
