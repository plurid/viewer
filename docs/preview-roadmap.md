# Preview format priorities

The complete [preview format inventory](preview-formats.md) lists current
extensions, partial coverage and proposed major/medium additions, including
fonts, notebooks, email and scientific/ML data. This roadmap adds domain-specific
priorities and shared preview capabilities; it is not the support matrix.

The [professional ecosystem catalog](preview-format-ecosystems.md) expands that
backlog with BIM, medical/scientific data, vendor CAD, point clouds, publishing,
web captures, packages and inspectable binaries. Its entries remain proposed.

These are proposed additions, not claims of implemented support. The current registry already covers common raster images/SVG, Chromium media, PDF, EPUB, DjVu, DOC/DOCX, XLS/XLSX and PPT/PPTX ([Office previews](office-previews.md)), Markdown/code/text, JSON/CSV, ZIP/TAR and GLB/glTF/OBJ/STL/FBX. Camera RAW now uses an independent LibRaw helper for camera images and half-size RAW renditions. TIFF, HEIC/HEIF, PSD composites, JPEG 2000, OpenEXR, TGA and ICNS retain the private image decoding path. ASCII DXF adds 2D drawing tools. STEP/STP, IGES/IGS, 3MF and PLY have geometry previews, dimensions and surface-distance measurement. See [DXF support](drawings.md) and [model previews](model-previews.md) for their exact boundaries.

The next preview should make a file useful without launching a specialist app. Share the existing resource grants, host lifetime, search/command registration and header controls; keep format readers independent of the explorer and spatial engine. Add a format only with representative good/bad fixtures and explicit partial-support feedback.

| Priority | Family and extensions                                                                             | Useful plane experience                                                                                                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1        | Deeper CAD inspection for existing formats, plus `.brep`                                          | Assembly tree, isolate/hide parts, section planes, edge/vertex snapping, radii, surface area and volume. Exact solid measurements need geometric topology rather than inference from a rendered mesh.                                                              |
| 1        | Office: `.odt`, `.ods`, `.odp`, `.rtf`; native `.pages`, `.numbers`, `.key` fallback     | Searchable document pages, selectable text, sheet tabs, virtualized tables, formula inspection and slide navigation. Disable document scripts/macros and external links. Local conversion or a native Quick Look helper can supplement purpose-built readers.      |
| 1        | Imaging: `.hdr`, and tools beyond the bitmap for HEIC, TIFF, camera RAW and `.exr`                | Orientation, multi-page TIFF, metadata, histogram, exposure/tone mapping and color-managed display. Native decoding coverage must be verified for each extension and sample.                                                                                       |
| 2        | Layered creative files: `.psd`, `.psb`, `.ora`, `.xcf`, `.ai`, `.eps`                             | Layer/composite inspection, artboards, dimensions and exportable assets. An embedded composite is an explicitly labeled fallback, not proof of full format rendering.                                                                                              |
| 2        | Data: `.sqlite`, `.sqlite3`, `.db`, `.duckdb`, `.parquet`, `.arrow`, `.feather`, `.h5`, `.hdf5`   | Schema/tree navigation, virtualized tables, filters, local read-only queries, charts and dataset comparisons. Detect database formats by signature; `.db` alone is ambiguous. Remote reads and engine extension loading require a separate intentional capability. |
| 2        | Other 3D: `.usd`, `.usda`, `.usdc`, `.usdz`, `.dae`                                               | Scene/mesh hierarchy, materials, point clouds, compare, clipping and measured coordinates. Extend the existing mesh viewer's tools; do not assume millimetres for unitless OBJ/STL.                                                                                |
| 2        | Electronics: `.kicad_pcb`, `.kicad_sch`, Gerber (`.gbr`, `.gtl`, `.gbl`, etc.), Excellon (`.drl`) | Board/trace/outline/drill layers, part and net lookup, dimensions and distances. Check clearance claims against the actual design rules and supported stackup.                                                                                                     |
| 3        | Geospatial: `.geojson`, `.gpx`, `.kml`, `.kmz`, `.shp`, `.gpkg`, GeoTIFF                          | Local map, feature selection, elevation tracks, distance/area and projection metadata. Distances must respect CRS/geodesy. Map tile networking is opt-in. Companion files share a bounded directory grant.                                                         |
| 3        | Reading: `.cbz`, `.cbr`, DRM-free `.mobi`/`.azw3`                                                 | Pages/chapter navigation, image/text selection, OCR evidence and book metadata. Never imply encrypted/DRM titles can be rendered.                                                                                                                                  |
| 3        | Additional archives: `.7z`, `.rar`, `.zst`, disk/package metadata                                 | Safe listing, bounded nested previews and explicit extraction through existing operation jobs. Respect encryption, bomb limits and format licenses.                                                                                                                |

