# Verification

Implementation checks ran on Apple Silicon, macOS 15.1, Node 26.8.2 and pnpm 11.3.0. Tests create disposable synthetic files and use an isolated application profile. They do not modify legacy Viewer data or user files.

## Verified

- Strict TypeScript checks cover the desktop process, sandboxed preload, renderer, tests and build tooling. ESLint and Prettier checks pass.
- 40 automated tests across seven files exercise real filesystem metadata and paths, transfers, collisions, cancellation, partial errors, source/destination races, safe undo, cross-volume and unsupported-hard-link fallback, macOS metadata protection, scoped resources, range streams, archive integrity, streamed search, shared watchers, atomic state recovery, workspace reconciliation and ambiguous source-code MIME detection.
- The actual locally signed macOS bundle starts with an isolated renderer and fixed preload bridge. Packaged-app checks reject invalid IPC, remote network requests and escaping resource paths, and exercise byte ranges and sandbox response headers.
- Synthetic GLB, glTF, OBJ with local MTL, STL and FBX render; malformed models and missing companions recover visibly. Orbiting a model changes its rendered image without moving its file planes.
- Synthetic images, Markdown, PDF, JSON, CSV, ZIP, TAR, TAR.GZ, audio and video open in their modules. PDF text selection/search, archive entry navigation, image zoom, media decoding/playback and cleanup are exercised. These checks cover representative files, not every codec or format variant.
- List, grid, columns and gallery operate on the same folder. Packaged copy/rename jobs and rename undo succeed. Linked branch close, arrangement undo/redo, workspace switching, reload restoration and pending-state save on native application quit are checked.
- Browser fixture interactions cover selection, copy/paste, keep-both collisions, new folder, rename, file information, linked previews and arrangement history. Clipboard and Trash are isolated fixture adapters in this environment.
- Rendered evidence covers the desktop, the minimum 780×560 window, dark/light looks and both observed user browser sizes, 1456×935 and 1456×879.
- An independent source/capture review confirmed all four requested interface fixes: compact workspace framing, docked preview control clearance, theme contrast and the SVG alias marker. Its final verdict applies to those fixes; functional evidence comes from the checks above. The design detector ran in degraded regex mode and did not evaluate computed styles or contrast.

## Not yet verified

Real removable-drive disconnection, mounted network failures and different filesystem/server combinations need hardware and mount-specific testing. Native Finder clipboard interoperability is not implemented; transfers currently use Viewer's internal file clipboard. Native Trash uses Electron's platform adapter, while automated destructive tests use a disposable replacement to avoid changing the user's Trash.

Windows/Linux packaging, release certificate signing, notarization and public distribution remain outside this implementation. Full Finder metadata copying, future preview families and unsupported codec/compression variants are described in the [README](../README.md).

## Reproduce

```sh
pnpm install
pnpm check
pnpm lint
pnpm format:check
pnpm test
pnpm make
pnpm test:desktop
```

Use `pnpm test:browser` for interactive checks against generated files. Stop it to remove its temporary workspace. The desktop check launches only its own packaged binary, profile and debugging endpoint; `VIEWER_RENDER_TEST=1` keeps that test window rendering when macOS occludes it. Normal application launches retain background throttling and the same isolation boundaries.

The interface review and its evidence live in `.impeccable/review/` during development. That directory is ignored by Git and is not part of the application bundle. Durable interface guidance is recorded in [DESIGN.md](../DESIGN.md).
