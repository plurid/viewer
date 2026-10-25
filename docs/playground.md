# Stable manual playground

The additive qualification corpus is available with `pnpm playground:qualify`
(`--offline` reuses existing files). It adds a 178-page upstream PDF manual,
application-authored Apache POI Word/Excel references and the distribution
license under `qualification/`, with a separate `manifest-v2.json`. The original
playground manifest and all existing bytes remain untouched. Historical v1
qualification metadata and every generation report are retained.

The corpus deliberately includes a corrupt ZIP rejection reference and a valid
workbook with an 18 MB expanded XML part, above the reader's current 4 MB
per-part limit. Reference presence is distinct from successful decoding. See
[real-file qualification](real-file-qualification.md) for actual outcomes and
the original RAW/video decoder limits on this Mac.

Run from the Viewer repository:

```sh
pnpm playground
```

The default destination is a sibling of the checkout:

```text
technologies/tools/
├── viewer/
└── viewer-playground/
```

This gives manual exploration a stable filesystem context across builds and
source changes. It is separate from temporary automated-test evidence and package
output. It is not bundled into Viewer or written into the application's profile.
The generator does not open the application, change Favorites or start demo
servers or terminals. It runs Git commands only for initial scenario creation.

The first run downloads approximately **215 MiB** of checksum-pinned public RAW
photographs and an OGV trailer. The small synthetic binary assets are committed
with the recipes. Normal generation needs the installed Node/pnpm dependencies
and Git; it does not need Python, FFmpeg or an Office/CAD application.

```sh
pnpm playground --offline
pnpm playground --directory /absolute/path/to/another-playground
pnpm playground --help
```

Offline mode populates local samples and reports missing downloads. Subsequent
online runs fill them. An existing downloaded sample is checked against its
pinned checksum and reused; changed bytes are preserved and reported.

## Contents and manual flows

| Folder                                 | Contents and intended exercise                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `previews/documents`                   | Three-page PDF with searchable text and outline, two-chapter EPUB, Word tables/headings, two-sheet Excel with saved formula values, DjVu image page and HTML variants. |
| `previews/images`                      | Synthetic raster/vector studies, a flattened PSD composite, extended system-rendered formats and original camera RAW files.                                            |
| `previews/audio`, `previews/video`     | Low-amplitude tones, synthetic motion patterns and a genuine Theora/Vorbis OGV trailer.                                                                                |
| `previews/models`, `previews/drawings` | Mesh/scene variants with companions, actual STEP/IGES solids and a millimeter DXF with CUT/HOLES layers.                                                               |
| `previews/archives`                    | ZIP, TAR, TAR.GZ and TGZ packages with nested documents/data.                                                                                                          |
| `previews/code-and-data`               | Every current language extension, structured JSON and delimited tables, plus conventional filenames and dotfiles.                                                      |
| `projects/static-website`              | Self-contained HTML/CSS/JS/JSON project for explicit local-server startup, interaction and request logs.                                                               |
| `git`                                  | One repository, three linked worktrees and a bare local remote.                                                                                                        |
| `edge-cases`                           | Explicitly invalid previews, empty text and awkward Unicode/space/dash filenames. These do not count toward positive coverage.                                         |
| `scratch`                              | Copies and experiments whose contents the generator leaves alone.                                                                                                      |
| `licenses`                             | Provenance and notices for generated, CAD and public media samples.                                                                                                    |
| `reports`                              | A new immutable generation report on every successful run.                                                                                                             |

Open the root in Viewer and optionally add it to Favorites. Use Space for Quick
Preview, open linked previews and compare copies placed in `scratch`. For the
website, run **Start local server** on its folder, open the URL, load its JSON
and inspect the server plane's request log. A Journal plane can show the resulting
Viewer activity.

`manifest.json` records each sample's relative path, declared extensions, expected
preview, description, source, license, byte size and SHA-256. Current extension
coverage is checked against the actual preview registry in the test suite.
Conventional filenames are recorded separately. Format aliases share an encoding
only where that encoding genuinely belongs to both names; MOV has its own
QuickTime container, and glTF retains its external buffer.

Sample presence is not decoder qualification. Extended images and RAW depend on
macOS and camera support; media depends on the Chromium codec build. The OGV
sample documents both playback and the expected explicit unsupported-codec error.
Vue/Svelte/TeX and similar examples exercise source inspection, not project
execution. See [the format inventory](preview-formats.md).

## Git work areas

Open `git/main`, then run **Open worktree…**:

- **main:** clean, two commits, tracking a local origin.
- **feature:** independent working files and index; staged addition/deletion,
  staged modification, working modifications and an untracked file. Its branch is
  one commit ahead and behind `origin/feature`.
- **review:** clean, with a separate review checklist commit.
- **conflict:** isolated unmerged stages and visible conflict markers.
- **local-remote.git:** bare local origin for human-invoked push/pull exercises.

Compare `index.html` between views or against HEAD, inspect logs and staged
changes, and open several views of one checkout. No network remote or credentials
are configured. The divergent feature branch deliberately needs a pull strategy;
it is not an example where an unconditional pull should succeed.

Only new scenario directories are initialized. Creation uses explicit fictional
identity/dates, empty templates/hooks and isolated Git configuration, with bounded
commands and local-file transport only. The deletion example is never materialized
in the feature checkout; its staged deletion requires no filesystem removal.

Linked worktrees contain paths to their shared repository. Keep this playground
at its chosen location. The generator does not repair or relocate registrations;
the [worktree guide](git-worktrees.md) covers how Viewer opens them.

## Preservation and implementation

The destination must be new or contain the exact recognized playground marker.
An unrelated existing folder, linked destination, linked parent within the
playground or linked output file is refused. The writer checks root identity,
accepts only relative paths within it, reads bounded regular files and uses
exclusive creation. Existing reference files are hashed and reported as unchanged
or modified; they are never overwritten. Files outside the recipes are untouched.

Once `git` exists, the generator leaves all its contents, branches, indices and
commits alone. An interrupted/unrecognized initialization is reported and retained;
it is not resumed by replaying Git mutations. Choose another destination for a
fresh scenario. No cleanup, reset or removal command is provided.

The implementation lives in `packages/viewer-electron/app/tools/playground`:
typed catalog/manifest records, additive filesystem writer, pinned downloads,
one-time Git seeding, format-specific recipe modules and a small CLI. Production
Viewer services and stored-state formats are unchanged. The optional
`generate-assets.py` recreates synthetic binary source assets using Pillow,
FFmpeg and macOS `sips`; it preserves existing assets.

The focused tests cover complete registry coverage, filename variants, CLI paths,
hash/size-checked downloads, link/traversal refusal and preservation of edits,
commits, index bytes and modification times across reruns. Decoder checks read
the actual PDF/EPUB/Office/archive files, render a nonblank DjVu page, load the
mesh formats, convert both CAD encodings and parse the drawing layers.

The populated October 25 playground contains **178 catalog samples covering all
141 declared extensions**, with no missing downloads. A rerun preserved the bytes
and modification times of all 298 checked reference/Git/metadata files. Its 29
focused and preview regression checks, all TypeScript targets, lint and formatting
pass; [verification](verification.md) records the retained evidence.

Public sample provenance:
[CC0 RAW release](https://github.com/tellodaniel/revelraw-sample-raw-files),
[Blender OGV attribution](https://commons.wikimedia.org/wiki/File:Big_Buck_Bunny_Trailer_400p.ogv).
Exact download URLs, sizes and SHA-256 values are versioned in the recipes and
copied to the generated manifest.
