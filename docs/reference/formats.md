# Supported preview formats

This page lists every file format Viewer previews, by extension, with each reader's limits.

Select a file and press **Space**, or open it in a linked plane. A rendered bitmap or a saved
picture is not the same as reading the document's contents; each row says which one you get. Codec
and platform limits still apply.

## Current document, image, media and model previews

| Family                  | Extensions                                                                                                                                                             | Current experience                                                                                                                                                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Images                  | `.png`, `.apng`, `.jpg`, `.jpeg`, `.jpe`, `.jfif`, `.gif`, `.webp`, `.avif`, `.bmp`, `.ico`, `.svg`                                                                    | Image preview with zoom and image controls.                                                                                                                                                                                                                              |
| Extended images         | `.tif`, `.tiff`, `.heic`, `.heif`, `.psd`, `.jp2`, `.exr`, `.tga`, `.icns`, `.pbm`, `.pgm`, `.ppm`, `.pnm`, `.ktx`, `.astc`, `.svgz`                                   | System-rendered bitmap; PSD coverage is its rendered composite. A compressed SVG is expanded, up to 8 MB, before drawing.                                                                                                                                                |
| Camera RAW              | `.dng`, `.cr2`, `.cr3`, `.nef`, `.arw`, `.raf`, `.orf`, `.rw2`, `.nrw`, `.srw`, `.pef`, `.rwl`, `.3fr`, `.iiq`, `.erf`, `.mrw`, `.kdc`, `.dcr`, `.srf`, `.sr2`, `.mos` | Independent LibRaw camera image or half-size RAW rendition, up to 4096px. Exact camera/encoding coverage still requires qualification.                                                                                                                                   |
| PDF                     | `.pdf`                                                                                                                                                                 | Pages, text-layer search/selection, thumbnails and outline navigation.                                                                                                                                                                                                   |
| Books                   | `.epub`, `.fb2`                                                                                                                                                        | Chapters, local illustrations, internal links/footnotes, book search and named bookmarks. A FictionBook opens on its cover, title and authors.                                                                                                                           |
| DjVu                    | `.djvu`, `.djv`                                                                                                                                                        | Page rendering and text-layer search.                                                                                                                                                                                                                                    |
| Word                    | `.doc`, `.docx`, `.docm`, `.dot`, `.dotx`, `.dotm`, `.rtf`                                                                                                             | Local paginated layout; the OOXML forms also have bounded Reading view. Macros never run.                                                                                                                                                                                |
| Excel                   | `.xls`, `.xlsx`, `.xlsm`, `.xlt`, `.xltx`, `.xltm`                                                                                                                     | Local print layout with worksheet navigation; the OOXML forms also have stored-value cell inspection.                                                                                                                                                                    |
| PowerPoint              | `.ppt`, `.pptx`, `.pptm`, `.pps`, `.ppsx`, `.pot`, `.potx`, `.potm`                                                                                                    | Local slide layout, including supported charts, pictures and backgrounds.                                                                                                                                                                                                |
| OpenDocument            | `.odt`, `.ods`, `.odp`, `.odg`, the templates `.ott`, `.ots`, `.otp`, and the flat `.fodt`, `.fods`, `.fodp`, `.fodg`                                                  | Local layout through the same engine; spreadsheets have worksheet navigation. A packaged file shows the picture of its first page it carries while the layout renders.                                                                                                   |
| Publisher and metafiles | `.pub`, `.emf`, `.wmf`                                                                                                                                                 | Local layout through the same engine, as drawing pages. A `.pub` file written as text, such as a public key, keeps the preview it had.                                                                                                                                   |
| Saved previews          | `.pages`, `.numbers`, `.key`, `.kra`, `.ora`, `.sketch`, `.xps`, `.oxps`                                                                                               | The preview image the document saved, said to be one, with its canvas size or page count. A Pages, Numbers or Keynote package folder shows the same way. Nothing is rendered.                                                                                            |
| Markdown                | `.md`, `.markdown`, `.mdx`                                                                                                                                             | Rendered Markdown and source; MDX components do not execute.                                                                                                                                                                                                             |
| Notebooks               | `.ipynb`                                                                                                                                                               | Markdown and code cells with their saved outputs; nothing runs.                                                                                                                                                                                                          |
| Web documents           | `.html`, `.htm`, `.xhtml`                                                                                                                                              | Sandboxed rendered preview and editable source.                                                                                                                                                                                                                          |
| Saved web pages         | `.webarchive`                                                                                                                                                          | Safari's saved page with the stylesheets, images and fonts it holds, without scripts. Nothing loads from the network.                                                                                                                                                    |
| Structured data         | `.json`, `.jsonc`, `.json5`, `.yaml`, `.yml`, `.xml`, `.plist`                                                                                                         | Searchable expandable tree and source, with bounded parsing and copy controls. Binary property lists are decoded, read-only.                                                                                                                                             |
| Map data                | `.geojson`, `.topojson`, `.gpx`, `.kml`                                                                                                                                | The same tree, read as JSON or XML.                                                                                                                                                                                                                                      |
| Delimited data          | `.csv`, `.tsv`                                                                                                                                                         | Table preview with filtering.                                                                                                                                                                                                                                            |
| SQLite                  | `.sqlite`, `.sqlite3`, `.db3`, `.db`                                                                                                                                   | Tables, columns and paged rows, read-only.                                                                                                                                                                                                                               |
| Calendar and contacts   | `.ics`, `.ical`, `.vcf`, `.vcard`                                                                                                                                      | Events by start time, or contact cards; a genomic VCF shows as text.                                                                                                                                                                                                     |
| Email                   | `.eml`, `.emlx`, `.mbox`                                                                                                                                               | The message's sender, recipients, date and subject, its HTML or plain text body and a list of attachments. HTML shows without scripts or remote images. A mailbox lists its messages; each opens in the same view.                                                       |
| Subtitles               | `.srt`, `.vtt`, `.ass`, `.ssa`                                                                                                                                         | A searchable table of cues with their times.                                                                                                                                                                                                                             |
| Fonts                   | `.ttf`, `.otf`, `.woff`, `.woff2`                                                                                                                                      | Sample text at chosen sizes, names and the characters the face covers.                                                                                                                                                                                                   |
| Certificates and keys   | `.pem`, `.crt`, `.cer`, `.der`, and PEM or OpenPGP armor in `.key`, `.pub`, `.asc`                                                                                     | Each certificate's subject, issuer, validity, key, names and fingerprints, and the chain a file holds. A private key shows its type and size only.                                                                                                                       |
| Internet shortcuts      | `.url`, `.webloc`                                                                                                                                                      | The address and its host, with **Open** for a web or email address. Viewer never loads the address.                                                                                                                                                                      |
| Torrents                | `.torrent`                                                                                                                                                             | Name, size, pieces, files, trackers, creation date and info-hash. Viewer contacts no tracker.                                                                                                                                                                            |
| Provisioning profiles   | `.mobileprovision`, `.provisionprofile`                                                                                                                                | App ID, team, expiry, devices, entitlements and developer certificates. The signature is not checked.                                                                                                                                                                    |
| Archives                | `.zip`, `.tar`, `.tar.gz`, `.tgz`                                                                                                                                      | Browse supported archive entries and open previewable contents.                                                                                                                                                                                                          |
| ZIP packages            | `.jar`, `.war`, `.ear`, `.apk`, `.aab`, `.ipa`, `.whl`, `.nupkg`, `.vsix`, `.xpi`, `.kmz`, `.cbz`                                                                      | Listed and opened as the ZIP archives they are.                                                                                                                                                                                                                          |
| Compressed files        | `.gz` that is not a tar archive                                                                                                                                        | The file inside, read-only, with its text, code, data, log, subtitle, calendar or notebook preview, from up to 16 MB compressed and 8 MB expanded; other kinds show the inner name and its expanded size. `.tar.gz` and `.tgz` are archives.                             |
| 3D meshes/scenes        | `.glb`, `.gltf`, `.obj`, `.stl`, `.fbx`, `.3mf`, `.ply`, `.dae`, `.3ds`, `.usdz`, `.x3d`, `.wrl`, `.off`                                                               | Interactive 3D viewing, dimensions, appearance controls and surface-point distance measurement. Collada, 3DS, USDZ, X3D, VRML and OFF show only what the file holds; files they name are listed, never loaded.                                                           |
| CAD exchange            | `.step`, `.stp`, `.iges`, `.igs`                                                                                                                                       | Locally converted geometry in the 3D viewer; dimensions normalized to millimeters.                                                                                                                                                                                       |
| 2D drawings             | ASCII `.dxf`                                                                                                                                                           | Supported model-space entities, layers, inspection, snapping and measurements.                                                                                                                                                                                           |
| Video                   | `.mp4`, `.webm`, `.mov`, `.m4v`, `.ogv`, `.f4v`                                                                                                                        | Original Chromium playback, with an automatic bounded local compatibility copy for unsupported video; see media tools. A subtitle file named like the video (`.srt`, `.vtt`, `.ass`, `.ssa`, also `Movie.en.srt`) can show as its subtitles, up to 2 MB and 20,000 cues. |
| Converted video         | `.avi`, `.mkv`, `.mpg`, `.mpeg`, `.m2ts`, `.wmv`, `.asf`, `.flv`, `.3gp`, `.3g2`, `.vob`, `.mxf`, `.m2v`, and recorded `.ts` and `.mts`                                | A complete local H.264 copy, at most 1280 × 720 and 64 MB, made by the bundled FFmpeg within two minutes when Chromium cannot play the original.                                                                                                                         |
| Audio                   | `.mp3`, `.wav`, `.ogg`, `.flac`, `.m4a`, `.aac`, `.opus`, `.oga`                                                                                                       | Playback through Chromium's media decoder, subject to codec compatibility.                                                                                                                                                                                               |
| Converted audio         | `.aif`, `.aiff`, `.caf`, `.wma`, `.mka`, `.ac3`, `.wv`, `.amr`, `.ape`, `.au`, `.snd`, `.mp2`, `.mpa`                                                                  | A complete local AAC copy of at most 64 MB, checked through its last frame.                                                                                                                                                                                              |
| Other files             | Any file no preview reads                                                                                                                                              | The file's bytes in a hex view, under what its first bytes say it is. **Hex** shows any file this way.                                                                                                                                                                   |

