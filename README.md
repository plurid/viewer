# Viewer

A macOS-first file manager in the Plurid family. Folders and read-only previews live in linked spatial planes; dock a plane for focused browsing. The active application is [`packages/viewer-electron/app`](packages/viewer-electron/app). `old_app` remains an archival reference.

## Run and build

Use Node ≥22.13 and pnpm 11. Verified with Node 26.8.2 and pnpm 11.3.0 on Apple Silicon macOS.

```sh
pnpm install
pnpm start
```

```sh
pnpm check         # strict types across main, preload, renderer, tests and tooling
pnpm lint
pnpm format:check
pnpm test          # filesystem, transfers, resources, archives, search, workspaces
pnpm make          # locally signed macOS .app and ZIP
pnpm test:desktop  # exercises the actual packaged app with synthetic files
```

The app is built under `packages/viewer-electron/app/out/Viewer-darwin-<architecture>/Viewer.app`; ZIPs are under `out/make/zip/darwin/<architecture>/`. Bundles use ad-hoc signing for local execution. Certificate signing, notarization and public distribution need a release configuration. Windows/Linux adapters and packaging are future work.

`pnpm test:browser` serves the same renderer and filesystem services with an isolated synthetic workspace at `http://127.0.0.1:4173/tests/browser.html`. Its native picker, clipboard and Trash use fixture adapters. Stop the server to clean up its files. The desktop check uses the real sandboxed preload, IPC and resource protocols; debugging flags and `VIEWER_RENDER_TEST=1` keep its owned test window rendering while occluded. Normal launches retain background throttling.

## File work

Browse local folders, external volumes and mounted network folders in virtualized list, grid, columns or gallery views. Folder double-click navigates within a plane. Option-double-click, **Open linked plane**, or a quick preview’s linked action opens a child plane. Space opens a quick preview. Plane tabs focus an existing plane; the dock button or Command-Return switches between focused and spatial views.

Breadcrumbs, history, hidden files, sorting, favorites, recents and file information accompany browsing. Filter the current folder or turn on **Subfolders** for cancellable streamed filename search. File actions include new folder, rename, duplicate, copy/paste, cut/paste, and dragging between planes (Option-drag copies). Clipboard transfers currently work between Viewer planes. Collision decisions include skip, keep both and replace; replacement sends the existing item to native Trash. The operations panel shows progress, cancellation and partial errors.

Command-Z undoes eligible rename/move jobs; identity and content checks protect changed destinations. Copies, duplicates, cross-volume moves and Trash have no application undo. Arrangement history is separate: use its toolbar arrows or Command-Option-Z / Command-Option-Shift-Z. Native Trash restoration remains available through Finder.

| Command | macOS shortcut |
| --- | --- |
| Open folder / new folder | ⌘⇧O / ⌘⇧N |
| Open selection / rename | ⌘O / Return |
| Copy / cut / paste / select all | ⌘C / ⌘X / ⌘V / ⌘A |
| Quick preview / file information | Space / ⌘I |
| Search / go to folder | ⌘F / ⌘L |
| Parent / back / forward | ⌘↑ / ⌘← / ⌘→ |
| Hidden files / duplicate / Trash | ⌘⇧. / ⌘D / ⌘⌫ |
| Frame all / dock or reveal | ⌘0 / ⌘Return |

## Previews

| Module | Initial support |
| --- | --- |
| 3D | GLB/glTF, OBJ with local MTL, STL, FBX; orbit, pan, zoom, framing, wireframe, animations, statistics |
| Images | PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG; fit, zoom and pan |
| Audio/video | Chromium-supported codecs with native seeking and playback |
| PDF | Worker rendering, pages, zoom, selectable text and document search |
| Text/data | Safe Markdown, code/text, expandable JSON and virtualized CSV/TSV tables |
| Archives | ZIP, TAR, TAR.GZ/TGZ indexing and entry previews without extraction |

Formats outside this set receive file information and an **Open in default app** action. Office, ebooks, CAD/USD, HEIC/TIFF and creative formats are the next extension path. A registered extension does not guarantee a file’s codec, compression or external asset requirements: failures stay visible and recoverable.

Preview limits are explicit: text reads 4 MiB; model source files 256 MiB; archive entries 32 MiB; TAR previews 128 MiB; gzip archive inputs 64 MiB; archive lists 20,000 entries. ZIP64, encrypted ZIPs, nested archive expansion, remote model assets and Draco/KTX2 model decoding are not included yet. Model companions must resolve inside the model’s local directory. PDF search covers the first 1,000 pages. Search returns up to 20,000 matches and visits up to 500,000 entries. Saved state allows 30 workspaces with 200 planes each.

Transfers preserve contents, symlinks, POSIX modes and modification times. Finder tags, extended attributes, resource forks and ACLs are not yet preserved by the portable copying backend; use Finder for copies requiring that metadata. Cross-volume moves of macOS items carrying extended attributes or ACLs stop and retain the original. Same-volume moves preserve the original filesystem object. Mounted drives use the same service, so their permissions, availability and performance still apply.

## Extend the codebase

The [architecture guide](docs/architecture.md) explains boundaries and Plurid integration. The [preview extension guide](docs/preview-modules.md) shows how to add a typed, lazy viewer without changing the explorer or engine. [PRODUCT.md](PRODUCT.md) records the agreed scope; [DESIGN.md](DESIGN.md) records the implemented visual system.

The [verification report](docs/verification.md) records executed checks and the remaining platform and format limits.

The renderer is sandboxed and isolated, with no Node access or arbitrary IPC. Previews receive revocable local resources, bounded reads and range streams. Downloaded files and Markdown cannot execute scripts, open remote pages or fetch network assets inside the application.

Workspaces use a fresh `viewer-state-v1.json` in Electron’s Viewer user-data directory (normally `~/Library/Application Support/Viewer` on macOS). Writes are atomic; unreadable state is retained as a backup. `VIEWER_DATA_DIRECTORY=/absolute/path` selects an isolated profile. Legacy `~/.viewer` data is not imported or modified.

Licensed under [DEL](LICENSE). Part of [Plurid](https://plurid.com).
