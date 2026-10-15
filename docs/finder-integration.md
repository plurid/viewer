# Finder integration

The first parity increment adds native Get Info editing, Finder aliases, Share, Quick Look Invert Selection and spring-loaded drag navigation through the existing command and desktop boundaries.

## Get Info

Select a file or folder and use Get Info (Command-I), or Tags and comments from Commands/context menus. On macOS the editor reads Finder tag names and colors, comments, Locked, owner/group, POSIX permissions and allocated bytes. Multi-selection editors load only when their details are expanded. Folder entry allocation describes the directory itself; Calculate Size remains the separate logical contents measurement.

Changes require Save changes. Reload discards the current draft and reads the current file. An item identity and change-time revision reject replacements and stale edits. Symlink editing redirects the user to the original item. Read-only volumes, ownership restrictions, unsupported metadata and unreadable attributes remain visible. Owner permission recovery can restore Read without following a symlink leaf. The editor does not change ownership or recursively apply permissions.

The main-process FileInformationService checks native folder access before and inside the provider claim. Its bounded serial queue drains on shutdown. The addon uses descriptor-based xattr/mode/flag work where possible, preserves unrelated attributes and flags, and restores prior metadata if a multi-field edit fails. A narrow coordinated permission-recovery path handles an owner who cannot open a read descriptor. These changes are explicit user edits and do not create an operation Undo receipt.

Finder tags and comments use their native binary plist extended attributes, not Viewer-only configuration. Native checks independently read tags through Foundation's tagNamesKey and recognize aliases through isAliasFileKey. See [URL resource keys](https://developer.apple.com/documentation/foundation/urlresourcekey/tagnameskey).

## Native commands

- Make alias creates a genuine macOS bookmark file in an owned private staging directory, then publishes it exclusively through the operation service. Collision handling, progress, receipts and guarded cold Undo remain shared with other operations. The source remains intact.
- Show Package Contents checks the native package flag before opening it as a folder.
- Share opens the macOS sharing picker. The user chooses the destination/service.
- Quick Look in macOS opens the system preview panel for the selected paths. Binary fallback previews also offer Quick Look and Open in Default App. This is an external system panel, not an embedded Office renderer.
- Invert Selection uses the active folder, column or loaded search-result scope, retaining view order and resetting the range anchor.

Native Share and Quick Look require granted paths and are available only on macOS. Native preview state is dismissed during permission revocation and shutdown. Their physical UI, provider handoff and signed Store sandbox behavior still require acceptance; passing metadata and browser tests does not prove those panels.

## Open With and Help

The direct build declares document types, so Finder offers Viewer in Open With for folders, images, movies, audio, PDF, EPUB, text, Office documents, archives, DjVu, drawings and 3D models. Viewer registers as an alternate viewer and never becomes the default app for a type. The App Store build does not declare them yet: it would receive access to the opened file only, which Viewer's folder-based access does not handle. The Help menu has Commands…, Report an Issue…, Viewer Website and Show Diagnostic Log, and macOS adds its menu search.

Application bundles (`.app`) show their own icon in list, grid and column views, as in Finder. Small icons come from `NSWorkspace`; grid tiles use Quick Look's full-resolution rendering of the bundle. Icons are cached per app version in a bounded cache.

The mouse's back and forward side buttons move through a folder plane's history; back with no earlier folder goes up to the parent. Close plane is ⌥⌘W; the engine's own close and reopen shortcuts are turned off so a closed plane never lingers in the saved workspace.

## Drag navigation

Hold a file drag over a folder for 650ms to open it. List, grid and gallery use the same plane; columns append the folder to the visible trail. Temporary traversal preserves file selection and docking. Cancelling restores the original folder/presentation/history or column trail. A successful drop adds only the final navigated folder to ordinary history; intermediate folders do not enter Recents. Temporary history slots remain valid for persistence throughout the drag.

Hover inspection uses the normal stat/access boundary. It never reads native dragged file objects, grants access or opens a permission picker. Delayed results cannot retarget a closed plane, another workspace or deliberate navigation. Traversal allows one inspection at a time and at most 32 successful openings per drag. Leave, Escape, drag end, an outside drop, blur, hiding and unmount dispose hover/scroll work. Escape belongs to the active file drag before spatial navigation.

Edge scrolling uses elapsed animation time, caps delayed frames and normalizes projected scale. The nearest vertical and horizontal viewports can scroll independently, including virtual rows, list metadata columns, browser columns and gallery strips. Scrolling cancels pending hover so moving rows do not open accidentally. Mutation, collision handling and Undo remain in the existing operation service. Physical Finder drag/modifiers and oblique-plane geometry remain separate acceptance checks.

## Browser preview

Copy Path in the Chrome fixture uses the browser clipboard API, writes exact newline-separated paths and clears the previous virtual file-operation clipboard only after writing succeeds. Denied/unavailable clipboard access raises a visible recovery message. Browser Share/Quick Look report that the installed app is required. These fixture adapters do not ship in Viewer.

## Remaining sequence

Continue the everyday Finder work with a Tags section in the sidebar, Trash browsing, native window/tab restoration, richer search filters and native Services. Metadata ownership/admin workflows, bulk tagging and explicit default-app association changes remain gaps.

Scoped MCP now supports reviewed workspace switching, plane focus, parameterized path opening and exact selection; see [agent-navigation.md](agent-navigation.md). The next five major feature groups are portable project workspaces, evidence-backed content search, comparison, workflows and dependency tracking. Saved searches, basic batch rename, terminals, CAD inspection and global JSONC already exist. Finder gaps listed above and native release qualification remain separate work.

The [roadmap](roadmap.md) tracks features. The [Store readiness ledger](mac-app-store-readiness.md) separately tracks native/provider/OS/distribution qualification. No parity increment grants itself release readiness.
