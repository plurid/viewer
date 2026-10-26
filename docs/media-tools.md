# Media, image and optimization tools

Open **Edit media…** from an audio/video preview or the selected files' commands.
Up to sixteen sources become a segment sequence in a linked media plane. The
filmstrip, waveform, player and In/Out controls inspect the original files;
reordering or removing a segment changes only the private draft. Add media adds
sources; Add audio selects replacement or mixed audio with an offset and gains.

Export the sequence, each segment separately, audio only, a muted video, or the
current video frame as PNG. Exact cuts are the default. A compatible complete
H.264/AAC clip may copy streams without re-encoding; **Fast · keyframe aligned**
explicitly trades cut precision for speed. MP4/MOV use H.264 and AAC; audio
outputs are M4A/AAC, WAV/PCM or FLAC. Joined video follows the first clip's frame
size and rate. This is a focused clip tool, with one additional audio track,
rather than a multitrack timeline, transitions or a full editing suite.

Drafts live in the private profile's `media-drafts/` directory. They store the
source paths and versions, segment decisions and export options, not copied
media. Autosaves join the existing durable-save barrier. Closing or culling an
editor keeps its draft; culling pauses playback and releases transient resources.
A changed or revoked source blocks further use. **New draft from current files**
preserves the old draft and opens a new one against current source versions.
Private media draft references are excluded from portable project exports.

**Image tools…** in a preview, or **Convert images…** in commands, exports JPEG,
PNG, WebP and AVIF. Quality, resize/fit, rotation, pointer or numeric crop and JPEG
transparency background are explicit. Batch export applies the same settings to
each image and reports individual failures. Inputs are still JPEG, PNG, TIFF,
GIF, WebP and AVIF files; multipage/animated images are refused to prevent silent
frame loss. The bundled decoder lacks HEVC/HEIC decoding. Existing native
JPEG/PNG/PDF quick actions remain available for HEIC/HEIF and BMP on macOS.

Ordinary image export normalizes orientation. The default metadata policy keeps
supported ICC color profiles and descriptive EXIF/XMP credit, title and rights,
and drops GPS and device identifiers. Remove metadata and Keep all, including
location, are separate choices. The retained metadata is an explicit subset,
not a promise to round-trip every camera or publishing tag.

## Optimize

**Optimize…** is available for selected PDF, JPEG, PNG, WebP and AVIF files and
from their previews. Batch selections may mix these families. Original and
optimized sizes, percent reduction, errors and output links remain visible in
the dialog; receipts retain the size result after restart. All processing is
local. Outputs get new names, existing names use Keep both, and a candidate is
published only when smaller. Otherwise the result says **Already compact**.

- **Balanced** recompresses images at high quality. **Smaller** uses stronger
  image compression. Optional maximum dimensions apply to raster images.
- **Lossless** keeps decoded image pixels. JPEG uses coefficient-preserving
  entropy/progressive optimization and retains technical orientation metadata;
  PNG uses lossless compression. WebP/AVIF use their lossless encoders.
- PDF optimization compresses structure and streams without rasterizing pages.
  Searchable text, vector content and page dimensions remain. Balanced/Smaller
  may convert eligible non-JPEG embedded images to JPEG. Existing JPEG scans are
  not resampled or indiscriminately re-encoded, so some PDFs cannot shrink.
  This follows [qpdf's documented optimization behavior](https://qpdf.readthedocs.io/en/latest/cli.html#optimizing-file-size).
- PDFs with signature fields are refused, and encrypted/damaged files requiring
  passwords or recovery fail without replacing the source. PDF document metadata
  remains; the GPS policy above applies to raster-image exports.

## Execution and limits

Typed plans contain only bounded formats, numbers, source indices and policy
choices. Desktop adapters compile fixed argument vectors; no renderer or agent
can supply an executable, shell text, filter graph or authenticated browser state.
Workflows can prepare reviewed `convert` steps. The MCP `propose_transform` tool
requires source/output grants and content permission, captures source versions
and waits for fresh user review. It cannot approve or apply itself.

Exports use the existing file-operation queue, progress, cancellation, durable
receipts, guarded publication, collision handling and eligible Undo. Source
identity/version checks surround processing and publication. Cancellation stops
the owned processor and preserves originals and any reported partial output.
Application-history Undo remains subject to the existing Trash rules.

The signed macOS package includes pinned FFmpeg 9.0.2, Sharp 0.35.5/libvips,
qpdf 12.4.2 and libjpeg-turbo 3.1.3. FFmpeg excludes GPL, nonfree and network
components. Optimizers link only to system libraries. Source archives, licenses,
notices, exact build options and checksum manifests ship alongside the tools.
No runtime Homebrew, tool installation or cloud account is needed. Build-time
preparation requires Xcode and CMake and retains fresh build directories.

Limits include two active processor tasks, a bounded pending queue, sixteen media
sources, thirty-two segments, a 24-hour source duration, 8192-pixel video edges,
256 MB per image/PDF input and 100-megapixel raster decoding. Frame/waveform
inspection has shorter deadlines, cancellation and a versioned 16 MB/128-entry
warm cache. Output formats and playback codecs differ: a source Chromium cannot
play can still be inspectable/exportable by FFmpeg. Apple Silicon direct-package
checks qualify this candidate; Intel, other operating systems and Store
distribution remain separate release qualification.


## Automatic compatibility playback

When an original video errors, opens without a picture or stalls before decoding,
Viewer prepares a complete local compatibility copy. Fixed bundled FFmpeg commands
read only the validated source descriptor and produce H.264/AAC in memory, without
network access or writing a temporary movie. The player labels the copy and keeps
all editing/export operations bound to the original file.

The copy preserves aspect/orientation, limits picture size to 1280×720 at 30 fps
and uses stereo AAC. Metadata, chapters, subtitles and extra streams are omitted.
A 4 GiB input ceiling, 64 MiB output ceiling and 120-second deadline bound the
operation. A source too long for the complete-copy budget is refused before
encoding; output is decoded through EOF to verify duration and codecs. This is
playback compatibility, not a promise to convert every video variant. Cancel and
Retry remain explicit; audio-only playback is offered only when audio was observed.

Copies use the same source-versioned 128 MiB cache and single expensive-decoder
lane as RAW previews. Closing the last consumer cancels work. Permission changes
invalidate access even on a cache hit; released resources cannot serve ranges.
`tests/native/video-compatibility.ts` qualifies the pinned Theora/Vorbis trailer's
picture, audio, seeking, cancellation, warm reuse and unchanged source bytes.