Media detection also accepts other audio/video MIME types. These may reach the player without being
listed above; Viewer tries to play the file, with no guarantee that it decodes.

`.ts` and `.mts` name TypeScript as well as MPEG transport streams. When Viewer opens such a file it
reads its first 1.5 KB: a stream's packets repeating there make it a video, played through a copy.
Text, a short file or anything unclear opens as code. Quick Preview, Columns and a double-clicked
plane all show what those bytes say.

Detailed coverage: [Office](office.md), [models, CAD and DXF](models.md),
[HTML and local servers](web.md), and [preview modules](../development/previews.md).

## EPUB reading limits

The reader builds a safe document tree, without source scripts, styles, embedded applications or
network resources. Internal links resolve inside the publication, including supported footnote
chapters outside the main reading order. A missing target stays in the book with an explanation.
External links remain text. Supported local PNG, JPEG, GIF and WebP illustrations load through the
book's authorized resource, at most 8 MB and 64 million pixels each. Unsupported images retain their
alternative text.

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

## Email, FictionBook and saved web pages

**Email.** A message file is read up to 64 MB. Viewer reads MIME multipart messages,
quoted-printable and base64 parts, encoded words and RFC 2231 file names in the header, and the
charset each part names. A part that names none reads as UTF-8, or as Windows-1252 when it is not
UTF-8. An `.emlx` file is Apple Mail's: the message after its length line. Mail's flags after the
message are not read.

