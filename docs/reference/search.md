# Search

**⌘F** searches the active folder. **Subfolders** widens the scope. **All indexed locations**
searches configured roots. **Search contents** opens a results plane with an editable query and a
**Document text** toggle.

## Useful queries

| Find                                    | Query                            |
| --------------------------------------- | -------------------------------- |
| PDFs and books                          | `ext:pdf,epub`                   |
| Folders                                 | `kind:folder`                    |
| Large images                            | `kind:image size>10mb`           |
| Recently modified documents             | `kind:document modified<7d`      |
| A phrase in a name                      | `"field notes"`                  |
| Files in a matching path                | `path:"Research papers"`         |
| Either image extension, excluding a tag | `(ext:png OR ext:jpg) -tag:done` |

Bare words match names in any order. Matching folds case and Latin diacritics. Quoted phrases
preserve word order. Combine terms with spaces for AND, `OR` for alternatives, `-` for exclusion and
parentheses for grouping.

## Terms

| Term         | Forms                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------- |
| Extension    | `ext:pdf`, comma-separated extensions                                                     |
| Kind         | `file`, `folder`, `link`, `app`, `image`, `video`, `audio`, `text`, `document`, `archive` |
| Name/path    | `name:draft`, `path:Books`                                                                |
| Size         | `size>10mb`, `size<=500kb`, `size=0`; units b, kb, mb, gb, tb                             |
| Dates        | `modified<7d`, `modified:today`, `created>=2026-01-01`; durations h, d, w, mo, y          |
| Finder tags  | `tag:red`, `tag:"Project X"`                                                              |
| Flags        | `is:hidden`, `is:link`, `is:file`, `is:folder`                                            |
| Name pattern | `~^IMG_\d+` for a case-insensitive RE2 regular expression                                 |

The older `size:>10mb` and `modified:>2025-01-01` forms remain accepted. Finder tags use Spotlight
and require the direct macOS build. Invalid syntax identifies its column; a folder filter keeps its
last valid query while you correct it.

Name patterns use a linear-time engine and are limited to 512 characters. Groups, alternatives,
character classes and repetition work; lookaround and backreferences are unavailable. Quote a
pattern containing spaces or parentheses, for example `~"(draft|notes).*\.md$"`.

## Names and document text

**Settings → Search** controls filename-index locations, exclusions, pause and rebuild. Unindexed
subfolders can use streamed filesystem search. The index stores local filename, path, extension,
kind, size and modification metadata.

Enable Contents for a location to grant document extraction separately. Supported readers include
bounded plain text, PDF, EPUB, DOCX and XLSX extraction. Indexing does not run OCR or send data to a
model. On-demand inspection can have different coverage. Legacy Office layout support does not imply
legacy binary text indexing.

With **Document text**, top-level words can match the body or name; the other filters still apply.
Select a content match to see its source excerpt and open the passage. Changing query or scope hides
old results and excerpts until the new response arrives.

Removing a content grant purges its stored body text, including while indexing is paused. Exclusions
hide matching paths immediately. Removing a root removes its rows and corresponding content grant.

### Skip dependency and cache folders

In **Settings → Search → Excluded names and paths**, enter one name or absolute path per line. A
name matches any path component; a full path excludes that location and its descendants. Matching
folders are skipped before traversal or document extraction, including in recursive searches of
unindexed folders and Spotlight-assisted results. These rules do not hide files from ordinary folder
browsing and are not glob patterns.

New configurations exclude common dependency, environment and cache trees such as `node_modules`,
`.venv`, `venv`, `__pycache__`, `.git`, `.cache`, `.next` and `target`. Existing custom lists are
preserved. **Add common exclusions** adds the current recommendations without replacing your rules.
Remove any rule to search that folder again; subsequent searches use the updated list. Rebuilding
the index can refresh previously skipped content.

## Fuzzy discovery and saved searches

The file finder and command palette rank bounded word typos and adjacent letter transpositions after
exact, prefix and subsequence matches. For example, `git iint` can help discover Git init.
Suggestions do not rewrite or execute input. Literal filters and indexed content retain the query
language above.

Save useful searches as virtual folder-like planes. They retain their query and scope, offer file
actions and Quick Preview, and refresh against the index. Results are paged: the UI shows up to 150
per page. Short fragments and complex queries have bounded scanning; partial or in-progress indexing
can affect results.

## Understand search coverage

Recursive folder searches and search planes show a compact coverage summary. Expand it to see the
location, whether hidden files are included, index progress, unavailable entries and the configured
excluded names and paths. Indexing in another location does not mark this search incomplete.

**Search finished** means the available filename scope was searched. **Partial coverage** identifies
paused or unavailable locations, unreadable entries or a bounded scan. A complex indexed query can
stop after 20,000 candidate rows; narrow the query to finish that search. This differs from ordinary
pagination, where **Next** visits more known matches. Live folder scans also report their checked
entry count, errors and limits; stopping one retains its partial results.

Document text always identifies its narrower coverage: supported formats and bounded extracts,
without OCR. Missing text-index permission is shown separately. An empty partial search says **No
matches in the available search data**, rather than implying every file was searched.
