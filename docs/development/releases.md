# Native and distribution release gates

A local development package is not a distribution release. Qualify the actual binary, platform,
architecture, dependency installation and signing configuration.

## Direct build

Use frozen registry dependencies and `pnpm plurid:check`. A local source-sync overlay is rejected by
release qualification. Record source/lock/runtime hashes, native helper/resource identities and
signature verification in generated evidence.

Certificate signing and notarization need the release identities and configuration. An ad-hoc local
bundle does not establish either. Verify downloaded distribution bytes, startup and required bundled
native dependencies before publishing.

### Version and build

`version` in the app's `package.json` is the release version, `CFBundleShortVersionString`. Every
direct package, local ones included, stamps the commit count (`git rev-list --count HEAD`) into
`CFBundleVersion`, so each release has a larger build than the last. Never rewrite published
history. A Store build uses `VIEWER_MAS_BUILD`. About Viewer shows both, as in `1.0.0 (812)`, and
the disk image is named `Viewer-<version>-<build>-arm64.dmg`. Help menu links open the guides at the
`v<version>` tag.

Viewer declares macOS 14.0 (`macOSMinimum` in `tools/native-build/macos-target.ts`). Native helpers
are built for it; a reused helper or the pinned speech engine must not need a newer macOS. The build
stops if Electron needs more.

### Set up the update feed once

Check for Updates reads a JSON feed signed with Ed25519. The app embeds the feed address and the
public key; only the release owner holds the private key.

1. Make a key pair, giving a new absolute path outside the repository:

   ```sh
   pnpm updates:keys /absolute/path/viewer-update-key.pem
   ```

   The command writes the private key, readable by you only, and prints the public key. Back up the
   private key: without it, installed copies cannot verify a later release.

2. In `packages/viewer-electron/app/src/desktop/release.ts`, set `url` to the https address where
   the feed will be published, such as `https://example.com/viewer/viewer-update.json`, and
   `publicKey` to the printed key. Commit the change.

With either value empty, Check for Updates says the build has no update feed and the launch check
does nothing. A release refuses to start.

### Make a release

1. Set `version` in `packages/viewer-electron/app/package.json`.
2. Write `packages/viewer-electron/app/release-notes/<version>.txt`: a few plain lines for the
   update dialog. Lines starting with `#` are left out. The release refuses empty notes.
3. Commit everything. The release refuses a tree with changes or untracked files, and a shallow
   clone.
4. Create a notarization profile privately in Terminal with
   `xcrun notarytool store-credentials viewer-notary`. The tool prompts for the account credentials;
   keep passwords and private keys out of chat, scripts and the repository. An Expo/EAS iOS build
   profile is separate from this macOS configuration.
5. Run the release with the profile name, a valid Developer ID Application identity and the update
   signing key:

   ```sh
   VIEWER_NOTARY_PROFILE=viewer-notary \
   VIEWER_DIRECT_IDENTITY="Developer ID Application: <name> (<team>)" \
   VIEWER_UPDATE_SIGNING_KEY_FILE=/absolute/path/viewer-update-key.pem \
   pnpm direct:release
   ```

   `VIEWER_UPDATE_SIGNING_KEY` can hold the PEM text instead of a file path. The disk image's
   address defaults to its name beside the feed; set `VIEWER_RELEASE_DOWNLOAD_URL` to its exact
   https address when it is published elsewhere.

