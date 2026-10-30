# Image, audio, video and Optimize

This page lists the image, audio and video tools, their formats, choices and limits, and how
Optimize prepares and saves smaller copies.

Every tool uses processors bundled with Viewer and runs on your Mac. Each export is a new file, with
Undo, reported in **File operations**; the source is never changed.

## Quick actions

These appear in **⌘K** when every selected file is a JPEG, PNG, TIFF, HEIC, HEIF, GIF, BMP or WebP
image.

| Command                                         | Output beside each image                                       |
| ----------------------------------------------- | -------------------------------------------------------------- |
| **Convert copy to JPEG**                        | `Name.jpg`                                                     |
| **Convert copy to PNG**                         | `Name.png`                                                     |
| **Rotated copy, left**, **Rotated copy, right** | `Name rotated.ext`; formats other than PNG and JPEG become PNG |
| **Create PDF from images**                      | One PDF in the folder: `Name.pdf`, or `Name and others.pdf`    |

A convert command is not offered when every selected image is already in that format. In a mixed
selection, such an image gets a copy beside it, such as `Shot copy.png`; the image itself is never
replaced.

## Image tools

**Convert images…** in **⌘K**, or **Image tools…** in an image preview, exports up to 1,000 JPEG,
PNG, TIFF, GIF, WebP or AVIF images. HEIC previews on macOS but is not an image-tool input; use
**Convert copy to JPEG**.

| Choice     | Values                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| Format     | **WebP**, **AVIF**, **JPEG**, **PNG**                                                                   |
| Quality    | 1 to 100; 85 by default                                                                                 |
| Size       | Width and height, 1 to 32,768 px each, below 100 megapixels together                                    |
| Fit        | **Fit · keep aspect ratio**, **Fill and crop**, **Stretch to size**                                     |
| Crop       | A rectangle drawn on the source                                                                         |
| Rotation   | **Rotate** turns the output 90° clockwise each press                                                    |
| Metadata   | **Keep color and credit · remove GPS** (default), **Remove metadata**, **Keep all · includes location** |
| Background | A color behind transparency in a JPEG; white by default                                                 |

- Orientation is applied, so the output stands the right way up.
- The default keeps supported ICC profiles and credit, title and rights fields, and drops GPS and
  device identifiers. No choice promises that every source tag survives.
- Animated and multipage images are refused, so no frame is silently dropped.
- A source is at most 256 MB and 100 megapixels.
- A batch applies one plan to each image and reports each failure on its own.

## Audio and video

**Edit media…** opens a draft for up to 16 sources: MP4, M4V, MOV, M4A, MP3, WAV, FLAC, Ogg, OGA,
Opus, AIFF, CAF, AVI, MKV, WebM, AAC, MPEG, TS and M2TS files of at most 24 hours. Use the
filmstrip, waveform, player and **In** and **Out** to mark up to 32 segments, reorder them, add
sources and add one audio track.

| Choice  | Values                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------ |
| Format  | **MP4 video**, **QuickTime video** (H.264 and AAC), **AAC audio** (M4A), **WAV audio**, **FLAC audio** |
| Quality | **Smaller file**, **Balanced**, **High quality**                                                       |
| Cut     | **Exact · frame accurate** (default), **Fast · keyframe aligned**                                      |
| Audio   | **Keep original**, **Remove audio**, **Replace audio**, **Mix with original**, with offset and gain    |
| Output  | The whole sequence, **Export each segment**, or **Export current frame as PNG**                        |

- **Fast · keyframe aligned** copies the streams without re-encoding. It is offered for one segment
  exported as MP4 or MOV, with original or removed audio, from H.264 video with AAC or no audio. Its
  cut points are less precise.
- Joined video takes the first segment's size and frame rate; other clips are scaled to fit inside
  it. Audio is resampled to 48 kHz stereo.
- Video is at most 8,192 px on each edge. A frame export takes one segment and no added audio.
- **Remove audio** is offered for MP4 and MOV only; **Replace audio** and **Mix with original**
  appear once an audio source is added.

