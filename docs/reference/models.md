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
| 3MF        | `.3mf`                           | Geometry in its declared unit, converted to millimetres                          |
| STEP, IGES | `.step`, `.stp`, `.iges`, `.igs` | Converted locally to meshes in millimetres, up to 64 MB                          |
| Collada    | `.dae`                           | From the file alone; see below                                                   |
| 3DS        | `.3ds`                           | From the file alone; see below                                                   |
| USDZ       | `.usdz`                          | From the file alone; see below                                                   |
| X3D        | `.x3d`                           | From the file alone; see below                                                   |
| VRML       | `.wrl`                           | From the file alone; see below                                                   |
| OFF        | `.off`                           | From the file alone; see below                                                   |

Keep companion files beside the formats that name them. Missing ones are listed as **Missing
companion assets:** with their names. A successful preview does not prove every material, animation
or scene feature was decoded. 3MF geometry support does not mean slicer settings or manufacturing
instructions are read.

### Controls

| Control                                 | Does                                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Frame model**                         | Fits the model in view. Drag to orbit, scroll to zoom                                                            |
| **Measure**                             | Click two surface points to read their **Distance**; **Clear** removes it                                        |
| **Wireframe**                           | Draws the model's edges only                                                                                     |
| **Shading**                             | **Surface**: **Original materials**, **Clay** or **Normals**. **Lighting**: **Studio**, **Contrast** or **Soft** |
|                                         | **Brightness** 40% to 160%, **Show edges**, **Shadows** and **Reset shading**                                    |
| **Model animation**, **Play animation** | For a model with animations: choose one and play or pause it                                                     |
| **Assumed model units**                 | For formats without physical units: **Model units**, **Millimeters**, **Centimeters**, **Meters** or **Inches**  |

The footer shows the model's size along x, y and z, then its meshes, triangles and vertices. STEP,
IGES and 3MF sizes are in millimetres. Other formats show model units until you choose an assumed
unit, which labels the numbers without rescaling them. Collada's own unit is converted to metres.
Measurement is for inspection; it does not replace the source CAD system.

Measure, wireframe, the assumed unit and shading are kept with the file's preview state. When
graphics memory runs out, the stage pauses with "The 3D view was paused to free graphics memory."

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
| Geometry                 | 4,000,000 vertices and 2,000,000 triangles, in every format                                 |

## DXF drawings

Viewer previews ASCII DXF model space. Binary DXF is refused with "Binary DXF is not supported yet.
Export an ASCII DXF from your CAD app." Native DWG and paper-space layouts are not read.

| Entities                                                                                                                         | Treatment                                                        |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `LINE`, `LWPOLYLINE`, `POLYLINE`, `CIRCLE`, `ARC`, `ELLIPSE`, `POINT`, `TEXT`, `MTEXT`, `INSERT`, `DIMENSION`, `SOLID`, `3DFACE` | Drawn                                                            |
| Any other type, such as `SPLINE` or `HATCH`                                                                                      | Left out and listed under **Preview limitations**                |
| Paper-space entities and entities on a tilted plane                                                                              | Left out, with a limitation note                                 |
| Invisible entities                                                                                                               | Left out                                                         |
| Block references                                                                                                                 | Expanded up to 16 levels; recursive and missing blocks are noted |

Text in a drawing from AutoCAD 2007 or later is read as UTF-8. An older drawing uses its
`$DWGCODEPAGE`; an encoding the preview cannot read asks for a UTF-8 ASCII DXF.

| Control                  | Does                                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fit drawing**          | Fits the drawing in view; **Home** does the same                                                                                                                       |
| **Drawing tool**         | **Inspect** (click geometry), **Distance** (two points), **Angle** (first point, vertex, last point) or **Area** (boundary points; **Enter** or double-click finishes) |
| **Snap**                 | On at first: snaps to endpoints, midpoints, centres and quadrants. Hold **Shift** to measure without it                                                                |
| **Show drawing grid**    | Shows or hides the grid                                                                                                                                                |
| **Show drawing details** | Opens the panel of units, layers and measurements                                                                                                                      |
| **Measurement units**    | **From file**, or **Millimetres**, **Centimetres**, **Metres**, **Inches** or **Feet**                                                                                 |
| **Layers**               | Show or hide each layer, with its entity count. Layers hidden or frozen in the drawing start hidden                                                                    |

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

Source files are never changed. [Nesting for cutting](nesting.md) reads DXF parts with its own
reader, which also reads splines.

## Specialist formats

BIM/IFC, point clouds, native vendor CAD, robotics descriptions and scientific meshes are
[proposed format families](../research/formats.md), not current preview support. See
[the current inventory](formats.md) for routing and
[preview development](../development/previews.md) to add a module.

**Related:** [Read and inspect files](../guides/previews.md) · [Supported formats](formats.md) ·
[Nesting for cutting](nesting.md) · [Configuration](configuration.md)
