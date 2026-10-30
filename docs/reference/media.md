# Image, audio, video and Optimize

All tools on this page use bundled local processors. Exports create new files and report their
destinations through Operations.

## Images

**Image tools…** and **Convert images…** export JPEG, PNG, WebP and AVIF with quality, dimensions,
aspect fit, rotation and crop controls. JPEG includes a transparency-background choice. Batch export
applies the plan to each image and reports individual failures.

Tool inputs are JPEG, PNG, TIFF, GIF, WebP and AVIF. Animated/multipage sources are refused rather
than silently dropping frames. HEIC can have a native preview on macOS while remaining unsupported
by this image-tool decoder. Native quick actions provide separate JPEG/PNG/PDF choices where
available. **Convert copy to JPEG** and **Convert copy to PNG** are not offered for images already
in that format. In a mixed selection, such an image gets a copy beside it, such as `Shot copy.png`;
the image itself is never replaced.

Exports normalize orientation. The default keeps supported ICC profiles and descriptive
credit/title/rights metadata while dropping GPS and device identifiers. Remove metadata and Keep
all, including location, are separate policies; no option promises every source tag can round-trip.

## Audio and video

**Edit media…** opens a draft for up to 16 sources. Use the filmstrip, waveform, player and In/Out
controls to inspect source media. Reorder segments, add sources and add one replacement/mixed audio
track with timing and gain choices.

Export the sequence, each segment, audio only, muted video or a frame as PNG. Exact cuts are the
default. **Fast · keyframe aligned** can copy suitable streams with less precise cut points. Joined
video follows the first clip's size/rate. MP4/MOV exports use H.264/AAC; audio outputs include
M4A/AAC, WAV/PCM and FLAC.

Drafts save editing decisions and source versions privately. Closing a draft's plane keeps it;
culling pauses playback. Changed/revoked sources block further use, with **New draft from current
files** preserving the old draft.

Reload first saves pending editing decisions. If saving still fails, the unsaved plan stays in
memory for another retry; a stale reload response cannot replace a newer edit.

## Optimize

Optimize supports selected PDF, JPEG, PNG, WebP and AVIF files, including mixed batches.
**Balanced** and **Smaller** trade image quality for compression; **Lossless** retains decoded
pixels, with coefficient-preserving JPEG optimization. Maximum raster dimensions are optional.

Choose **Prepare candidates** before saving anything. Each row shows the measured original and
candidate sizes. **Review** compares images side by side, with an actual-size option and linked
panning; PDFs share a page selector. **Save smaller copies** exports the exact bytes prepared for
review. **Already compact** keeps the original. If the Trash cannot take the unused copy, **File
operations** says where it was kept.

Enable **Target size per file** for a budget such as 500 kB or 2 MB. These units are decimal; the
allowed budget is 1 KiB–256 MiB. Lossy compression tries at most eight quality settings and respects
the chosen minimum quality. **Target not met** reports the measured result without selecting it for
export. You can explicitly select a smaller candidate even when it misses the target. Lossless mode
never lowers quality to reach a budget. A size target cannot guarantee a particular visual quality:
inspect the comparison before exporting.

Under **Saved batch recipes**, name and save the compression, target and folder-layout choices.
Recipes remain available after restart; they contain no file locations or access grants. **Keep
folders relative to…** preserves the displayed source hierarchy inside the chosen output folder.
Output name collisions receive separate names, leaving existing files intact.

**Retry** prepares only that row using its current source version. A file changed after preparation
must be retried before export. Private prepared candidates are limited to 512 MiB at a time, with a
256 MiB limit per candidate. Closing the dialog releases its previews; admitted exports finish
through Recent file operations. See [PDF tools](pdf.md) for structural versus scanned-image
compression and signature limits.

## Quick presets

| Command               | Starting choices                                          |
| --------------------- | --------------------------------------------------------- |
| Images for web…       | WebP, quality 80, fit within 2048 × 2048, remove GPS      |
| Batch convert images… | WebP with editable format, quality and dimensions         |
| PDF for email…        | Smaller, compatible JPEG scan recompression, 1600 px edge |
| Extract audio…        | A fresh M4A/AAC draft with ranges to review               |

## Playback compatibility

The player first tries Chromium decoding. Unsupported video can request a bounded local
compatibility copy; the view labels it as such and retains retry and external open actions.
Compatibility is codec-dependent, not guaranteed by an extension.

Exports compile fixed arguments from validated plans and recheck source versions. They do not expose
arbitrary processor options or a shell to agents. Image/PDF batches support up to 1,000 compatible
inputs; each tool enforces additional byte, dimension and time budgets. Source files and already
completed outputs remain available after a later batch item fails.
