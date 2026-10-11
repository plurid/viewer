# Verification

Verified on October 11, 2026, on Apple Silicon, macOS 15.1, Node 26.8.2 and pnpm 11.3.0. Native tests launch the packaged Electron binary with generated fixtures and a separate application profile. They do not use the user's normal Viewer profile, existing files or native Trash. Content hashes, directory paths and symlink targets protect the fixture inventories across layout changes and recovery.

## Automated checks

Strict TypeScript and ESLint checks and the production package build passed. The unit/service suite passed 122 tests across 17 files. Coverage includes filesystem operations and safe Undo; IPC and scoped resources; state/settings migration and concurrent updates; root-scoped preview matching; selection/session retention and path remapping; command targeting and ranking; index scopes, pagination, content grants and revocation; document extraction; action evidence, conflicts, cycles and durable recovery; structured provider adapters; and authenticated MCP transport. New regressions cover cursor/anchor range behavior, selection scope, read-only folder-size scans with overlap/symlinks/partial failures/cancellation/concurrency, and validated native application choices with literal captured paths.

Settings initialization and listing credential IDs are tested to avoid secure-storage calls. Provider encryption/decryption occurs on an explicit key save/use. Local agent authentication uses a private token file rather than Electron safe storage.

## Packaged application

The native harness exercises these paths through actual rendered controls:

- The complete packaged suite passed using hidden, GPU-backed offscreen Viewer and Settings windows. Read-only macOS activation probes confirmed that the QA process remained inactive at startup, after closing Settings and before quit. Reloads do not activate it. Tests use the real production renderer, sandboxed bridge and utility process; foreground timing is a separate opt-in workload.
- Shift-arrow range extension, reversal/shrinking and cursor-driven scrolling in all four views without camera rotation; blank file-space deselection and background menus without stale file targets. A 320-file fixture unmounts the selected virtual row before opening: the row is revealed, and the new preview has the parent's orientation and source-level vertical placement.
- An unknown selected folder reports an uncalculated size rather than 0 B. Calculate Size produces a measured 2.5 KB result through the packaged utility process, and Get Info reuses it. Actual macOS compatible-app discovery drives an autofocus searchable Open With dialog; empty search disables Open, retains its dimensions and closes without launching an app.
- Toolbar Rotate, command-palette Finish/Translate and Escape use one mode state. The regression reproduced a synchronous preference publication that reverted a mode update; coalescing preference synchronization after the engine transaction makes both the isolated spatial check and full suite pass.
- Separate previews for the same image under two roots, reuse within each root, and exact topology/identity restoration after reload. Space preview retains the selected file after header framing and Plurid culling. Existing deliberately oblique camera views and explicit copies remain distinct. Recovery and consolidation of legacy duplicate layouts are reversible.
- Independent root creation through the workspace plus, Command-N, commands and sidebar actions. Per-plane navigation, history and width; shared Favorites/order/folding; camera-projected sidebar resizing; narrow docked navigation; title dragging; minimap facing and context; default-on toolbar/minimap/viewcube; and persisted spatial settings. Plane backs remain visible.
- Command-K, contextual two-letter action search, promoted recent actions, captured targets, filename/subfolder finding and suppressed focus outlines. List, grid, columns and gallery share the browsing context.
- A separate modeless Settings window with searchable categories. Index folders, document-content grants, recipes, model profiles, agent access and shortcut editing are exposed there. Changes propagate to the main window; closing Settings drains queued edits before destroying the window.
- PDF text extraction and generated scanned-PDF OCR; a local EPUB book-name proposal with evidence; filename-first review, native text selection and full-path editing; explicit Apply and byte-identical Undo; granted EPUB content indexing and revocation while paused; saved search root planes; Quick Preview and Get Info from virtual results.
- The packaged stdio MCP client initializes, lists tools, reads an explicitly granted fixture, and rejects an outside path. It creates no provider-credential file and needs no Keychain access. Unit tests cover invalid tokens, scoped search, proposal ownership and revocation.
- GLB, glTF, OBJ/MTL, STL and FBX previews, malformed models and missing assets; independent model orbit; images, SVG, Markdown, EPUB, PDF, JSON, code, CSV, archives, audio and video. PDF selection/search, image zoom, media decoding, archive navigation and cleanup use representative synthetic inputs.
- Unsupported/malformed media shows an explicit error with Default App, Open With and Retry. Retry returns to a recoverable error state; valid WAV/WebM playback pauses and releases its source when closed.
- Copy and rename, collision review with cancelled replacement and safe Skip, Undo, IPC validation, blocked renderer network access, resource escape rejection and byte ranges. Workspace deletion changes application layout only, retains all fixture files/jobs, and supports recovery. Native application quit saves pending state.

