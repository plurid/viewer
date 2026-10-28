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

Create a notarization profile privately in Terminal with
`xcrun notarytool store-credentials viewer-notary`. The tool prompts for the account credentials;
keep passwords and private keys out of chat, scripts and the repository. Pass only that profile name
through `VIEWER_NOTARY_PROFILE`, and select a valid Developer ID Application identity with
`VIEWER_DIRECT_IDENTITY`. An Expo/EAS iOS build profile is separate from this macOS configuration.

Run `pnpm direct:release` to produce the signed Apple Silicon app and notarized disk image. The
command submits the app archive and disk image separately, staples both tickets and checks
Gatekeeper acceptance. App stapling uses a retained copy in the system temporary directory to avoid
deep checkout paths; the submitted source stays intact. It keeps the archives, disk-image source and
Apple's responses under `packages/viewer-electron/app/out/direct-release/`, including failed
submissions. It does not publish the installer. Use the resulting `SHA256SUMS.txt` to verify the
distribution bytes. The receipt points to the retained notarized app in that run's staging
directory, so a later build cannot change which app the receipt identifies.

Qualify the installer itself with `tests/native/direct-distribution.ts`, run from the app directory.
Set `VIEWER_TEST_PRESERVE=1`, `VIEWER_TEST_NO_REMOVAL=1` and `VIEWER_TEST_DISTRIBUTION_RECEIPT` to
that run's `notarization.json`. The scenario verifies the disk image, mounts it read-only and copies
Viewer into a new retained installation directory. It checks signatures, tickets, Gatekeeper, fuses
and bundled resource identities while retaining download quarantine.

Use the resulting installed binary as `VIEWER_TEST_BINARY` for packaged startup, Office, media and
PDF checks. Exercise helpers through the installed application after its normal first launch; a
standalone helper invocation before that launch is a separate Gatekeeper diagnostic. Static package
verification does not establish that a conversion or export succeeds.

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
