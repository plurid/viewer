# Viewer

A macOS-first file manager in the Plurid family. Folders and read-only previews live in linked spatial planes; dock a plane for focused browsing. The active application is [`packages/viewer-electron/app`](packages/viewer-electron/app). The 2021 predecessor is summarized in [docs/old-app.md](docs/old-app.md).

## Run and build

Use Node ≥22.13 and pnpm 11. Verified with Node 26.8.2 and pnpm 11.3.0 on Apple Silicon macOS.

```sh
pnpm install
pnpm start
```

The October 18 Plurid release is published. Viewer pins data `0.0.0-27` and React `0.0.0-41`,
with the coordinated dependency graph in the registry lockfile. `pnpm plurid:update` checks all
13 release versions before resolving changes in a temporary workspace and preserves the current
installation. Fresh registry installation, distribution byte checks, tests and production bundles
pass; packaged/native release qualification remains pending.

For local Plurid development only, install the sibling workspace's dependencies and run
`pnpm plurid:sync`. It builds with cleanup disabled and copies generated distributions into
Viewer's installation. Qualification rejects this overlay. After updating and committing the
registry pins, qualify from a fresh checkout and a fresh pnpm store, then run `pnpm plurid:check`.
That check verifies the complete installed Plurid graph, rejects local links and source-sync stamps,
and compares every distribution file to its registry tarball. See the
[Plurid release handoff](docs/plurid-release.md) for the exact sequence.

```sh
pnpm check         # strict types across main, preload, renderer, tests and tooling
pnpm lint
pnpm format:check
pnpm test          # filesystem, transfers, resources, archives, commands, saved state
pnpm make          # locally signed macOS .app and ZIP
pnpm test:desktop  # verifies the packaged app in hidden background windows
```

The app is built under `packages/viewer-electron/app/out/Viewer-darwin-<architecture>/Viewer.app`; ZIPs are under `out/make/zip/darwin/<architecture>/`. `pnpm start`, `pnpm package` and `pnpm make` replace earlier outputs: Electron Forge's Vite plugin removes `.vite/` before it builds, and packaging replaces `out/Viewer-darwin-<architecture>/`. Under this repository's [removal policy](AGENTS.md), an agent runs them only with your approval; `tools/build-preserving.ts` builds without removing earlier outputs. Bundles use ad-hoc signing for local execution. Certificate signing, notarization and public distribution need a release configuration. Windows/Linux adapters and packaging are future work.

To install a local build, extract the ZIP and drag `Viewer.app` into Applications. The native Swift helpers inherit the bundled Electron runtime's minimum macOS version (currently 13.0), rather than the build machine's SDK default.

The main window remembers its native size and position across closing and reopening, including Rectangle's full-width/full-height sizing. Restoration keeps the frame visible when a display moves, changes resolution or disconnects. Window placement is separate from the saved Plurid camera/layout and the Settings window's size.

The [Mac App Store build guide](docs/mac-app-store-build.md) describes the separate `mas:preflight`, `mas:dev` and `mas:package` commands for Propal Invest SRL (49W9L8Z9J5). Store builds require matching macOS profiles and Keychain identities. Their file-access layer saves native picker bookmarks privately and offers folder-access recovery; their readers run in main-process threads, with PDF OCR passed over stdin. The local installer retains JIT-only ad-hoc signing. The [readiness assessment](docs/mac-app-store-readiness.md) tracks the signed sandbox, privacy and release gates that remain.

`pnpm test:browser` serves the same renderer and filesystem services with an isolated synthetic workspace at `http://127.0.0.1:4173/tests/browser.html`. Its native picker, clipboard and Trash use fixture adapters. Stopping the server keeps its generated fixtures and prints their folder; move it to the Trash when no longer needed. The desktop check uses the real sandboxed preload, IPC and resource protocols in hidden, GPU-backed offscreen windows. It never activates the test app or shows Settings. The isolated macOS process stays out of the Dock, and the harness checks its native activation state. Normal launches retain visible windows and background throttling.

