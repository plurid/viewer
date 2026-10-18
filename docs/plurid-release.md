# Plurid release handoff

The maintainer published the coordinated October 18 release: all 13 packages are verified on npm's
`latest` tag, including data `0.0.0-27`, engine `0.0.0-24` and React `0.0.0-41`. Viewer now pins
that graph. Its fresh registry installation, distribution byte checks, tests and production bundles
pass; see [verification](verification.md). The Plurid release tag remains local until consumer
verification is reviewed. Public Viewer builds and Store submission remain separate release steps.

In the sibling `plurid` checkout, review the prepared manifests and peer minimums. The workspace
lockfile uses local links, so these version changes need no new lockfile entries. Commit the complete
preparation, push it, and wait for all four CI jobs on that commit. The dry run needs no login and
does not fetch git refs, build, pack, or write files.

```sh
pnpm release --dry-run --all
pnpm release --pack
```

The script manages a new temporary workspace outside the checkout and remembers its location under
ignored `.out/releases/`. It contains a fresh source snapshot and package store, logs/output
from the verification commands, tested tarballs and `release.json` with source commit and integrity
hashes. The pipeline checks build, types, unit tests, lint, modules, budgets, documentation, browser,
performance, visual baselines and packed consumers. It retains all intermediates. A failed gate does
not produce a verified release manifest; fix the source, commit it and run `--pack` again.

Publishing is an explicit maintainer step. It requires green CI, rechecks tarball hashes and submits
the packages consecutively in dependency order with lifecycle scripts disabled. Registry visibility
is checked for the whole release together after submission, including exact versions, integrity and
`latest` tags. Retained publication receipts prevent accepted uploads from being submitted again
while npm processes them. On partial publication, resume with the same artifacts; an existing version
whose integrity differs stops the round. Without an explicit path, the script reuses verified
artifacts for this commit (or a permitted publisher-only descendant) or builds and verifies them
automatically when none exist. Running `--pack` first is optional for reviewing artifacts.

```sh
pnpm release --publish
pnpm release --verify-registry
```

Then, in Viewer:

```sh
pnpm plurid:update
```

This command reads `tools/plurid-release.json`, requires every version to exist on npm, and prepares
an authentic registry lockfile in a separate temporary workspace. It updates only the app manifest
and root lockfile after resolution succeeds. It preserves the installed packages. Review and commit
both updated files before creating the candidate checkout.

Use a fresh checkout and store for the candidate. A fresh checkout alone is insufficient: a local
source overlay may have modified files hardlinked from an existing store.

```sh
git clone --no-local /absolute/path/to/viewer /private/tmp/viewer-registry-rc-20261018
cd /private/tmp/viewer-registry-rc-20261018
pnpm install --frozen-lockfile --store-dir /private/tmp/viewer-registry-store-20261018
pnpm plurid:check
VIEWER_TEST_PRESERVE=1 pnpm check
pnpm lint
pnpm format:check
VIEWER_TEST_PRESERVE=1 pnpm test
```

Choose new paths if those already exist. Keep the development installation and prior candidates.
The full tests require `assets/viewer-macos-files.node` built from the candidate's source. Compile
the native helpers before running them; a source archive with dependencies alone lacks this binding.
Normal Forge packaging cleans build outputs; use a separately reviewed preservation-safe candidate
build when operating under the workspace's Trash policy. `build-preserving.ts` inherits native
dependencies and resources from its seed and is insufficient to prove a fresh registry candidate.

Qualification now includes the registry byte comparison. A source-synced installation, a stale nested
dependency, an unexpected local link, an extra retained chunk, or a distribution file differing from
npm blocks it. The remaining candidate checks include tiling/Undo/restoration; native scrolling for
folders, images, models, CAD and terminals; and independent Space/Quick Preview input. Follow
[release qualification](release-qualification.md) for packaged and native acceptance.

Automated candidate checks do not establish public readiness. The current source still needs an
immutable candidate qualification and soak, physical/native/provider acceptance, the supported OS
matrix, and Developer ID notarization/Gatekeeper or the corresponding Store distribution gates.
