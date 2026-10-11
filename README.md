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
pnpm test          # filesystem, transfers, resources, archives, commands, saved state
pnpm make          # locally signed macOS .app and ZIP
pnpm test:desktop  # verifies the packaged app in hidden background windows
```

The app is built under `packages/viewer-electron/app/out/Viewer-darwin-<architecture>/Viewer.app`; ZIPs are under `out/make/zip/darwin/<architecture>/`. Bundles use ad-hoc signing for local execution. Certificate signing, notarization and public distribution need a release configuration. Windows/Linux adapters and packaging are future work.

`pnpm test:browser` serves the same renderer and filesystem services with an isolated synthetic workspace at `http://127.0.0.1:4173/tests/browser.html`. Its native picker, clipboard and Trash use fixture adapters. Stop the server to clean up its files. The desktop check uses the real sandboxed preload, IPC and resource protocols in hidden, GPU-backed offscreen windows. It never activates the test app or shows Settings. The isolated macOS process stays out of the Dock, and the harness checks its native activation state. Normal launches retain visible windows and background throttling.

Physical frame-rate profiling is separate: `VIEWER_TEST_FOREGROUND=1 pnpm test:desktop` deliberately shows and activates the owned test app. Use it only when a foreground profiling session is explicitly wanted; hidden-window frame timings are not comparable. `VIEWER_TEST_SCENARIO=spatial pnpm test:desktop` runs the short toolbar/command/Escape regression in the background.

## File work

Browse local folders, external volumes and mounted network folders in virtualized list, grid, columns or gallery views. Folder double-click navigates within a plane. Option-double-click, **Open linked plane**, or a quick preview’s linked action opens a child plane. Opening an already open path reuses its preview within the originating root; another root gets an independent preview. **Open another plane** creates an intentional copy. The workspace **+**, Command-N, **New folder plane** in Commands, the native File menu and plane actions create an independent root explorer at the active folder or preview’s parent, with fresh navigation history and selection. A sidebar shortcut offers **Open in new root plane**. New planes face the camera by default; Settings also offers linked-pair framing or immediate docking. Space opens a quick preview, including after header navigation or framing. Command-Return switches between focused and spatial views. Each plane has one compact header with frame/dock actions; narrower headers keep those actions in their searchable menu. The search button toggles its row and clears the query on close.

Reopening preserves a usable saved camera view and brings a clipped active plane back into view. **Consolidate repeated previews** in Commands closes redundant image or other preview views from older layouts, retaining the active view and its placement. It preserves explicit copies, manually positioned views and branches; one **Undo arrangement** restores the closed views. This changes workspace layout only.

New linked previews start parallel to their parent beside the originating row or tile. A virtualized source is revealed before Plurid measures the link. Existing saved positions and rotations remain arrangement state.

All four views share a file cursor and range anchor. Shift-arrows extend or shrink a range without rotating Plurid; Command-Shift-click adds a range. Clicking blank file space clears selection. Keyboard movement reveals the cursor, and right-clicking blank space targets the folder without retaining a previous file selection.

Command-K searches commands, workspaces, open planes and places using the active folder, file selection or preview. Command-F finds filenames in that context, with optional subfolder search. Right-click opens an autofocus search with aliases such as `rn` (rename), `cp` (copy) and `nf` (new folder). The last two applicable actions appear first; history stores command IDs, never previous file targets. Breadcrumbs and folder filtering appear on demand.

The sidebar can be resized, hidden, and arranged by dragging sections or shortcuts. Sections fold; Recent stays chronological. Drag a folder into Favorites to add a shortcut. Rename shortcut and Hide location change only the sidebar. Equivalent movement commands are available in its searchable menus. Folder planes show this shared navigation by default; their header toggles it directly. Each has independent width/visibility and navigation scoped to that plane. Pointer resizing accounts for zoom and perspective, and narrow planes retain space for file content. Window navigation starts hidden and has its own topbar toggle. Settings can change the default for later new planes. Older layouts receive a metadata backup before navigation is enabled in existing folder planes once; subsequent choices persist.

Appearance and spatial controls live in a separate modeless Settings window (Command-comma), which keeps its size across categories and applies changes live. Browsing, Navigation, Previews, Space, Search, Actions, Models, Agents and Shortcuts are searchable. Plurid’s native bottom toolbar, minimap and viewcube are on by default and can each be hidden. Minimap activation faces the selected plane and makes it the active command context. Plane backs are always visible. Plane headers, title dragging and resize handles are independently configurable; transform origin starts hidden. Existing unversioned preferences receive the restored spatial aids once, and subsequent choices persist. Toolbar actions, commands and Escape share the engine’s transform mode. Focus outlines and halos are suppressed throughout the interface; caret, active command and selection feedback remain visible.

The workspace switcher provides New, Rename and Delete. Deletion confirms the workspace name and plane count, removes only saved layout, and can be undone during the session. Deleting the final workspace leaves an empty replacement. Files, folders and running jobs are unaffected.

File actions include new folder, rename, duplicate, copy/paste, cut/paste, Copy/Move to a chosen destination, and dragging between planes (Option-drag copies). Clipboard transfers currently work between Viewer planes. Collision decisions include skip, keep both and replace; replacement sends the existing item to native Trash after confirmation. A topbar operations control appears only for pending work, conflicts or unseen failures. Progress opens in a popover; **Recent file operations** remains available through Commands and the File menu.

**Open in Default App** and **Open With…** are available in searchable file actions, Commands, the native File menu and preview recovery. On macOS, Open With searches compatible installed apps, identifies the common default and offers a native application picker. Choices use opaque IDs; opening never changes system file associations. Aliases are `od` and `ow`.