- Up to 1,000 parts nested 16 levels deep, 500 attachments and 1,000,000 characters of plain text
  are read. A message past these limits says so.
- Of an alternative's forms, the HTML one shows and **Plain text** shows the other. Plain text
  written as `format=flowed` is joined where its writer wrapped it.
- The HTML body, up to 4 MB, shows in the same isolated frame as an HTML file, and none of its
  scripts run. Pictures it names by Content-ID come from the message, up to 8 MB each and 32 MB
  together. Remote images, stylesheets, fonts, frames and forms are removed and never load; **Remote
  images are blocked.** says when the message named any. A link keeps its address as a tooltip and
  goes nowhere.
- Attachments are listed with their name, type and size. Viewer never opens or runs one.
- **Save** writes an attachment beside its message, **Save to…** in a folder you choose, and **Save
  All** every attachment of the message. Each save is a file operation: a name in use keeps both
  (`Invoice copy.pdf`), and **Undo** moves the saved file to the Trash. The message is read again
  for the save, and nothing is saved when it changed after it was shown. A message inside an archive
  has no **Save**.
- A saved name keeps the attachment's name, with path separators as hyphens, without control
  characters, marks that reorder text, leading dots or trailing dots and spaces, and cut to 240
  bytes. A name Windows reserves, such as `CON`, gains an underscore.
