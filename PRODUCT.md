# Viewer

Viewer is a macOS-first local file manager in the Plurid application family. It turns folders and read-only file previews into linked spatial planes, while letting routine browsing stay focused in a docked plane. The architecture must remain portable to Windows and Linux.

The first release serves frequent everyday file work: browse large folders, find files, compare previews, and organize local files, external disks, and mounted network folders. Double-clicking a folder navigates inside its plane; an explicit action opens a linked child. List, grid, columns, and gallery are functional views. File operations include create, rename, copy, move, duplicate, native Trash, collision decisions, cancellation, progress, and safe undo of rename/move.

Preview modules are typed, lazy-loaded, and independent of the explorer and spatial engine. The first set covers images, audio/video supported by Chromium, PDF, Markdown, code/text, JSON, CSV, ZIP/TAR/TAR.GZ, and GLB/glTF, OBJ, STL, and FBX. Office documents, ebooks, CAD/USD, and creative formats belong on the same extensible path; future modules must report support honestly rather than relabeling incompatible files as images.

Visual decisions inherit current Plurid applications: one look for the shell and engine, restrained surfaces, readable dense file rows, familiar macOS commands, clear focus and feedback. The defining interaction is opening a file beside its folder in space, then docking the relevant plane for focused work.

The window has no wordmark, tagline, plane-tab row or global shortcut footer. One contextual plane header exposes navigation and primary controls; path, search and secondary actions appear when needed. Appearance belongs in Settings. Plane backs are visible by default; spatial aids and tools are deliberate choices. Framing uses the live viewport and measured planes while preserving deliberate camera movements.

A shared command registry serves Command-K, autofocus searchable context menus, header actions, native commands and shortcuts. Commands bind the clicked target or current selection, filter by availability, and rank aliases and the last two applicable actions. Preview modules may contribute scoped commands without depending on the explorer or engine. Command-F finds files in the active folder or subtree; Copy/Move to opens a destination step.

Sidebar sections fold and reorder; Locations and Favorites support shortcut arrangement, alias names and hiding. Recent remains chronological and can supply Favorites. The sidebar resizes and hides. These changes alter navigation preferences only. Workspace deletion removes layout only, confirms the name and plane count, offers session recovery, and preserves files and running jobs. An operations control appears only for pending work, conflicts or unseen failures; past jobs are available through Commands and the native menu.

Local persistence is new, versioned, and atomic. Legacy code and ~/.viewer data stay untouched. Remote/cloud accounts, third-party plugin installation, file editing inside previews, release certificate signing, notarization, and publishing are outside this first implementation. macOS development bundles use local ad-hoc signatures so they can run on Apple Silicon.

Confirmed by the user during the planning interview and subsequent interface review; implementation authorized with “Implement the plan.” Existing files and folders must not be deleted during this work.