Drafts keep their editing decisions and source versions privately. Closing a draft's plane keeps the
draft. A changed or revoked source blocks further use; **New draft from current files** starts again
and keeps the old draft. Reloading saves pending decisions first; if saving fails, the plan stays in
memory for another try, and a stale reload never replaces a newer edit.

## Optimize

**Optimize…** takes up to 1,000 PDF, JPEG, PNG, WebP and AVIF files, mixed in one batch. Each copy
is named `Name optimized.ext`.

| Preset                             | Images                                     |
| ---------------------------------- | ------------------------------------------ |
| **Balanced · high quality**        | Quality 85                                 |
| **Smaller · stronger compression** | Quality 65                                 |
| **Lossless · keep image pixels**   | Same pixels; a JPEG keeps its coefficients |

**Limit image dimensions** caps the longest edge at 64 to 32,768 px; it does not apply to
**Lossless**. [PDF tools](pdf.md#optimize) describes what each preset does to a PDF.

1. **Prepare candidates** makes each copy privately and shows the original and candidate sizes.
2. **Review** compares a candidate with its original side by side, with an actual-size option and
   linked panning; PDFs share a page selector.
3. **Save** _n_ **smaller copies** writes the exact bytes you reviewed into the folder chosen under
   **Save smaller copies in**.

- A candidate no smaller than its original says **Already compact · original kept**. If the Trash
  cannot take the unused copy, **File operations** says where it was kept.
- **Retry** prepares one row again from its current version. A file changed after preparation must
  be retried before it is saved.
- **Keep folders relative to** _folder_ keeps the source folders inside the output folder. A name in
  use gets a new name; existing files are never replaced.
- **Saved batch recipes** keep a named set of compression, target and folder choices across
  restarts. A recipe holds no file locations or access.
- Closing the dialog releases its previews; saves already started finish in **File operations**.

**Target size per file** sets a budget such as 500 kB or 2 MB.

| Target rule     | Value                                                               |
| --------------- | ------------------------------------------------------------------- |
| Budget          | 1 kB to 256 MB, decimal units                                       |
| Minimum quality | 20 to 95; 60 by default                                             |
| Attempts        | At most 8 quality settings per file, starting at 95                 |
| Missed          | **Target not met**, with the measured size; not selected for saving |
| Lossless        | Never lowers quality to meet a budget                               |

You can still select a candidate that missed its target. A size target does not promise a visual
quality; compare before saving.

| Optimize limit      | Value         |
| ------------------- | ------------- |
| Files in a batch    | 1,000         |
| Prepared candidates | 512 MB in all |
| One image source    | 256 MB        |

## Quick presets

| Command                   | Starting choices                                                |
| ------------------------- | --------------------------------------------------------------- |
| **Images for web…**       | WebP, quality 80, fit within 2048 × 2048, remove GPS            |
| **Batch convert images…** | WebP with editable format, quality and size; two or more images |
| **PDF for email…**        | **Smaller**, scan recompression, 1,600 px maximum edge          |
| **Extract audio…**        | A new M4A draft with ranges to review                           |

## Playback compatibility

The player first tries Chromium's own decoders. When they cannot play a file, Viewer makes a
complete local copy with the bundled FFmpeg (**Preparing a compatible video copy…**, with
**Cancel**), and the view says **Compatibility copy · up to 720p**. If no copy can be made,
**Compatibility preview unavailable** offers **Retry conversion**, opening in another app and, when
the file has sound, **Play audio only**.

| Copy  | Format              | Limits                                              |
| ----- | ------------------- | --------------------------------------------------- |
| Video | H.264 with AAC, MP4 | At most 1280 × 720 and 64 MB, made within 2 minutes |
| Audio | AAC                 | At most 64 MB                                       |

A copy is checked through its last frame before it plays. Whether a file plays depends on its
codecs, not its extension. [Supported formats](formats.md) lists the extensions sent through a copy.

Exports are built from checked plans with fixed processor arguments, and source versions are checked
again before an output is published. No tool passes arbitrary processor options, and none gives an
agent a shell.

**Related:** [Make a quick change](../guides/create.md) · [PDF tools](pdf.md) ·
[Layout output](layout.md) · [Supported formats](formats.md) · [File operations](file-operations.md)
