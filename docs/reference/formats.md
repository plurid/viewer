# Supported preview formats

Select a file and press Space, or open it in a linked plane. This inventory describes current
preview routes; codec, source and platform limits still apply. A rendered bitmap or embedded
thumbnail is different from full semantic inspection. See [platform status](platforms.md) and
[preview usage](../guides/previews.md).

## Current document, image, media and model previews

| Family           | Extensions                                                                 | Current experience                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Images           | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.bmp`, `.ico`, `.svg`  | Image preview with zoom and image controls.                                                                                            |
| Extended images  | `.tif`, `.tiff`, `.heic`, `.heif`, `.psd`, `.jp2`, `.exr`, `.tga`, `.icns` | System-rendered bitmap; PSD coverage is its rendered composite.                                                                        |
| Camera RAW       | `.dng`, `.cr2`, `.cr3`, `.nef`, `.arw`, `.raf`, `.orf`, `.rw2`             | Independent LibRaw camera image or half-size RAW rendition, up to 4096px. Exact camera/encoding coverage still requires qualification. |
| PDF              | `.pdf`                                                                     | Pages, text-layer search/selection, thumbnails and outline navigation.                                                                 |
| Books            | `.epub`                                                                    | Chapter navigation and rendered book content.                                                                                          |
| DjVu             | `.djvu`, `.djv`                                                            | Page rendering and text-layer search.                                                                                                  |
| Word             | `.doc`, `.docx`                                                            | Local paginated layout; DOCX also has bounded Reading view.                                                                            |
| Excel            | `.xls`, `.xlsx`                                                            | Local print layout with worksheet navigation; XLSX also has stored-value cell inspection.                                              |
| PowerPoint       | `.ppt`, `.pptx`                                                            | Local slide layout, including supported charts, pictures and backgrounds.                                                              |
| Markdown         | `.md`, `.markdown`, `.mdx`                                                 | Rendered Markdown and source; MDX components do not execute.                                                                           |
| Web documents    | `.html`, `.htm`, `.xhtml`                                                  | Sandboxed rendered preview and editable source.                                                                                        |
| Structured data  | `.json`, `.jsonc`, `.json5`, `.yaml`, `.yml`, `.xml`                       | Searchable expandable tree and source, with bounded parsing and copy controls.                                                         |
| Delimited data   | `.csv`, `.tsv`                                                             | Table preview with filtering.                                                                                                          |
| Archives         | `.zip`, `.tar`, `.tar.gz`, `.tgz`                                          | Browse supported archive entries and open previewable contents.                                                                        |
| 3D meshes/scenes | `.glb`, `.gltf`, `.obj`, `.stl`, `.fbx`, `.3mf`, `.ply`                    | Interactive 3D viewing, dimensions, appearance controls and surface-point distance measurement.                                        |
| CAD exchange     | `.step`, `.stp`, `.iges`, `.igs`                                           | Locally converted geometry in the 3D viewer; dimensions normalized to millimeters.                                                     |
| 2D drawings      | ASCII `.dxf`                                                               | Supported model-space entities, layers, inspection, snapping and measurements.                                                         |
| Video            | `.mp4`, `.webm`, `.mov`, `.m4v`, `.ogv`                                    | Original Chromium playback, with an automatic bounded local compatibility copy for unsupported video; see media tools.                 |
| Audio            | `.mp3`, `.wav`, `.ogg`, `.flac`, `.m4a`, `.aac`, `.opus`                   | Playback through Chromium's media decoder, subject to codec compatibility.                                                             |

Media detection also accepts other audio/video MIME types. These may reach the player without being
listed above; that is an attempt to play the file, rather than a guarantee of decoding support.

Detailed coverage: [Office](office.md), [CAD/models](models.md), [DXF](models.md),
[HTML/local servers](web.md), and [preview modules](../development/previews.md).

## Current text, code and configuration previews

The following extensions are recognized by the registry and shared language catalog. Syntax
highlighting depends on the language; entries such as `.tex`, `.env`, `.gitignore` and `.jsonl` also
have text coverage without a dedicated document/data renderer. A text preview can offer editing in a
workspace plane; Quick Preview remains a reading surface.

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

- `README`, `LICENSE`, `Dockerfile`, `Containerfile`, `Makefile`, `GNUmakefile`, `makefile`,
  `Gemfile` and `Rakefile`.
- `.env` and `.env.*`, `.gitignore`, `.gitconfig` and `.editorconfig`.
- `.bashrc`, `.bash_profile`, `.zshrc`, `.zprofile`, `.zshenv` and `.profile`.

Vue/Svelte files are source previews, not running components. JSON, JSONC, JSON5, YAML, YML and XML
offer a shared searchable tree with Expand all, Collapse all, copy path/value and retained expansion
state. Alias references remain explicit; bounded parsing prevents recursive expansion. Invalid or
oversized structures retain Source with a visible explanation. JSONL remains source text. Other
readable files may use the bounded generic text fallback.

XML Tree preserves qualified element/attribute names, repeated children and mixed text order. UTF-8
and BOM-marked UTF-16 sources are supported. DTDs, custom entity declarations and external
resolution are rejected; source remains available. Tree inspection is bounded to 1 million decoded
characters and 50,000 nodes. It does not render domain-specific documents such as invoices.

Reading text uses separate preview font/line-height/wrap preferences, initially 16px/20px, with
local zoom/reset controls. This does not change editor settings. CSS selectors and property names
use theme syntax roles.
