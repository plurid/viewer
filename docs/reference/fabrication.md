# Fabrication checks

This page describes exactly how Viewer checks a laser job: what it reads and sends to a model, how
it reconciles quantities and thicknesses, its own measurement of a DXF part, how it grades every
finding against that measurement, the reviewed DXF correction, and the handoff for the shop.
[Check a laser job](../guides/layout.md#check-a-laser-job) has the steps.

The model reads and points; Viewer measures, compares and grades. A model's numbers are never
trusted: a finding stands only when Viewer measures it, or finds its quote on the page.

## What a check reads

**Check laser job…** reads a job folder's own files, not those in folders inside it, or the selected
files when one of them is a DXF. With nothing selected, it reads the folder shown.

| Kind    | Extensions                                                                   |
| ------- | ---------------------------------------------------------------------------- |
| Request | `.eml`, `.emlx`, `.txt`                                                      |
| Drawing | `.pdf`                                                                       |
| Photo   | `.jpg`, `.jpeg`, `.png`, `.webp`, `.heic`, `.heif`, `.tif`, `.tiff`, `.avif` |
| DXF     | `.dxf`                                                                       |

Other files, links and folders are listed under **Left out**, with why. A check needs at least one
DXF, and a request or a drawing to compare it with: "A check compares the request and drawings with
the DXF parts, and this job has no DXF." Each file gets a ref, `S1`, `S2` and on, requests first,
then drawings, photos and DXF parts, each by name.

| Limit                   | Value                               |
| ----------------------- | ----------------------------------- |
| Files                   | 200                                 |
| Photos                  | 8; later ones are left out          |
| Drawing pages           | 12 across the job                   |
| Pictures in one request | 16, each up to 4 MB, 16 MB together |

## What is sent

One request goes to the model, with the instructions, the input as text, then the pictures in the
order the input numbers them. The answer is held to `fabricationAnswerSchema` with a strict
`json_schema`.

| File    | Sent as                                                                                                                                              |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request | Its subject, date, plain text up to 20,000 characters and attachment names, read with the message preview's parser. Addresses are left out           |
| Drawing | Each page drawn by pdf.js at 2048 px on its longer side, as a JPEG, with each run of text and its box on the page                                    |
| Photo   | A JPEG of at most 1600 px on its longer side, turned upright, without EXIF, GPS, XMP or a colour profile. HEIC goes through the preview helper first |
| DXF     | Viewer's [measurement](#measurement) and what its name gives. The drawing itself is not sent                                                         |

The model sees each file by its ref and name, never its folder. Every file is read only while it is
the version the check listed; a page drawn from another version is refused with "Job 1042
drawing.pdf changed since the check listed it. Check the job again." **Cancel** stops the check at
any point, and nothing is graded.

The model has 240 seconds to answer; other requests have 120. The provider's
[reasoning effort](agents.md#add-a-model) goes with the request when one is set. While the check
runs, the panel says what is being read and for how long, then what SAM outlines:

| Step     | The panel says                                                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading  | "Muse Spark is reading the request, 2 drawing pages, 1 photo and 2 DXF parts · 34 s"                                                                                                     |
| Outlines | "SAM 3.1 is outlining 3 features · 2 s"                                                                                                                                                  |
| Too long | "Muse Spark timed out after 240 s reading the job, so nothing was graded. Run the check again, or choose Minimal under Reasoning effort for Meta in Settings → Models to answer faster." |

The faster effort is suggested only for a provider that takes one and does not use it already.

The check sends pictures, so it needs the `images` data level in **Settings → Models**, **filenames,
metadata, document text and pictures (photos and rendered drawing pages)**, and a provider that
takes pictures: Meta, Gemini, OpenRouter or another Chat Completions model; see
[models and agents](agents.md#add-a-model). Without it, nothing is read: "Meta may receive
filenames, metadata and extracted document text. This check also sends pictures: allow …". The check
asks the first Meta model first, then the model of Ask Viewer, then the first that takes pictures;
**Model to check with** chooses another.

## After the answer

1. An answer that does not fit the schema is refused: "Meta’s answer does not fit the check’s form
   at tour, so nothing was graded. Run the check again."
2. What the schema cannot check, refs, pages and boxes, is listed under **Notes on the answer**
   ([answer and grading](#answer-and-grading)).
3. Every finding is graded against Viewer's own measurement.
4. Findings one cause explains become [one finding](#one-cause-one-finding).
5. Quantities and thicknesses are [reconciled](#quantities-and-thicknesses); what disagrees, and
   what the answer leaves unread in the request, becomes a finding of Viewer's own.
6. The answer's tour becomes a tour: each quoted text is marked and each feature
   [outlined](#outlines).
7. Each confirmed pitch finding with a proposal becomes a [correction](#correction) for review.

## Quantities and thicknesses

The request comes first: its message, then a drawing's title block or parts list, as the model read
them with their quotes. A file name comes second, as a fallback and a cross-check. Viewer compares
them itself and never picks one silently.

| Compared                                      | When they disagree                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| The request and the file name                 | "The request asks for 4 pieces of PL60-B2; its file name gives 2 pieces (“2buc”)." |
| The request and the drawing                   | "The request asks for 6 mm of PL60-B2; Job 1042 drawing.pdf gives 5 mm."           |
| The drawing and the name, without the request | "The drawing asks for 6 mm of PL60-B2; its file name gives 5 mm (“g5”)."           |

- **Graded.** Such a finding is **Confirmed** when each quote is on its page and gives its value:
  "The request says “PL60-B2 base plate, 6 mm, 4 pieces”; page 1 of Job 1042 drawing.pdf says
  “Thickness 5 mm”." Otherwise it is **Unverified**, with why: "“MB20-A1 mounting bracket, 6 mm, 4
  pieces” does not give 5 pieces." A disagreement the model already found is not raised twice.
- **Agree.** Thicknesses agree within 0.05 mm. Quantities agree when they are the same count, or one
  is the other times the separate pieces the drawing holds.
- **Used.** **Prepare cut sheets** takes the request's value, else the drawing's, else the name's,
  and says which: "4, from the request", "6 mm, from the file name". Parts the request lists apart
  that are one drawing, such as a left and a right, add up.

**Unread.** When the job has a request, what the answer leaves unread in it is a finding of its own,
one for each part, **Unverified** and without a number of Viewer's:

| The answer                                         | The finding                                                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Lists a part without a quantity                    | "Muse Spark did not read a quantity for Bracket B2 from the request. Check the request or run the check again."   |
| Lists no part for a DXF part                       | "Muse Spark did not read Spacer S4 from the request. Check the request or run the check again."                   |
| Lists a part whose name a DXF has, without its DXF | "Muse Spark did not match Bracket B2 in the request to Bracket B2.dxf. Check the request or run the check again." |

A DXF part the model already found a quantity of is not raised again.

A drawing holding several separate pieces, several outlines, is never assumed to count sets or
pieces. For a drawing of 2 pieces:

| The job gives         | Cut sheets nest                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Only the name, `4buc` | 4 sets × 2 pieces = 8 pieces, from the file name, saying nothing else in the job says whether it counts sets or pieces                                    |
| A request for 8       | 4 sets × 2 pieces = 8 pieces, from the request                                                                                                            |
| A request for 4       | 2 sets × 2 pieces = 4 pieces, from the request                                                                                                            |
| A request for 5       | No number. A question finding: "… holds 2 separate pieces, and the request asks for 5, which is not a whole number of sets. How many sets should be cut?" |

## Outlines

A stop about a finding on a drawing page marks the text its value is read from and the hole, edge or
part the value is about. The page opens fitted to both: the feature outlined, the text's box dashed.

- **Text.** On a page with text runs, the quote is marked by the box of the runs it is read from,
  labelled **the text on the drawing**; a quote on the page more than once is marked where it is
  nearest the model's box. On a page without text, such as a scan, or for a quote not on it, the
  model's `box` stands in, labelled **box from Muse Spark**. Text is never sent to SAM.
- **Feature.** The finding's `feature` box goes to SAM 3.1 as an object prompt in whole pixels of
  the picture the model read. The mask SAM returns, laid over the box SAM found, is traced around
  its largest region and labelled **outline from SAM 3.1**, with SAM's confidence. When SAM gives
  none, the model's feature box stands in, labelled **box from Muse Spark**, with SAM's reason in
  the check record. Another provider's box is labelled for it, such as **box from Gemini**.
- **Photo.** A finding's photo `box` is the region shown; its `feature`, the part or hole, is
  outlined the same way.
- **A stop about no finding** marks its own box: as text when it lies over one text run by half or
  more, by intersection over union, otherwise as a feature SAM outlines.

## The check record

A check keeps its record in memory; it is written only when its [handoff](#handoff) is exported, as
`Check record.json`. It names files, never their folders.

| Field                    | Holds                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`, `level`      | The provider's kind, name, endpoint and model ID, and `images`                                                                                                          |
| `instructions`, `schema` | Exactly what the model was asked, and the JSON Schema of its answer                                                                                                     |
| `inputs`                 | Each file's ref, kind, name, size, date, SHA-256, how it was sent, and each picture's number, size and SHA-256                                                          |
| `output`                 | The model's answer as it parsed, before Viewer checked it                                                                                                               |
| `validation`, `grades`   | Whether the answer fit the schema, its notes, and every grade with its reason                                                                                           |
| `segmentation`           | Each outline: its stop, ref and page, `text` or `feature`, who drew it, its label, the region drawn, the model's box, the quote, SAM's confidence and why SAM gave none |
| `causes`                 | Findings [one cause](#one-cause-one-finding) explains: the finding shown, its readings and the cause in words                                                           |
| `corrections`, `tour`    | The corrections proposed, and the tour's stops and those left out                                                                                                       |
| `timings`, `error`       | Milliseconds to prepare, ask, check and in all; and what stopped a check that failed                                                                                    |

## Handoff

**Export handoff** saves `<job> handoff`, such as "Job 1042 handoff", in the job's folder, through
**File operations**: it is made in a private stage, published whole, and Undo applies.

| Item                    | Holds                                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cut sheets/`           | Each nesting of the job's parts the Layout plane has checked, as **Save nesting** writes it                                                              |
| `Evidence/`             | A copy of every file of the check and of each corrected copy, each with its date                                                                         |
| `Job.viewer-tour.jsonc` | The check's tour, its stops pointed at the copies in `Evidence/`, so it plays wherever the folder goes; each copy has its stop's recorded bytes and date |
| `Check record.json`     | The [check record](#the-check-record)                                                                                                                    |

- A nesting is saved when its every drawing is a part the job cuts, its corrected copy in place of
  an original. One of a drawing since corrected is left out: "“Nesting of 3 parts, 6 mm” nests
  g6-PL60-B2-2buc.dxf, not its corrected copy: prepare the cut sheets again." A thickness no nesting
  covers is said: "6 mm is not nested yet: open its tab in the Layout plane and wait for Checked."
- Every file's version is checked again when the operation starts. A check closed since, or not
  finished, is refused: "This check is no longer open. Check the job again, then export its
  handoff."
- Agents cannot export a handoff, as they cannot save a correction.

## Part names

One common convention names each part `g<thickness>-<part>-<n>buc.dxf`, and Viewer reads it and the
variants below. In `g6-MB20-A1-4buc.dxf`, `g6` is 6 mm, `MB20-A1` is the part and `4buc` is 4 pieces
(_buc_ is Romanian for pieces). Many shops name parts otherwise: a name is a fallback and a
cross-check, and the request comes first.

| Value     | Forms                                                     | Range         |
| --------- | --------------------------------------------------------- | ------------- |
| Thickness | `g6`, `g6mm`, `g1.5`, `g1,5`, `6mm`, `6 mm`, `t6mm`, `t6` | 0.1 to 300 mm |
| Quantity  | `4buc`, `4 buc`, `4buc.`, `4pcs`, `4pc`, `x4`, `4x`       | 1 to 20,000   |

- **Separators.** Fields are separated by `-`, `_` or spaces. A number and its unit may stand across
  one separator: `4 buc`, `4_buc`, `6-mm`. Letters are read in any case.
- **Where.** Viewer reads markers from both ends of the name inward, one thickness and one quantity.
  Between them, only forms with a unit are read: `g6`, `6mm`, `t6mm`, `4buc`, `4pcs`. The bare forms
  `t6`, `x4` and `4x` stay part of the name there, so `g6-T6-2buc.dxf` is part `T6`.
- **The part** is what is left, with its own separators: `MB20-A1`, or `PL60_B2` from
  `g6mm_PL60_B2_x4.dxf`. A bracketed ending such as `(corrected)` is set aside, so a corrected copy
  reads like its original. The extensions `.dxf`, `.dwg`, `.dwf`, `.pdf`, `.svg`, `.stp`, `.step`,
  `.igs`, `.iges`, `.ai`, `.eps`, `.nc` and `.cnc` are removed first.
- **Unsure means unread.** A name that gives two thicknesses, such as `T3-g6-2buc.dxf`, or a value
  out of range, such as `g0` or `0buc`, gives none, and Viewer says which text it saw: "The name
  gives two thicknesses: “T3” and “g6”." It never guesses. A decimal count such as `2.5buc` is not a
  quantity.

Files are grouped by thickness, thinnest first: the one a check's request gives, else the one their
names give. Files with neither are grouped last as **Thickness not in name**.

## Nesting by thickness

When the selected parts' names give more than one thickness, **Nesting** shows one tab per
thickness, such as **3 mm · 2 files**. Each thickness has its own parts, quantities, sheets, cutting
values and search.

- **Cutting values** start from the preset of the same material and process at that thickness. With
  no preset at that thickness, the nearest one is used, the thicker on a tie, with the thickness
  set.
- **Quantity** of each part starts from, in order: the quantity the plane was opened with, shown as
  **As requested**; the quantity in the file's name, shown as **From “4buc”**; otherwise the copies
  drawn. A quantity counts sets of the drawing: a drawing of two outlines cut `4buc` gives 8 pieces.
  Typing a quantity replaces it; opening the plane again with quantities replaces those typed.
- **By thickness** lists each thickness with its sheets, pieces, time and cost, and **All** sums
  them. The shown thickness is live. Another thickness shows its last finished search while nothing
  it nests has changed, otherwise its box estimate as **About 2 sheets**.
- **Save nesting** saves the shown thickness, named for it: "Nesting of 3 parts, 6 mm".

## Measurement

Viewer measures a DXF on the entities its preview draws, so every value names the entity numbers the
preview highlights.

- **Units.** The drawing's `$INSUNITS` is converted to millimetres. A drawing that does not give its
  units, or gives a code Viewer does not know, is not measured: "The drawing does not give its units
  ($INSUNITS), so it is not measured."
- **What is measured.** Lines, polylines, circles, arcs, ellipses and splines on visible layers.
  Layers whose names mark engraving or text, as in [nesting](nesting.md#reading-parts), are left
  out, and so are text, points and solids. An entity drawn twice counts once.
- **Loops.** Ends closer than 0.05 mm join, in any order and direction. A loop at an even depth is
  an outline; a loop inside an outline is a hole when it is round, otherwise a cut-out such as a
  slot.
- **Round.** Circles, and arcs that share a centre and radius, give their centre and diameter
  exactly. Any other loop is round when every point lies within 0.01 mm of one fitted circle and no
  chord between its points falls more than 0.01 mm inside it, so a polygon is not a hole. A hole
  drawn with lines, a spline or an ellipse is marked as fitted. Two round loops with the same centre
  and size are one hole.
- **Hole numbers** follow reading order: rows from the top, each from the left. Centres within 0.05
  mm in y share a row; within 0.05 mm in x, a column.
- **Pitch** is centre to centre along x, along y, or straight between the centres. Viewer gives it
  between two named holes, and between neighbours: along x within each row and along y within each
  column.
- **Size** is the box of the outlines.

The summary a model reads gives millimetres to the thousandth, the entity numbers of every outline
and hole, and no paths. It lists up to 200 holes and 400 pitches, and says when it lists fewer.

## Answer and grading

A model's answer is checked against `fabricationAnswerSchema` in `src/domain/fabrication/answer.ts`.
It names files only by inventory refs: `S1`, `S2` and on, numbered requests first, then drawings,
photos and DXF parts, each by name. The model sees each file's name and kind, never its folder.
Entities are the numbers of the DXF summary. Every field is required; an absent value is `null`.

| Part        | Fields                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------- |
| Request     | `ref`, `part`, `dxf` ref, `quantity`, `thickness`, `material`, `quote`, `drawing`            |
| Title block | The request's `drawing`: `ref`, `page`, `quantity`, `thickness`, `material`, `quote`         |
| Finding     | `id` (`F1` …), `kind`, `summary`; `drawing`, `dxf`, `photo` and `proposal`, each or `null`   |
| Drawing     | `ref`, `page`, `value`, `quote`, `box` (the quoted text), `feature` (the hole, edge or part) |
| DXF         | `ref`, `value`, `axis` (`x`, `y`, `centre`), `entities`                                      |
| Photo       | `ref`, `box` (the region shown), `feature` (the part or hole)                                |
| Proposal    | `target`, `move`: entities of the holes that move                                            |
| Stop        | `ref`, `caption`, `note`, `finding`, `page`, `box`, `entities`                               |

A box is left, top, right and bottom, as fractions of the page or photo. Refs that are not in the
inventory or are of the wrong kind, pages past the last, boxes and feature boxes the wrong way round
and tour stops naming a missing finding are reported as issues.

Each finding is graded against Viewer's own value:

| Grade          | When                                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Confirmed**  | Viewer's value matches the finding's DXF value within the tolerance and differs from the drawing's value by more than it                     |
| **Refuted**    | Viewer's value matches the drawing's, so there is no mismatch, or differs from the finding's DXF value                                       |
| **Unverified** | Viewer cannot measure it: only a photo shows it, an entity is not a hole, the drawing has no units, a value is missing, or a quote is absent |

The tolerance is 0.05 mm for lengths; counts must match exactly.

| Kind                    | Viewer's value                                                               |
| ----------------------- | ---------------------------------------------------------------------------- |
| `pitch`                 | Between the two holes the entities name, along the axis given or lined up on |
| `diameter`              | Of the one hole the entities name                                            |
| `size`                  | The outline's width (`x`) or height (`y`)                                    |
| `holes`                 | The holes in the outline                                                     |
| `thickness`, `quantity` | What the DXF's file name gives                                               |
| `material`, `other`     | None: always unverified                                                      |

When the quoted page has text, the quote must be on it, ignoring case and spacing, in one of three
forms. The instructions ask for the first, the shortest that states the value.

| Form                           | On the page                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| One passage                    | As one stretch of its text: "Holes 4× Ø9 at 60 × 50 mm"                                                                              |
| Passages on lines of their own | Each line of the quote, in that order, with lines between left out: "Job 2103, in S355 steel:" then "- CL10-D1 clip, 3 mm, 6 pieces" |
| Whole printed lines            | Lines as printed, in order, joined without line breaks: the row "HP50-A3 Hinge plate 6 mm 2", then "Material: S235JR steel, 6 mm"    |

- **A printed line** is the runs of text that follow one another on the page and share a line, as a
  table row's cells do.
- **Never pieces cut from lines.** "HP50-A3 Hinge plate 6 mm 4", one row's part with another row's
  count, is not on that page. Every non-empty line of a quote must be on it.
- **Never a cut number.** "2 pieces" is not on a page that says "12 pieces", nor "Ø8.5" on one that
  says "Ø8.55".

A scanned page without text is not checked. Every reason gives the values: "Viewer measured 48.00 mm
between holes 4 and 5 along x; the drawing gives 50 mm."

The answer's tour becomes a tour Viewer plays (`checkTour` in `src/domain/fabrication/tour.ts`). A
drawing's page opens with its text and feature [outlined](#outlines), without searching for the
quote. A photo's box marks that region. A DXF stop highlights its entities, frames them with 10 mm
around, and for each pitch finding draws the pitch Viewer measured between its two holes. A stop
about a finding shows its grade, with Viewer's reason as its note. Each stop's `version` carries the
SHA-256 the check read of its file, so the tour knows the file by its bytes. A stop whose file is
outside the tour's folder is left out, and Viewer says which.

## One cause, one finding

Confirmed pitch findings whose corrections move the same holes of one DXF by the same amount have
one cause, and the check shows them as one finding: "Hole 2 is 2.00 mm off along x: the 60 mm pitch
reads 58.00 mm and the 28 mm pitch reads 30.00 mm. Moving it, with hole 5, fixes both."
(`sharedCauses` in `src/domain/fabrication/causes.ts`).

- **Readings.** Each finding it joins is listed under it as a reading, with its own grade, reason
  and quote. The check record keeps every reading's grade and names the cause under `causes`.
- **One correction.** The first reading's correction, with each other reading's pitch under `also`.
  The copy is measured again for every pitch.
- **One stop for each file.** The readings' stops on one file and page are one stop: on the drawing,
  each reading's text and feature; on the DXF, each pitch Viewer measured. Their captions are
  joined, and the note gives every reading's reason.

## Correction

A confirmed pitch finding with a proposal becomes a reviewed transform of kind `dxf-correction`
(`dxfCorrectionSchema` in `src/domain/fabrication/plan.ts`):

| Field      | Meaning                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `from`     | An entity of the hole that stays                                                                                                |
| `to`       | An entity of the hole whose pitch is set; it moves                                                                              |
| `axis`     | `x`, `y` or `centre`                                                                                                            |
| `target`   | The pitch to set, in millimetres: the drawing's value                                                                           |
| `measured` | The pitch as reviewed, in millimetres                                                                                           |
| `move`     | Entities of further holes that move with `to`, such as its column                                                               |
| `also`     | Further pitches the same move sets, each `from`, `to`, `axis`, `target` and `measured`: for [one cause](#one-cause-one-finding) |

- **What moves.** The moving holes go along the axis by the difference, away from the hole that
  stays when the pitch grows. Every other entity stays where it is.
- **Refused**, with the reason and nothing written: a drawing that now measures another pitch than
  `measured`, a pitch under `also` the move does not set, an entity that is not a hole, a hole asked
  to stay and move, a fitted hole, two holes sharing their position on the axis, or a moved hole
  that would cut into the outline, a cut-out or another hole. A web under 1 mm is named in the
  report's notes.
- **Written** as nesting writes a sheet: an R12 DXF in the drawing's own units, on its own layers,
  lines, arcs, circles and bulged polylines exact. Dimensions, hatches, points, hidden layers and
  other entities a cutter does not follow are left out, and the notes say so.
- **Measured twice.** The copy is measured in memory and again after it is read back from disk. Its
  pitch, and each pitch under `also`, must equal its target within 0.00001 mm, and every other hole
  must be where it was.
- **Saved** beside the original as `<name> (corrected).dxf`, as a new file only; the original is
  only read. Through **File operations**, a name already taken gives `<name> (corrected) copy.dxf`,
  and Undo applies. The job's record keeps the pitch before and after, the shift, each moved hole's
  entities in the original and in the copy, and the thinnest web.

Agents cannot propose a correction; it is saved from a reviewed check with **Save `<name>`
(corrected).dxf**, as nestings are saved from the Layout plane.

## Samples and evaluation

`pnpm playground` writes `fabrication/Job 1042/`: five AutoCAD 2010 DXF parts in millimetres named
in the convention, a one-page dimensioned drawing and the request with the drawing attached. The
base plate's DXF puts its holes 48 mm apart where the drawing gives 50 mm. `fabrication/Evaluation/`
holds about forty generated parts and `Truth.json`, which gives each part's thickness, quantity,
holes and a pitch, and whether that pitch is drawn off.

From the repository root,
`node --import tsx packages/viewer-electron/app/tools/fabrication/evaluate.ts` reads, measures,
grades and corrects every evaluation part, nests each thickness with the quantities the names give,
and prints the accuracy. It writes nothing.

### Live evaluation

`tools/fabrication/evaluate-live.ts` runs the check on eight generated jobs with the real models:
Viewer's own check service, the Meta provider with Muse Spark, and SAM 3.1 for the outlines, as the
app wires them. Each job is a request message, one or two dimensioned drawings with a parts list and
a title block, one to three DXF parts and, for J1, J4 and J7, a photo of a part. Six jobs have
problems planted; J7 and J8 are controls with none. Every part, customer and address is fictional
(`tools/playground/samples/fabrication-jobs.ts`).

| Job | Part names                              | Planted                                                                    |
| --- | --------------------------------------- | -------------------------------------------------------------------------- |
| J1  | `g5-TP40-A1-4buc.dxf`                   | A hole pitch: 58 mm in the DXF, 60 mm in the drawing                       |
| J2  | `Bracket B2.dxf`                        | A hole Ø10 where the drawing gives Ø8.5; 6 requested, 8 in the title block |
| J3  | `g5-FL30-C2-2buc.dxf`                   | 5 mm requested, 4 mm in the title block                                    |
| J4  | `Base B7.dxf`                           | A hole Ø12 where the drawing gives Ø13; a requested part with no DXF       |
| J5  | `g3-SB40-LR.dxf`                        | 5 pieces of a drawing of 2; a pitch of 48 mm where the drawing has 50      |
| J6  | `g2-CL15-A1-12buc.dxf`, `Gusset K2.dxf` | 10 requested, `12buc` in the name; a requested part with no DXF            |
| J7  | `g6-HP50-A3-2buc.dxf`                   | Nothing                                                                    |
| J8  | `Plate P9.dxf`                          | Nothing; 4 pieces of a drawing of 2 is 2 sets                              |

1. Set `META_API_KEY` in the environment. The evaluation reads the key from there only and holds it
   in memory: it never prints, writes or logs it, and stops before writing a result that would hold
   it.
2. From the repository root, run
   `node --import tsx packages/viewer-electron/app/tools/fabrication/evaluate-live.ts --out <folder>`
   with a new or empty folder outside the repository. The evaluation never overwrites.
3. Read `summary.md` in that folder. `answers.json` holds every raw reply, each check record and the
   score of every run; `truth.json` holds what each job plants and where its text and features are;
   `jobs/` holds the jobs as sent.

| Option                     | Effect                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `--jobs J1,J7`             | Only these jobs                                                                                  |
| `--repeat <n>`             | Each job `n` times, for the variance between runs                                                |
| `--model <id>`             | Another Muse Spark model; `muse-spark-1.3` unless given                                          |
| `--effort <value>`         | Muse Spark's reasoning effort, `minimal` or `low`; the API's own unless given                    |
| `--retries <n>`            | Runs a check again after a schema miss, invalid JSON, a timeout or a busy server; 1 unless given |
| `--price <input>,<output>` | US dollars per million tokens, for the cost when the replies report tokens without one           |

Each run makes one Muse Spark call, and one SAM 3.1 call for each feature a tour stop outlines on a
drawing page or photo: the answer may have 12 stops, and the instructions ask for at most 8. A retry
makes them again. Photos go through Viewer's image processor, in this process: without it built,
leave out J1, J4 and J7.

| Measure            | How                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Found              | A finding of the planted problem's kind that names its DXF or, naming none, its part. A missing DXF is found by any finding without a DXF that names the part; an open count by a quantity finding. A finding of one cause counts once                                                                                                         |
| Unread             | Viewer's findings of what Muse Spark did not read from the request, counted apart: neither found nor false. A planted problem they name is marked so in the missed list                                                                                                                                                                        |
| Recall             | Found over planted, for each kind and in all, with how many were confirmed and how many got the grade expected: confirmed, or unverified for a missing DXF and an open count                                                                                                                                                                   |
| False findings     | Findings of no planted problem, by job, by the model or Viewer, and by grade. A second finding of a found problem is a duplicate, not false                                                                                                                                                                                                    |
| Quotes             | Each quote of the answer against the text of the page it names, as grading checks it                                                                                                                                                                                                                                                           |
| Request            | The parts the model listed from the request, with the right quantity, thickness and DXF                                                                                                                                                                                                                                                        |
| Schema and retries | Attempts, and why each failed: schema, JSON, incomplete, HTTP, timeout or network, with where the answer missed the schema                                                                                                                                                                                                                     |
| Outlines           | Text and features apart, by intersection over union: a quoted text's box against the page's text runs and labelled text, a feature's outline against the drawing's pieces and holes and the photo's part and holes, a hole as the circle in its box; the model's boxes the same way; and how often the box stood in for SAM, with SAM's reason |
| Calls              | Each call's time, and its tokens and cost when the reply reports them                                                                                                                                                                                                                                                                          |

The drawing pages are drawn in Node, not by the app's renderer. pdf.js draws them at 2048 px on the
longer side as JPEGs at the same quality, with text runs from the same code, but:

- **Canvas.** pdf.js's Node build draws onto `@napi-rs/canvas`, pdf.js's own dependency, where the
  app draws onto Chromium's canvas. Both use Skia; the pixels and JPEG bytes differ slightly.
- **Fonts.** In Node, pdf.js draws text without system fonts, from its standard font data; in the
  app a drawing's unembedded Helvetica may be drawn with the system's. Glyph shapes differ; text
  runs and their boxes do not.
- **Reading.** The pages are read from the file directly, not through a preview resource, and
  pdf.js's worker runs in the same thread. The check service compares each file with the version it
  listed, as in the app.
