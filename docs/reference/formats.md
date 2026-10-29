# Supported preview formats

Select a file and press Space, or open it in a linked plane. This inventory describes current
preview routes; codec, source and platform limits still apply. A rendered bitmap or embedded
thumbnail is different from full semantic inspection. See [platform status](platforms.md) and
[preview usage](../guides/previews.md).

## Current document, image, media and model previews

| Family                | Extensions                                                                                                                           | Current experience                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Images                | `.png`, `.apng`, `.jpg`, `.jpeg`, `.jpe`, `.jfif`, `.gif`, `.webp`, `.avif`, `.bmp`, `.ico`, `.svg`                                  | Image preview with zoom and image controls.                                                                                            |
| Extended images       | `.tif`, `.tiff`, `.heic`, `.heif`, `.psd`, `.jp2`, `.exr`, `.tga`, `.icns`, `.pbm`, `.pgm`, `.ppm`, `.pnm`, `.ktx`, `.astc`, `.svgz` | System-rendered bitmap; PSD coverage is its rendered composite. A compressed SVG is expanded, up to 8 MB, before drawing.              |
| Camera RAW            | `.dng`, `.cr2`, `.cr3`, `.nef`, `.arw`, `.raf`, `.orf`, `.rw2`                                                                       | Independent LibRaw camera image or half-size RAW rendition, up to 4096px. Exact camera/encoding coverage still requires qualification. |
| PDF                   | `.pdf`                                                                                                                               | Pages, text-layer search/selection, thumbnails and outline navigation.                                                                 |
| Books                 | `.epub`                                                                                                                              | Chapters, local illustrations, internal links/footnotes, book search and named bookmarks.                                              |
| DjVu                  | `.djvu`, `.djv`                                                                                                                      | Page rendering and text-layer search.                                                                                                  |
| Word                  | `.doc`, `.docx`, `.docm`, `.dot`, `.dotx`, `.dotm`, `.rtf`                                                                           | Local paginated layout; the OOXML forms also have bounded Reading view. Macros never run.                                              |
| Excel                 | `.xls`, `.xlsx`, `.xlsm`, `.xlt`, `.xltx`, `.xltm`                                                                                   | Local print layout with worksheet navigation; the OOXML forms also have stored-value cell inspection.                                  |
| PowerPoint            | `.ppt`, `.pptx`, `.pptm`, `.pps`, `.ppsx`, `.pot`, `.potx`, `.potm`                                                                  | Local slide layout, including supported charts, pictures and backgrounds.                                                              |
| OpenDocument          | `.odt`, `.ods`, `.odp`, `.odg`, and the flat `.fodt`, `.fods`, `.fodp`, `.fodg`                                                      | Local layout through the same engine; spreadsheets have worksheet navigation.                                                          |
| Markdown              | `.md`, `.markdown`, `.mdx`                                                                                                           | Rendered Markdown and source; MDX components do not execute.                                                                           |
| Notebooks             | `.ipynb`                                                                                                                             | Markdown and code cells with their saved outputs; nothing runs.                                                                        |
| Web documents         | `.html`, `.htm`, `.xhtml`                                                                                                            | Sandboxed rendered preview and editable source.                                                                                        |
| Structured data       | `.json`, `.jsonc`, `.json5`, `.yaml`, `.yml`, `.xml`, `.plist`                                                                       | Searchable expandable tree and source, with bounded parsing and copy controls. Binary property lists are decoded, read-only.           |
| Map data              | `.geojson`, `.topojson`, `.gpx`, `.kml`                                                                                              | The same tree, read as JSON or XML.                                                                                                    |
| Delimited data        | `.csv`, `.tsv`                                                                                                                       | Table preview with filtering.                                                                                                          |
| SQLite                | `.sqlite`, `.sqlite3`, `.db3`, `.db`                                                                                                 | Tables, columns and paged rows, read-only.                                                                                             |
| Calendar and contacts | `.ics`, `.ical`, `.vcf`, `.vcard`                                                                                                    | Events by start time, or contact cards; a genomic VCF shows as text.                                                                   |
| Subtitles             | `.srt`, `.vtt`, `.ass`, `.ssa`                                                                                                       | A searchable table of cues with their times.                                                                                           |
| Fonts                 | `.ttf`, `.otf`, `.woff`, `.woff2`                                                                                                    | Sample text at chosen sizes, names and the characters the face covers.                                                                 |
| Archives              | `.zip`, `.tar`, `.tar.gz`, `.tgz`                                                                                                    | Browse supported archive entries and open previewable contents.                                                                        |
| ZIP packages          | `.jar`, `.war`, `.ear`, `.apk`, `.aab`, `.ipa`, `.whl`, `.nupkg`, `.vsix`, `.xpi`, `.kmz`, `.cbz`                                    | Listed and opened as the ZIP archives they are.                                                                                        |
| 3D meshes/scenes      | `.glb`, `.gltf`, `.obj`, `.stl`, `.fbx`, `.3mf`, `.ply`                                                                              | Interactive 3D viewing, dimensions, appearance controls and surface-point distance measurement.                                        |
| CAD exchange          | `.step`, `.stp`, `.iges`, `.igs`                                                                                                     | Locally converted geometry in the 3D viewer; dimensions normalized to millimeters.                                                     |
| 2D drawings           | ASCII `.dxf`                                                                                                                         | Supported model-space entities, layers, inspection, snapping and measurements.                                                         |
| Video                 | `.mp4`, `.webm`, `.mov`, `.m4v`, `.ogv`                                                                                              | Original Chromium playback, with an automatic bounded local compatibility copy for unsupported video; see media tools.                 |
| Converted video       | `.avi`, `.mkv`, `.mpg`, `.mpeg`, `.m2ts`, `.wmv`, `.asf`, `.flv`, `.3gp`, `.3g2`, `.vob`, `.mxf`, and recorded `.ts` and `.mts`      | A complete local H.264 copy, up to 64 MB, made by the bundled FFmpeg when Chromium cannot play the original.                           |
| Audio                 | `.mp3`, `.wav`, `.ogg`, `.flac`, `.m4a`, `.aac`, `.opus`                                                                             | Playback through Chromium's media decoder, subject to codec compatibility.                                                             |
| Converted audio       | `.aif`, `.aiff`, `.caf`, `.wma`, `.mka`, `.ac3`, `.wv`                                                                               | A complete local AAC copy, checked through its last frame.                                                                             |

