# Image, audio, video and Optimize

This page lists the image, audio and video tools, their formats, choices and limits, and how
Optimize prepares and saves smaller copies.

Every tool runs on your Mac. The image, PDF and media processors are bundled with Viewer; HEIC, HEIF
and BMP pictures, and **Create PDF from Images**, are read by the macOS image decoder. Each export
is a new file, with Undo, reported in **File Operations**; the source is never changed.

## Quick actions

These appear in **⌘K** when every selected file is a JPEG, PNG, TIFF, HEIC, HEIF, GIF, BMP or WebP
image.

| Command                                         | Output beside each image                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Convert Copy to JPEG**                        | `Name.jpg`                                                                                |
| **Convert Copy to PNG**                         | `Name.png`                                                                                |
| **Rotated Copy, Left**, **Rotated Copy, Right** | `Name rotated.ext`: PNG and JPEG keep their format, HEIC and HEIF become JPEG, others PNG |
| **Create PDF from Images**                      | One PDF in the folder: `Name.pdf`, or `Name and others.pdf`                               |

**Save Rotated Copy** in a picture's preview makes the same copy, turned as the picture is shown: a
quarter left or right, or a half turn. In a plane with the Essential header, it waits in the plane's
**…** menu. Rotated copies:

- are made of JPEG, PNG, HEIC, HEIF, BMP, WebP, GIF and TIFF pictures. An animated GIF or a TIFF of
  several pages is refused, saying why, since a copy would keep one frame or page of it;
- turn the picture as it is shown, its EXIF orientation applied first;
- save a JPEG at the quality it was saved at, read from its own tables, and with its own color
  detail, so the copy is about its size and looks as it did;
- save a HEIC or HEIF photo as a JPEG, about its size, with the date it was taken;
- keep the color profile, the description, artist, copyright and the date the photo was taken, and
  nothing else of its metadata;
- leave the picture itself as it was.

A convert command is not offered when every selected image is already in that format. In a mixed
selection, such an image gets a copy beside it, such as `Shot copy.png`; the image itself is never
replaced.

## Image tools

**Image Tools…** in **⌘K** or an image preview exports up to 1,000 JPEG, PNG, TIFF, GIF, WebP or
AVIF images. HEIC previews on macOS but is not an image-tool input; use **Convert Copy to JPEG**.

| Choice     | Values                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| Format     | **WebP**, **AVIF**, **JPEG**, **PNG**                                                                   |
| Quality    | 1 to 100; 85 by default; not shown for PNG                                                              |
| Size       | Width and height, 1 to 32,768 px each, below 100 megapixels together; never enlarged                    |
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
- One image takes the **File name** you type, `Name converted` at first. A batch names each output
  `Name converted.ext`. A name in use gets “copy” added; nothing is replaced.
- An image that takes longer than 90 seconds stops with **Image processing timed out. Its source was
  kept.**

## Audio and video

**Edit Media…** opens a draft for up to 16 sources: MP4, M4V, MOV, M4A, MP3, WAV, FLAC, Ogg, OGA,
Opus, AIFF, CAF, AVI, MKV, WebM, AAC, MPEG, TS and M2TS files of at most 24 hours. Use the
filmstrip, waveform, player and **In** and **Out** to mark up to 32 segments, reorder them, add
sources and add one audio track.

| Choice  | Values                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------ |
| Format  | **MP4 video**, **QuickTime video** (H.264 and AAC), **AAC audio** (M4A), **WAV audio**, **FLAC audio** |
| Quality | **Smaller file**, **Balanced**, **High quality**                                                       |
| Cut     | **Exact** (default), **Fast**                                                                          |
| Audio   | **Keep original**, **Remove audio**, **Replace audio**, **Mix with original**, with offset and gain    |
| Output  | The whole sequence, **Export each segment**, or **Export current frame as PNG**                        |

- **Fast** copies the streams without re-encoding. It is offered for one segment exported as MP4 or
  MOV, with original or removed audio, from H.264 video with AAC or no audio. It starts at the
  keyframe before the chosen start, which can be a few seconds early.
- An untrimmed H.264 clip exported as MP4 or MOV at **Balanced** with its own audio is copied the
  same way, also under **Exact**: it is not re-encoded, so it is about the size of its source.