Physical frame-rate profiling is separate: `VIEWER_TEST_FOREGROUND=1 pnpm test:desktop` deliberately shows and activates the owned test app. Use it only when a foreground profiling session is explicitly wanted; hidden-window frame timings are not comparable. `VIEWER_TEST_SCENARIO=spatial pnpm test:desktop` runs the short toolbar/command/Escape regression in the background.

## File work

Hovering a spatial plane keeps wheel/trackpad navigation in the workspace. Click its content
or header to scroll inside that plane; a subtle header tint marks it. Click the background or
press Escape to release it. Docked planes scroll immediately. Pinch, navigation modifiers and
explicit navigation modes still move the workspace. Space/Quick Preview keeps its own scrolling.

Browse local folders, external volumes and mounted network folders in virtualized list, grid, columns, gallery or Map views. Folder double-click navigates within a plane. Option-double-click, **Open linked plane**, or a quick preview’s linked action opens a child plane. Opening an already open path reuses its preview within the originating root; another root gets an independent preview. **Open in another plane** creates an independent root, without a parent link. The workspace **+**, Command-N, **New folder plane** in Commands, the native File menu and plane actions create an independent root explorer with fresh navigation history and selection. Settings → Browsing chooses its starting folder: current folder, Home, Desktop, Documents, Downloads, Pictures, Movies, Music or a custom folder. The default follows the active folder, terminal working folder or preview’s parent, falling back to Home. The empty workspace offers **New folder plane** directly, alongside **Open folder…**, with its own separate starting-folder preference in Browsing. It defaults to Home and supports the standard locations or a custom folder; the populated-workspace preference remains Current folder by default. A sidebar shortcut offers **Open in new root plane** at that shortcut's folder. New planes face the camera by default; Settings also offers linked-pair framing or immediate docking. Space opens a quick preview, including after header navigation or framing. Command-Down/Command-O enters a selected folder and Command-Up returns to its parent; Command-1–5 changes that folder’s view. Folder views, sorts and column widths follow the path across roots; selection/history remain independent. Browser-column edges resize with drag or keys and fit names on double-click. Command-Return switches between focused and spatial views. Each plane has one compact header with frame/dock actions; narrower headers keep those actions in their searchable menu. The search button toggles its row and clears the query on close.

Reopening preserves a usable saved camera view and brings a clipped active plane back into view. **Consolidate repeated previews** in Commands closes redundant image or other preview views from older layouts, retaining the active view and its placement. It preserves explicit copies, manually positioned views and branches; one **Undo arrangement** restores the closed views. This changes workspace layout only.

New linked previews use Plurid's reading layout, opening at 90.1° relative to their parent beside the originating row or tile. A virtualized source is revealed before Plurid measures the link. Existing saved positions and rotations remain arrangement state. The command palette keeps its top edge slightly above the window center; results grow downward and scroll within the available height.

All five views share a file cursor and range anchor. Shift-arrows extend or shrink a range without rotating Plurid; Command-Shift-click adds a range. Clicking blank file space clears selection. Keyboard movement reveals the cursor, and right-clicking blank space targets the folder without retaining a previous file selection. In columns, Up/Down reveals the selected folder, Right enters it and Left returns to its parent. Paste uses the active column's folder. Drag files or folders onto a folder to move them there; hold Option to copy. Missing folder branches close and clear their stale selection when the listing refreshes.

Settings → Space → Plane toolbar controls which header icons appear. The view menu toggles open and closed from the same button. Settings → Browsing → List columns, or right-clicking the list header, controls Date modified, Date created, Kind, Extension and Size. Drag a divider to resize a column; double-click resets it. Long filenames have full-name tooltips and optional wrapping. The rename dialog's **Rename actions…** selector opens applicable saved recipes with the original file target, then presents a proposal for review before any changes.

