# Layout output

This page lists the Layout plane's modes, sizes and choices, and describes exactly what a layout
writes: one new PDF, or one PNG or JPEG image of a single page.

Sources are only read. The saved plan is `layoutTransformSchema` in `src/domain/layout/plan.ts`; the
modes are planned in `src/domain/layout/planner.ts`.

## Modes

| Mode                | Lays out                                                                               | Sources                              | Page at first         | Format at first |
| ------------------- | -------------------------------------------------------------------------------------- | ------------------------------------ | --------------------- | --------------- |
| **Collage**         | Photos in one picture                                                                  | 1 to 100 photos                      | **Fit the photos**    | JPEG            |
| **Contact sheet**   | Every photo and page whole, in a grid of captioned cells, over as many pages as needed | Photos and PDF pages                 | A4 portrait           | PDF             |
| **N-up**            | Several photos or pages on each sheet                                                  | Photos and PDF pages                 | A4, **Automatic**     | PDF             |
| **Booklet**         | Sheets to print on both sides, fold and staple; blank pages pad it to a multiple of 4  | At least 2 photos or pages           | A4, **Automatic**     | PDF             |
| **Step and repeat** | Copies of each item packed on sheets for cutting                                       | Photos and PDF pages                 | A4 portrait           | PDF             |
| **Poster**          | One picture in parts on sheets that overlap for gluing, labeled A1, A2, B1…            | One photo or page from the selection | A4, **Automatic**     | PDF             |
| **Nesting**         | DXF parts on stock sheets; see [Nesting for cutting](nesting.md)                       | DXF drawings                         | 1250 × 2500 mm sheets | DXF             |

The plane shows the modes that suit the selection, the suggested one first. Under the preview it
ranks up to four other layouts of the current mode, each with its reason.

## Page

| Choice          | Values                                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Page** size   | Collage and Contact sheet: every size below, and **Fit the photos** in Collage. Other modes, labeled **Sheet**: paper only |
| **Orientation** | **Automatic** (tries portrait, then landscape; a screen size its own shape first), **Portrait** or **Landscape**           |
| **Margin**      | 0 to 60 mm; 0 to 400 px on a screen size                                                                                   |
| **Gap**         | 0 to 60 mm; 0 to 400 px on a screen size. Not in Booklet or Poster                                                         |
| **Background**  | Collage and Contact sheet: **White**, **Cream**, **Grey**, **Black**, **Transparent** or a colour. Other modes: white      |

**Transparent** is transparent in a PNG and white on paper.

| Group       | Sizes                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------- |
| Paper       | A0, A1, A2, A3, A4, A5, A6, Letter (8.5 × 11 in), Legal (8.5 × 14 in), Tabloid (11 × 17 in)   |
| Photo print | 10 × 15 cm, 13 × 18 cm, 4 × 6 in, 5 × 7 in, 8 × 10 in, Square 20 cm                           |
| Screen      | 1080 × 1080 px, 1080 × 1350 px, 1920 × 1080 px, 3840 × 2160 px; drawn at 72 dpi, a point a px |

| Mode            | Margin at first | Gap at first |
| --------------- | --------------- | ------------ |
| Collage         | 6 mm            | 3 mm         |
| Contact sheet   | 12 mm           | 4 mm         |
| N-up            | 5 mm            | 5 mm         |
| Booklet         | 5 mm            | none         |
| Step and repeat | 10 mm           | 0            |
| Poster          | 6 mm            | none         |

## Mode choices

| Mode            | Choice                                    | Values                                                                                                                   |
| --------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Collage         | **Style**                                 | **Rows**, **Featured** (3 or more photos), **Grid**, **Strip**, **Halves** (2 photos) or **Thirds** (3 photos)           |
| Collage         | **Photos**                                | **Fill** crops each photo to its cell; **Whole** keeps it uncropped                                                      |
| Collage         | **Keep**                                  | With **Fill**: **Centre**, **Top**, **Bottom**, **Left** or **Right**                                                    |
| Collage         | **Direction**                             | **Rows** and **Strip** styles: **Automatic**, **Rows** or **Columns**                                                    |
| Collage         | **Large photo**                           | **Featured** and **Thirds**: **Most pixels**, or one photo by name                                                       |
| Contact sheet   | **Columns**                               | **Automatic**, or 2 to 10                                                                                                |
| Contact sheet   | **Folder name**, **Date**, **Size**       | Header and captions; on, on and off at first                                                                             |
| N-up            | **Pages per sheet**                       | 2, 4, 6, 8, 9 or 16                                                                                                      |
| N-up            | **Order**                                 | **Across** or **Down**                                                                                                   |
| N-up            | **Crop marks**, **Frame lines**           | Off at first                                                                                                             |
| N-up            | **Bleed in the pages**                    | 0 to 10 mm, included in the source pages and cut away at the crop marks                                                  |
| Booklet         | **Creep per sheet**                       | 0 to 2 mm in 0.05 mm steps: how far each sheet inward moves its pages toward the fold                                    |
| Step and repeat | **Item**                                  | An item size below, **Actual size** (each picture at its own size) or **Custom size** (**Width**, **Height** to 1000 mm) |
| Step and repeat | **Fill the sheet**                        | On: as many as one sheet holds. Off: **Copies of each**, 1 to 1,000                                                      |
| Step and repeat | **Pictures**                              | **Fill** or **Whole**                                                                                                    |
| Step and repeat | **Marks**                                 | **None**, **Crop marks** or **Cut lines** (at first)                                                                     |
| Step and repeat | **Turn items to fit more**                | On at first                                                                                                              |
| Poster          | **Picture**                               | With several photos or pages: the one to enlarge                                                                         |
| Poster          | **Poster size**                           | **Scale** (10 to 2,000%) or A3, A2, A1, A0                                                                               |
| Poster          | **Overlap**                               | 0 to 50 mm; 10 mm at first                                                                                               |
| Poster          | **Sheet labels**, **Trim and glue marks** | On at first                                                                                                              |