- Joined video takes the first segment's size and frame rate; other clips are scaled to fit inside
  it. Audio is resampled to 48 kHz stereo.
- Video is at most 8,192 px on each edge. A frame export takes one segment and no added audio.
- One export runs for at most 10 minutes, then stops with **Media processing timed out. Its sources
  and partial output were kept.**
- **Remove audio** is offered for MP4 and MOV only; **Replace audio** and **Mix with original**
  appear once an audio source is added.
- **Export each segment** writes `Name 1.ext`, `Name 2.ext` and so on.
- Exports carry no metadata or chapters from their sources.
- With the editor focused, **Space** plays or pauses, **I** and **O** set the In and Out points, and
  **←** and **→** step one frame of video, or one second with **⇧**. A text field keeps its own
  keys.

Drafts keep their editing decisions and source versions privately. Closing a draft's plane keeps the
draft. A changed or revoked source blocks further use; **Apply Saved Edits to Current Files** makes
a new draft with the same edits on the files as they are now, **New Draft from Current Files**
starts again, and both keep the old draft. Reloading saves pending decisions first; if saving fails,
the plan stays in memory for another try, and a stale reload never replaces a newer edit.

## Optimize

**Optimize…** takes up to 1,000 PDF, JPEG, PNG, WebP and AVIF files, mixed in one batch. Each copy
is named `Name optimized.ext`.

| Preset                             | Images                                     |
| ---------------------------------- | ------------------------------------------ |
| **Balanced · high quality**        | Quality 85                                 |
| **Smaller · stronger compression** | Quality 65                                 |
| **Lossless · keep image pixels**   | Same pixels; a JPEG keeps its coefficients |

**Limit image dimensions**, under **Quality and dimensions**, caps the longest edge at 64 to 32,768
px, 2,048 at first; it does not apply to **Lossless**. [PDF tools](pdf.md#optimize) describes what
each preset does to a PDF.

1. **Prepare candidates** makes each copy privately and shows the original and candidate sizes.
2. **Review** compares a candidate with its original side by side, with an actual-size option and
   linked panning; PDFs share a page selector.
3. **Save** _n_ **smaller copies** writes the exact bytes you reviewed into the folder chosen under
   **Save smaller copies in**.

- A candidate no smaller than its original says **Already compact · original kept**. If the Trash
  cannot take the unused copy, **File Operations** says where it was kept.
- **Retry** prepares one row again from its current version. A file changed after preparation must
  be retried before it is saved.
- **Keep folders relative to** _folder_ keeps the source folders inside the output folder. A name in
  use gets a new name; existing files are never replaced.
- **Saved batch recipes** keep a named set of compression, target and folder choices across
  restarts. A recipe holds no file locations or access.
- Closing the dialog releases its previews; saves already started finish in **File Operations**.

**Target size per file** sets a budget such as 500 KB or 2 MB.

| Target rule     | Value                                                             |
| --------------- | ----------------------------------------------------------------- |
| Budget          | 1 KB to 256 MB, decimal units                                     |
| Minimum quality | 20 to 95; 60 by default                                           |
| Attempts        | At most 8 quality settings per file, starting at 95               |
| Missed          | **Target not met**, with the target size; not selected for saving |
| Lossless        | Never lowers quality to meet a budget                             |

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
complete local copy with the bundled FFmpeg (**Converting video to play here…**, with **Cancel**),
and the view says **Playing a 720p copy**. If no copy can be made, **Can't convert this video to
play here** offers **Open in Default App**, **Open With…**, **Play Audio Only** when the file has
sound, and **Try Again**.

| Copy  | Format              | Limits                                              |
| ----- | ------------------- | --------------------------------------------------- |
| Video | H.264 with AAC, MP4 | At most 1280 × 720 and 64 MB, made within 2 minutes |
| Audio | AAC                 | At most 64 MB, made within 2 minutes                |

A copy is checked through its last frame before it plays. Whether a file plays depends on its
codecs, not its extension. [Supported formats](formats.md) lists the extensions sent through a copy.

Exports are built from checked plans with fixed processor arguments, and source versions are checked
again before an output is published. No tool passes arbitrary processor options, and none gives an
agent a shell.

**Related:** [Make a quick change](../guides/create.md) · [PDF tools](pdf.md) ·
[Layout output](layout.md) · [Supported formats](formats.md) · [File operations](file-operations.md)
