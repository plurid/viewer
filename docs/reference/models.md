# Models and drawings

This page lists the 3D model, CAD and DXF drawing formats Viewer previews, with their controls,
units, measurement tools and limits.

## 3D models

| Format     | Extensions                       | Preview                                                                          |
| ---------- | -------------------------------- | -------------------------------------------------------------------------------- |
| glTF       | `.glb`, `.gltf`                  | Geometry, materials, embedded textures and animations; companion files beside it |
| OBJ        | `.obj`                           | Geometry, with the MTL material library named in the file when it lies beside it |
| STL        | `.stl`                           | Geometry                                                                         |
| FBX        | `.fbx`                           | Geometry, materials and animations                                               |
| PLY        | `.ply`                           | Geometry and vertex colors                                                       |
| 3MF        | `.3mf`                           | Geometry in its declared unit, converted to millimeters                          |
| STEP, IGES | `.step`, `.stp`, `.iges`, `.igs` | Converted locally to meshes in millimeters, up to 64 MB                          |
| Collada    | `.dae`                           | From the file alone; see below                                                   |
| 3DS        | `.3ds`                           | From the file alone; see below                                                   |
| USDZ       | `.usdz`                          | From the file alone; see below                                                   |
| X3D        | `.x3d`                           | From the file alone; see below                                                   |
| VRML       | `.wrl`                           | From the file alone; see below                                                   |
| OFF        | `.off`                           | From the file alone; see below                                                   |

Keep companion files beside the formats that name them. Missing ones are listed as **Missing files
next to the model:** with their names. A successful preview does not prove every material, animation
or scene feature was decoded. 3MF geometry support does not mean slicer settings or manufacturing
instructions are read.

### Controls

| Control                                 | Does                                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Frame model**                         | Fits the model and turns it to the starting view, front right and a little above; the **Home** key does the same |
| **Rotation**                            | **Free** tumbles in any direction without poles or stops; **Turntable** rotates around a fixed up axis           |
| View cube                               | Click a face, edge or corner to turn to that view; drag it to rotate; **Home view** turns to the starting view   |
| **Measure**                             | Click two surface points to read their **Distance**; **Clear** removes it                                        |
| **Wireframe**                           | Draws the model's edges only                                                                                     |
| **Shading**                             | **Surface**: **Original materials**, **Clay** or **Normals**. **Lighting**: **Studio**, **Contrast** or **Soft** |
|                                         | **Brightness** 40% to 160%, **Show edges**, **Shadows** and **Reset shading**                                    |
| **Model animation**, **Play animation** | For a model with animations: choose one and play or pause it                                                     |
| **Assumed model units**                 | For formats without physical units: **Model units**, **Millimeters**, **Centimeters**, **Meters** or **Inches**  |

The footer shows the model's size along x, y and z, then its meshes, triangles and vertices. STEP,
IGES and 3MF sizes are in millimeters. Other formats show model units until you choose an assumed
unit, which labels the numbers without rescaling them. Collada's own unit is converted to metres.
Measurement is for inspection; it does not replace the source CAD system.

STEP, STP, IGES, IGS, STL, 3MF and 3DS start with **Free** rotation. glTF, OBJ, FBX, PLY, Collada,
USDZ, X3D, VRML and OFF start with **Turntable**. Choose either mode with **Rotation** in the full
preview toolbar. With Essential headers, use **Use free rotation** or **Use turntable rotation** in
the plane's **…** menu or command palette. Switching keeps the camera where it is; a camera rolled
in **Free** turns level in a third of a second for **Turntable**, which always turns around the
model's top.

Drag to rotate and right-drag to pan. A two-finger scroll on a trackpad or Magic Mouse pans: the
model moves with your fingers, as a page does. A mouse wheel zooms, a notch at a time, and so does a
pinch. With a mouse, hold **Shift** while turning the wheel to pan sideways; holding **Control**
zooms by notches. Viewer tells a mouse from a trackpad by the events of each scroll; if it guesses
wrong, set **Settings → Previews → 3D scroll device** to **Mouse** or **Trackpad**
(`settings.previews.modelScrollDevice`). Zoom runs at the same speed in **Free** and **Turntable**.