Media detection also accepts other audio/video MIME types. These may reach the player without being
listed above; Viewer tries to play the file, with no guarantee that it decodes.

`.ts` and `.mts` name TypeScript as well as MPEG transport streams. A file with those names that
reads as binary is checked for the stream's packet pattern and plays as video; otherwise it is code.

Detailed coverage: [Office](office.md), [CAD/models](models.md), [DXF](models.md),
[HTML/local servers](web.md), and [preview modules](../development/previews.md).

## EPUB reading limits

The reader builds a safe document tree, without source scripts, styles, embedded applications or
network resources. Internal links resolve inside the publication, including supported footnote
chapters outside the main reading order. A missing target stays in the book with an explanation.
External links remain text. Supported local PNG, JPEG, GIF and WebP illustrations load through the
book's authorized resource, at most 8 MiB and 64 million pixels each. Unsupported images retain
their alternative text.

Extraction is bounded to 32 MB of expanded text files, 300 chapters and 400,000 characters per
chapter. Each rendered chapter is bounded to 20,000 nodes and 100 levels. Find in book searches the
available sanitized chapters, including text split by inline formatting. It shows up to 200 matches
and identifies partial coverage. Loading illustrations releases their resources when the chapter or
preview closes. Chapter, text size and supported scroll position remain in versioned preview
history.

Named bookmarks store a chapter path and horizontal/vertical scroll coordinates in the file's
preview state within the workspace. Names are limited to 80 characters; a blank name uses the
current chapter title. Up to 32 bookmarks share a 4096-byte saved marker budget, so long names and
chapter paths can fill it sooner. The sidebar supports opening, renaming and removing markers.

