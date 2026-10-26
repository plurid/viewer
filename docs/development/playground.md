# Sample playground

The playground is a stable folder of files and projects for exploring Viewer. It is separate from
application data, package output and temporary test evidence.

## Generate it

From the repository root:

```sh
pnpm playground --offline
```

The default destination is the sibling `../viewer-playground`. Offline mode creates local samples
and reports missing public downloads. Run `pnpm playground` to add the checksum-pinned public RAW
photographs and video references; its first download is about 215 MiB. `pnpm playground --help`
lists destination options.

The generator preserves changed files and existing scenarios. It does not open Viewer, add
Favorites, or start servers/terminals. Node/pnpm dependencies and Git are required; ordinary
generation does not need a separate Office/CAD app.

## Explore by task

| Folder                                 | Try                                                              |
| -------------------------------------- | ---------------------------------------------------------------- |
| `previews/documents`                   | PDF pages/outline, EPUB chapters, Office views and HTML          |
| `previews/images`                      | Raster/vector controls, extended images and camera RAW           |
| `previews/audio`, `previews/video`     | Playback, compatibility and media drafts                         |
| `previews/models`, `previews/drawings` | Mesh/CAD views, companions and DXF measurements                  |
| `previews/archives`                    | Browse nested contents without extracting                        |
| `previews/code-and-data`               | Languages, structured trees, tables and conventional filenames   |
| `projects/static-website`              | Start a local server and open its browser plane                  |
| `git`                                  | Compare worktrees, staging and deliberately conflicted scenarios |
| `edge-cases`                           | Explicit rejection cases and awkward filenames                   |
| `scratch`                              | Your copies and experiments                                      |
| `licenses`, `reports`                  | Provenance and immutable generation reports                      |

Open the root in Viewer and optionally add it to Favorites. Work on copies in scratch when you want
to preserve a reference. Invalid samples exercise recovery; their presence does not count as
successful format support.

## Larger references

```sh
pnpm playground:qualify
```

The additive corpus includes a long PDF manual and application-authored Office documents, with
separate provenance/manifest records. It preserves existing playground bytes. Some references
intentionally exceed reader limits, and a valid complex file can expose a limitation rather than a
passing preview.

[Testing](testing.md) explains real-file qualification. Public documentation recordings use their
own small [demo workspace](../media/README.md), rather than publishing raw QA screenshots or the
user's working files.