Command-K searches commands, workspaces, open planes and places using the active folder, file selection or preview. Command-F finds filenames in that context, with optional subfolder search. Right-click keeps common file actions visible and groups other commands into View, Folder, Terminal, Actions and other contextual submenus. View separates grouping and column controls. Its autofocus search reaches every submenu, with aliases such as `rn` (rename), `cp` (copy) and `nf` (new folder). The last two applicable actions also appear in Recent; their normal menu placement remains available. History stores command IDs, never previous file targets. Choose **Change workspace…** (`cw`) for a workspace-only picker, or type a workspace name directly. Breadcrumbs and folder filtering appear on demand.

The sidebar can be resized, hidden, and arranged by dragging sections or shortcuts. Sections fold; Recent stays chronological. Drag a folder into Favorites to add a shortcut. Rename shortcut and Hide location change only the sidebar. Equivalent movement commands are available in its searchable menus. Folder planes show this shared navigation by default; their header toggles it directly. Each has independent width/visibility and navigation scoped to that plane. Pointer resizing accounts for zoom and perspective, and narrow planes retain space for file content. Window navigation starts hidden and has its own topbar toggle. Settings can change the default for later new planes. Older layouts receive a metadata backup before navigation is enabled in existing folder planes once; subsequent choices persist.

Appearance and spatial controls live in a separate modeless Settings window (Command-comma), which keeps its size across categories and applies changes live. Browsing, Navigation, Previews, Space, Search, Actions, Models, Agents, Shortcuts, Terminals, Configuration, Permissions and Privacy are searchable. Plurid’s native bottom toolbar, minimap and viewcube are on by default and can each be hidden. The toolbar's More menu leaves out plurid's Global drawer: Appearance in Settings sets the look, and the drawer's look, theme and language picks would not have been kept. Minimap activation faces the selected plane and makes it the active command context. Plane backs are always visible. Plane headers, title dragging and resize handles are independently configurable; transform origin starts hidden. Existing unversioned preferences receive the restored spatial aids once, and subsequent choices persist. Toolbar actions, commands and Escape share the engine’s transform mode. Keyboard-focused controls use a raised surface and accent text; checkbox labels receive the same feedback. Focus rings remain off, while text editors retain their caret and whole-plane focus retains its existing treatment.

The workspace switcher provides New, Rename and Delete. Deletion confirms the workspace name and plane count, removes only saved layout, and can be undone during the session. Deleting the final workspace leaves an empty replacement. Files, folders and running jobs are unaffected.

File actions include new folder, rename, duplicate, copy/paste, cut/paste, Copy/Move to a chosen destination, and dragging between planes (Option-drag copies). macOS native file-URL clipboard and drag adapters support multiple files/folders with bounded session permissions; genuine Finder exchange remains a signed-candidate acceptance check. Unavailable copied files do not block unrelated navigation, while Paste reports their access failure. Collision decisions include skip, keep both and replace; replacement sends the existing item to native Trash after confirmation. ZIP creation and ZIP/TAR/TAR.GZ extraction use the same progress, cancellation and collision jobs. A topbar operations control appears only for pending work, conflicts or unseen failures. Progress opens in a popover; **Recent file operations** remains available through Commands and the File menu.

The Volumes dialog lists native mount inventory, capacity and read-only state without requiring blanket `/Volumes` access. Opening a mount can request its native folder grant; cancellation retains the dialog. Eject drains affected work first. Settings → Permissions lists saved picker and temporary clipboard/drag permissions, with repair and revocation. Real eject/reconnect and cloud-provider coordination remain release gates.

**Open in Default App** and **Open With…** are available in searchable file actions, Commands, the native File menu and preview recovery. On macOS, Open With searches compatible installed apps, identifies the common default and offers a native application picker. Choices use opaque IDs; opening never changes system file associations. Quick Preview uses one footer for metadata and actions, and its open button names the actual default application. Aliases are `od` and `ow`.

Selecting a folder shows **Size not calculated**. **Calculate Size** (`cs`) measures logical contents independently of indexing and document extraction, in a dedicated utility process for direct builds or a main-process worker thread in the sandboxed Store edition. Progress appears immediately; cancellation also works while the native start request is pending. It includes hidden files, prunes overlapping selected paths and never follows symlinks. Measured empty folders can show 0 B; unreadable items produce an explicit partial/unavailable result. The footer and Get Info share a bounded cache with calculation timestamps and invalidation after observed changes. Disk allocation, hard-link deduplication and continuous monitoring of every nested folder are separate future capabilities.

