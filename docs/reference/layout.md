# Layout output

A layout is drawn as one new PDF, or as one PNG or JPEG image of a single page. Sources are only
read. This page describes the output exactly; the plan itself is `layoutTransformSchema` in
`src/domain/layout/plan.ts`.

## Plans

Lengths are PDF points (72 to the inch), measured from each page's top-left corner with y down.
Items are drawn in plan order: a later item covers an earlier one.

| Item    | Draws                                                              |
| ------- | ------------------------------------------------------------------ |
| `image` | A raster image, rotated, then cropped, then stretched to its frame |
| `page`  | One page of a source PDF, placed as an image is; PDF output only   |
| `rect`  | A rectangle with a fill, a stroke or both                          |
| `path`  | A polyline of x, y pairs, open or closed, with an optional dash    |
| `text`  | One line, its baseline at `y`, its start, center or end at `x`     |

Rotation is clockwise in quarter turns. A crop is a part of the rotated source, as fractions of its
width and height. A rect or path with neither fill nor stroke draws nothing. A line width of 0 draws
the thinnest line the device shows: a hairline in a PDF, one pixel in an image. Fills use the
nonzero winding rule. Joins are mitered, and lines stop at their end points.

## PDF output

### Source pages

A source page is placed as a Form XObject: its text, fonts, vector drawing and images stay as they
are in the source, so its text stays selectable and searchable. Its visible area is the page's crop
box inside its media box. Attributes the page inherits from its page tree (resources, media box,
crop box and rotation) apply. The page's own rotation adds to the item's. A crop clips the page to
its frame.

A source page keeps its content, its resources and its transparency group. It does not keep:

- annotations, such as links, comments, highlights and stamps;
- form fields and their values;
- bookmarks, page labels, document tags and document metadata;
- layer settings: content in optional layers shows as drawn;
- attachments and scripts.

Encrypted or signed PDFs are refused: use an unlocked, unsigned copy. A page used several times is
stored once, and objects the pages of one source share, such as fonts, are stored once.

### Images

| Source                                               | In the PDF                                   |
| ---------------------------------------------------- | -------------------------------------------- |
| JPEG with 8-bit gray or RGB samples, at most `dpi`   | The original JPEG data                       |
| Any other JPEG                                       | Encoded as JPEG at `quality`                 |
| PNG, GIF, WebP, TIFF or AVIF, all pixels opaque      | Encoded as JPEG at `quality`                 |
| PNG, GIF, WebP, TIFF or AVIF with transparent pixels | Flate-compressed RGB with an 8-bit soft mask |
| HEIC, HEIF, BMP or camera RAW                        | Decoded first, then as the rows above        |

`dpi` is the most pixels per inch an image keeps: a crop with more pixels across its frame is
resampled to `dpi` at the frame's size. Images are never enlarged. EXIF orientation is applied. An
original JPEG keeps its embedded color profile; other images are converted to sRGB. A grayscale
image stays grayscale.

An original JPEG keeps its coded image only: EXIF, XMP, comments and any further images it holds,
such as a depth map or a preview, are left out. It is stored once however many frames show it, and
its rotation and crop are applied when it is drawn, so the parts a crop hides stay in the file.

Animated and multipage images use their first frame.

HEIC, HEIF and BMP images are decoded by macOS, as **Convert copy to JPEG** decodes them: upright,
in their own color profile and at the size their largest frame needs at `dpi`, at most 4,096 pixels
on the long side. Camera RAW files are rendered by Viewer's RAW renderer, as **Render RAW** renders
them: upright in sRGB, at half the sensor's size and at most 4,096 pixels on the long side. A DNG,
NEF or ARW file needs its own extension to be read as RAW. Each decoder reads only the open source,
in a separate process; the decoded image stays in memory and is never saved beside the source.

### Text

Text that Windows Latin 1 (WinAnsi) can hold is set in Helvetica or Helvetica-Bold, PDF standard
fonts that readers supply. Alignment and `maxWidth` use Adobe's Helvetica metrics, without kerning.
A line wider than `maxWidth` is shortened with an ellipsis (…).

A line with any other character, such as Japanese, Greek, Hebrew or an emoji, is drawn whole in the
system sans-serif font as a picture: at 600 dpi, or at `dpi` when that is higher, in the text color
through an 8-bit opacity mask. An invisible copy of the same characters lies over it, so the line
can still be searched, selected and copied. Such a line is not vector: enlarged far, its edges show
pixels. A line wider than 32,767 pixels at that resolution is drawn at a lower one. `maxWidth`
shortens it with an ellipsis, measured on the drawn line.

Control characters become spaces, and text is composed to Unicode NFC.

### Document

The plan's `title` becomes the document title, which readers show in place of the file name. qpdf
writes the file with compressed streams and object streams.

## PNG and JPEG output

An image output holds one page of `rect`, `path`, `text` and `image` items; a `page` item is
refused. Its size in pixels is the page size times `dpi` / 72, rounded. Images are resampled to fill
their frames, up or down.

Pixels are sRGB, with an sRGB profile and the resolution recorded. No source metadata is copied: the
EXIF, GPS and XMP data of placed images are left out. A PNG is transparent where nothing is drawn,
unless the page has a background; a JPEG is white there. Text uses the system sans-serif font.

## Limits

| Limit                        | Value                                     |
| ---------------------------- | ----------------------------------------- |
| Source files                 | 500                                       |
| Pages                        | 1,000; an image output holds 1            |
| Items per page               | 5,000                                     |
| Path coordinates in a plan   | 2,000,000 numbers, two per point          |
| Characters in a line of text | 500                                       |
| Page side                    | 14,400 points (200 inches)                |
| `dpi`                        | 36 to 1,200                               |
| `quality`                    | 1 to 100, for JPEG                        |
| Image output                 | 100 megapixels                            |
| Each image source            | 256 MB and 100 megapixels                 |
| HEIC, HEIF, BMP and RAW      | Decoded at most 4,096 pixels long         |
| PDF sources                  | 256 MB each, 512 MB together              |
| PDF output                   | 750 MB                                    |
| Time                         | 10 minutes; 90 seconds for one image step |

Cancelling stops the work at the next item. Output is published only when it is complete.
