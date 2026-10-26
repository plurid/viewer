# Build and run Viewer

The current development setup is macOS with Xcode command-line tools, Node **22.13 or later** and
pnpm **11**. `package.json` records the exact package-manager pin. Native helpers and bundled
processors make the first setup larger than a renderer-only web project.

## Run from source

Clone the repository, enter it and run:

```sh
pnpm install
pnpm start
```

The app builds native helpers and starts Electron. No model credential is needed for ordinary
browsing, previews and local tools. Use the [first-five-minutes guide](../guides/getting-started.md)
once it opens.

## Make a local application

```sh
pnpm check
pnpm lint
pnpm format:check
pnpm test
pnpm make
```

On macOS, the app is under
`packages/viewer-electron/app/out/Viewer-darwin-<architecture>/Viewer.app`. The ZIP is under the
app's `out/make/zip/darwin/<architecture>/` directory. Extract the ZIP and drag Viewer.app to
Applications to use that local build.

Local bundles use ad-hoc signing. They are not automatically notarized or Store packages. See
[platform status](../reference/platforms.md) and [release gates](releases.md).

## Preserve earlier outputs

`pnpm package` and `pnpm make` first move the prior app `.vite` and exact current
platform/architecture package directory to OS Trash. This is the narrow standing exception in
[AGENTS.md](../../AGENTS.md). Other agent-initiated removals still require exact-path approval.

For a local JS rebuild against a retained macOS seed, use the preserving helper from the app
directory:

```sh
node --import tsx tools/build-preserving.ts <seed-Viewer.app> <new-output-Viewer.app>
```

The destination must be new. It retains seeds/intermediates, checks source witnesses and signs the
resulting local bundle. It does not qualify changed native dependencies or a distribution release
merely by rebuilding JavaScript.

## Dependencies and native resources

Use the lockfile for installs. `pnpm plurid:check` checks installed Plurid distributions against
registry tarballs. `pnpm plurid:update` prepares a coordinated registry update; `pnpm plurid:sync`
is a local-development overlay that release qualification rejects.

Build helpers prepare pinned Office, media, PDF and RAW resources. Assets and third-party notices
travel with the package. Some native processors currently have macOS-only build paths; a shared
renderer build is not Windows/Linux acceptance.

## Mac App Store path

`pnpm mas:preflight`, `pnpm mas:dev` and `pnpm mas:package` use the separate Store configuration.
Supply valid signing identities/profiles and follow the diagnostics. The Store file-access layer,
entitlements, sandbox workers and signed-runtime acceptance differ from the direct build.
[Release gates](releases.md) lists the evidence required before distributing either edition.
