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
available.

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

## Optimize

Optimize supports selected PDF, JPEG, PNG, WebP and AVIF files, including mixed batches.
**Balanced** and **Smaller** trade image quality for compression; **Lossless** retains decoded
pixels, with coefficient-preserving JPEG optimization. Maximum raster dimensions are optional.

Every result shows original size, output size and savings or failure. Only smaller candidates
publish. **Already compact** keeps the original. See [PDF tools](pdf.md) for structural versus
scanned-image compression and signature limits.

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