Bookmarks survive preview closure, reopen, app restart and changed source revisions. Transient
reader coordinates still reset after a source change. A marker whose chapter path is unavailable
stays visible and disabled with **Chapter unavailable**; Viewer never opens a guessed chapter. Saved
coordinates are positions, not text anchors, so edited chapter content can move the passage. Adding
or removing bookmarks does not change the original EPUB. See
[saving a book position](../guides/previews.md#bookmark-a-place-in-a-book) for the controls.

## Databases, fonts and other readers

**SQLite.** The file opens read-only and immutable, so no journal or side files appear and a live
writer's uncommitted changes are not shown. Views are listed with their columns and definition but
never run. Row counts stop at 100,000; pages hold at most 200 rows and long text is cut. Databases
up to 2 GB open; encrypted or damaged files say so. A `.db` file that is not SQLite shows as text.

**Fonts.** The font loads only into the preview. Names, glyph count and coverage are read from the
font's own tables, up to 32 MB. WOFF2 shows sample text without those details, because its tables
use Brotli compression.

**Notebooks.** Images in outputs show up to 2 MB each. HTML outputs are never rendered; their source
is available. Up to 1,000 cells are read.

**Calendar and contacts.** Times in a named zone are converted; a zone name the system does not know
is shown as written. Photos show only when they are embedded image data.

**Subtitles.** ASS and SSA style tags are removed from the cue text.

## Files whose name does not say

When no preview reads a file, Viewer reads its first 4 KB and names the format from a table of
signatures: databases, archives and compressed files, documents, images, audio and video, fonts,
executables and libraries, and installer packages. Text is shown as text and is never named this
way.

These formats show in place with **Show as**, whatever the file is called: SQLite; ZIP, JAR, APK,
tar and compressed tar archives; PDF and DjVu; PNG, JPEG, GIF, WebP, BMP, ICO, AVIF, HEIC, TIFF,
PSD, JPEG 2000, ICNS and OpenEXR images; MP4, MOV, WebM, M4A, MP3, AAC, FLAC, Ogg, Opus and WAV;
TrueType, OpenType, WOFF and WOFF2 fonts; binary property lists.

- Images show as a rendered still of at most 4096 pixels on the long side, so an animated GIF or
  WebP shows its first frame.
- A PDF shown this way cannot be printed until it is renamed to end in `.pdf`.
- A gzip file shows as an archive only when its name says `.tar`.

Office, OpenDocument and EPUB files, camera raw photos and the video and audio formats Viewer plays
through a copy are named but not shown: Viewer reads those by the file's own extension. The message
names the extension that makes them preview.

**Ask** sends the prompt model the file's name, its size and its first 64 bytes, as hexadecimal and
as printable characters, with the name of any signature Viewer matched. It needs the excerpts
permission. The answer is a proposal: what the file is, its usual extension and up to four apps that
open it.

## Current text, code and configuration previews

The following extensions are recognized by the registry and shared language catalog. Syntax
highlighting depends on the language; entries such as `.env`, `.gitignore` and `.jsonl` also have
text coverage without a dedicated document/data renderer. Text written as UTF-16 with a byte-order
mark, as Windows tools and macOS `.strings` files often are, reads as text. A text preview can offer
editing in a workspace plane; Quick Preview remains a reading surface.

| Family                       | Extensions                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| Plain text/logs              | `.txt`, `.text`, `.log`, `.org`, `.bib`                                                               |
| JavaScript/JSX               | `.js`, `.mjs`, `.cjs`, `.jsx`                                                                         |
| TypeScript/TSX               | `.ts`, `.mts`, `.cts`, `.tsx`                                                                         |
| JSON and related text        | `.json`, `.jsonc`, `.json5`, `.jsonl`, `.webmanifest`, `.geojson`, `.topojson`                        |
| HTML/component source        | `.html`, `.htm`, `.xhtml`, `.vue`, `.svelte`                                                          |
| XML                          | `.xml`, `.svg`, `.plist`, `.xsl`, `.xsd`, `.gpx`, `.kml`                                              |
| Stylesheets                  | `.css`, `.scss`, `.less`                                                                              |
| Markdown and other markup    | `.md`, `.markdown`, `.mdx`, `.rst`, `.adoc`, `.asciidoc`                                              |
| LaTeX                        | `.tex`, `.sty`, `.cls`, `.ltx`                                                                        |
| Python                       | `.py`, `.pyw`, `.pyi`                                                                                 |
| Shell and Windows scripts    | `.sh`, `.bash`, `.zsh`, `.ksh`, `.ps1`, `.psm1`, `.psd1`, `.bat`, `.cmd`                              |
| C/C++/Objective-C            | `.c`, `.h`, `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx`, `.m`, `.mm`                                 |
| C#/F#/Visual Basic           | `.cs`, `.csx`, `.fs`, `.fsi`, `.fsx`, `.vb`                                                           |
| Go/Rust/Zig                  | `.go`, `.rs`, `.zig`                                                                                  |
| Java, Kotlin, Scala, Groovy  | `.java`, `.kt`, `.kts`, `.scala`, `.sc`, `.groovy`, `.gradle`                                         |
| Swift/Dart                   | `.swift`, `.dart`                                                                                     |
| Ruby                         | `.rb`, `.rake`, `.gemspec`                                                                            |
| PHP                          | `.php`, `.phtml`                                                                                      |
| Functional languages         | `.hs`, `.lhs`, `.ml`, `.mli`, `.ex`, `.exs`, `.erl`, `.hrl`, `.clj`, `.cljs`, `.cljc`, `.edn`, `.elm` |
| Julia/R/Lua/Perl             | `.jl`, `.r`, `.lua`, `.pl`, `.pm`                                                                     |
| SQL/GraphQL/Protocol Buffers | `.sql`, `.graphql`, `.gql`, `.proto`                                                                  |
| Solidity/Assembly            | `.sol`, `.asm`, `.nasm`                                                                               |
| YAML/TOML/INI/properties     | `.yaml`, `.yml`, `.toml`, `.ini`, `.cfg`, `.conf`, `.properties`                                      |
| Build/configuration text     | `.dockerfile`, `.mk`, `.mak`, `.cmake`, `.nix`, `.tf`, `.tfvars`, `.hcl`, `.env`, `.gitignore`        |
| Diffs                        | `.diff`, `.patch`                                                                                     |
| Other explicit text formats  | `.csv`, `.tsv`                                                                                        |

Recognized conventional filenames include:

- `README`, `LICENSE`, `Dockerfile`, `Containerfile`, `Makefile`, `GNUmakefile`, `makefile`,
  `Gemfile`, `Rakefile`, `CMakeLists.txt`, `Jenkinsfile` and `nginx.conf`.
- `.env` and `.env.*`, `.gitignore`, `.gitconfig` and `.editorconfig`.
- `.bashrc`, `.bash_profile`, `.zshrc`, `.zprofile`, `.zshenv` and `.profile`.

Vue/Svelte files are source previews, not running components. JSON, JSONC, JSON5, YAML, YML, XML,
property lists and map data offer a shared searchable tree with Expand all, Collapse all, copy
path/value and retained expansion state. Alias references remain explicit; bounded parsing prevents
recursive expansion. Invalid or oversized structures retain Source with a visible explanation. JSONL
remains source text. Other readable files may use the bounded generic text fallback.

XML Tree preserves qualified element/attribute names, repeated children and mixed text order. UTF-8
and BOM-marked UTF-16 sources are supported. DTDs, custom entity declarations and external
resolution are rejected; source remains available. Tree inspection is bounded to 1 million decoded
characters and 50,000 nodes. It does not render domain-specific documents such as invoices.

Reading text uses separate preview font/line-height/wrap preferences, initially 16px/20px, with
local zoom/reset controls. This does not change editor settings. CSS selectors and property names
use theme syntax roles.
