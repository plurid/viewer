# DXF drawing previews

Open an ASCII `.dxf` as a linked Plurid plane, use Space for Quick Preview, or select it in Gallery. The same lazy module and drawing tools serve all three hosts. Primary controls join the existing plane header; secondary actions are searchable in Commands. Files are read locally and are not edited by the preview.

The canvas leads the preview and inherits [the current design system](../DESIGN.md). Drawing details starts hidden and scrolls independently at 208px wide, capped at 42% of the preview width. Toolbar buttons and selectors share a 28px height in plane headers and 30px in standalone previews. The fixed 34px status bar groups instructions and units on the left, with draft controls and limitations on the right. Long instructions retain their full text on hover. In linked planes, the file footer groups filename, type and size on the same left edge, with the external-open action on the right.

Choose **Inspect**, **Distance**, **Angle** or **Area** in the tool selector. Inspect reports entity type, layer, length and, where applicable, radius, ellipse axes and closed-entity area. Circle/arc and bulged-polyline lengths are analytic. Ellipse length is tessellated and shown with `≈`. The manually picked Area tool measures a polygon through the points you choose; it does not integrate a curved outline.

Distance needs two points. Angle needs an arm point, the vertex, then the other arm point. After three points, Area finishes with **Finish area** in the status bar, Enter, a double-click or another click at its first point. Escape or the status bar's cancel control cancels a draft; Backspace removes its last point. Completed measurements can be removed individually or cleared in Drawing details. Measurement state is session-only, scoped to its preview host; saving annotations to a file is future work.

Snap targets endpoints, line/curve midpoints where available, centers and full-circle/ellipse quadrants. Hold Shift to temporarily disable snap. Drag to pan, right/middle-drag or Option-drag to pan, scroll to zoom, and use Fit drawing or Home to reframe. A focused drawing owns its arrows and measurement keys. Canvas coordinates invert the plane's projected rectangle, so Plurid scale and perspective do not become drawing units.

Drawing details offers layer visibility, measurement units, drawing dimensions and measurement history. `$INSUNITS` supplies units; common display units include millimetres, centimetres, metres, inches and feet. Converting an area squares the unit factor. Unitless/unknown files retain “Drawing units”; choosing a unit for one labels the coordinates without guessing a scale or changing the file.

Fit drawing continues to fit when the details panel or window size changes. Manual pan or zoom keeps its chosen view until Fit drawing is used again. The status distinguishes displayed units from file units when converted.

## Support and limits

Supported model-space entities: LINE, LWPOLYLINE and POLYLINE with circular bulges, CIRCLE, ARC, ELLIPSE, POINT, basic TEXT/MTEXT, SOLID/3DFACE projections, INSERT block instances and DIMENSION graphics supplied through their block. Blocks preserve base points, rotation, scale and arrays; recursive references are omitted. Layer color and visibility/frozen flags are read. Line widths/dashes, CAD font/layout fidelity, independently computed dimensions, spline curves, hatches, embedded images, proxy entities and 3D solid geometry are not included. Unsupported entity types are reported. Paper-space layouts are omitted.

Binary DXF and DWG need a separate decoder/conversion path. Files are limited to 32 MiB, 600,000 group-code pairs, 50,000 render entities, one million tessellation vertices, 16 block levels and bounded block expansion. A drawing worker owns bounded reading, text decoding, parsing and normalization. It is terminated on close, abort, failure or a 20-second timeout. UTF-8 DXF 2007+ and supported legacy Windows codepages are decoded locally.

The main renderer owns only normalized geometry, canvas paths and lightweight measurement state. It draws on dirty animation frames, stops while inactive, culls offscreen entities and indexes snap points. Pointer movement, pan and zoom do not publish React state. Path caches, observers, listeners and backing canvas pixels are released on disposal. This is a bounded initial implementation, not a claim of AutoCAD rendering parity or a benchmark on large production drawings.

Format references: [Autodesk ellipse parameters](https://help.autodesk.com/cloudhelp/2023/ENU/AutoCAD-DXF/files/GUID-107CB04F-AD4D-4D2F-8EC9-AC90888063AB.htm), [Autodesk polyline flags and bulges](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-DXF/files/GUID-748FC305-F3F2-4F74-825A-61F04D757A50.htm), [DXF text encoding](https://ezdxf.readthedocs.io/en/stable/dxfinternals/fileencoding.html), and the [dxf-parser project](https://github.com/gdsestimating/dxf-parser).
