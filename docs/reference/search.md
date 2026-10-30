# Search

This page lists every term of the file query language, where you can type it, and what each kind of
search covers.

## Where to search

| Place                    | Opens with                                                              | Scope and controls                                                                                                                                                                           |
| ------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Find file**            | **⌘F** (**Find file…**); in an editor or terminal ⌘F finds text instead | **Search scope**: **This folder**, **Subfolders** or **Indexed locations**. **Document text** searches indexed text. **Open results** opens a search plane; **Save search…** saves the query |
| Folder filter row        | **Search this folder…**, or the plane toolbar's search button           | Filters the folder plane as you type. **Subfolders** searches below it. **Search contents** opens a search plane with document text on                                                       |
| Search plane             | **Open results**, **Search contents**, `:find` or a saved search        | Editable query, **Document text** checkbox, coverage summary, 150 results a page with **Previous** and **Next**                                                                              |
| Command line             | `:filter`, `:find`, `:select`, `:deselect`                              | See [the command language](command-line.md)                                                                                                                                                  |
| **Find files with tag…** | ⌘K                                                                      | One Finder tag; macOS only                                                                                                                                                                   |

## Query syntax

| Form            | Meaning                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| `draft notes`   | Every word is in the name, in any order                                     |
| `"field notes"` | The phrase is in the name, in this order; a quote left open runs to the end |
| `a b`           | Both terms match                                                            |
| `a OR b`        | Either term matches; `OR` is uppercase                                      |
| `-term`         | The term does not match                                                     |
| `( … )`         | Groups terms                                                                |
| `~pattern`      | The name matches a regular expression                                       |
| `key:value`     | A filter from the table below                                               |

Names and paths are compared with case and accents folded: `cafe` finds `Café`. A query is at most
1,000 characters.

## Filters