- A saved attachment is marked as downloaded, as Mail marks one, so macOS checks it before it first
  opens.

**Mailboxes.** A `.mbox` file lists its messages by date, sender and subject, up to 10,000 messages
from its first 2 GB. The list keeps only the start of each message's header; a message is read on
its own when you choose it, up to 64 MB. A message starts at a `From ` line at the start of the
file, after a blank line, or with an envelope date. A body line quoted as `>From ` reads as `From `.
A `.mbox` folder, as Mail exports one, opens as a folder.

**FictionBook.** An `.fb2` book, up to 32 MB, is read as XML without a DTD or entity declarations; a
book that has one does not open. The encoding its declaration names, such as Windows-1251, is used.
The book opens on a title page with its cover, title, authors, series and annotation, then a chapter
for each top-level section and one for its notes. Note links go to the note. Up to 300 chapters of
400,000 characters each are read. PNG, JPEG, GIF and WebP pictures from the book show, checked by
their bytes, at most 8 MB and 64 million pixels each and 16 MB together. **Find in book** and
bookmarks work as in an EPUB.

**Saved web pages.** A `.webarchive` file, a binary or XML property list up to 64 MB, shows the page
Safari saved, up to 4 MB of HTML. Stylesheets, images and fonts the archive holds load from it, up
to 8 MB each and 32 MB together, and a stylesheet's own references resolve the same way. Scripts,
frames, video, audio and anything the archive does not hold never load; **Content not saved in the
archive is not loaded.** says when the page named any. Links go nowhere.

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

**Saved previews.** Viewer reads only the picture each format saves, and the part that gives its
size or page count:

- Pages, Numbers and Keynote: the largest of `preview.jpg`, `preview-web.jpg` and
  `preview-micro.jpg`, or `QuickLook/Thumbnail.jpg` in an older document. A package folder is read
  the same way, and links inside it are not followed. It opens in a preview plane, not a folder
  plane, and the footer shows its total size, measured once per version of the package; **Show
  Package Contents** opens the folder.
- Krita: `mergedimage.png`, then `preview.png`; the canvas size from `maindoc.xml`.
- OpenRaster: `mergedimage.png`, then `Thumbnails/thumbnail.png`; the canvas size from `stack.xml`.
- Sketch: `previews/preview.png`; the page count from `meta.json`.
- XPS and OpenXPS: `docProps/thumbnail.jpeg` or `.png`; the page count from up to 16 documents in
  the file. Without a thumbnail the preview says **No preview image in this document**.

A picture is at most 32 MB and 64 million pixels, and must be the PNG or JPEG its name says. A part
read for a size or count is at most 1 MB. Double-click opens the document in its own app. A `.key`
file written as text, such as a private key, keeps the preview it had, and double-click opens it in
Viewer: Viewer reads its first bytes and sends only a ZIP to Keynote.

## Certificates, keys, shortcuts, torrents and profiles

Viewer's desktop service reads these files in its preview worker. Double-click shows the preview:
the file's own app would import a certificate or profile, follow a link or start a download.

**Certificates and keys.** Up to 4 MB and 256 blocks are read, with the system's certificate and key
readers. Each certificate shows its subject, issuer, serial number, validity, key type and size,
alternative names, extended key usage, SHA-256 and SHA-1 fingerprints, and whether it is a
certificate authority. **Expired** or **Not yet valid** says when today falls outside its validity.
When one certificate in the file issued another and its key verifies the signature, the chain shows
from the first certificate to its root.

- A private key in PEM, DER, OpenSSH or OpenPGP form shows its type and size, and whether a
  passphrase protects it. Its bytes never reach the preview or search, and a file holding one offers
  neither **Source** nor **Show as hex**.
- An OpenPGP public key shows its user IDs, keys, creation and expiry dates and fingerprints; a
  signature shows its signer, and an encrypted message the keys it is for.
- A block Viewer does not read, such as a certificate request, shows as text.
- A `.key`, `.pub` or `.asc` file without PEM or armor keeps the preview it had: an OpenSSH public
  key shows as text, and a Publisher `.pub` file as its layout.
- OpenSSH's private key files without an extension, such as `id_ed25519`, are read the same way.

