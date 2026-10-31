# Lay out photos and PDFs

Use this guide to put several photos or pages on one sheet: collages, contact sheets, several pages
to a sheet, booklets, cards and labels, posters on ordinary paper, and DXF parts nested for cutting.

**Find it:** **⌘K** → **Lay out…**, **Nest for cutting…** or **Check laser job…** · the file menu,
under **Suggested** for several photos or DXF drawings

Select photos or PDFs, press **⌘K** and choose **Lay out…**. Viewer chooses a layout for what you
selected and opens it in a Layout plane. The preview is the file it saves.

Across the top, the plane offers the modes that suit the selection, the suggested one first. Under
the preview, the suggested layouts are ranked, each with the reason it fits, such as "Fills A4
landscape, no cropping". Choose one to use it.

![A Layout plane with three photographs as one across and two below, and the other layouts ranked under it](../media/layout.png)

## Make a collage

1. Select two to nine photos and choose **Lay out…**. The plane opens on **Collage**, with the best
   layout chosen.
2. Pick a suggested layout, or choose a **Style**: **Rows**, **Featured**, **Grid**, **Strip**, and
   **Halves** or **Thirds** for two or three photos.
3. Under **Photos**, **Fill** crops each photo to its frame and **Whole** shows each photo uncut.
   With **Fill**, **Keep** chooses the part of each photo that stays: the centre, top, bottom, left
   or right.
4. Under **Page**, **Fit the photos** shapes the picture to the photos, at their own resolution, and
   prefers print and screen proportions (from square to 16:9) to long strips. You can also choose a
   paper size such as A4, a print size such as 10 × 15 cm, or a screen size such as 1080 × 1350 px.
5. Set the **Margin**, the **Gap** and the **Background**. **Transparent** leaves a PNG clear around
   the photos.
6. Choose **JPEG**, **PNG** or **PDF**, check the **Name** and choose **Save**.

**Featured** gives one photo most of the page; **Large photo** chooses which.

## Make a contact sheet

1. Select ten or more photos and choose **Lay out…**. The plane opens on **Contact sheet**.
2. Keep **Columns** on **Automatic**, or choose a number. The summary shows how many pages that
   makes.
3. Turn **Folder name**, **Date** and **Size** on or off for the captions.
4. Choose **Save PDF**. Every page is numbered.

## Print several pages on one sheet

1. Select a PDF and choose **Lay out…**. A5 and A6 pages open on **N-up**, as many to an A4 sheet as
   print at nine tenths of their size or more.
2. Choose **Pages per sheet**: 2, 4, 6, 8, 9 or 16. Viewer turns the sheet, and the pages when it
   must, so they print as large as they can.
3. Under **Order**, choose **Across** or **Down**.
4. Turn on **Crop marks** or **Frame lines** if you will cut the sheets. For pages that carry bleed,
   set **Bleed in the pages**: it is cut away at the crop marks.

Pages of different sizes are each scaled into their own place on the sheet.

## Make a booklet

1. Select a PDF of four pages or more, choose **Lay out…**, then **Booklet**.
2. Viewer orders the pages for folding and adds blank pages at the end to make a multiple of four.
   The summary shows the sheets and pages.
3. For a thick booklet, set **Creep per sheet** to about the thickness of the paper, 0.1 mm for
   office paper. Inner sheets then move their pages toward the fold.
4. Choose **Save PDF**.
5. Print it on both sides, flipping on the short edge. Fold the stack in half and staple along the
   fold. The plane shows the same instructions.

## Print cards, labels and passport photos

1. Select a card-sized PDF, or one photo, and choose **Lay out…**. The plane opens on **Step and
   repeat**.
2. Choose the **Item**: business cards of 85 × 55 mm or 3.5 × 2 in, passport photos of 35 × 45 mm or
   2 × 2 in, photo prints, a label sheet, **Actual size**, or **Custom size**.
3. Keep **Fill the sheet**, or turn it off and set **Copies of each**. The summary shows how many
   fit on a sheet and how many sheets you need.
4. **Turn items to fit more** lets Viewer turn some items on their side when more then fit.
5. Under **Marks**, choose **Crop marks** at each item's corners, or **Cut lines** in the margins
   for items placed edge to edge.
