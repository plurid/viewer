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

### Alpha versioning

Viewer follows [alpha versioning](https://github.com/ly3xqhl8g9/alpha-versioning):
`ender.launcher.revisioner-developmenter`, starting at `0.0.0-0`. Viewer is launched, so its series
is `0.1.0-N`: ender **0** means development continues, launcher **1** means launched, revisioner
**0** is the current general revision, and developmenter **N** is the release counter, starting
at 0. The first release is `0.1.0-0`, followed by `0.1.0-1`. After cutting a release, the owner runs
`pnpm version:next` and commits the next version. The third number changes only on a declared
general revision. Alpha versions keep their first number at 0; `1.0.0` is reserved for the end of
development.

The manifest is the version's single source. Direct bundles stamp `0.1.0-0` into
`CFBundleShortVersionString`; feed `version` carries the same alpha version. The machine build stays
separate in `CFBundleVersion` and feed `build`: the commit count for direct builds, or
`VIEWER_MAS_BUILD` for the Store. Never rewrite published history. About shows `0.1.0-0 (584)`; a
development run shows `0.1.0-0`, development, and receives no update offers. Tags use `v<version>`,
and installers use `Viewer-<version>-arm64.dmg`. Help links use the version tag, or `master` in
development.

Apple's Store requires increasing three-integer versions. Its bundle short version drops the alpha
ender: `0.1.0-0` becomes `1.0.0`, `0.1.0-N` becomes `1.0.N`, and `0.1.1-0` becomes `1.1.0`. The
embedded app manifest and all in-app surfaces keep the alpha version. No separate Store version is
maintained. The feed orders all four alpha numbers numerically, then the build for equal versions;
macOS system versions keep their dotted comparison.

The event build of 2026-11-03, named `1.0.0` (build 553), was withdrawn on 2026-11-16 with its
GitHub releases and `v1.0.0` tag. Commit `1a0dcf04e50fa4c74f506ea07035a52da68d4a04` stays in
history. Install `0.1.0-N` over a copy from that build once by hand: its update check will not offer
a lower dotted version. See the [decision](../adr/0019-alpha-versioning.md).

Viewer declares macOS 14.0 (`macOSMinimum` in `tools/native-build/macos-target.ts`). Native helpers
are built for it; a reused helper or the pinned speech engine must not need a newer macOS. The build
stops if Electron needs more.

### Set up the update feed once

Check for Updates reads a JSON feed signed with Ed25519. The app embeds the feed address and the
public key; only the release owner holds the private key.

The configured feed is
`https://github.com/plurid/viewer/releases/latest/download/viewer-update.json`. GitHub Releases
hosts the installer, checksums, feed and signature. The product presentation belongs at
`https://plurid.com/viewer`, in the Plurid applications repository's existing WWW app. Keep download
links on that page pointed at the qualified GitHub release.

The public key is already configured. Use its matching private key for subsequent releases; do not
generate a replacement for each build. The following steps describe initial setup for a new
distribution, before any copies have shipped.

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

### Set up offline license keys

The direct build's trial and pay-once key use a separate Ed25519 key pair from the update feed.
`licenseConfiguration` ships with both fields empty, disabling the feature. Configure both before
selling a direct build. The Store edition ignores them and writes no license record.

Before the release gates or packaging run, `pnpm direct:release` checks that the configuration is
fully empty or contains a valid Ed25519 public key and an https purchase address without
credentials. A partial or mistyped configuration stops the release with the field's name.
`pnpm license:issue` applies the same check and requires both fields to be configured.

1. Generate the license key pair at a new absolute path outside this repository:

   ```sh
   pnpm license:keys /absolute/path/viewer-license-key.pem
   ```

   The private file is readable by its owner only. The command prints only the public key. Back up
   the private file privately; never put it in source control or a release artifact.

2. Set `licenseConfiguration.publicKey` in `packages/viewer-electron/app/src/desktop/release.ts` to
   the printed public key and `licenseConfiguration.purchaseURL` to the fixed https purchase page
   without credentials. The purchase page owns the price and payment instructions.
3. After a purchase, issue a key with its email and order reference:

   ```sh
   VIEWER_LICENSE_SIGNING_KEY_FILE=/absolute/path/viewer-license-key.pem \
   pnpm license:issue buyer@example.invalid generated-order-reference
   ```

   `VIEWER_LICENSE_SIGNING_KEY` can hold PEM text instead. Set exactly one of the two variables.
   File paths must be absolute and outside the repository, including resolved symbolic links. The
   issuer refuses a private key that does not match the embedded public key. It prints the resulting
   key to stdout and never prints the private key. Deliver the key privately to its buyer; payment
   fulfillment is outside this tool.

   Purchase emails may contain international characters. They must have exactly one `@`, text on
   both sides, no whitespace or control characters, and at most 320 characters. The app verifies the
   signed text without applying an email address pattern.

4. Check a copied key offline with `pnpm license:verify '<key>'`. It uses the embedded public key
   and prints the email, order and issue date. Commands report errors on stdout and exit with a
   failure code.

Release gates and packagers receive neither signing variable nor its file reference, for updates or
license keys. No license check contacts a server. The only license-related navigation is **Buy
Viewer**, which opens the configured page in the person's browser. See the
[format and trial reference](../reference/license.md).

### Make a release

1. Use the alpha `version` in `packages/viewer-electron/app/package.json`, currently `0.1.0-0`.
   After cutting it, run `pnpm version:next` to prepare `0.1.0-1`. A local `v<version>` tag for the
   current version stops the release and asks you to raise N first.
2. Write `packages/viewer-electron/app/release-notes/<version>.txt`, starting with
   `release-notes/0.1.0-0.txt`: a few plain lines for the update dialog, committed separately for
   each release. Lines starting with `#` are left out. The release refuses empty notes.
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

### Keep source maps for report locations

Archive the source maps for every published version and build, for both editions and each
architecture. This is a release-owner step; release tooling does not make a separate map archive.
The main and renderer Vite configurations already generate maps. Keep the generated JavaScript and
its matching `.map` files from that exact release run, preserving their relative directories under
`.vite/build/` and `.vite/renderer/main_window/`. Do this before another build replaces `.vite`.

Keep this archive outside the mutable build output, alongside the exact source commit, version,
build, edition, architecture and SHA-256 checksums of the JavaScript and maps. For a direct release,
keep `notarization.json` and its source hash with it; compare the JavaScript with the retained app
identified by that receipt. For the Store, keep the matching submitted app, its version/build and
source commit with the maps. Preserve embedded `sourcesContent`, or retain that exact source tree
when a map has none. These retention steps do not alter the app or the files it ships.

To investigate a location from **Copy Report…**:

1. Select the archive matching the report's version, build and edition. Verify its recorded
   checksums. A rebuild from the same source is not evidence of matching generated code.
2. Find the map beside the reported generated file. A renderer location such as
   `assets/index-B3.js:12:76` uses `.vite/renderer/main_window/assets/index-B3.js.map`. A
   main-process location under `Contents/Resources/app.asar/.vite/build/main.cjs` uses
   `.vite/build/main.cjs.map`.
3. Resolve its line and column with Node's built-in source-map reader, using the archived map:

   ```sh
   node --input-type=module - /absolute/path/index-B3.js.map 12 76 <<'JS'
   import { readFileSync } from 'node:fs';
   import { SourceMap } from 'node:module';
   const [file, line, column] = process.argv.slice(2);
   const map = new SourceMap(JSON.parse(readFileSync(file, 'utf8')));
   const entry = map.findEntry(Number(line) - 1, Number(column) - 1);
   if (!entry.originalSource) throw new Error('No mapping at this location.');
   console.log(`${entry.originalSource}:${entry.originalLine + 1}:${entry.originalColumn + 1}`);
   JS
   ```

   Reported locations are one-based. `findEntry` takes zero-based offsets; the printed source
   location is one-based again. Inspect that source in the retained commit, including adjacent
   mappings when a minified frame spans several expressions. Default reports omit function names, so
   the matching map and source are needed to identify the failing code.

### Publish

1. Qualify the installer (below) before anyone can download it.
2. Upload the disk image and `SHA256SUMS.txt` to the download address the command printed. Build the
   demo from the folder holding the saved **Front** and **Rear** tools. From
   `packages/viewer-electron/app`, run:

   ```sh
   pnpm_config_verify_deps_before_run=false pnpm demo:archive \
     /absolute/path/saved-tools /absolute/path/demo-output
   ```

   Both paths must be absolute, and the output must be outside the source. Move any existing
   `Viewer-Demo.zip` and `Viewer-Demo.sha256` away first. The command keeps and prints its staging
   folder, skips dot files and refuses symbolic links. It reports the size, SHA-256 and saved tool
   names. Attach `Viewer-Demo.zip` and `Viewer-Demo.sha256` to every release under those fixed
   names: the [demo guide](../guides/demo-project.md) downloads the archive through the latest
   release's asset URL.

3. Upload `viewer-update.json` and `viewer-update.json.sig` to the feed address. Upload the feed
   last, so it never points at a missing disk image.
4. Run `pnpm updates:verify`. It reads the published feed as the app does and prints the version it
   offers.
5. Tag the release commit the command printed, `git tag v<version> <commit>`, and push the tag. Help
   menu links open the guides at that tag.

Installed copies find the release at their next launch check, at most a day later, or at once with
**Viewer → Check for Updates…**. Download opens the disk image's https address in the browser;
nothing is installed automatically.

For GitHub Releases, create and push the version tag for the qualified source commit, then prepare a
draft release with the disk image, checksums, feed and signature. Set `VIEWER_RELEASE_DOWNLOAD_URL`
during the build to the disk image's version-specific URL under
`https://github.com/plurid/viewer/releases/download/v<version>/`. Publish the draft as the latest
release only after its assets have uploaded. This makes the installer and feed available together.
Run `pnpm updates:verify` against the published assets, then check the website's download link.

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