**Internet shortcuts.** Viewer reads a Windows `.url` file's `URL` entry, or `BASEURL` without one,
and a `.webloc` property list's `URL`, up to 64 KB. **Open in Browser** or **Open in Mail App**
hands the address to the app macOS opens it with. The desktop service accepts only `http`, `https`
and `mailto` addresses without a user name or password. A host in another script shows as the
browser addresses it, beginning `xn--`. A `.webloc` that keeps its address in a resource fork says
so.

**Torrents.** Up to 16 MB, 32 levels of nesting and 1,000,000 values are read. The list holds the
first 100,000 files, without padding files. The info-hash is SHA-1 of the info dictionary, and a
version 2 torrent also shows its SHA-256.

**Provisioning profiles.** The property list is found inside the signed envelope of a file of at
most 4 MB: it must start in the first 64 KB and be at most 2 MB. Up to 100 developer certificates
are read. The signature is not checked, and the preview says so.

## Files whose name does not say

When no preview reads a file, Viewer reads its first 4 KiB and names the format from a table of
signatures: databases, archives and compressed files, documents, images, audio and video, fonts,
executables and libraries, and installer packages. For a Word, Excel or PowerPoint 97 to 2003 file
it also reads the directory that names the file's streams. Text is shown as text and is never named
this way.

Below what the bytes say, the preview shows them in a hex view: offset, hexadecimal and printable
characters, 16 bytes to a row. A Mach-O file names its CPU type, and a universal binary each slice;
a PE file its machine, format, subsystem and .NET runtime; an ELF file its class, byte order and
machine. WebAssembly modules and Java class files name their version. The view reads 64 KiB pages as
the rows on screen need them and keeps 16, so a file of any size opens without being read whole.
**Hex** in a preview's footer, or **Show as hex**, shows any other file this way, except one that
holds a private key.

These formats show in place with **Show as**, whatever the file is called: SQLite; ZIP, JAR, APK,
tar and compressed tar archives; PDF and DjVu; PNG, JPEG, GIF, WebP, BMP, ICO, AVIF, HEIC, TIFF,
PSD, JPEG 2000, ICNS and OpenEXR images; MP4, MOV, WebM, M4A, MP3, AAC, FLAC, Ogg, Opus and WAV;
TrueType, OpenType, WOFF and WOFF2 fonts; binary property lists.

- Images show as a rendered still of at most 4096 pixels on the long side, so an animated GIF or
  WebP shows its first frame.
- A PDF shown this way cannot be printed until it is renamed to end in `.pdf`.
- A gzip file shows as an archive only when its name says `.tar`.

EPUB books; Safari web archives; Word, Excel and PowerPoint (docx, xlsx, pptx, and their macro and
template files); Word, Excel and PowerPoint 97 to 2003 (doc, xls, ppt); OpenDocument (odt, ods, odp,
odg); Krita and OpenRaster images and XPS documents (kra, ora, xps); camera raw photos from Canon
(CR2, CR3), Fujifilm (RAF), Olympus and OM System (ORF) and Panasonic (RW2); and the video and audio
Viewer plays through a copy (MKV, MKA, AVI, FLV, WMV, WMA, ASF, MPG, VOB, 3GP, 3G2, AIFF, CAF) also
show with **Show as**. Viewer's desktop service reads the file's own first bytes again, with a 97 to
2003 file's directory, before it reads the file as that format. When they disagree it says "The
contents of this file do not match", and when the file changes afterwards it asks you to reopen the
preview.

- A macro or template Office file shows its layout; its Reading view needs the file's own extension.
- A DNG, NEF or ARW photo is also a TIFF image and shows as one. Rename it to its own extension for
  the camera preview and **Render RAW**.
- Ogg video is named but not shown. The message names the extension that makes it preview.
- A torrent is named, and shows with **Show as**, when its first 4 KiB hold piece hashes. One whose
  first 4 KiB are names alone shows as text.

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

Reading text uses its own preview settings: **Text size** (`settings.previews.textFontSize`, 8 to
32, default 16), **Text line height** (`settings.previews.textLineHeight`, 12 to 64, default 20) and
**Wrap preview text**, with local zoom and reset controls. They do not change editor settings. CSS
selectors and property names use theme syntax roles.

**Related:** [Read and inspect files](../guides/previews.md) · [Office documents](office.md) ·
[PDF tools](pdf.md) · [Media](media.md) · [Models and drawings](models.md) ·
[Platform status](platforms.md)