The fixture HTTP bridge also verifies indexed EPUB lookup, read-only proposals and explicit document-content grants/revocation. Its sorted before/after metadata inventory remains identical.

The installed Plurid engine emits transient unregistered-route warnings while dynamic planes enter its tree. Tests check the settled and restored identities and record renderer exceptions separately.

Rendered evidence includes the desktop, contextual actions, search, action review, Settings categories, EPUB, dark/light appearance, the 780×560 minimum window and a 420px docked navigation stress case. The interface inherits the existing Plurid application design. An independent finishing review identified three changes: editable filenames before directory context, current modeless Settings documentation, and singular Apply copy. The affected native view was recaptured, documentation was synchronized, and the reviewer confirmed all three resolved with no visible regressions. Its ship disposition applies to those scored fixes. The detector pass remained degraded because its HTML parser dependencies were unavailable; computed contrast and live providers remain unverified.

That independent review belongs to the preceding pass. This reliability pass adds captures for file-level anchoring, measured folder information, native application choices and media recovery, inspected directly after the hidden packaged run.

## Performance evidence

[performance.md](performance.md) distinguishes historical before/after fixes from fresh measurements. Native probes count React commits and engine emissions, observe frame intervals and long tasks, and test menus with pointer jitter. SQLite benchmarks use disposable databases at 100,000 and 1,000,000 entries. These are single-machine samples, not a claim that all interaction, parsing or GPU costs are solved.

## Unverified or incomplete

Live paid-provider requests and metadata accuracy on a representative real book library have not been tested; provider contract tests use mock responses. Local model discovery does not prove that a server supports structured outputs. Agents currently share one local token/grant set and can create proposals, not apply them. Cloud providers require explicit configuration and content permission.

Real removable-drive disconnection, network filesystem failures, mixed filesystem/server behavior, large decoded model textures, long-session GPU memory and cold-start traces need additional evidence. Windows/Linux packaging, certificate signing, notarization and public distribution were not performed. Open With discovery/search/cancel and the launch adapter's literal arguments were tested; the native application picker and an actual selected/default external-player launch were not automated because they can show system UI or activate another application. Codec coverage is representative rather than comprehensive. Finder clipboard interoperability, tags, Trash browsing and additional preview families remain in the [roadmap](roadmap.md). Automated Trash tests use an owned disposable adapter.

## Reproduce

```sh
pnpm check
pnpm lint
pnpm format:check
pnpm test
pnpm package
pnpm test:desktop
```

Run `pnpm test:browser` for an interactive fixture server; stopping it removes only its generated workspace. `pnpm test:desktop` defaults to hidden windows without native activation. It supplies an isolated profile plus `VIEWER_RENDER_TEST=1` and `VIEWER_BACKGROUND_TEST=1`, which keep offscreen RAF rendering active. Normal launches retain visible windows, background throttling and the same isolation boundaries.

`VIEWER_TEST_SCENARIO=spatial pnpm test:desktop` runs the short mode regression in the background. `VIEWER_TEST_FOREGROUND=1 pnpm test:desktop` explicitly enables visible windows, PID activation and physical frame observations; request a foreground profiling session before using it. Ordinary offscreen runs do not overwrite the foreground performance artifact.

Development captures and review output live in the ignored `.impeccable/review/` directory. Durable interface guidance lives in [DESIGN.md](../DESIGN.md). Feature documentation is in [actions.md](actions.md), [search.md](search.md) and [architecture.md](architecture.md).