### Step and repeat items

| Item                               | Sheet                                          |
| ---------------------------------- | ---------------------------------------------- |
| Business card 85 × 55 mm           | The chosen sheet                               |
| Business card 3.5 × 2 in           | The chosen sheet                               |
| Passport photo 35 × 45 mm          | The chosen sheet                               |
| Passport photo 2 × 2 in            | The chosen sheet                               |
| Print 10 × 15 cm                   | The chosen sheet                               |
| Print 9 × 13 cm                    | The chosen sheet                               |
| Print 4 × 6 in                     | The chosen sheet                               |
| Labels 63.5 × 38.1 mm, 21 per A4   | A4, 3 × 7, at the label maker's positions      |
| Labels 99.1 × 38.1 mm, 14 per A4   | A4, 2 × 7, at the label maker's positions      |
| Labels 38.1 × 21.2 mm, 65 per A4   | A4, 5 × 13, at the label maker's positions     |
| Labels 2.625 × 1 in, 30 per Letter | Letter, 3 × 10, at the label maker's positions |

A label sheet replaces the page choices with "Printed on A4, where the label sheet has its labels."

## Save

| Choice         | Values                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| **Save as**    | **PDF**, **PNG** or **JPEG**. An image holds one page without PDF pages; otherwise only **PDF** is offered     |
| **Resolution** | PNG and JPEG on a paper size: 150, 300 (at first) or 600 dpi, lowered when the image would pass 100 megapixels |
| **Name**       | Up to 200 characters. The file is saved in the plane's folder, beside the originals                            |

The button reads **Save PDF**, **Save PNG** or **Save JPEG**. It is unavailable while the layout's
PDFs are over 512 MB together, with "The PDFs in this layout are over 512 MB together. Choose
fewer." Progress, **Cancel** and **Open** _name_ appear under it. A fitted collage takes its photos'
own pixels, between 4 and 24 megapixels, at 72 to 600 dpi. A screen size is drawn at 72 dpi. In a
PDF from the Layout plane, an image keeps at most 300 pixels per inch.

| Mode            | Name at first                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| Collage         | `Collage of <photo>`, or `Collage of <n> photos`                                                        |
| Contact sheet   | `Contact sheet of <subject>`                                                                            |
| N-up            | `<subject> <n> up`                                                                                      |
| Booklet         | `Booklet of <subject>`                                                                                  |
| Poster          | `Poster of <subject>`                                                                                   |
| Step and repeat | `Cards <n> up`, `Passport photos <n> up`, `Labels <n> up`, `Prints of <subject>`, or `<subject> <n> up` |

The subject is one file's name without its extension, or a count: `3 photos`, `3 PDFs`, `3 files`.
`/`, `\` and `:` become spaces, and a name is at most 120 characters. When the name is taken, file
operations choose a free one.

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

| Field                          | Values                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `format`                       | `pdf`, `png` or `jpeg`                                                                       |
| `dpi`                          | 36 to 1,200; 300 when left out                                                               |
| `quality`                      | 1 to 100, for JPEG; 90 when left out                                                         |
| `title`                        | Optional, up to 200 characters                                                               |
| Page `width`, `height`         | 1 to 14,400 points                                                                           |
| `background`, `fill`, `stroke` | `#rrggbb`; text `color` is `#000000` when left out                                           |
| Frame and text `x`, `y`        | -14,400 to 28,800 points                                                                     |
| `rotate`                       | 0, 90, 180 or 270                                                                            |
| `crop`                         | `x`, `y`, `width`, `height` as fractions 0 to 1; inside the source, width and height above 0 |
| `page` number                  | 1 to 100,000, and within the source                                                          |
| `lineWidth`                    | 0 to 100; 0.5 for a `rect` and 0.25 for a `path` when left out                               |
| `points`                       | At least 4 numbers, in x, y pairs                                                            |
| `dash`                         | `[on, off]` lengths                                                                          |
| Text `size`                    | 2 to 200 points                                                                              |
| `align`, `weight`              | `start`, `center` or `end`; `regular` or `bold`                                              |
| `maxWidth`                     | Optional; a longer line is shortened with an ellipsis                                        |

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
| Photos in a collage          | 100; more need **Contact sheet**          |
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

**Related:** [Lay out photos and PDFs](../guides/layout.md) · [Nesting for cutting](nesting.md) ·
[PDF tools](pdf.md) · [Images, audio, video and Optimize](media.md) ·
[File operations and recovery](file-operations.md)
