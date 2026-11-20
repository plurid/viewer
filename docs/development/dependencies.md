# Runtime dependencies

Viewer ships the tools its local previews and exports need. An installed app should not ask the user
to install an Office suite, FFmpeg or a package manager to use those features.

| Feature                    | Owner and source of truth                                                                                                                                                                                                             | Runtime constraints                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Office print layout        | [Runtime pins](../../packages/viewer-electron/app/src/desktop/previews/office-runtime-manifest.ts), [verification and staging](../../packages/viewer-electron/app/tools/office-runtime.ts)                                            | Bundled WebAssembly in an isolated sandbox; macros, document updates, downloads and external requests disabled.                                            |
| PDF preview and extraction | [PDF.js packaging](../../packages/viewer-electron/app/tools/pdf-runtime.ts) and the workspace lockfile                                                                                                                                | Keep the worker, fonts and native canvas dependencies with the matching package.                                                                           |
| Images, audio and video    | [Processor pins and build](../../packages/viewer-electron/app/tools/processors.ts)                                                                                                                                                    | Bundled image libraries and FFmpeg; typed arguments, held source descriptors, output limits and cancellation.                                              |
| PDF/JPEG optimization      | [Optimizer pins and build](../../packages/viewer-electron/app/tools/pdf-processors.ts)                                                                                                                                                | Bundled qpdf/jpegtran, resolved beside media processors without rewriting installation parents.                                                            |
| Camera RAW                 | [LibRaw build](../../packages/viewer-electron/app/tools/libraw.ts)                                                                                                                                                                    | Verified helper/source hashes and architecture; an older macOS minimum can satisfy a newer app minimum.                                                    |
| Terminals                  | [PTY packaging](../../packages/viewer-electron/app/forge.config.ts), [launch policy](../../packages/viewer-electron/app/src/desktop/terminals/terminal-launch.ts)                                                                     | Electron-compatible native PTY; configured external programs have separate confirmation.                                                                   |
| File operations            | [Native file adapter](../../packages/viewer-electron/app/src/desktop/native/macos-files.ts) and desktop operation services                                                                                                            | Captured identity/version, guarded publication, native access and exact removal review.                                                                    |
| SSH transport              | macOS `/usr/bin/ssh`; [fixed arguments](../../packages/viewer-electron/app/src/domain/remote/ssh-arguments.ts)                                                                                                                        | System OpenSSH, direct build with `VIEWER_REMOTE=1`; no npm dependency, PATH lookup or launch-time connection.                                             |
| SSH authentication relay   | [Swift source](../../packages/viewer-electron/app/tools/askpass.swift), [helper build](../../packages/viewer-electron/app/tools/build-helpers.ts) and [native secure sheet](../../packages/viewer-electron/app/tools/remote-prompt.h) | Built and signed like `viewer-ocr`, packaged in the direct build only; Foundation and AppKit only. Answers never enter renderer IPC or persistent storage. |

## Change a dependency

Update the manifest and lockfile together. Check installed versions and run `pnpm audit` for the
complete graph. `pnpm audit --prod` is a useful additional view, but it omits Electron because the
shipped runtime is declared as a development dependency. An audit of npm packages does not cover
every bundled native library. Review the upstream advisory or release notes and verify the patched
bytes. Retain corresponding sources, licenses and notices for bundled processors.

When a patched version cannot be adopted, record the advisory under `auditConfig.ignoreGhsas` in
[pnpm-workspace.yaml](../../pnpm-workspace.yaml), with the date, the path it reaches Viewer by, why
it cannot be exploited there, and what removes the exception. Only build and lint tools qualify: an
advisory in a package the app ships is fixed, never ignored.

Build-time downloads must match their reviewed hashes. Preserve mismatched caches for inspection.
The Office build appends the pinned, unmodified Noto CJK font collection to a new virtual-filesystem
package. Upstream engine files and earlier packages stay intact. The resulting data and metadata
have their own pins; the font source, copyright and SIL Open Font License are supplied with Viewer.
The installed application must use its bundled resources rather than inheriting tools from a
developer's PATH. Follow [AGENTS.md](../../AGENTS.md) before replacing or removing existing folders.

After a change, run types, lint, affected regressions and the full tests. Package the app and repeat
the relevant real workflow: a source test cannot establish that its native dependency was bundled or
that the exported file renders correctly.

The renderer applies a narrowly guarded build adaptation (`tools/three-renderer.ts`) for Three.js
texture ownership while keeping the installed package files intact. Separately,
`tests/plurid-camera.test.ts` (`tools/plurid-camera.ts`) reads the installed `@plurid/plurid-react`
bundle directly to verify that its camera-selector cache stays bounded and fails if the selector
shape drifts; review both when upgrading Three.js or Plurid.

## Validate the package

Check Office asset hashes, processor versions, dynamic-library linkage and third-party notices in
the actual bundle. Verify source manifests as well as binary version banners. Exercise real
documents, cancellation and source-change recovery. Keep the input hashes and generated results in
retained evidence, with private paths excluded from public reports.

[Testing](testing.md) explains isolated native checks. [Release gates](releases.md) covers native
consent, signing, notarization and operator acceptance separately.
