# Nesting for cutting

This page describes exactly how the **Nesting** mode of the Layout plane reads DXF parts, packs them
on stock sheets for laser, plasma or water-jet cutting, checks the result and saves it.

Nesting reads each part's true shape, packs the copies you ask for onto the formats you allow,
checks the result exactly and saves one DXF per sheet with a PDF report and a CSV parts list. The
steps are in the [Layout guide](../guides/layout.md#nest-parts-for-cutting). The saved plan is
`nestingTransformSchema` in `src/domain/layout/nesting/plan.ts`.

## Reading parts

**Entities.** Lines, arcs, circles, ellipses, splines, polylines with bulges, text and block
references (`INSERT`, including arrays) are read from model space. Paper space, invisible entities,
hidden or frozen layers, and entities on a tilted plane are left out. Dimensions, hatches, points,
solids and other types are left out and listed in the part's notes. Binary DXF is refused.

**Units.** A drawing's `$INSUNITS` sets its unit, converted to millimetres. When the drawing does
not say, the drawing shows **Units not given** with a choice of every physical DXF unit,
millimetres, centimetres, metres, inches and feet first; millimetres until you choose.

**Loops.** For packing, every curve is flattened to chords within 0.05 mm of the curve. Entities
whose ends lie within 0.05 mm join into one path, in any order and direction. A path whose ends meet
is a closed loop. When the two ends of an otherwise closed outline are up to 0.5 mm apart, the gap
is bridged and the part's notes say so: check the drawing, because the saved DXF keeps the original
entities and the gap with them. Exact duplicate entities are cut once.

**Outlines and holes.** Each loop's parent is the smallest loop around it. Loops at even depth are
outlines; loops at odd depth are holes of their parent. An outline drawn inside a hole, such as a
disc in a ring, is a separate outline.

**Open paths.** A path that does not close is cut as drawn. It counts toward cut length and pierces,
not area, and it keeps neighbours at the spacing like any edge.

**Marked layers.** A layer marked **mark only** is drawn and saved but never cut. Layer names
containing `engrav`, `mark`, `etch`, `text`, `scribe`, `label`, `annot`, `bend` or `defpoints`, in
any case, are marked when a drawing opens. Text on any layer is a mark. Marks outside every outline
are left out.

**Several outlines in one drawing.** A drawing with more than one outline offers **Separate parts**
(the default) or **One part**. Separate outlines that are translated copies of each other are one
part with that many copies; a mirrored copy is a different part. Separate parts are numbered in
reading order, top row first.

**Each part** has a **Quantity** (0 to 20,000), a **Turn**, **Mirror** and **Grain**. The quantity
starts from the copies found in the drawing, times the quantity the plane was opened with or the
file's name gives. Parts whose names give different thicknesses are nested one thickness at a time;
see [nesting by thickness](fabrication.md#nesting-by-thickness).

**A drawing that cannot be nested** names the reason: "Bracket has no closed outline. Its nearest
open ends are 2.00 mm apart.", or "has nothing to cut" when every layer is marked.

## Part facts

| Fact        | Meaning                                                               |
| ----------- | --------------------------------------------------------------------- |
| Size        | The part's box as drawn, in millimetres                               |
| Area        | Outlines less their holes; exact for lines, arcs, bulges and ellipses |
| Cut length  | Every closed loop and open path; exact for lines, arcs and bulges     |
| Pierces     | One per closed loop and per open path                                 |
| Mark length | Marked lines, shown in the report but not timed                       |

## Turning, mirroring and grain

| Turn                | Angles                        |
| ------------------- | ----------------------------- |
| **As drawn**        | 0°                            |
| **90° steps**       | 0°, 90°, 180°, 270°; at first |
| **45° steps**       | every 45°                     |
| **15° steps**       | every 15°                     |
| **Free (5° steps)** | every 5°                      |

**Mirror** also tries each angle mirrored across the part's vertical axis. **Grain** keeps the
part's x axis along the sheet's length, so only 0° and 180° remain. Orientations that look the same,
such as a square's quarter turns, are searched once.

## Units

**Units** beside the **Sheets** heading reads every length in the panel in millimetres or inches:
part sizes and areas, sheet formats, edge margin, spacing, kerf, speeds (mm/min or in/min), cut
length, offcuts, weights (kilograms or pounds), and the saved report and parts list. Values are kept
in millimetres; a drawing's own units still come from its file, and the sheet DXFs are written in
millimetres. Thickness stays in millimetres, as the presets and the part names give it. The choice
is the Layout preference `ui.layout.units`, `mm` or `in`; see [configuration](configuration.md).

| Units  | Typed and shown                               | Long lengths    | Areas           |
| ------ | --------------------------------------------- | --------------- | --------------- |
| **mm** | Millimetres to a hundredth                    | Metres from 1 m | m²              |
| **in** | Inches to a thousandth; sheets to a hundredth | Feet from 10 ft | in², ft² from 1 |

## Sheets

Only the formats you nest on are listed, each with an optional stock count (empty for **Any**, up
to 500) and a price per sheet; **×** removes one. **Add format** offers the presets of the chosen
units and **Custom size…**, a width and length each 10 to 100,000 mm; up to 12 formats in all. A
preset removed and added again keeps its stock and price. A custom size that matches a preset turns
on the preset.

| Units  | Presets                                                         | Chosen at first |
| ------ | --------------------------------------------------------------- | --------------- |
| **mm** | 1000 × 2000, 1250 × 2500, 1500 × 3000, 2000 × 4000, 2000 × 6000 | 1250 × 2500     |
| **in** | 48 × 96, 48 × 120, 60 × 120, 60 × 144 (4' × 8' to 5' × 12')     | 48 × 96         |

Changing units while the formats are as they started changes them to the other unit's first format.
With no format chosen, no sheet is drawn, the summary reads "Choose a sheet format to nest on." and
**Save nesting** is off.

A sheet lies with its longer side along x. **Edge margin** (10 mm at first) keeps every part that
far inside the sheet edge. **Spacing** (5 mm at first) is the least distance between any two parts,
holes included. Each is 0 to 1,000 mm. Choosing a material sets both from the process and thickness
(see [cutting allowances](#cutting-allowances)) until you type one yourself.

## Direction

**Direction** chooses where the parts gather.

| Direction            | Placement                                                                   | What is left            |
| -------------------- | --------------------------------------------------------------------------- | ----------------------- |
| **Compact block**    | The last sheet's parts in a block in its lower left corner; at first        | Pieces on two sides     |
| **Along the length** | Rows along the sheet's long side from its upper edge, each row filled first | A strip down the length |
| **Along the width**  | Columns across the sheet from its left end, each column filled first        | A strip across the end  |

Along the length, the fill stands the sheet on end and turns each part back a quarter turn, so a
part's allowed turns, mirroring and grain hold as on any sheet. **Compact block** fills full sheets
along the width, then packs the last sheet again on its own: its columns are capped at heights from
0.8 to 4 times the side of a square holding its parts' boxes, and at the full width, each with both
placement rules. The layout whose parts' box, measured from the corner, has the least area wins,
then the one leaving the larger offcut. The caps and orders are the same every time, so a layout
compacts the same way each run.

**Offcut.** The offcut is the largest piece one straight cut across the whole sheet takes off, the
cut at the spacing from the parts: across the sheet past the parts' box, or along it beside them.
Its cut side is rounded down to a whole millimetre. It is **reusable** when both its sides are at
least 300 mm, about a foot; otherwise it is **too small to keep**. Sixteen parts of 90 × 72 mm on a
1250 × 2500 mm sheet form a block of about 310 × 380 mm and leave "Offcut 1250 × 2178 mm, reusable".

## Estimate while typing

Each change of quantity, turn or sheet updates a box estimate at once: every part's box, widened by
the spacing, is packed by MaxRects with the best short-side fit, longest side first, a quarter turn
allowed when the part may take one. Above 3,000 copies the boxes go in rows instead. The headline
reads "About 4 sheets" until the true-shape result arrives.

## True-shape nesting

Half a second after the last change, a worker starts the true-shape search; better layouts replace
the shown one as they are found. **Stop** keeps the best so far. **Search longer** searches again,
each time for longer, from a different random start, and keeps the shown layout until it finds a
better one. **Search** sets the time: 5, 15 (at first), 30 or 60 seconds.

**Raster.** Each orientation of each part is drawn on a square grid. A cell is marked when it comes
within half the spacing, plus 0.05 mm for flattening, of the part's material; holes stay empty, so
smaller parts can land in them. Two parts whose cells do not meet are therefore at least the spacing
apart. The cell size is a hundredth of the median part's short side, or finer, down to a 400th, when
the smallest part's short side needs it; it stays between a 5,000th and a 600th of the longest sheet
and is rounded up to a step from 0.25 to 10 mm. A coarse pass at twice that size answers first, and
past half the time a finer pass at half the size can improve on it. The grid costs up to about 1.5
cells of extra gap between neighbours.

**Placement.** Copies are placed one at a time, largest first. A copy goes first into a hole of a
part already placed, on any open sheet: the smallest hole that takes it, at its lowest-leftmost free
spot. Material inside a hole is otherwise scrap, so a disc lands in a ring and a tab in a flange.
Otherwise the copy goes into the first open sheet where it fits: in each allowed orientation the
part slides up each column of the sheet past what is already there, and the first column where it
fits gives its position. Of the orientations, the one whose far end lies nearest the start of the
sheet wins (or, in the other rule, the one that starts nearest). A new sheet opens when no open
sheet takes a copy. The columns run across the sheet's width; **Along the length** they run down it,
as [Direction](#direction) explains.

**Search.** The search tries each allowed format alone and, with several formats, a mix that opens
the cheapest material first (or the largest sheet, without prices) within stock. It tries four part
orders (area, longest side, box area, shortest side) and both placement rules, then swaps parts in
the best order at random. In every order, a part comes after the parts with a hole its box might fit
in, so their holes are there when it is placed. A layout is better when it places more copies, then
when it costs less (or, without prices, uses less sheet area), then when it uses fewer sheets, then
when its last sheet's parts spread less (along the width, how far they reach along the sheet; along
the length, how far across; compact, their box's area), then when it leaves a larger offcut. In the
compact direction, each new best layout has its last sheet packed again as a block. Once every copy
fits on as few sheets as the area allows, the search ends after 60 passes in a row bring nothing
better.

**Exact check.** When the search ends, every pair of placed parts whose boxes come within the
spacing is measured edge to edge, and every part is checked against the margin. Flattened curves are
held 0.1 mm further apart than the spacing, so the drawn curves keep it. A part lying on another's
material fails even without nearby edges. The panel shows "Checked: parts at least 5.4 mm apart,
inside the margin." Saving is refused if the check fails, and the desktop repeats it before writing.

**Limits.** At most 200 drawings, 2,000 parts, 20,000 placed copies, 500 sheets and 12 formats. A
drawing may be 32 MB, 50,000 entities and 1,000,000 vertices. Block references expand to at most
200,000 entities, 16 levels deep, and a block array holds at most 10,000 copies. Raster nesting is
not optimal: shapes that interlock only at angles finer than the turn step, or in gaps smaller than
a cell, are missed.

## Results and advice

The headline gives the sheets used and their format, the material used (parts' area over sheet
area), copies placed of those requested, cut length, pierces, cutting time and cost. Under it, the
last sheet's [offcut](#direction): "Offcut 1250 × 2178 mm, reusable", or with several sheets "Offcut
on sheet 3: …".

**Picking a part.** A click on a part on a sheet picks it: every copy of it lights up on every
sheet, its row in **Parts** is marked, and **Selected part** gives its number and name, its file,
size, holes, the pieces placed of those requested, and the sheets it is on. A click on empty sheet,
**Esc** or **×** lets it go. A double click, **Enter** or **Open drawing** opens its DXF in a plane.
With a sheet focused, **←** **→** (or **↑** **↓**) step through its parts in number order, and
**Home** and **End** pick the first and last. Picking moves nothing.

Advice appears under the headline:

- each format alone, ranked: "1500 × 3000: 3 sheets, 84% used, €360", then which needs the fewest
  sheets and which costs least, and a mix when mixing does best;
- a part that fits no sheet: larger than every sheet, or fitting only when turned further;
- copies left off because the stock runs out;
- the sheets that more turning freedom would save, tried once per search for parts that turn less
  than 45° steps: "Letting Bracket and Plate turn in 45° steps would save 1 sheet (3 instead of 4)";
- the sheets true-shape nesting saves over boxes;
- a last sheet less than a quarter used;
- a spacing narrower than the kerf, which would run neighbouring cuts together.

## Estimates

| Figure       | Formula                                                            |
| ------------ | ------------------------------------------------------------------ |
| Cutting time | cut length ÷ speed + pierces × pierce time                         |
| Cost         | sheets × price + cutting time × machine rate                       |
| Weight       | area × thickness × density, for parts placed and for sheets bought |

Rapid moves, lead-ins, marking and setup are not included. **Material** fills speed, pierce time,
kerf and density from a table of typical values for about 3 kW fiber, 100 W CO2, 65 A plasma and an
abrasive water jet; editing any value makes them **Custom values**. It starts at **Mild steel 3 mm ·
Fiber laser**. **Process** picks that process's preset for the same material at the nearest
thickness, thicker on a tie, or the process's nearest thickness in another material when it has none
for this one. Check the values against your machine.

The kerf is the width of the cut. The machine offsets its path by half of it, so the parts keep the
drawn size; nesting uses it for the report and to warn about a spacing narrower than it.

| Material        | Process     | Thickness (mm)   | Speed (mm/min)                | Pierce (s)          | Kerf (mm)                |
| --------------- | ----------- | ---------------- | ----------------------------- | ------------------- | ------------------------ |
| Mild steel      | Fiber laser | 1, 2, 3, 6, 10   | 15000, 7000, 4000, 2200, 1300 | 0.1, 0.2, 0.4, 1, 2 | 0.1, 0.15, 0.2, 0.3, 0.4 |
| Mild steel      | Plasma      | 3, 6, 10, 20     | 5000, 3000, 1800, 800         | 0.3, 0.5, 0.8, 1.5  | 1.5, 1.7, 1.9, 2.3       |
| Stainless steel | Fiber laser | 1, 2, 3, 5       | 20000, 9000, 5000, 2000       | 0.1, 0.2, 0.3, 0.6  | 0.1, 0.15, 0.2, 0.3      |
| Aluminium       | Fiber laser | 1, 2, 3, 5       | 18000, 8000, 5000, 2000       | 0.1, 0.2, 0.3, 0.6  | 0.1, 0.15, 0.2, 0.3      |
| Plywood         | CO2 laser   | 3, 6, 9          | 1500, 600, 300                | 0.1, 0.3, 0.5       | 0.2, 0.25, 0.3           |
| Acrylic         | CO2 laser   | 3, 5, 8          | 900, 500, 250                 | 0.2, 0.4, 0.8       | 0.15, 0.2, 0.25          |
| Mild steel      | Water jet   | 3, 6, 10, 20, 30 | 750, 400, 240, 110, 70        | 2, 4, 8, 18, 30     | 0.9, 1, 1, 1.1, 1.2      |
| Stainless steel | Water jet   | 3, 6, 10, 20     | 520, 300, 180, 80             | 3, 6, 12, 25        | 0.9, 1, 1, 1.1           |
| Aluminium       | Water jet   | 3, 6, 10, 20, 30 | 1000, 600, 380, 180, 120      | 1.5, 3, 6, 14, 22   | 0.9, 1, 1, 1.1, 1.2      |

Densities: steel 7.85, stainless 8, aluminium 2.7, plywood 0.6 and acrylic 1.19 g/cm³. The machine
rate starts at 90 an hour and the currency at €; a one-character currency leads the amount, a longer
one follows it.

**Water-jet values.** Abrasive cutting at 4,100 bar (60,000 psi) with a 0.30 mm orifice, a 1.0 mm
focusing tube and 80-mesh garnet, at a medium edge quality, the third of the five quality steps
OMAX's software offers. Each speed, pierce time and kerf lies inside the reference ranges FabFlow
publishes for that set-up, for example mild steel 6 mm at 350 to 500 mm/min with a 0.8 to 1.1 mm
kerf and 25 mm at 70 to 120 mm/min; stainless steel 12 mm at 120 to 180 mm/min and a 10 to 20 s
pierce; aluminium 25 mm at 100 to 180 mm/min and a 15 to 30 s pierce. Values between the published
thicknesses follow speed falling a little faster than thickness rises. Thick plate pierces with a
low-pressure start, and a separation cut runs two to three times faster than these speeds. Sources:
[FabFlow, Waterjet cutting engineering guide](https://www.fabflow.app/blog/waterjet-cutting-complete-engineering-guide)
(tables 5.1 and 7.1) and the
[OMAX protocol at UC Berkeley](https://me.berkeley.edu/wp-content/uploads/2025/05/Omax-Abrasive-Jet-Machining-Protocol-2024.pdf)
(quality steps).

### Cutting allowances

Choosing a material sets **Spacing** and **Edge margin** for its process and thickness, the nearest
row, until you type them. A water jet starts each part from a lead-in in the scrap beside it, and in
thick plate the pierce leaves a crater, so its parts sit further apart.

| Process               | Thickness (mm)   | Spacing (mm)   | Edge margin (mm)   |
| --------------------- | ---------------- | -------------- | ------------------ |
| Fiber, CO2 and plasma | Any              | 5              | 10                 |
| Water jet             | 3, 6, 10, 20, 30 | 3, 4, 5, 8, 10 | 10, 10, 15, 15, 20 |

## Saved files

**Save nesting** writes a new folder beside the first drawing, named for its parts: "Nesting of 3
parts". It goes through file operations like any export: the folder is made in a private stage,
published whole, and **File operations** offers Undo, which moves it to the Trash. The drawings are
read again and must not have changed since they were nested.

| File            | Contents                                                                 |
| --------------- | ------------------------------------------------------------------------ |
| `Sheet 1.dxf` … | One sheet each, R12 (AC1009) ASCII DXF in millimetres (`$INSUNITS` 4)    |
| `Report.pdf`    | A summary page with the tables and assumptions, then each sheet to scale |
| `Parts.csv`     | A parts table, a blank line, then a sheets table                         |

**Sheet DXF.** Each part's own entities are moved into place. Lines, arcs, circles and polylines
with bulges stay exact, including under mirroring; ellipses and splines become polylines within 0.01
mm. Coordinates are written to a millionth of a millimetre.

| Layer       | Color | Holds                                                |
| ----------- | ----- | ---------------------------------------------------- |
| `CUT-OUTER` | 1     | Outlines                                             |
| `CUT-INNER` | 5     | Holes                                                |
| `CUT-OPEN`  | 6     | Open cut paths                                       |
| `MARK`      | 3     | Marked layers and text                               |
| `LABELS`    | 2     | Part numbers, when **Part numbers in the DXF** is on |
| `SHEET`     | 8     | The sheet outline                                    |

**Report.** A4 landscape. The first page lists the sheets used, the material used, parts placed, cut
length, pierces, cutting time, cost and weight; a sheets table with the material used and offcut
length of each; a parts table with each part's number, file, size, quantities, area, cut length and
pierces; and the assumptions behind the estimate, with the closest distance the exact check found.
Each further page draws one sheet to scale with its margin, every part numbered, and a legend. A
sheet with more than about 5,000 outlines and holes is drawn without holes and marks, and says so.

The report and the parts list measure in the units chosen when the nesting was saved; the sheet DXFs
are in millimetres whatever the units.

**Parts.csv.** UTF-8 with a byte order mark and CRLF lines; numbers without thousands separators.
`(mm)` columns read `(in)`, and `(mm²)` `(in²)`, in inches.

| Table  | Columns                                                                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parts  | `No.`, `Part`, `File`, `Requested`, `Placed`, `Width (mm)`, `Height (mm)`, `Area (mm²)`, `Cut length (mm)`, `Pierces`, `Cutting time each (min)`                                            |
| Sheets | `Sheet`, `Width (mm)`, `Height (mm)`, `Parts`, `Utilisation (%)`, `Offcut width (mm)`, `Offcut length (mm)`, `Offcut reusable`, `Cut length (mm)`, `Pierces`, `Cutting time (min)`, `Price` |

**Related:** [Lay out photos and PDFs](../guides/layout.md#nest-parts-for-cutting) ·
[Layout output](layout.md) · [Models and drawings](models.md) ·
[File operations and recovery](file-operations.md)