| Filter     | Also written  | Values                                                                                    |
| ---------- | ------------- | ----------------------------------------------------------------------------------------- |
| `ext:`     | `extension:`  | Extensions, comma-separated, with or without the dot: `ext:pdf,epub`                      |
| `kind:`    | `type:`       | `file`, `folder`, `link`, `app`, `image`, `video`, `audio`, `text`, `document`, `archive` |
| `name:`    |               | Text in the name only, even with **Document text** on                                     |
| `path:`    | `in:`         | Text anywhere in the full path: `path:"Research papers"`                                  |
| `size`     |               | `size>10mb`, `size<=500kb`, `size=0`; see [sizes](#sizes)                                 |
| `modified` | `mod`, `date` | `modified<7d`, `modified:today`, `modified>=2026-01-01`; see [dates](#dates)              |
| `created`  |               | As `modified`, for the creation date                                                      |
| `tag:`     | `tags:`       | A Finder tag by its exact name, ignoring case: `tag:red`, `tag:"Project X"`               |
| `is:`      |               | `hidden`, `link`, `file`, `folder`                                                        |

`kind:` also accepts plurals and these words: `directory` and `dir` (folder), `symlink` (link),
`application` (app), `photo` (image), `movie` (video), `music` (audio), `doc` (document).

| Kind                              | Matches                                                           |
| --------------------------------- | ----------------------------------------------------------------- |
| `file`                            | Anything that is not a folder                                     |
| `folder`                          | Folders, except `.app` bundles                                    |
| `app`                             | `.app` bundles                                                    |
| `link`                            | Symbolic links                                                    |
| `image`, `video`, `audio`, `text` | Files whose detected type starts with that word                   |
| `document`                        | The document extensions listed below                              |
| `archive`                         | `zip`, `tar`, `gz`, `tgz`, `bz2`, `xz`, `7z`, `rar`, `dmg`, `zst` |

`kind:document` matches `pdf`, `pages`, `numbers`, `key`, `epub`, `txt`, `md`, `csv` and `rtf`; Word
`doc`, `docx`, `docm`, `dot`, `dotx` and `dotm`; Excel `xls`, `xlsx`, `xlsm`, `xlt`, `xltx` and
`xltm`; PowerPoint `ppt`, `pptx`, `pptm`, `pps`, `ppsx`, `pot`, `potx` and `potm`; OpenDocument
`odt`, `fodt`, `ott`, `ods`, `fods`, `ots`, `odp`, `fodp`, `otp`, `odg` and `fodg`; and Publisher
`pub`. Pages, Numbers, Keynote and `rtfd` packages count too.

Keys share two of these extensions. A `pub` or `key` file is left out when it is named as OpenSSH
names keys (`id_ed25519.pub`, `ssh_host_rsa_key.pub`) or, where its size is known, when it is under
16 KB. EMF and WMF files are pictures: `kind:image` finds them.

### Sizes

| Unit      | Bytes             |
| --------- | ----------------- |
| none, `b` | 1                 |
| `k`, `kb` | 1,000             |
| `m`, `mb` | 1,000,000         |
| `g`, `gb` | 1,000,000,000     |
| `t`, `tb` | 1,000,000,000,000 |

Sizes are decimal, as Viewer and Finder show them: `size>10mb` finds what reads as more than 10 MB.
Values can have a fraction (`size>1.5gb`). Operators are `<`, `<=`, `>`, `>=` and `=`. A size filter
matches files only, never folders.

### Dates

| Value                           | Meaning                                                      |
| ------------------------------- | ------------------------------------------------------------ |
| `today`, `yesterday`            | That day, in local time                                      |
| `2026`, `2026-10`, `2026-10-30` | That year, month or day                                      |
| `12h`, `7d`, `2w`, `3mo`, `1y`  | A time ago: hours, days, weeks, 30-day months, 365-day years |

| Operator | With a time ago (`7d`) | With a day, month or year (`2026-01`) |
| -------- | ---------------------- | ------------------------------------- |
| `<`      | Newer than that        | Before it starts                      |
| `<=`     | Newer than that        | Up to its end                         |
| `>`      | Older than that        | After it ends                         |
| `>=`     | Older than that        | From its start                        |
| `:`, `=` | Newer than that        | Within it                             |

The forms `size:>10mb` and `modified:>2025-01-01` are also accepted.

### Name patterns

`~` starts a case-insensitive RE2 regular expression matched against the name: `~^IMG_\d+`. Groups,
alternatives, character classes and repetition work; lookaround and backreferences do not. A pattern
is at most 512 characters. Quote a pattern that contains spaces or parentheses:
`~"(draft|notes).*\.md$"`.

### Select by pattern

**Select by pattern…** (⌃⌘=), **Deselect by pattern…** (⌃⌘-), `:select` and `:deselect` also take
globs. When every word contains `*` or `?` and none starts with `-`, `~` or `(` or contains `:`,
`<`, `>`, `=` or `"`, each word is a glob and any of them may match: `*.md *.txt`, `IMG_????.jpg`.
Otherwise the text is a query.

### Errors

A query that does not parse shows its message under the field; on the command line the error also
marks the column. A folder filter keeps its last valid query while you correct it.

| Message                                         | Cause                               |
| ----------------------------------------------- | ----------------------------------- |
| `OR needs a term before it.` / `after it.`      | `OR` at the start or end of a group |
| `- needs a term after it.`                      | A `-` with nothing after it         |
| `A ( is not closed.` / `A ) closes nothing.`    | Unbalanced parentheses              |
| `Sizes read size>10mb, size<1kb, size=0.`       | Unknown size or unit                |
| `Dates read modified<7d, …`                     | Unknown date or duration            |
| `Use kind:file or kind:folder, or …`            | Unknown kind                        |
| `Use is:hidden, is:link, is:file or is:folder.` | Unknown `is:` value                 |
| `Use a valid RE2 name pattern. …`               | A pattern RE2 does not accept       |
| `A query is at most 1,000 characters; …`        | Too long; says how much to shorten  |

## Filename index

**Settings → Search** controls the index:

| Control                                  | Effect                                                         |
| ---------------------------------------- | -------------------------------------------------------------- |
| **Indexed locations**, **Add location…** | Folders to index; the default is your Home folder; at most 100 |
| **Contents** beside a location           | Also extracts document text there; off by default              |
| **Rebuild index**                        | Reads every location again                                     |
| **Pause background indexing**            | Stops indexing; results may be incomplete while paused         |
| **Saved searches**                       | Lists saved searches; remove one here                          |
| **Excluded names and paths**             | One name or absolute path per line; at most 200                |
| **Add common exclusions**                | Adds the list below without replacing your rules               |

The index stores each file's name, path, extension, kind, size and modification time, locally.
Indexing never runs OCR and never sends data to a model. Offline drives keep their last results.
Removing a location removes its rows and its **Contents** grant. Turning **Contents** off removes
the stored text for that location, also while indexing is paused.

### Excluded names and paths

A name matches any path component: `node_modules` skips every folder of that name. A full path
excludes that location and everything inside it. Rules are not glob patterns. Matching folders are
skipped before they are read, in indexing, document text, subfolder searches of unindexed folders
and Spotlight-assisted results. They still show in ordinary folder browsing.

New configurations exclude `~/Library` and these names: `.git`, `node_modules`, `.venv`, `venv`,
`__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.tox`, `.nox`, `.cache`, `.vite`,
`.next`, `.nuxt`, `.svelte-kit`, `.turbo`, `.parcel-cache`, `.pnpm-store`, `.yarn`, `.gradle`,
`target` and `out`. Existing lists are kept. Rebuild the index to pick up content that a removed
rule skipped.

## Document text

With **Document text** on, the words at the top level of the query match a file's name or its
indexed text; `name:` still matches the name only, and every other filter still applies to the file.
Select a match to see its passage (**Page**, **Chapter**, **Line** or **Passage**) and open the
document there. Changing the query or scope hides old results and passages until the new answer
arrives.

| Read for document text                                                                  | Limit                                    |
| --------------------------------------------------------------------------------------- | ---------------------------------------- |
| Any file under a location with **Contents** on                                          | 16 MB per file                           |
| PDF                                                                                     | First 16 pages; 20,000 characters a page |
| Word and Excel Open XML: `docx`, `docm`, `dotx`, `dotm`, `xlsx`, `xlsm`, `xltx`, `xltm` | Bounded extract                          |
| EPUB, FictionBook (`fb2`), web archives (`webarchive`)                                  | Bounded extract                          |
| Email: `eml`, `emlx`, `mbox`                                                            | Bounded extract                          |
| Certificates, keys, torrents and provisioning profiles                                  | Their readable fields                    |
| Other text files                                                                        | 4 MB; no NUL byte in the first 8 KB      |
| Stored text per file                                                                    | 150,000 characters                       |

PowerPoint files and the binary Office 97 to 2003 formats are not text-indexed, although Viewer lays
them out. Inspecting one file on demand can read further than the index.

## Search planes and saved searches

A search plane is folder-like: file actions, Quick Preview and selection work as in a folder. It
shows 150 results a page; **Next** reads more known matches.

| Command in a search plane             | Effect                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| **Add all indexed matches to basket** | Up to 10,000 matches, after indexing has finished; changed files are refused |
| **Save as smart folder**              | A collection that follows the index                                          |

**Save search…** in **Find file** stores the name, query, scope and **Document text** choice. A
saved query is as long as any query, up to 1,000 characters. Its name starts as the query, cut at a
word to 100 characters. You can keep 100 saved searches. Each saved search is a command in ⌘K under
**Saved searches**; choosing it opens a search plane.

## Coverage

Recursive folder searches and search planes show a coverage summary. Expand it to see the location,
whether hidden files are included, index progress, unreadable entries and the excluded names and
paths. Indexing in another location does not make this search incomplete.

| Summary                  | Meaning                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| **Search finished**      | The available filename scope was searched                                                              |
| **Partial coverage**     | Paused or offline locations, unreadable entries, a scan limit, or document text not enabled everywhere |
| **Indexing in progress** | Results may change                                                                                     |
| **Location not indexed** | The folder is outside **Indexed locations**                                                            |

| Limit                                                                | Value                                                       |
| -------------------------------------------------------------------- | ----------------------------------------------------------- |
| Rows an indexed query reads when its filters cannot run in the index | 20,000; narrow the query to finish                          |
| Live scan of an unindexed folder                                     | Stops at 20,000 matches or 500,000 entries                  |
| Spotlight shortcut in a live scan                                    | First 2,000 hits by name; the walk still completes the list |
| Finder tag lookup                                                    | Spotlight, in the direct macOS build only                   |

A live scan reports its checked entries, errors and limits; stopping it keeps the partial results.
An empty search with partial coverage says **No matches in the available search data**; a complete
one says **No matching files**.

## Fuzzy matching in ⌘K

The command palette and **Find file** rank near-misses after exact, prefix and subsequence matches,
in labels, aliases and file names. Each word of 3 to 5 letters may be one edit away, a longer word
two, and a swap of adjacent letters counts as one edit: `git iint` finds **Run command…**, whose
aliases include `git init`. Words keep their order. This only ranks suggestions: it never rewrites
or runs what you typed, and query filters stay literal.

**Related:** [Browse and organize](../guides/files.md) · [Command language](command-line.md) ·
[Configuration](configuration.md) · [Terms](terms.md)