With the model canvas focused, arrow keys pan, **Shift+arrows** rotate, and **+** or **-** zoom.
**Frame model**, also found by searching **Reset view**, restores the format's initial orientation
and fits the model without changing the chosen rotation mode. In **Measure**, a click picks a
surface point and a drag rotates the view.

The view cube sits in the lower-right corner of the model area and turns with the camera, so its
labels name the sides in view. A STEP, IGES, STL, 3MF or 3DS model has +Z at the top, and its
**Front** view looks along +Y. Other formats have +Y at the top, and their **Front** view looks
along -Z.

1. Click a face (**Front**, **Back**, **Left**, **Right**, **Top** or **Bottom**), one of the 12
   edges or one of the 8 corners. The pointer names an edge or corner beside the cube. The view
   turns in a third of a second, or at once with **Reduce motion** on in macOS.
2. Drag the cube to rotate the model as a drag on the model does, in either rotation mode. A wheel
   over the cube zooms or pans as it does over the model.
3. Choose **Home view** in the cube's corner to return to the starting view.

After a click the model's top is up in the picture, so the labels read upright; from **Top** the
back is up, and from **Bottom** the front.

**Tab** reaches the cube after the model, on the side in view. **Left** and **Right** arrows step
around the model, also around the top or bottom; **Up** and **Down** step toward the top or bottom.
**Enter** or **Space** chooses the view, **Home** returns to the starting view, and **+** or **-**
zoom. A click on the cube never measures, and a right-click there opens no menu. The cube is hidden
when the model area is narrower than 260 pixels or shorter than 220, and after the graphics memory
runs out. With **Shading** open in a model area shorter than 300 pixels, the panel takes the cube's
corner.

The rotation mode and camera position, target and up vector are remembered per file, along with
wireframe, the assumed unit and shading. Measure stays with the current preview. When graphics
memory runs out, the stage pauses with "The 3D view was paused to free graphics memory."

A STEP, IGES, STL, PLY or OFF model opened again shows at once, with its remembered camera. An OBJ
is not read again either, but it waits for its material library, which is. Each window keeps the
last 16 models it read in memory, up to 512 MiB of geometry, one version of each file: a file whose
size, modification time or identity changed is read again. Two previews of one file opening
together, such as a plane and Quick Preview, each read the file, and it is converted once. Revoking
a folder's access or ejecting its volume forgets its models. Nothing is written to disk.

Files on a server are read each time they open. On a disk whose times have whole seconds, such as
HFS+, or two seconds, such as FAT, a file rewritten at the same size within that time shows its
earlier model until its time or size changes.

The STEP and IGES converter stays loaded while a 3D preview is open and for 2 minutes after the last
one closes, so the next file skips its start. A converter whose memory passed 512 MiB unloads as
soon as it is idle, as does every converter when a model exceeds the decoded geometry or texture
limit, which also empties the remembered models. Cancelling a conversion, by moving to another file,
restarts the converter without compiling it again.

### Formats read from the file alone

Collada, 3DS, USDZ, X3D, VRML and OFF previews read only the file itself. Textures, layers and
worlds it names, by path or URL, are never loaded; the preview lists their names under the model.
What the file embeds still loads, such as the images inside a USDZ package or a texture written as a
`data:` URL.

| Format  | What the preview reads                                                                                          | Limit           |
| ------- | --------------------------------------------------------------------------------------------------------------- | --------------- |
| Collada | Geometry, materials and animations; units are converted to meters                                               | 64 MB           |
| 3DS     | Meshes, their placement and material colors                                                                     | 128 MB          |
| USDZ    | A package with one USD layer, in text or binary form, and the PNG, JPEG or AVIF images it holds                 | 128 MB expanded |
| X3D     | The XML encoding: Transform and grouping nodes, Shape, Material, IndexedFaceSet, IndexedTriangleSet and DEF/USE | 64 MB           |
| VRML    | VRML 2.0 (VRML97) worlds; a Background is not drawn                                                             | 16 MB           |
| OFF     | ASCII OFF and its COFF, NOFF and STOFF forms, with vertex or face colors                                        | 64 MB           |

- X3D geometry outside that list, such as Box or Sphere, is named under the model as not drawn.
  Classic-encoded `.x3dv` and binary `.x3db` files are not read.
