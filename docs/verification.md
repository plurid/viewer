# Verification

Implementation checks ran on Apple Silicon, macOS 15.1, Node 26.8.2 and pnpm 11.3.0. The interface overhaul was verified on October 11, 2026. File-operation tests use disposable synthetic files; the native harness has an isolated application profile. Existing user files, folders, legacy Viewer data and the user's normal application profile are not modified by verification.

## Verified

- Strict TypeScript checks cover the desktop process, sandboxed preload, renderer, tests and build tooling. ESLint and Prettier checks pass.
- 67 automated tests across ten files exercise real filesystem metadata and paths, transfers, collisions, cancellation, partial errors, source/destination races, safe undo, cross-volume and unsupported-hard-link fallback, macOS metadata protection, scoped resources, range streams, archive integrity, streamed search, shared watchers, atomic state recovery, workspace reconciliation and ambiguous source-code MIME detection. Mocked-service tests cover command availability, aliases, applicable recency without duplicate rows, captured and stale targets, clipboard refresh, text-edit routing, layout-only workspace recovery, running-job continuity, last-workspace replacement and independent optional preference fallback. Added regressions cover exact/unique/ambiguous identity selection, normalized current-workspace plane reuse, late matches in a 10,000-entry finder with a 150-result bound, source-root boundaries/order, one-time UI migration and independent pane-sidebar persistence, sequenced compact progress with stale/gap resynchronization, and whole-job throttling without loss of completed inventories. Preview-recovery tests protect explicit copies, manually positioned views, branches, distinct parents and shared host records; optional copy intent survives persistence without invalid metadata discarding the layout.
- The actual locally signed macOS bundle starts with an isolated renderer and fixed preload bridge. Packaged-app checks reject invalid IPC, remote network requests and escaping resource paths, and exercise byte ranges and sandbox response headers.
- Synthetic GLB, glTF, OBJ with local MTL, STL and FBX render; malformed models and missing companions recover visibly. Orbiting a model changes its rendered image without moving its file planes.
- Synthetic images, Markdown, PDF, JSON, CSV, ZIP, TAR, TAR.GZ, audio and video open in their modules. PDF text selection/search, archive entry navigation, image zoom, media decoding/playback and cleanup are exercised. These checks cover representative files, not every codec or format variant.
- List, grid, columns and gallery operate on the same folder. Packaged copy/rename jobs and rename undo succeed. Linked branch close, arrangement undo/redo, workspace switching, reload restoration and pending-state save on native application quit are checked.
- Native keyboard Command-K opens focused action search. Two-letter `rn` opens Rename for the clicked target; the next target receives the promoted recent action exactly once. Header actions retain selection. Command-F focuses filename search and finds a nested PDF. Preview wireframe commands work through the palette while primary controls occupy the plane header.
- Settings stays 500×540px on Appearance, Sidebar and Space. Native bottom toolbar, minimap and viewcube start visible, hide independently, and preserve hidden choices through saved-state reload. Plane headers, resize handles, title dragging and computed backface visibility respond to their settings. The first title press moves an unselected plane while the camera remains unchanged; toolbar, commands and Escape share the native transform mode. Search toggles closed/open, clears its query, restores explorer focus and has no computed focus outline. Context search has neither a focus outline nor halo.
- The shared sidebar can appear within a folder plane; its shortcut navigates that plane, and keyboard width changes leave the window sidebar width unchanged. Sidebar section/shortcut drag, folder-to-Favorites drop, fold, alias rename, keyboard resize and hide/show change layout without starting any filesystem job. Full fixture inventories remain identical after plane-control and navigation changes. Those preferences survive ordinary saved-state persistence.
- Linked previews open facing the camera. Rapid repeated file activation retains the same two host planes and exact engine tree; Open another plane creates a third view, which closes independently. Existing link and position records survive normal reuse.
- A generated saved-state fixture reproduces the reported three repeated previews and clipped oblique camera after reopening. This regression failed against the previous bundle. Three fresh restores now recover the offscreen active image; repeated native and rapid synthetic activation preserves exact engine identities, including culled planes. Explicit consolidation leaves the active placement unchanged, one arrangement undo restores all previews, and redo consolidates them again. Usable deliberately oblique viewpoints remain exact across reopening. Explicit new preview copies remain separate after reload. Full fixture inventories stay identical throughout recovery.
- A real fixture copy conflict shows the operations control and opens an anchored popover without reducing workspace width. Replace opens a protected confirmation, which the test cancels; Skip completes safely and removes the control. Recent history remains explicitly accessible.
- Native workspace deletion confirms the name/count, switches workspace, and supports session recovery. Full relative-path, directory, symlink-target and file-content hash inventories are identical before deletion, after deletion and after recovery. File jobs remain present. Mocked tests separately cover running-job continuity and deleting the final workspace.
- Earlier browser fixture checks covered selection, clipboard transfers, keep-both collisions, new folder, rename and linked previews. The current overhaul was exercised in the actual packaged Electron app; a Chrome connection was unavailable, so no fresh browser-fixture interaction pass is claimed.
- Current rendered evidence covers the desktop, fixed Settings, contextual actions, the minimum 780×560 window, docked views and dark/light looks. Earlier captures also covered both observed user browser sizes, 1456×935 and 1456×879. The earlier independent interface review and design-detector results applied to the preceding overhaul; this pass uses refreshed native captures and direct source/runtime checks, without claiming a new independent reviewer.
- Native performance probes verify 60px menu wheel steps under pointer jitter with no hover-driven autoscroll, no prevented wheel events and no spatial movement. Selecting all 10,000 generated files used 6.81ms script work with no observed long task, compared with roughly 264ms previously. A generated 1,000-file copy sent three full lifecycle snapshots and 70 compact progress updates, retained every source, and produced byte-identical destinations. [performance.md](performance.md) records measurements, methods and remaining parser/thumbnail/GPU/persistence limits.

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

Use `pnpm test:browser` for interactive checks against generated files. Stop it to remove its temporary workspace. The desktop check launches only its own packaged binary, profile and debugging endpoint. It activates that specific process, waits for a new document after reload, and observes actual paints before checking camera stability. `VIEWER_RENDER_TEST=1` disables background throttling for that test window; normal application launches retain background throttling and the same isolation boundaries.

The interface review and its evidence live in `.impeccable/review/` during development. That directory is ignored by Git and is not part of the application bundle. Durable interface guidance is recorded in [DESIGN.md](../DESIGN.md).
