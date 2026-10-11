# Verification

Implementation checks ran on Apple Silicon, macOS 15.1, Node 26.8.2 and pnpm 11.3.0. The interface overhaul was verified on October 11, 2026. File-operation tests use disposable synthetic files; the native harness has an isolated application profile. Existing user files, folders, legacy Viewer data and the user's normal application profile are not modified by verification.

## Verified

- Strict TypeScript checks cover the desktop process, sandboxed preload, renderer, tests and build tooling. ESLint and Prettier checks pass.
- 55 automated tests across nine files exercise real filesystem metadata and paths, transfers, collisions, cancellation, partial errors, source/destination races, safe undo, cross-volume and unsupported-hard-link fallback, macOS metadata protection, scoped resources, range streams, archive integrity, streamed search, shared watchers, atomic state recovery, workspace reconciliation and ambiguous source-code MIME detection. New mocked-service tests cover command availability, aliases, applicable recency without duplicate rows, captured and stale targets, clipboard refresh, text-edit routing, layout-only workspace recovery, running-job continuity, last-workspace replacement and independent optional preference fallback.
- The actual locally signed macOS bundle starts with an isolated renderer and fixed preload bridge. Packaged-app checks reject invalid IPC, remote network requests and escaping resource paths, and exercise byte ranges and sandbox response headers.
- Synthetic GLB, glTF, OBJ with local MTL, STL and FBX render; malformed models and missing companions recover visibly. Orbiting a model changes its rendered image without moving its file planes.
- Synthetic images, Markdown, PDF, JSON, CSV, ZIP, TAR, TAR.GZ, audio and video open in their modules. PDF text selection/search, archive entry navigation, image zoom, media decoding/playback and cleanup are exercised. These checks cover representative files, not every codec or format variant.
- List, grid, columns and gallery operate on the same folder. Packaged copy/rename jobs and rename undo succeed. Linked branch close, arrangement undo/redo, workspace switching, reload restoration and pending-state save on native application quit are checked.
- Native keyboard Command-K opens focused action search. Two-letter `rn` opens Rename for the clicked target; the next target receives the promoted recent action exactly once. Header actions retain selection. Command-F focuses filename search and finds a nested PDF. Preview wireframe commands work through the palette while primary controls occupy the plane header.
- Settings toggles computed plane backface visibility. Sidebar section/shortcut drag, folder-to-Favorites drop, fold, alias rename, keyboard resize and hide/show change layout without starting any filesystem job. Those preferences survive ordinary saved-state persistence.
- A real fixture copy conflict shows the operations control and opens an anchored popover without reducing workspace width. Replace opens a protected confirmation, which the test cancels; Skip completes safely and removes the control. Recent history remains explicitly accessible.
- Native workspace deletion confirms the name/count, switches workspace, and supports session recovery. Full relative-path, directory, symlink-target and file-content hash inventories are identical before deletion, after deletion and after recovery. File jobs remain present. Mocked tests separately cover running-job continuity and deleting the final workspace.
- Earlier browser fixture checks covered selection, clipboard transfers, keep-both collisions, new folder, rename and linked previews. The current overhaul was exercised in the actual packaged Electron app; a Chrome connection was unavailable, so no fresh browser-fixture interaction pass is claimed.
- Rendered evidence covers the desktop, the minimum 780×560 window, dark/light looks and both observed user browser sizes, 1456×935 and 1456×879.
- The renderer design detector reported one warning for the existing Markdown blockquote accent border, which belongs to displayed document content. It does not establish computed contrast or interaction correctness. A fresh independent interface reviewer returned `ship`, with no material fixes in fourteen validated native captures and sampled renderer source. That review did not independently execute runtime tests or audit the entire backend, registry and persistence implementation.

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