Command-Z undoes eligible rename/move, copy/duplicate/create/archive outputs and Viewer Trash jobs. Durable receipts and identity/content checks protect changed destinations; unavailable permissions or changed outputs can prevent Undo. Cross-volume moves do not have application Undo. Interrupted mutations are retained for inspection rather than replayed automatically. Arrangement history is separate: use Commands or Command-Option-Z / Command-Option-Shift-Z. When editing a text field, standard Edit commands operate on its text. See [file operations and recovery](docs/file-operations.md).

| Command                          | macOS shortcut    |
| -------------------------------- | ----------------- |
| New root folder plane            | ⌘N                |
| Open folder / new folder         | ⌘⇧O / ⌘⇧N         |
| Open selection / rename          | ⌘O / Return       |
| Copy / cut / paste / select all  | ⌘C / ⌘X / ⌘V / ⌘A |
| Copy file or folder path         | ⌥⌘C               |
| Quick preview / file information | Space / ⌘I        |
| Commands / Settings              | ⌘K / ⌘,           |
| Find file / go to folder         | ⌘F / ⌘L           |
| Show or hide window navigation   | ⌥⌘S               |
| Parent / back / forward          | ⌘↑ / ⌥← / ⌥→      |
| Hidden files / duplicate / Trash | ⌘⇧. / ⌘D / ⌘⌫     |
| Frame all / dock or reveal       | ⌘0 / ⌘Return      |

## Previews

Indexed search covers filenames and metadata in configured locations, with optional folder-granted document text. Filters include `ext:pdf,epub`, `kind:folder`, `path:Books`, `size:>10mb` and `modified:>2025-01-01`. Saved searches open as virtual root planes with file actions and Space preview. See [search configuration and limits](docs/search.md).

Right-click or Command-K provides **Batch rename**, **Rename as book**, **Rename with model**, **Organize** and **Summarize**. Review proposed changes, evidence and conflicts before Apply; no proposal changes a file automatically. Recipes preserve your naming template and can have shortcuts. OpenAI, Anthropic, z.ai, DeepSeek, Qwen, Gemini, OpenRouter and compatible local providers are optional. A private endpoint/data approval is required before transmitting filenames or text; configuration changes and Viewer’s agent API cannot grant it. Protected keys, revocation, guarded Undo and proposal-only agent access are described in [actions and agents](docs/actions.md).

| Module      | Initial support                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Drawings    | ASCII DXF; pan/zoom, layers, snap, distance/angle/polygon-area measurement and entity inspection                                 |
| 3D          | STEP/STP, IGES/IGS, STL, 3MF, PLY, GLB/glTF, OBJ with local MTL, FBX; orbit, wireframe, dimensions, surface distance, animations |
| Images      | PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG; fit, zoom and pan                                                                     |
| Rendered    | TIFF, HEIC/HEIF, PSD, camera RAW, JPEG 2000, OpenEXR, TGA and ICNS, decoded by Quick Look in its own sandboxed service           |
| Audio/video | Chromium-supported codecs with native seeking and playback                                                                       |
| PDF         | Worker rendering, pages, zoom, selectable text and document search                                                               |
| EPUB        | Local publication metadata, chapter navigation, safe text reading and search                                                     |
| DjVu        | Worker rendering through WebAssembly, pages and text-layer search                                                                |
| Office      | DOCX text, headings and simple tables; XLSX worksheets with stored values and formulas, never evaluated                          |
| Text/data   | Safe Markdown, code/text, expandable JSON and virtualized CSV/TSV tables                                                         |
| Archives    | ZIP, TAR, TAR.GZ/TGZ indexing and entry previews without extraction                                                              |

