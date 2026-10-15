# The 2021 Viewer (old_app)

Before the 2026 modernization, Viewer was a webpack-built Electron app with React, Redux Toolkit and `@plurid/plurid-react` 0.0.0-34. Its tracked source is in git at commit `bd198da` under `packages/viewer-electron/old_app` (recover with `git show bd198da:<path>` or `git checkout bd198da -- packages/viewer-electron/old_app`). The working copy was removed on 2026-10-15.

This page records what that app did, how it compares with the current app, and which of its ideas are not yet carried over. The sample files in its `examples/` folder were never committed and were removed with it; see [Sample files](#sample-files).

## Architecture

- **Main process** (`source/index.ts`): one 1000×800 window with `hiddenInset` title bar, `nodeIntegration: true`, `contextIsolation: false` and `@electron/remote`. There were no IPC handlers; the renderer read the filesystem directly with `fs` and chokidar. Main sent `FILES_OPEN` (from `open-file` and the Open menu) and Touch Bar events.
- **Renderer**: a Redux store with `owner`, `views`, `product` and plurid-ui-state `notifications`/`sitting`/`themes`. Nothing was persisted: an nedb store at `~/.viewer/datastore.general` was opened but never read or written.
- **Plurid**: `<PluridApplication>` per space, with routes `/images/:id`, `/videos/:id`, `/sounds/:id`, `/texts/:id`, `/files/:id`, `/stream/:id` and `/unknown/:id`. Plane controls were hidden; each opened file or folder became a plane.
- **Vendored libraries**: pdf.js 2.0.943 (full prebuilt viewer, dark-tinted CSS) and DjVu.js 0.5.1 with its 0.5.4 viewer.
- **Packaging**: electron-builder with macOS DMG (hardened runtime, `allow-jit` and `allow-unsigned-executable-memory`), Windows NSIS, Linux AppImage and deb, and file associations for pdf, pluridoc, bmp, gif, ico, jpeg/jpg, png, svg, tif/tiff, webp, eimg, mp4, mkv and mov (all `role: Editor`).

## Feature comparison

| 2021 feature | Current app |
|---|---|
| Spaces as tabs (add, switch, remove; rename never saved) | Workspaces with new, rename, delete, undo delete and switching |
| Files plane: list, blocks, columns (empty), gallery (placeholder) | List, grid, columns and gallery views (⌘1–⌘4) |
| Back/forward history, editable path field | Back/forward, Go to Folder (⌘L, ⇧⌘G) |
| Favorites and Recent sidebar (Recent never filled) | Locations, Favorites and Recent, reorderable |
| Search field (stored, never filtered) | Folder filter, indexed search, content search, Spotlight first pass |
| New Folder, New File | New Folder, New Folder with Selection; **no New File** |
| Delete: permanent `fs.rm`, no confirmation, stopped after the first file | Move to Trash only, with review, Undo and Redo |
| Rename (stub) | Rename and batch rename with review |
| Folder watching (stuck on the first folder) | Watched folders, per plane |
| Context menu (list view only) | Context menus everywhere, from the command registry |
| Extension-badge icons | File icons and thumbnails |
| Per-file header: copy path, info (path, size), view location, close | Copy path, Get Info, Back to parent plane, Reveal in Finder, close |
| Images: bmp, gif, ico, jpeg, png, svg, webp through EnhancedImage | Image preview with zoom and pan (also avif); **no TIFF, `.eimg` or "enhanced" image features** |
| TIFF through UTIF | **Missing** |
| Video through EnhancedVideo for many extensions (only Chromium codecs played) | Media preview for mp4, mov, m4v, webm, ogv and other Chromium-playable types |
| Audio: Sound plane had no player | Audio preview (mp3, wav, ogg, flac, m4a, aac, opus) |
| PDF in the pdf.js viewer (thumbnails, outline, print, rotate, presentation mode) | PDF preview with search, fit and remembered page; **no thumbnails, outline or print** |
| EPUB through epub.js (paginated, white theme) | EPUB preview with contents, chapters and font size |
| DjVu through DjVu.js | **Missing** |
| md, txt, docx, xlsx were sent to pdf.js and failed | Text, Markdown, code, JSON, CSV and Office previews |
| LAN streaming: an Express server on 0.0.0.0:9090 with HTTP Range, started at launch, no authentication | **Not carried over**, on purpose: an unauthenticated server on every interface is unsafe |
| "Global stream" URL (`viewer.plurid.com/identonym/…`) | Never implemented |
| Touch Bar rotate/scale/translate with a slider (disabled) | Spatial tools in Commands; **no Touch Bar** |
| Toast on every file open | Errors only |
| Menus: Help (Report an Issue, website), View zoom and reload roles, Speech | **No Help menu, zoom roles or Speech** |
| Settings: Data, Themes, Space, Toolbars and Shortcuts sections, all empty | Full Settings with search and JSONC configuration |
| English and Romanian toolbar labels | English only |
| Account, logout and cloud storage (placeholders) | Not applicable |
| File associations, DMG, Windows and Linux packages | macOS ZIP and Mac App Store builds; **no document types declared** |

## Ideas not yet carried over

Ordered by likely value. None of these are planned yet.

1. **TIFF preview.** macOS decodes TIFF natively, so a desktop-side conversion to PNG for the image preview would avoid a decoder dependency.
2. **Document types** (`CFBundleDocumentTypes`, role Viewer) so Viewer appears in Finder's Open With. The app already handles `open-file`.
3. **New File** in folder menus, created exclusively, never replacing an existing name.
4. **Help menu** with an issue link and the product page.
5. **PDF thumbnails, outline and printing.**
6. **DjVu** through a maintained decoder, in a worker, with the same resource scoping as other previews.
7. **Enhanced image formats** (`.eimg` with text overlays; planned `evid`, `eaud`, `pluridoc` converters). Their sources live in `technologies/tools/enhanced-view`.
8. **Touch Bar controls** for spatial tools. The 2021 icons are in `source/assets/` (rotate, scale, translate, up-down, left-right, with inverted variants).
9. **Interface translation.**
10. **Local streaming**, only if redesigned: loopback or explicit opt-in, a per-file random token, Range support and an obvious stop control.

## Unfinished and broken parts

These were never working and need no porting:

- Unknown files never rendered: the route table had no `unknown` key.
- Text and Office formats were routed to pdf.js.
- Delete was permanent and stopped after the first file.
- The folder watcher stayed on the first folder.
- Keyboard handling and the context menu worked only in list view.
- Stub menu items: New Space, Restore Space, Close Space, and a custom Quit.

## Sample files

`examples/` (11 MB) was git-ignored and was removed on 2026-10-15. It held:

- `images/`:
  - `example.tiff` (HP sample from 1998), `example.bmp`, `example.ico`, `example.svg`, `example.webp`
  - `example.gif` and `example.jpg`, both actually PNG data
  - two `.eimg` files with text overlays
  - `image.png`, a screenshot that shows personal folder and account names in a Finder sidebar
- `texts/`: `example.pdf`, and two multi-page `.djvu` files.
- `videos/video.mov`: a 2018 screen recording whose metadata names the Mac model and macOS build.

If TIFF, DjVu or `.eimg` support is implemented, use new samples with known licenses as test fixtures.

## Size

639 files, 26 MB:

| Folder | Size | What it holds |
|---|---|---|
| `libraries/` | 13 MB | Vendored pdf.js and DjVu.js |
| `examples/` | 11 MB | Sample files (see above) |
| `source/` | 1.1 MB | About 15,700 lines of TypeScript |
| `pnpm-lock.yaml` | 284 KB | Lockfile |

The app icons in `assets/` are byte-identical to `packages/viewer-electron/app/assets/`.

No credentials or tokens were found.
