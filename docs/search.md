# Indexed search

The desktop runs SQLite FTS5 in a utility process. Filename, path, extension, kind, size and modification time are stored locally. Filename indexing starts at Home by default; Settings → Search controls locations, exclusions, pause and rebuild. Verification replaces Home with a generated fixture folder.

Command-F starts at the active folder. Subfolder search uses the background index when that location is indexed; unindexed folders retain streamed filesystem search. **All indexed locations** searches configured roots. **Document text** includes extracted text from explicitly granted locations. Search results are bounded to 150 per page, with at most 500 through the desktop query API.

## Filters

| Filter | Example |
| --- | --- |
| Extension | `ext:pdf,epub` |
| Files/folders | `kind:file`, `kind:folder` |
| Path substring | `path:Books`, `path:"Research papers"` |
| Byte size | `size:>10mb`, `size:<500kb` |
| Modified date | `modified:>2025-01-01` |

Combine filters with literal text, such as `fire ext:epub`. Matching folds case and Latin diacritics. This is substring search with structured filters, not arbitrary FTS/SQL syntax. Text of three or more characters uses the trigram index; shorter filename fragments use a bounded result query but can scan the index. Short text fragments do not search document bodies. Broad terms, deep offsets and restrictive paths can cost more than selective first-page queries.

## Text permission

Enable Contents next to a location in Settings → Search to extract local text. The index uses bounded PDF/EPUB/plain-text extraction; index crawling does not invoke OCR. On-demand document actions may run the local macOS OCR helper. Indexing never sends text to a model provider. Revoking a content grant clears that location's stored body text even when indexing is paused, and a late extraction cannot put it back.

Excluded paths are hidden from queries immediately. Removing an indexed root also removes its matching text grant. Its cached filename rows can remain in the local database, but queries and counts exclude that root; re-adding it reconciles them with current files. Rebuild refreshes the disposable search index and never modifies source files. An offline root preserves its cached rows and reports its state; cached results can be stale until the drive or mount returns.

## Saved searches

Use **Open results as plane** to create a virtual root. **Save search…** adds a named query to Commands; Settings → Search manages saved queries. Folder scope, recursive scope and the document-text choice travel with the query. Results share the file command catalogue, clipboard, file information, action recipes and Space preview. Keyboard navigation works on the displayed page. When results span several pages, Select All takes a verified snapshot of up to 10,000 indexed matches. The selection is kept by path, so it stays the same when you move between pages. Over 10,000 matches, or while the location is still indexing, Select All covers only the current page and says why.

## Smart folders

**Save as smart folder** turns a search pane into a named query collection. Collection planes for query and tag collections are smart folders: they read their matches again when the index updates (at most every two seconds while indexing runs) and after file operations. They show the previous matches while refreshing.

**Find files with tag…** asks for a Finder tag name and opens a smart folder of every file under the indexed locations (or Home) with that tag. It uses Spotlight's `kMDItemUserTags`, matching the exact name and ignoring case. Only files that still exist and that Viewer may read are listed. Spotlight is unavailable in the App Store build, so the command reports that there instead of showing an empty folder.

Saved searches are dynamic queries, not copies of their results. Applying a file operation remaps open paths, selections, Favorites and Recent, and refreshes the index. The original root's preview ownership remains independent from other roots.

The benchmark in `tools/index-benchmark.ts` ingests synthetic metadata into a temporary disk database, without crawling user folders. It exercises 100,000 and 1,000,000 rows. Its timing scope and results are recorded in [performance.md](performance.md); they do not establish equivalent performance for network mounts, millions of extracted documents or every filter combination.

In direct macOS builds, a folder name search first shows Spotlight (`mdfind -onlyin … -name`) matches, filtered by the same name and hidden-file rules, and then completes the list by walking the folder, skipping files already shown. Spotlight cannot tell an unindexed folder from one without matches, so the walk remains authoritative. The App Store build and other platforms only walk.
