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
| Name pattern | `~^IMG_\d+` for a case-insensitive regular expression                                     |

The older `size:>10mb` and `modified:>2025-01-01` forms remain accepted. Finder tags use Spotlight
and require the direct macOS build. Invalid syntax identifies its column; a folder filter keeps its
last valid query while you correct it.

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

## Fuzzy discovery and saved searches

The file finder and command palette rank bounded word typos and adjacent letter transpositions after
exact, prefix and subsequence matches. For example, `git iint` can help discover Git init.
Suggestions do not rewrite or execute input. Literal filters and indexed content retain the query
language above.

Save useful searches as virtual folder-like planes. They retain their query and scope, offer file
actions and Quick Preview, and refresh against the index. Results are paged: the UI shows up to 150
per page. Short fragments and complex queries have bounded scanning; partial or in-progress indexing
can affect results.