6. Choose **Save PDF** and print it at 100%.

A label sheet places each label where the labels are on the sheet: 21, 14 or 65 on A4, or 30 on
Letter.

## Print a poster on ordinary sheets

1. Select a large PDF page, such as an A1 plan, or a photo, and choose **Lay out…**, then
   **Poster**.
2. Choose the **Poster size**: **Scale**, a percentage of the page's own size, or A3 to A0.
3. Set the **Overlap** that neighbouring sheets share. The summary shows how many sheets the poster
   takes and how they are arranged.
4. Choose **Save PDF** and print it at 100%.
5. Each sheet is labelled in its corner: a row letter and a column number, A1 at the top left. Trim
   each sheet after the first at the solid marks, then glue it over the dashed overlap of its
   neighbour.

## Nest parts for cutting

![Nine parts nested on one 1250 × 2500 mm sheet, a disc inside a ring, under the sheets, cut length, time and cost](../media/nesting.png)

1. Select DXF parts, press **⌘K** and choose **Nest for cutting…**. The Layout plane opens on
   **Nesting** and lists each part with its picture, size and area.
2. Type each part's **Quantity**. The headline answers at once with a box estimate, such as "About 4
   sheets · 1250 × 2500 mm". The true-shape result replaces it within seconds and improves while the
   search runs.
3. Choose how far each part may **Turn**: **As drawn**, **90° steps**, **45° steps**, **15° steps**
   or **Free (5° steps)**. Turn on **Mirror** for parts that may be flipped, and **Grain** for parts
   that must keep their direction along the sheet.
4. If a drawing holds several outlines, choose **Separate parts** or **One part**. Under **Layers**,
   mark engraving and text layers **mark only**: they are drawn but not cut. Layers named like
   ENGRAVE, MARK, ETCH or TEXT are marked already. A drawing that does not say its units shows
   **Units not given**: choose them.
5. Under **Sheets**, turn on every format you can use, with its **In stock** count and **Price
   each**, or **Add size** for your own. Set the **Edge margin** and the **Spacing** between parts.
6. Under **Cutting**, choose the **Material** and thickness, then adjust **Speed**, **Pierce** and
   **Machine rate** to your machine.
7. Read the advice under the headline: which format needs the fewest sheets or costs least, parts
   that fit no sheet, and how many sheets more turning would save. **Fit**, **2×**, **4×** and
   **8×** zoom the sheets.
8. When the headline says **Checked**, choose **Save nesting**. A folder such as "Nesting of 3
   parts" appears beside the first drawing, holding `Sheet 1.dxf` for each sheet, `Report.pdf` and
   `Parts.csv`. **Open folder** shows it.

**Stop** keeps the best layout so far; **Search longer** looks again for longer. The
[nesting reference](../reference/nesting.md) explains the search, the estimate formulas and the
saved files exactly.

## Check a laser job

Before a job is cut, Viewer can read the customer's request, the drawings and photos with a model,
then measure every DXF part itself and say where the job disagrees with itself: a hole pitch drawn
48 mm where the drawing gives 50 mm, a quantity the request and a file name give differently.

1. Select the job's folder, or its files with at least one DXF part, press **⌘K** and choose **Check
   laser job…**. The command appears only where there are parts to cut, and says what the check
   compares there, such as "Compare Job 1042’s request email and 1 drawing with its 5 DXF parts".
   Parts kept in a folder inside the job, such as `DXF/`, are read too. The check panel lists **What
   is sent**: each file with its ref, such as `S2`, and how it goes. A request goes as its text, a
   drawing as its pages with their text, a photo as a picture without location or camera details,
   and a DXF only as Viewer's measurement.
   - Without a request or a drawing, the check reads the parts' names and measurements, and any
     photos.
   - A DWG part is left out: save it as DXF from the CAD app first, as Viewer measures DXF only.
2. Under **Model**, choose the model in **Model to check with**: Meta's Muse Spark, Gemini,
   OpenRouter or another that takes pictures. The check sends pictures, so a model allowed only text
   asks first: choose **Allow pictures for Meta** and confirm.