- A USDZ package holds at most 4,096 entries, each expanding to at most 64 MB.
- Collada, VRML and X3D can reuse a node many times. A scene builds at most 100,000 objects,
  counting each reuse. Collada and X3D files that declare XML entities are refused.
- Binary and four-dimensional OFF files are refused.

### Model limits

| Limit                    | Value                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| File size                | **3D file limit (MB)** in Settings, `settings.previews.maxModelMB`: 16 to 512; 256 at first |
| STEP and IGES conversion | 64 MB                                                                                       |
| Mesh parsing             | 128 MB                                                                                      |
| Decoded geometry         | 128 MB                                                                                      |
| Decoded textures         | 128 MB                                                                                      |
| Models kept to reopen    | 16 per window, 512 MiB of geometry in all                                                   |
| Geometry                 | 4,000,000 vertices and 2,000,000 triangles, in every format                                 |

## DXF drawings

Viewer previews ASCII DXF model space. Binary DXF is refused with "Binary DXF is not supported yet.
Export an ASCII DXF from your CAD app." Native DWG and paper-space layouts are not read.

| Entities                                                                                                                                   | Treatment                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `LINE`, `LWPOLYLINE`, `POLYLINE`, `CIRCLE`, `ARC`, `ELLIPSE`, `SPLINE`, `POINT`, `TEXT`, `MTEXT`, `INSERT`, `DIMENSION`, `SOLID`, `3DFACE` | Drawn                                                            |
| Any other type, such as `HATCH`                                                                                                            | Left out and listed under **Not shown**                          |
| Paper-space entities and entities on a tilted plane                                                                                        | Left out, with a limitation note                                 |
| Invisible entities                                                                                                                         | Left out                                                         |
| Block references                                                                                                                           | Expanded up to 16 levels; recursive and missing blocks are noted |

Text in a drawing from AutoCAD 2007 or later is read as UTF-8. An older drawing uses its
`$DWGCODEPAGE`; an encoding the preview cannot read asks for a UTF-8 ASCII DXF.

| Control                  | Does                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fit drawing**          | Fits the drawing in view; **Home** does the same                                                                                                                  |
| **Drawing tool**         | **Select** (click geometry), **Distance** (two points), **Angle** (first point, vertex, last point) or **Area** (boundary points; **↩** or double-click finishes) |
| **Snap**                 | On at first: snaps to endpoints, midpoints, centers and quadrants. Hold **⇧** to measure without it                                                               |
| **Show drawing grid**    | Shows or hides the grid                                                                                                                                           |
| **Show drawing details** | Opens the panel of units, layers and measurements                                                                                                                 |
| **Measurement units**    | **From file**, or **Millimeters**, **Centimeters**, **Meters**, **Inches** or **Feet**                                                                            |
| **Layers**               | Show or hide each layer, with its entity count. Layers hidden or frozen in the drawing start hidden                                                               |

Drag pans, scroll zooms and the arrow keys pan. **Escape** cancels a measurement in progress, and
**Delete** removes its last point. A drawing that does not say its units shows coordinates as
drawing units: choosing a unit labels them without rescaling the drawing.

| Limit            | Value                                |
| ---------------- | ------------------------------------ |
| File             | 32 MB or 600,000 group codes         |
| Entities         | 50,000                               |
| Preview vertices | 1,000,000                            |
| Block expansion  | 100,000 entities; an array of 10,000 |
| Measurements     | 100                                  |

A spline is drawn as nesting reads it: from its control points and knots, in chords within 1/10,000
of its size, or through its fit points when it has no control points. Its length and area are
measured along those chords. Source files are never changed. [Nesting for cutting](nesting.md) reads
DXF parts with its own reader.

## Specialist formats

BIM/IFC, point clouds, native vendor CAD, robotics descriptions and scientific meshes are
[proposed format families](../research/formats.md), not current preview support. See
[the current inventory](formats.md) for routing and
[preview development](../development/previews.md) to add a module.

**Related:** [Read and inspect files](../guides/previews.md) · [Supported formats](formats.md) ·
[Nesting for cutting](nesting.md) · [Configuration](configuration.md)
