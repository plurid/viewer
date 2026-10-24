# Preview format inventory

Last checked against the source on **October 24, 2026**. This is the reference for
current preview coverage, limitations within supported formats, and proposed
major and medium additions. Implementation status is separate from the
candidate-specific results in [verification](verification.md).

## Reading the inventory

- **Dedicated preview:** Viewer has a registered format viewer with the behavior
  described below. Supported features and input limits still apply.
- **System rendering:** Viewer displays a bitmap produced by macOS Quick Look.
  Decoding depends on the OS and its support for the particular file variant.
- **Text/source:** Viewer can show or edit source text. This does not imply a
  rendered application, notebook, map, toolpath or other format-specific view.
- **Proposed:** A future addition or deeper capability, with no implementation
  claim or delivery date. Major/medium indicates proposed product impact, not
  implementation effort.

The registry also attempts other files identified as text or audio/video. Its
declared extension lists are descriptive; detection, content, codecs and decoder
limits decide whether an individual file can actually be previewed. An icon,
thumbnail, embedded bitmap or file-information fallback does not establish full
format support.

## Current document, image, media and model previews

| Family           | Extensions                                                                 | Current experience                                                                              |
| ---------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Images           | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.bmp`, `.ico`, `.svg`  | Image preview with zoom and image controls.                                                     |
| Extended images  | `.tif`, `.tiff`, `.heic`, `.heif`, `.psd`, `.jp2`, `.exr`, `.tga`, `.icns` | System-rendered bitmap; PSD coverage is its rendered composite.                                 |
| Camera RAW       | `.dng`, `.cr2`, `.cr3`, `.nef`, `.arw`, `.raf`, `.orf`, `.rw2`             | System-rendered bitmap, dependent on camera/OS decoding support.                                |
| PDF              | `.pdf`                                                                     | Pages, text-layer search/selection, thumbnails and outline navigation.                          |
| Books            | `.epub`                                                                    | Chapter navigation and rendered book content.                                                   |
| DjVu             | `.djvu`, `.djv`                                                            | Page rendering and text-layer search.                                                           |
| Word             | `.docx`                                                                    | Read-only paragraphs, supported headings and simple tables.                                     |
| Excel            | `.xlsx`                                                                    | Read-only worksheets, stored cell values and saved-formula inspection.                          |
| Markdown         | `.md`, `.markdown`, `.mdx`                                                 | Rendered Markdown and source; MDX components do not execute.                                    |
| Web documents    | `.html`, `.htm`, `.xhtml`                                                  | Sandboxed rendered preview and editable source.                                                 |
| Structured JSON  | `.json`                                                                    | Expandable JSON tree and source.                                                                |
| Delimited data   | `.csv`, `.tsv`                                                             | Table preview with filtering.                                                                   |
| Archives         | `.zip`, `.tar`, `.tar.gz`, `.tgz`                                          | Browse supported archive entries and open previewable contents.                                 |
| 3D meshes/scenes | `.glb`, `.gltf`, `.obj`, `.stl`, `.fbx`, `.3mf`, `.ply`                    | Interactive 3D viewing, dimensions, appearance controls and surface-point distance measurement. |
| CAD exchange     | `.step`, `.stp`, `.iges`, `.igs`                                           | Locally converted geometry in the 3D viewer; dimensions normalized to millimeters.              |
| 2D drawings      | ASCII `.dxf`                                                               | Supported model-space entities, layers, inspection, snapping and measurements.                  |
| Video            | `.mp4`, `.webm`, `.mov`, `.m4v`, `.ogv`                                    | Playback through Chromium's media decoder, subject to container/codec compatibility.            |
| Audio            | `.mp3`, `.wav`, `.ogg`, `.flac`, `.m4a`, `.aac`, `.opus`                   | Playback through Chromium's media decoder, subject to codec compatibility.                      |

Media detection also accepts other audio/video MIME types. These may reach the
player without being listed above; that is an attempt to play the file, rather
than a guarantee of decoding support.

Detailed coverage:
[Office](office-previews.md), [CAD/models](model-previews.md),
[DXF](drawings.md), [HTML/local servers](web-previews.md), and
[preview modules](preview-modules.md).

## Current text, code and configuration previews

The following extensions are recognized by the registry and shared language
catalog. Syntax highlighting depends on the language; entries such as `.tex`,
`.env`, `.gitignore` and `.jsonl` also have text coverage without a dedicated
document/data renderer. A text preview can offer editing in a workspace plane;
Quick Preview remains a reading surface.

| Family                      | Extensions                                               |
| --------------------------- | -------------------------------------------------------- |
| Plain text/logs             | `.txt`, `.text`, `.log`                                  |
| JavaScript/JSX              | `.js`, `.mjs`, `.cjs`, `.jsx`                            |
| TypeScript/TSX              | `.ts`, `.mts`, `.cts`, `.tsx`                            |
| JSON and related text       | `.json`, `.jsonc`, `.json5`, `.jsonl`, `.webmanifest`    |
| HTML/component source       | `.html`, `.htm`, `.xhtml`, `.vue`, `.svelte`             |
| XML                         | `.xml`, `.svg`, `.plist`, `.xsl`                         |
| Stylesheets                 | `.css`, `.scss`, `.less`                                 |
| Markdown                    | `.md`, `.markdown`, `.mdx`                               |
| Python                      | `.py`, `.pyw`, `.pyi`                                    |
| Shell                       | `.sh`, `.bash`, `.zsh`, `.ksh`                           |
| C/C++                       | `.c`, `.h`, `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx` |
| C#                          | `.cs`, `.csx`                                            |
| Go/Rust                     | `.go`, `.rs`                                             |
| Java/Kotlin/Swift           | `.java`, `.kt`, `.kts`, `.swift`                         |
| Ruby                        | `.rb`, `.rake`, `.gemspec`                               |
| PHP                         | `.php`, `.phtml`                                         |
| SQL/GraphQL                 | `.sql`, `.graphql`, `.gql`                               |
| YAML/TOML/INI               | `.yaml`, `.yml`, `.toml`, `.ini`, `.cfg`, `.conf`        |
| Build/configuration text    | `.dockerfile`, `.mk`, `.mak`, `.env`, `.gitignore`       |
| Diffs                       | `.diff`, `.patch`                                        |
| Lua/R/Perl                  | `.lua`, `.r`, `.pl`, `.pm`                               |
| Other explicit text formats | `.csv`, `.tsv`, `.tex`                                   |

Recognized conventional filenames include:

- `README`, `LICENSE`, `Dockerfile`, `Containerfile`, `Makefile`, `GNUmakefile`,
  `makefile`, `Gemfile` and `Rakefile`.
- `.env` and `.env.*`, `.gitignore`, `.gitconfig` and `.editorconfig`.
- `.bashrc`, `.bash_profile`, `.zshrc`, `.zprofile`, `.zshenv` and `.profile`.

Vue/Svelte files are source previews, not running components. JSONC, JSON5 and
JSONL currently show text; the structured tree is specific to `.json`. Other
readable files may use the bounded generic text fallback.

## Deeper support missing within current families

| Current family             | Missing capability                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| DOCX                       | Full page layout, images, headers/footers, footnotes and merged-table fidelity.                                                               |
| XLSX                       | Number/date formatting, merged cells, charts and drawings. Formula inspection uses stored formulas/cached values; formulas are not evaluated. |
| TIFF/HEIC/RAW/EXR          | Multi-page TIFF navigation, richer metadata, histogram, exposure/tone mapping and color-managed inspection beyond the system bitmap.          |
| PSD                        | Layer/group inspection, artboards and asset extraction beyond its composite.                                                                  |
| DXF                        | Binary DXF, paper-space layouts, spline/hatch/image coverage, fuller CAD text/dimension fidelity and 3D solids.                               |
| STEP/IGES and other models | Assembly tree, part isolation, section planes, exact edge/vertex snapping, radii, surface area and volume from geometric topology.            |
| 3MF                        | Slicer/project settings and toolpaths; current support displays model geometry.                                                               |
| ZIP                        | ZIP64, multipart archives and encrypted entries; supported compression/entry limits also apply.                                               |
| Audio/video                | Reliable broader container/codec coverage, track selection and subtitle inspection.                                                           |
| JSON-family data           | Structured JSONC/JSON5 trees and JSONL record/table navigation.                                                                               |

Support for one variant does not establish support for encrypted Office files,
macro-enabled Office packages, every camera RAW model or every codec in a listed
media container. Exact reader limits and partial-coverage behavior remain in the
linked format guides.

## Proposed major additions

These are the largest coverage gaps for general browsing and developer/data
workflows. They are proposals, including when a file's source text is already
readable.

| Family                          | Extensions                                                                                | Proposed preview                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Presentations                   | `.pptx`, `.ppt`, `.odp`                                                                   | Slides, thumbnails, text search and speaker notes.                                                         |
| Other Office/ODF/rich text      | `.odt`, `.ods`, `.rtf`, `.doc`, `.xls`                                                    | Formatted documents and spreadsheet worksheets.                                                            |
| Apple iWork                     | `.pages`, `.numbers`, `.key`                                                              | Document, sheet and slide previews, with a clearly identified native rendering fallback where appropriate. |
| Additional archives/compression | `.7z`, `.rar`, `.tar.xz`, `.tar.bz2`, `.tar.zst`; standalone `.gz`, `.bz2`, `.xz`, `.zst` | Browse supported contents or inspect decompressed data, with bounded nested previews.                      |
| Databases                       | `.sqlite`, `.sqlite3`, `.db`, `.duckdb`                                                   | Schema, tables, filters and local read-only queries.                                                       |
| Columnar datasets               | `.parquet`, `.arrow`, `.feather`                                                          | Column types, sample rows, statistics and dataset comparisons.                                             |
| Fonts                           | `.ttf`, `.otf`, `.ttc`, `.woff`, `.woff2`                                                 | Specimens, glyph coverage, family/style metadata and weight inspection.                                    |
| Jupyter notebooks               | `.ipynb`                                                                                  | Markdown/code cells and saved outputs, without executing notebook code.                                    |

Broader media playback is also a major capability gap. Candidates include `.mkv`,
`.avi`, `.mpeg`, `.mpg`, `.mts`, `.m2ts`, `.ts`, `.vob` and `.3gp`. Some already
reach the generic player through MIME detection. Adding extensions alone cannot
provide missing decoders. Ambiguous `.ts`/`.mts` files also need content-aware
routing so video transport streams are distinguished from TypeScript source.

## Proposed medium and specialist additions

| Family                    | Extensions                                                                                | Proposed preview                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Email                     | `.eml`, `.msg`, `.mbox`                                                                   | Message headers/body, conversation navigation and attachments.                                                          |
| Contacts/calendars        | `.vcf`, `.ics`                                                                            | Contact cards, events and recurrence details.                                                                           |
| Creative/vector documents | `.ai`, `.eps`, `.psb`, `.xcf`, `.ora`, `.kra`, `.sketch`                                  | Artboards, layers, dimensions and embedded/composite previews.                                                          |
| Additional 3D scenes      | `.usd`, `.usda`, `.usdc`, `.usdz`, `.dae`, `.blend`, `.3ds`, `.abc`                       | Scene hierarchy, geometry, materials and camera inspection.                                                             |
| Additional CAD            | `.dwg`, `.dgn`, `.brep`, `.3dm`, `.FCStd`                                                 | Drawings, assemblies and geometry inspection through an appropriate decoder.                                            |
| Manufacturing/toolpaths   | `.gcode`, `.gco`, `.bgcode`, `.nc`, `.tap`                                                | Layers, toolpaths, travel/extrusion moves and dimensions.                                                               |
| Electronics               | `.kicad_pcb`, `.kicad_sch`, Gerber (`.gbr`, `.gtl`, `.gbl`, etc.), Excellon (`.drl`)      | Board/trace/drill layers, parts, nets and measurements.                                                                 |
| Geospatial                | `.geojson`, `.gpx`, `.kml`, `.kmz`, `.shp`, `.gpkg`; geospatial interpretation of GeoTIFF | Maps, tracks, features, coordinate systems and measurements. Current TIFF rendering does not provide a geospatial view. |
| Comics/other books        | `.cbz`, `.cbr`, DRM-free `.mobi`, `.azw3`, `.fb2`                                         | Page/chapter reading, navigation and book metadata.                                                                     |
| Scientific arrays         | `.npy`, `.npz`, `.h5`, `.hdf5`                                                            | Array/dataset hierarchy, shapes, types and bounded sample values.                                                       |
| ML artifacts              | `.safetensors`, `.onnx`, `.gguf`                                                          | Metadata, available architecture/tensor information and shapes without executing the model.                             |
| Additional imaging        | `.hdr`                                                                                    | HDR image preview and appropriate tone mapping.                                                                         |
| Disk/package inspection   | `.iso`, `.dmg`, `.pkg`                                                                    | Contents/metadata inspection through a dedicated adapter; no installation implied.                                      |

The native creative/CAD families require format-specific investigation. An
embedded image may be a useful labeled fallback, but is not equivalent to
decoding layers, assemblies or editable geometry. Similarly, `.db` needs signature
detection because that extension does not identify one database format.

## Suggested delivery order

For broad file-manager coverage:

1. PPTX, ODF and RTF, followed by other legacy Office formats and iWork fallbacks.
2. Additional archives and compressed streams.
3. Font specimens and metadata.
4. Notebook cells and saved outputs.
5. SQLite/DuckDB and Parquet/Arrow/Feather inspection.
6. Email/contacts/calendars and the specialist families above.

For fabrication workflows, G-code viewing and deeper CAD inspection can move
ahead of this sequence. DWG and other native CAD formats need a deliberate
decoder/conversion choice. [Format priorities](preview-roadmap.md) records the
domain-specific roadmap; this inventory records coverage.

A delivered preview should have representative valid/malformed fixtures, explicit
partial-support feedback, bounded work and resource cleanup, and a native
rendered check. Shared controls, linked comparisons and structured read-only
inspection should build on the existing preview services. See
[adding a preview module](preview-modules.md).

## Source of truth and references

When adding a format or changing coverage, update this inventory alongside the
relevant format guide and registry. Code ownership:

- [Preview selection and declared formats](../packages/viewer-electron/app/src/renderer/previews/registry.ts).
- [Text languages and conventional filenames](../packages/viewer-electron/app/src/domain/editing/languages.ts).
- [3D/CAD formats](../packages/viewer-electron/app/src/domain/previews/models/formats.ts).
- [System-rendered image formats](../packages/viewer-electron/app/src/domain/previews/images/rendered.ts).
- [Archive reader](../packages/viewer-electron/app/src/desktop/previews/archives.ts).

Format references used in the proposals:
[Office conversion/filter families](https://help.libreoffice.org/latest/en-US/text/shared/guide/convertfilters.html),
[Jupyter notebook structure](https://nbformat.readthedocs.io/en/latest/format_description.html),
[USD file formats](https://openusd.org/release/usdfaq.html),
[Parquet inspection](https://duckdb.org/docs/extensions/parquet), and
[media containers/codecs](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Containers).