Selecting a folder shows **Size not calculated**. **Calculate Size** (`cs`) measures logical contents in the utility process, with progress and cancellation. It includes hidden files, prunes overlapping selected paths and never follows symlinks. Measured empty folders can show 0 B; unreadable items produce an explicit partial/unavailable result. The footer and Get Info share a bounded cache with calculation timestamps and invalidation after observed changes. Disk allocation, hard-link deduplication and continuous monitoring of every nested folder are separate future capabilities.

Command-Z undoes eligible rename/move jobs; identity and content checks protect changed destinations. Copies, duplicates, cross-volume moves and Trash have no application undo. Arrangement history is separate: use Commands or Command-Option-Z / Command-Option-Shift-Z. Native Trash restoration remains available through Finder. When editing a text field, standard Edit commands operate on its text.

| Command                          | macOS shortcut    |
| -------------------------------- | ----------------- |
| New root folder plane            | ⌘N                |
| Open folder / new folder         | ⌘⇧O / ⌘⇧N         |
| Open selection / rename          | ⌘O / Return       |
| Copy / cut / paste / select all  | ⌘C / ⌘X / ⌘V / ⌘A |
| Quick preview / file information | Space / ⌘I        |
| Commands / Settings              | ⌘K / ⌘,           |
| Find file / go to folder         | ⌘F / ⌘L           |
| Show or hide window navigation   | ⌥⌘S               |
| Parent / back / forward          | ⌘↑ / ⌥← / ⌥→      |
| Hidden files / duplicate / Trash | ⌘⇧. / ⌘D / ⌘⌫     |
| Frame all / dock or reveal       | ⌘0 / ⌘Return      |

## Previews

Indexed search covers filenames and metadata in configured locations, with optional folder-granted document text. Filters include `ext:pdf,epub`, `kind:folder`, `path:Books`, `size:>10mb` and `modified:>2025-01-01`. Saved searches open as virtual root planes with file actions and Space preview. See [search configuration and limits](docs/search.md).

Right-click or Command-K provides **Batch rename**, **Rename as book**, **Rename with model**, **Organize** and **Summarize**. Review proposed changes, evidence and conflicts before Apply; no proposal changes a file automatically. Recipes preserve your naming template and can have shortcuts. OpenAI, Anthropic and compatible local providers are optional. Protected keys, explicit text-sharing permission, guarded Undo and proposal-only agent access are described in [actions and agents](docs/actions.md).

| Module      | Initial support                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| 3D          | GLB/glTF, OBJ with local MTL, STL, FBX; orbit, pan, zoom, framing, wireframe, animations, statistics |
| Images      | PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG; fit, zoom and pan                                         |
| Audio/video | Chromium-supported codecs with native seeking and playback                                           |
| PDF         | Worker rendering, pages, zoom, selectable text and document search                                   |
| EPUB        | Local publication metadata, chapter navigation, safe text reading and search                         |
| Text/data   | Safe Markdown, code/text, expandable JSON and virtualized CSV/TSV tables                             |
| Archives    | ZIP, TAR, TAR.GZ/TGZ indexing and entry previews without extraction                                  |

Formats outside this set receive file information and an **Open in default app** action. Office, additional ebook formats, CAD/USD, HEIC/TIFF and creative formats are the next extension path. A registered extension does not guarantee a file’s codec, compression or external asset requirements: failures stay visible and recoverable.

Preview limits are explicit: text reads 4 MiB; model source files 256 MiB; archive entries 32 MiB; TAR previews 128 MiB; gzip archive inputs 64 MiB; archive lists 20,000 entries. ZIP64, encrypted ZIPs, nested archive expansion, remote model assets and Draco/KTX2 model decoding are not included yet. Model companions must resolve inside the model’s local directory. PDF search covers the first 1,000 pages. Search returns up to 20,000 matches and visits up to 500,000 entries. Saved state allows 30 workspaces with 200 planes each.

Transfers preserve contents, symlinks, POSIX modes and modification times. Finder tags, extended attributes, resource forks and ACLs are not yet preserved by the portable copying backend; use Finder for copies requiring that metadata. Cross-volume moves of macOS items carrying extended attributes or ACLs stop and retain the original. Same-volume moves preserve the original filesystem object. Mounted drives use the same service, so their permissions, availability and performance still apply.

## Extend the codebase

The [architecture guide](docs/architecture.md) explains boundaries and Plurid integration. The [preview extension guide](docs/preview-modules.md) shows how to add a typed, lazy viewer without changing the explorer or engine. [PRODUCT.md](PRODUCT.md) records the agreed scope; [DESIGN.md](DESIGN.md) records the implemented visual system.

The [verification report](docs/verification.md) records executed checks and the remaining platform and format limits. The [performance analysis](docs/performance.md) records native measurements, implemented fixes and remaining workload limits across the stack.

The renderer is sandboxed and isolated, with no Node access or arbitrary IPC. Previews receive revocable local resources, bounded reads and range streams. Downloaded files and Markdown cannot execute scripts, open remote pages or fetch network assets inside the application.

Workspaces use a fresh `viewer-state-v1.json` in Electron’s Viewer user-data directory (normally `~/Library/Application Support/Viewer` on macOS). Writes are atomic; unreadable state is retained as a backup. `VIEWER_DATA_DIRECTORY=/absolute/path` selects an isolated profile. Legacy `~/.viewer` data is not imported or modified.

Licensed under [DEL](LICENSE). Part of [Plurid](https://plurid.com).