For the current fabrication workflow, deeper CAD inspection and G-code toolpath viewing remain valuable next additions. For general file-manager adoption, office and imaging support have broader day-to-day value. DWG requires a deliberate licensed decoder or local conversion backend rather than the DXF parser.

## Professional tracks promoted for investigation

These tracks address whole workflows rather than increasing an extension count.
They sit alongside the general-user priorities above, with no delivery schedule.

| Track                    | Candidates brought forward                                       | First useful semantic result                                                                               |
| ------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| BIM/construction         | IFC/IFCZIP as a separate family; LAS/LAZ/E57                     | Building/entity/property navigation and linked geometry; bounded point-cloud inspection.                   |
| Mechanical/manufacturing | Parasolid/ACIS/JT, native CAD research and slicer/project 3MF    | Qualified structure/topology/PMI views and manufacturing metadata, beyond the existing geometry preview.   |
| Medical/scientific       | DICOM/volumes, NetCDF/GRIB/Zarr, PDB/CIF/molecular SDF           | Slices, dimensions, fields, records and spatial structure with native coordinate/unit provenance.          |
| General/media coverage   | Subtitles and XLSB/XLSM/DOCM/PPTM and template/show variants     | Cue timelines and supported document content; shared package readers do not replace per-format validation. |
| Developer/data/admin     | HAR/WARC/MHTML, ORC/Avro, certificates, executables and packages | Request/trace inspection, typed record windows and metadata/manifest structure without payload execution.  |
| Robotics/CAE             | URDF/SDFormat and VTK-family meshes/results                      | Links/joints, meshes and supported scalar/vector fields without starting a simulator.                      |

The expanded catalog retains the proposed specialist sequence and decoder/version
questions. Proprietary/native formats, medical transfer syntaxes, disk readers and
mailbox stores need their own feasibility work; a container or XML resemblance
does not establish that an integration is straightforward.

## Generic decoding, semantic inspection and binary structure

One shared archive decoder can underpin ZIP browsing, an APK package inspector,
a Word document reader and a slicer-project viewer. Their semantic data models,
views and qualification remain distinct. HDF5, IFC, ONNX and certificate/binary
structures likewise deserve hierarchy/fact inspection instead of an opaque-file
fallback where a suitable reader exists.

Keep stable source/entity identity across the scene, table, property, timeline
and comparison views so Plurid links express the file's relationships. Identify
ambiguous extensions from bounded content/schema evidence, and support package
folders and multi-file stores explicitly. See the
[semantic model and routing catalog](preview-format-ecosystems.md#ambiguous-suffixes-and-content-aware-routing).

## Capabilities that make the system more than a collection of viewers

- **Compare in place:** connect two revisions and synchronize zoom/page/camera; show content or geometric differences with alignment and tolerance controls.
- **Measurements and annotations as portable data:** save a reviewed sidecar with resource identity, native units, points, dimensions, comments and provenance. Users and agents can read or modify that data without screen scraping.
- **One searchable action system:** every viewer contributes contextual commands, aliases and keyboard actions to the same registry. Users configure their preferred tool/header arrangement without inventing a separate navigation model for each format.
- **Structured inspection for agents:** a narrow read-only format service returns real metadata and supported-content evidence (CAD units/entities/dimensions, sheet schemas, document pages). Models propose changes through the existing review/journal path. A model's guessed geometry is never substituted for a parser's measurements.
- **Task areas:** named checkout contexts now retain documents and tool references within a workspace, with explicit reopening and private command history. Command-K finds task names; closing a view keeps its underlying document. Structured external-agent adapters remain future work. See [task areas](task-areas.md).
- **Representation without losing identity:** inspect the source alongside a generated thumbnail, diagram, section, summary or extracted table as a linked plane. Cache conversions by file identity/version, and show their provenance.

Implementation references: [Open CASCADE STEP topology and assemblies](https://occt3d.com/dev/doc/overview/html/occt_user_guides__step.html), [IGES translation](https://occt3d.com/dev/doc/overview/html/occt_user_guides__iges.html), [DuckDB Parquet inspection](https://duckdb.org/docs/current/data/parquet/overview), [KiCad board data](https://docs.kicad.org/9.0/en/pcbnew/pcbnew.html), and [Apple Quick Look](https://developer.apple.com/documentation/quicklook). The priority order and interaction proposals above are product judgments for Viewer.
