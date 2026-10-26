# Models and drawings

## 3D models

Viewer opens supported GLB/glTF, OBJ, STL, FBX, PLY and 3MF geometry in an interactive model stage.
STEP/STP and IGES/IGS convert locally to the same stage. Use orbit/zoom, dimensions, appearance
choices and surface-point distance tools.

Keep companion assets beside formats that reference them. Missing textures are reported; a
successful geometry preview does not prove every material, animation or scene feature was decoded.
Embedded textures are supported in qualified GLB samples. Model camera and shading preferences have
separate saved state.

CAD exchange dimensions are normalized to millimeters. Measurement is for inspection, not a
substitute for a source CAD system's exact modeling operations. 3MF geometry support does not imply
slicer-project settings or manufacturing instructions are inspected.

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