3. Choose the button that counts the files, such as **Check 7 files**. The panel says what is being
   read and for how long, such as "Muse Spark is reading the request, 2 drawing pages and 1 photo ·
   34 s", then "SAM 3.1 is outlining 3 features". **Cancel** stops it. The model has 240 seconds to
   answer; for a faster answer, open **Settings → Models**, choose the Meta model and set
   **Reasoning effort** to **Minimal: fastest answers**.
4. Read the **Findings**. Each has Viewer's grade, **Confirmed**, **Refuted** or **Unverified**, and
   its reason with the values: "Viewer measured 48.00 mm between holes 4 and 5 along x; the drawing
   gives 50 mm." **Question** marks what the job leaves open, such as how many sets of a drawing of
   two pieces to cut.
   - One misplaced hole that gives two wrong pitches is one finding: "Hole 2 is 2.00 mm off along x:
     the 60 mm pitch reads 58.00 mm and the 28 mm pitch reads 30.00 mm. Moving it, with hole 5,
     fixes both." Each pitch's grade and quote is listed under it.
   - "Muse Spark did not read a quantity for Bracket B2 from the request" means the answer left it
     out. Read the request yourself, or choose **Run again**.
5. For a confirmed pitch, read the proposed correction and choose **Save g6-PL60-B2-2buc
   (corrected).dxf**. The copy is saved beside the original, measured again, and the panel says
   "Saved: pitch 48.00 mm → 50.00 mm, measured again." Nothing is changed until you choose it.
6. Choose **Play the tour** to be shown each finding: the request's line, the drawing with the
   quoted dimension boxed and the hole it is about outlined, the DXF holes with the pitch Viewer
   measured. **Esc** stops it.
7. Under **Cut sheets**, read each part's quantity and thickness and where it comes from, such as "2
   pieces · 6 mm, both from the request", then choose **Prepare cut sheets**. The Nesting plane
   opens on the job's parts, the corrected copy in place of its original, a tab per thickness. Wait
   for **Checked** on each tab.
8. Choose **Export handoff**. A folder such as "Job 1042 handoff" appears in the job's folder,
   holding `Cut sheets/`, `Evidence/` copies of the job's files, `Job.viewer-tour.jsonc`, which
   plays from those copies, and `Check record.json`. **File operations** offers Undo.

Closing the panel keeps the check while the window is open, for its last 5 jobs. Choose **Check
laser job…** on the job again and the panel shows it at once, with "Checked at 22:14 · Run again",
its saved corrections and its handoff. If a file changed since, the panel names it, such as
"g6-PL60-B2-2buc.dxf changed since the check at 22:14", dims the findings as from before, and **Run
again** checks the job as it is now.

Without a check, nesting reads each part's thickness and quantity from its name when it follows a
convention Viewer reads, such as `g6-MB20-A1-4buc.dxf`: 6 mm, part MB20-A1, 4 pieces. Select every
DXF part of the job and choose **Nest for cutting…**; parts of different thicknesses get a tab each,
such as **3 mm · 2 files**, with **From “4buc”** beside a quantity read from a name. A name Viewer
is unsure of, such as one giving two thicknesses, is left unread: Viewer never guesses.

To try it, run `pnpm playground` and open `fabrication/Job 1042`: five parts in 3 and 6 mm, their
drawing and the request. The [fabrication reference](../reference/fabrication.md) gives what a check
sends, how it reconciles quantities and grades findings, the name rules, and the handoff.

## What is saved

- The plane uses photos, PDFs and DXF parts. It names any file it leaves out and why: a file over
  256 MB, or a PDF locked with a password.
- **Save** writes a new file in the folder of the first file you selected and leaves the originals
  as they were. If the name is taken, Viewer chooses a free one. **File operations** in the title
  bar shows its progress and offers Undo.
- A JPEG or PNG holds one page without PDF pages. Layouts of PDF pages, and layouts of several
  pages, are saved as PDF.
- On a paper size, **Resolution** sets the pixels of a JPEG or PNG. A fitted collage takes the
  photos' own resolution, and a screen size is saved at exactly its pixels.

The [layout reference](../reference/layout.md) lists the page sizes, limits and what the saved file
contains.