Before packaging, `pnpm direct:release` checks that the signing key matches the embedded public key,
then runs `pnpm check`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm docs:check` and
`pnpm plurid:check` with test folders preserved. Any failure stops the release. The gates never
receive the signing key. After packaging, it checks the version and build in `Info.plist`.

It then produces the signed Apple Silicon app and notarized disk image. The command submits the app
archive and disk image separately, staples both tickets and checks Gatekeeper acceptance. App
stapling uses a retained copy in the system temporary directory to avoid deep checkout paths; the
submitted source stays intact. It keeps the archives, disk-image source and Apple's responses under
`packages/viewer-electron/app/out/direct-release/`, including failed submissions. It does not
publish anything.

Each run's folder holds:

| File                     | Contents                                                               |
| ------------------------ | ---------------------------------------------------------------------- |
| `Viewer-…-arm64.dmg`     | The notarized disk image                                               |
| `SHA256SUMS.txt`         | The disk image's SHA-256                                               |
| `viewer-update.json`     | Version, build, release notes, download address, SHA-256, minimum OS   |
| `viewer-update.json.sig` | The base64 Ed25519 signature of the feed's exact bytes                 |
| `notarization.json`      | Submissions, the retained notarized app, commit, build and source hash |

The receipt points to the retained notarized app in that run's staging directory, so a later build
cannot change which app the receipt identifies.

### Publish

1. Qualify the installer (below) before anyone can download it.
2. Upload the disk image and `SHA256SUMS.txt` to the download address the command printed.
3. Upload `viewer-update.json` and `viewer-update.json.sig` to the feed address. Upload the feed
   last, so it never points at a missing disk image.
4. Run `pnpm updates:verify`. It reads the published feed as the app does and prints the version it
   offers.
5. Tag the release commit the command printed, `git tag v<version> <commit>`, and push the tag. Help
   menu links open the guides at that tag.

Installed copies find the release at their next launch check, at most a day later, or at once with
**Viewer → Check for Updates…**. Download opens the disk image's https address in the browser;
nothing is installed automatically.

### Qualify the installer

Qualify the installer itself with `tests/native/direct-distribution.ts`, run from the app directory.
Set `VIEWER_TEST_PRESERVE=1`, `VIEWER_TEST_NO_REMOVAL=1` and `VIEWER_TEST_DISTRIBUTION_RECEIPT` to
that run's `notarization.json`. The scenario verifies the disk image, mounts it read-only and copies
Viewer into a new retained installation directory. It checks signatures, tickets, Gatekeeper, fuses
and bundled resource identities while retaining download quarantine.

Use the resulting installed binary as `VIEWER_TEST_BINARY` for packaged startup, Office, media and
PDF checks. Exercise helpers through the installed application after its normal first launch; a
standalone helper invocation before that launch is a separate Gatekeeper diagnostic. Static package
verification does not establish that a conversion or export succeeds.

### What the bundle leaves out

The app bundle declares English only, matching Viewer's own text, so standard menu items and system
panels appear in English. Chromium's language files stay, so dates and numbers follow the system's
region and language. It leaves out other platforms' node-pty prebuilds and the Windows ConPTY and
winpty files. Electron's camera and screen-audio purpose strings are removed; the Bluetooth ones say
Viewer does not use Bluetooth.

## Store build

Run `pnpm mas:preflight` before `pnpm mas:dev` or `pnpm mas:package`. Supply the matching
provisioning profiles, Keychain identities and configured team/bundle IDs. Keep private signing
assets outside the repository.

Qualify the sandbox's folder bookmarks, revocation/recovery, main-process worker strategy, native
helpers, OCR transport, JIT entitlements and permitted network paths in the signed runtime.
Direct-build behavior is not substitute evidence. Keep
[submission drafts](../release/app-store-metadata.md) and the
[privacy draft](../release/privacy-policy.md) under owner review until published.

## Operator acceptance

Exercise genuine file/folder pickers, native consent denial/allow/revocation, Finder drag/paste/open
behavior, signing prompts, file provider changes and volume loss. Permission transitions must retain
drafts and recover without widening authority. Human confirmations belong to the operator.

Test sustained mixed workspaces and representative files. Qualify physical keyboard/accessibility
behavior, resize/full-screen/hide restoration, long media and cancellation separately from hidden
functional tests. Track each architecture and OS separately.

## Keep release state honest

`pnpm qualify` and `pnpm direct:release` own structured qualification and direct release records.
Read their documented diagnostics before invoking a mutating or distribution step. Generated
evidence distinguishes passed, failed, skipped and pending gates; do not turn an older candidate's
pass into a current release claim.

The [platform reference](../reference/platforms.md) is the user-facing status. [Testing](testing.md)
describes routine checks and fixture preservation.
