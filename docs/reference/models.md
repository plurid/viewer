# Models and drawings

## 3D models

Viewer opens supported GLB/glTF, OBJ, STL, FBX, PLY, 3MF, Collada (`.dae`), 3DS, USDZ, X3D, VRML
(`.wrl`) and OFF geometry in an interactive model stage. STEP/STP and IGES/IGS convert locally to
the same stage. Use orbit/zoom, dimensions, appearance choices and surface-point distance tools.

Keep companion assets beside formats that reference them. Missing textures are reported; a
successful geometry preview does not prove every material, animation or scene feature was decoded.
Embedded textures are supported in qualified GLB samples. Model camera and shading preferences have
separate saved state.

CAD exchange dimensions are normalized to millimeters. Measurement is for inspection, not a
substitute for a source CAD system's exact modeling operations. 3MF geometry support does not imply
slicer-project settings or manufacturing instructions are inspected.

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
- Every format shares the stage's geometry limit of 4 million vertices and 2 million triangles.

## DXF drawings

ASCII DXF support includes selected model-space entities, layers, inspection, snapping and
measurement. Unsupported entities and limits are identified. Binary DXF, full paper-space layouts
and native DWG are separate capabilities.

Use layer visibility and entity details to inspect the drawing. File parsing, geometry and pixel
budgets keep malformed or oversized content from unbounded work. Source files remain unchanged.

## Specialist formats

BIM/IFC, point clouds, native vendor CAD, robotics descriptions and scientific meshes are
[proposed format families](../research/formats.md). Their presence in the roadmap is not current
preview support. See [the current inventory](formats.md) for routing and
[preview development](../development/previews.md) to add a module.
