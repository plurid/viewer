# Indexed search

Folder search also offers **Search contents** for the current query/scope.
The resulting search plane has an editable query and Document text toggle, and
links directly to Search settings when its location lacks text-index coverage.
These controls do not grant indexing permission or scan document bodies by
themselves. Exact content matches retain their source excerpts and anchors.

The file finder and command palette rank adjacent transpositions and bounded
word typos below exact, prefix and subsequence matches. `git iint` can discover
Git init without altering the input or executing a correction. Command-line
did-you-mean uses the same bounded distance function. Literal folder filters and
indexed content queries retain their query-language meaning. Query/root changes
withhold previous results and evidence until the new response arrives.

The desktop runs SQLite FTS5 in a utility process (a worker thread in the Mac App Store build). Filename, path, extension, kind, size and modification time are stored locally. Filename indexing starts at Home by default; Settings → Search controls locations, exclusions, pause and rebuild. Verification replaces Home with a generated fixture folder.

Command-F starts at the active folder. Subfolder search uses the background index when that location is indexed; unindexed folders retain streamed filesystem search. **All indexed locations** searches configured roots. **Document text** includes extracted text from explicitly granted locations. Search results are bounded to 150 per page, with at most 500 through the desktop query API.

## The query language

One language reads queries everywhere: the folder filter (the search icon in a plane's header), the search through subfolders, Find file (⌘F), **All indexed locations**, saved searches and smart folders, and the command line's `:filter` and `:find`.

**Words.** Words are in the name, each anywhere and in any order: `draft notes` finds "notes (draft).md". A quoted phrase is in the name as written: `"draft notes"`. Matching folds case and Latin diacritics: `resume` finds "Résumé.pdf".

**Terms:**

| Term | Example |
| --- | --- |
| Extension | `ext:pdf,epub` |
| Kind | `kind:file`, `kind:folder`, `kind:link`, `kind:app`, `kind:image`, `kind:video`, `kind:audio`, `kind:text`, `kind:document`, `kind:archive` (plurals too; another kind is an error) |
| Name, path | `name:draft`, `path:Books`, `path:"Research papers"` |
| Size | `size>10mb`, `size<=500kb`, `size=0` (b, kb, mb, gb, tb; folders have none) |
| Modified, created | `modified<7d` (within a week), `modified>1y` (older), `modified:today`, `modified:yesterday`, `created>=2026-01-01`, `modified=2026-10` (durations h, d, w, mo, y; dates in local time, a day, a month or a year) |
| Finder tag | `tag:red`, `tag:"Project X"` |
| Hidden, links | `is:hidden`, `is:link`, `is:file`, `is:folder` |
| Name pattern | `~^IMG_\d+` (a regular expression, case aside) |

**Combining terms.**
- Terms side by side must all match. `OR` between them means either; `-` turns one down; parentheses group: `(ext:png OR ext:jpg) -tag:done size>1mb`.
- The index's older form, `size:>10mb` and `modified:>2025-01-01`, still reads.
- A quote left open runs to the end, so a filter typed letter by letter keeps filtering.

**Errors.** A query that does not read says why, with the column: under the folder filter, in Find file and on the command line. The filter keeps the last query that did read until the next one does.

**How each place runs a query.**
- **The index** narrows in SQL by the terms every match has: top-level words, extensions, file or folder, size and modified date. The query then decides each row, reading at most 20,000 rows for one page, so OR, `-`, patterns, created dates, kinds by content and tags read as they do elsewhere.
- **Text.** Text of three or more characters uses the trigram index. Shorter fragments use a bounded result query but can scan the index, and do not search document bodies. With **Document text**, the words at the top match a document's text or its name; the other terms still apply.
- **The search through subfolders** reads only names, extensions and kinds from each folder, and asks for sizes and dates only when the query needs them.
- **Tags** come from Spotlight, so `tag:` needs the direct build: the App Store sandbox has no Spotlight.

## Text permission

Enable Contents next to a location in Settings → Search to extract local text. The index uses bounded PDF/EPUB/plain-text extraction; index crawling does not invoke OCR. On-demand document actions may run the local macOS OCR helper. Indexing never sends text to a model provider. Revoking a content grant clears that location's stored body text even when indexing is paused, and a late extraction cannot put it back.

Excluded paths are hidden from queries immediately. Removing an indexed root also removes its matching text grant and its rows in the local database; re-adding it indexes it again. A crawl keeps the text already extracted for a document that has not changed (same identity, size and modification time), so a launch or a settings change does not extract every document again. Choosing a folder does not restart indexing: an unchanged configuration only crawls again the roots that could not be read. Rebuild crawls every root and extracts every document again; it refreshes the disposable search index and never modifies source files. An index database SQLite cannot read is renamed `files-v1.sqlite.unreadable-<time>`, with its journal files, and indexed again from the configured roots; a search after a failed start of the index service starts it again. An offline root preserves its cached rows and reports its state; cached results can be stale until the drive or mount returns. A location the Store edition is not permitted to read also shows as offline, but its rows and text are removed until access is granted again.

## Saved searches

Use **Open results as plane** to create a virtual root. **Save search…** adds a named query to Commands; Settings → Search manages saved queries. Folder scope, recursive scope and the document-text choice travel with the query. Results share the file command catalogue, clipboard, file information, action recipes and Space preview. Keyboard navigation works on the displayed page. When results span several pages, Select All takes a verified snapshot of up to 10,000 indexed matches. The selection is kept by path, so it stays the same when you move between pages. Over 10,000 matches, or while the location is still indexing, Select All covers only the current page and says why.

## Smart folders

**Save as smart folder** turns a search pane into a named query collection. Collection planes for query and tag collections are smart folders: they read their matches again when the index updates (at most every two seconds while indexing runs) and after file operations. They show the previous matches while refreshing.

**Find files with tag…** asks for a Finder tag name and opens a smart folder of every file under the indexed locations (or Home) with that tag. It uses Spotlight's `kMDItemUserTags`, matching the exact name and ignoring case. Only files that still exist and that Viewer may read are listed. Spotlight is unavailable in the App Store build, so the command reports that there instead of showing an empty folder.

Saved searches are dynamic queries, not copies of their results. Applying a file operation remaps open paths, selections, Favorites and Recent, and refreshes the index. The original root's preview ownership remains independent from other roots.

The benchmark in `tools/index-benchmark.ts` ingests synthetic metadata into a temporary disk database, without crawling user folders. It exercises 100,000 and 1,000,000 rows. Its timing scope and results are recorded in [performance.md](performance.md); they do not establish equivalent performance for network mounts, millions of extracted documents or every filter combination.

In direct macOS builds, a folder name search first shows Spotlight (`mdfind -onlyin … -name`) matches, filtered by the same name and hidden-file rules, and then completes the list by walking the folder, skipping files already shown. Spotlight cannot tell an unindexed folder from one without matches, so the walk remains authoritative. The App Store build and other platforms only walk.
