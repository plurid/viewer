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