Formats outside this set receive file information and an external-app action. Presentations, other Office formats, additional ebooks, USD and other creative formats are proposed next in the [preview roadmap](docs/preview-roadmap.md); Office coverage is in [Office previews](docs/office-previews.md). DXF support and limits are documented in [drawing previews](docs/drawings.md); physical units, CAD conversion limits and surface measurements are documented in [model previews](docs/model-previews.md). A registered extension does not guarantee a file’s codec, compression or external asset requirements: failures stay visible and recoverable.

Preview limits are explicit: DXF files 32 MiB with bounded worker parsing/geometry; text reads 4 MiB; model source files 256 MiB; archive entries 32 MiB; TAR previews 128 MiB; gzip archive inputs 64 MiB; archive lists 20,000 entries. ZIP64, encrypted ZIPs, nested archive expansion, remote model assets and Draco/KTX2 model decoding are not included yet. Model companions must resolve inside the model’s local directory. PDF search covers the first 1,000 pages. Search returns up to 20,000 matches and visits up to 500,000 entries. Saved state allows 30 workspaces with 200 planes each.

Transfers preserve contents, symlinks, POSIX modes and modification times. The native macOS adapter also copies extended attributes, resource forks and ACLs; generated signed-runtime checks cover these cases. Same-volume moves preserve the original filesystem object. Cross-volume copies stream through private staging and validate source identity before publication/removal. Unsupported metadata or provider errors remain visible, and originals are preserved when copying or validation fails. Full cloud/file-provider coordinated I/O and adverse mount behavior remain release gates.

## Extend the codebase

The [architecture guide](docs/architecture.md) explains boundaries and Plurid integration. The [preview extension guide](docs/preview-modules.md) shows how to add a typed, lazy viewer without changing the explorer or engine. [PRODUCT.md](PRODUCT.md) records the agreed scope; [DESIGN.md](DESIGN.md) records the implemented visual system.

The [verification report](docs/verification.md) records executed checks and the remaining platform and format limits. The [performance analysis](docs/performance.md) records native measurements, implemented fixes and remaining workload limits across the stack.

The renderer is sandboxed and isolated, with no Node access or arbitrary IPC. Previews receive revocable local resources, bounded reads and range streams. Downloaded files and Markdown cannot execute scripts, open remote pages or fetch network assets inside the application.

Workspaces use a fresh `viewer-state-v1.json` in Electron’s Viewer user-data directory (normally `~/Library/Application Support/Viewer` on macOS). Writes are atomic; unreadable state is retained as a backup. `VIEWER_DATA_DIRECTORY=/absolute/path` selects an isolated profile. Legacy `~/.viewer` data is not imported or modified.

Licensed under [DEL](LICENSE). Part of [Plurid](https://plurid.com).

## Configuration, custom commands and terminals

Settings and external editors share a validated, commented `config.jsonc`, with a generated editor schema, live reload, last-valid recovery and conflict handling. Settings → Configuration opens/imports/exports it and shows diagnostics and recent changes. Folder overrides, shortcuts, recipes, custom actions and terminal profiles are editable; credentials and effective agent approvals remain separate. See [configuration.md](docs/configuration.md).

Custom actions can invoke built-in commands, recipes, shell profiles, literal executable arguments or explicit shell scripts from the same searchable menu and Command-K. Bounded process output and cancellation are available. Agents discover the same contextual commands and propose invocation/configuration changes; every agent command needs fresh in-app approval, and only reading a terminal’s output can be granted separately. A new or changed shell or executable action, terminal profile, tmux program or terminal application asks for native confirmation once before it first runs, so imported or externally edited configuration cannot run code silently. A command’s working folder is not a sandbox. See [actions.md](docs/actions.md).

**Open in Terminal** detects a running supported app, then prefers iTerm; **Open in tmux** creates a window in a configurable shared session. **Open terminal plane** creates an independent PTY under the captured root. Terminal screens/shells survive camera culling and workspace switches while Viewer runs; restarting creates fresh shells. See [terminals.md](docs/terminals.md). Routine tests remain hidden and never activate Viewer.
