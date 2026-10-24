# Professional formats and semantic inspection

Status: **proposed**, October 24, 2026. This expands the future-format discussion;
it does not add runtime support. The [preview format inventory](preview-formats.md)
remains the reference for current coverage and the general future backlog.
[Format priorities](preview-roadmap.md) separates delivery tracks from this catalog.

The product ambition is to explain a file's contents and structure without
requiring the application that authored it. A useful preview might be a scene,
table, document, hierarchy, timeline or metadata report. Read-only inspection
still requires a bounded, validated decoder; merely avoiding execution of the
payload does not make arbitrary parser input safe.

## Generic decoding and semantic inspection

These are separate capabilities. A shared container reader can support several
format-specific experiences without replacing them with an archive listing.

| Source     | Generic decoding                                   | Semantic experience                                                      | Viewer today                                                         |
| ---------- | -------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| ZIP        | Entries and bounded entry bytes                    | Archive browsing                                                         | Implemented within documented ZIP limits.                            |
| APK        | Container entries                                  | Android manifest, permissions, icons, architectures and signing metadata | Proposed.                                                            |
| DOCX       | ZIP/XML parts                                      | Word paragraphs, tables, document structure and eventually layout        | Partial document preview implemented.                                |
| 3MF        | Package/model data                                 | Geometry, units and meshes                                               | Geometry preview implemented.                                        |
| Slicer 3MF | Package plus vendor-specific project/toolpath data | Manufacturing project, plates, profiles, layers and moves                | Proposed; current geometry support does not establish this coverage. |
| HDF5       | Groups, datasets and attributes                    | Scientific hierarchy, dimensions, units and bounded data slices          | Proposed.                                                            |
| IFC        | Entities, relationships and geometry               | Building hierarchy, property sets, materials and spatial queries         | Proposed as its own BIM family.                                      |
| Executable | Binary headers/sections                            | Architectures, available symbols, dependencies and signing metadata      | Proposed; inspection does not launch or load the executable.         |

Identify the source/version once, then expose the supported representations and
their limits. Preserve identifiers so selection, comparison, citations and linked
planes refer to the same entity or record. A bitmap fallback should name what
it represents; an unavailable semantic decoder must not silently claim full support.

## BIM is a separate family

Promote IFC discovery ahead of less broadly useful native engineering adapters.
Do not classify it only as another mesh/CAD extension. Proposed IFC views include:

- Spatial navigation through project, site, building, storey and space where
  those levels exist; element containment and property-set relationships remain
  explicit rather than being forced into one mandatory chain.
- Stable element identifiers, names/types, property sets, quantities and materials.
- A linked geometry view with storey/category isolation and selection that stays
  synchronized with the property/tree views.
- Search and comparison of supported properties and element geometry, with source
  version, native units and unavailable information retained in the result.

For example, selecting a storey in a BIM plane could open linked element and
property planes, then frame the selected elements in the scene. The semantic
relationships supply meaningful navigation in Plurid; the 3D workspace remains
separate from the building's own coordinate system.

The spatial structure is documented by
[buildingSMART](https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD1/HTML/schema/templates/spatial-decomposition.htm).
Schema versions and optional levels require explicit coverage. Revit, SketchUp
and Navisworks are separate decoder investigations; IFC support does not imply
support for those native applications' files.

## Engineering, construction and manufacturing candidates

All rows are future work. Existing STEP/IGES, mesh, ASCII DXF and 3MF geometry
coverage remains described in the main inventory.

| Family                              | Extensions or source form                                                                          | Useful semantic preview / investigation boundary                                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IFC/BIM exchange                    | `.ifc`, `.ifczip`                                                                                  | Spatial/entity hierarchy, property sets, materials and geometry; bounded package handling for IFCZIP.                                                                       |
| Native building/design coordination | `.rvt`, `.rfa`, `.skp`, `.nwd`, `.nwc`                                                             | Building/family/model structure and supported geometry; adapter/version coverage investigated individually.                                                                 |
| Mechanical kernels/interchange      | `.x_t`, `.x_b`, `.sat`, `.sab`                                                                     | Parasolid/ACIS bodies, topology and supported attributes; decoder availability and supported versions require investigation.                                                |
| Lightweight manufacturing exchange  | `.jt`                                                                                              | Product structure, supported geometry and PMI where present; separate from kernel-format support.                                                                           |
| Vendor CAD                          | `.sldprt`, `.sldasm`, `.slddrw`, `.ipt`, `.iam`, `.idw`, `.CATPart`, `.CATProduct`, `.prt`, `.asm` | Parts, drawings, assemblies and references. Vendor/version identification and an explicit metadata/geometry/full-structure coverage level are required.                     |
| CAD publishing                      | `.dwf`, `.dwfx`                                                                                    | Published sheets/models, hierarchy and supported annotations.                                                                                                               |
| Scanning/LiDAR                      | `.las`, `.laz`, `.e57`, `.pts`, `.xyz`, `.pcd`                                                     | Point clouds, attributes, coordinate metadata, spatial selection and measurements with bounded/streamed loading.                                                            |
| Robotics                            | `.urdf`, `.xacro`, `.sdf`                                                                          | Links, joints, limits, hierarchy and supported geometry. Xacro expansion needs a constrained design; previewing must not run arbitrary expansion code or simulator plugins. |
| Simulation/CAE meshes               | `.vtk`, `.vtu`, `.vtp`, `.msh`, `.med`, `.xdmf`                                                    | Meshes, fields, time steps and supported scalar/vector visualization; companion data remains scoped.                                                                        |
| Finite-element results              | `.odb`, `.op2`, `.rst`, `.case`, `.foam` ecosystems                                                | Available meshes/results, field/time selection and provenance; individual solver and version adapters, sometimes multi-file or directory-backed.                            |
| PCB/design exchange                 | `.kicad_pcb`, `.kicad_sch`, `.brd`, `.sch`, `.dsn`, `.ses`, `.bom`, `.ipc`, `.ipc2581`             | Boards/schematics, components, nets and supported stackup/exchange facts; suffix alone does not identify a vendor or schema.                                                |
| Fabrication layers/drills           | Gerber `.gbr`, `.gtl`, `.gbl` and related layer names; Excellon `.drl`                             | Layer/outline/drill navigation, dimensions and supported manufacturing metadata.                                                                                            |
| Circuit simulation/netlists         | `.cir`, `.sp`, `.spice`, `.lib`                                                                    | Circuit/netlist hierarchy and model references without running a simulator.                                                                                                 |
| Manufacturing projects/toolpaths    | `.gcode`, `.gco`, `.bgcode`, `.nc`, `.tap`, `.gcode.3mf`, slicer/project `.3mf`                    | Plates, profiles, layers and toolpaths. Prusa/Bambu and other project variants need their own documented semantics; generic 3MF geometry remains a separate capability.     |
| Firmware/embedded images            | `.hex`, `.ihex`, `.srec`, `.s19`, `.uf2`, `.bin`, `.elf`                                           | Segments, memory maps, address ranges and architecture facts where encoded; raw BIN does not supply an architecture or base address by itself.                              |

LAS/LAZ are documented by the [OGC LAS specification](https://www.ogc.org/standards/LAS/).
[Parasolid import documentation](https://help.solidworks.com/2023/english/SolidWorks/sldworks/c_parasolid_files.htm)
distinguishes text/binary encodings, and
[Siemens JT documentation](https://www.siemens.com/en-us/products/plm-components/jt/jt2go/)
describes product-structure/PMI viewing. These references establish format
semantics, not a selected Viewer decoder or integration license.

## Medical, scientific, molecular and geospatial candidates

| Family                     | Extensions or source form                                                                  | Useful semantic preview / investigation boundary                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Medical/volumetric imaging | `.dcm` and DICOM data sets/series, `.nii`, `.nii.gz`, `.nrrd`, `.mha`, `.mhd`              | Series/slice navigation, window/level, orientation, spacing and available metadata; transfer syntaxes, dimensions and companion data require explicit coverage.     |
| Multidimensional science   | `.nc`, `.netcdf`, `.grib`, `.grib2`, `.zarr`                                               | Variables, dimensions, coordinates, attributes and bounded array slices. Zarr may be a directory/store rather than one regular file.                                |
| MATLAB workspace data      | `.mat`                                                                                     | Variables, arrays, shapes and structured values with version-aware readers. HDF5 reuse covers the relevant v7.3 branch, not every MAT version.                      |
| Molecular structures       | `.pdb`, `.cif`, `.mmcif`, `.mol`, `.sdf`, `.mol2`, `.xyz`                                  | Atoms/bonds, residues/chains, supported structure metadata and 3D views; chemistry format/version identification is distinct from robotics or point-cloud decoding. |
| Bioinformatics             | `.fasta`, `.fa`, `.fastq`, `.sam`, `.bam`, `.cram`, `.vcf`, `.bcf`, `.bed`, `.gff`, `.gtf` | Bounded sequence/alignment/variant/feature records and metadata. Indexed/reference-dependent operations need explicit companion-file handling.                      |
| GIS vectors/tracks         | `.geojson`, `.gpx`, `.kml`, `.kmz`, `.shp`, `.gpkg`                                        | Features, tracks, attributes and supported coordinate systems, as already proposed in the main inventory.                                                           |
| GIS rasters/elevation      | GeoTIFF, `.asc`, `.dem`, `.vrt`, `.img`                                                    | Raster/elevation bands, coordinate metadata and supported map/terrain views. Existing TIFF bitmap rendering does not establish this capability.                     |
| Web/offline map data       | `.topojson`, `.mbtiles`, `.pmtiles`                                                        | Topology, tile-package metadata and local map navigation. Remote tile retrieval remains a separate intentional operation.                                           |
| GPS/activity devices       | `.fit`, `.tcx`                                                                             | Tracks, laps, timestamps, device fields and available activity series.                                                                                              |
| Arrays and ML artifacts    | `.npy`, `.npz`, `.h5`, `.hdf5`, `.safetensors`, `.onnx`, `.gguf`                           | Dataset/tensor hierarchy, shapes, types and available model metadata, extending the existing proposed array/data track.                                             |

DICOM files contain encoded data sets, not necessarily just a standalone bitmap;
see the [DICOM file-format standard](https://dicom.nema.org/medical/dicom/current/output/chtml/part10/chapter_7.html).
[NetCDF documentation](https://docs.unidata.ucar.edu/netcdf-c/current/faq.html)
distinguishes classic and HDF5-backed formats.
[Zarr storage documentation](https://zarr.readthedocs.io/en/stable/user-guide/storage/)
describes local and ZIP stores. Local multi-file preview does not imply automatic
remote-store access.

[MATLAB's version table](https://www.mathworks.com/help/matlab/import_export/mat-file-versions.html)
explains the MAT/HDF5 boundary, and
[HTS specifications](https://samtools.github.io/hts-specs/) cover the distinct
sequence/alignment/variant encodings. Large scientific data needs windowed reads
and evidence of the supported layout/compression variants, not whole-file loading.

## Creative, photography, audio and publishing candidates

| Family                   | Extensions or source form                                                           | Useful semantic preview / investigation boundary                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Additional camera RAW    | `.dcr`, `.k25`, `.srw`, `.pef`, `.x3f`, `.mos`, `.iiq` and other qualified variants | Platform/decoder-supported rendition, dimensions and metadata. Retain an explicit tested coverage list; do not replace today's whitelist with a claim that every RAW format works. |
| Cinema/VFX imagery       | `.dpx`, `.cin`                                                                      | Image/frame metadata, bit depth and appropriate display/tone mapping.                                                                                                              |
| Additional audio         | `.aif`, `.aiff`, `.caf`, `.wma`, `.ape`, `.wv`                                      | Playback and available stream metadata. Existing generic audio routing may attempt some; decoder coverage remains unqualified until tested.                                        |
| MIDI/notation            | `.mid`, `.midi`, `.musicxml`, `.mxl`                                                | Tracks, notes, tempo/instruments and supported score rendering, distinct from decoded waveform playback.                                                                           |
| Subtitles                | `.srt`, `.vtt`, `.ass`, `.ssa`, `.sub`                                              | Cues, styles where supported, timeline navigation and explicit pairing with media. SUB variants need identification and may have companion data.                                   |
| Playlists/HLS            | `.m3u`, `.m3u8`, `.pls`                                                             | Structured entries and media-manifest facts. Reading a manifest does not automatically fetch/play its local or remote references.                                                  |
| DASH manifests           | `.mpd`                                                                              | Representations, tracks, periods and segment metadata without automatic segment retrieval.                                                                                         |
| Layered/vector design    | `.ai`, `.eps`, `.psd`, `.psb`, `.ora`, `.xcf`, `.kra`                               | Layers, artboards, geometry and labeled embedded composites. Current PSD support is only the existing system rendering.                                                            |
| Adobe publishing         | `.indd`, `.idml`                                                                    | Pages, stories and supported assets. IDML container/XML structure is a useful starting point; full layout is separate from extracting its parts.                                   |
| Affinity                 | `.afdesign`, `.afphoto`, `.afpub`                                                   | Available document metadata, embedded previews and eventually supported layer/page structure; decoder feasibility remains open.                                                    |
| Business/vector graphics | `.cdr`, `.vsd`, `.vsdx`, `.emf`, `.wmf`                                             | Pages/diagrams, shapes and supported text/vector rendering.                                                                                                                        |
| UI/design projects       | `.fig`, `.xd`, `.sketch`                                                            | Available project/page/artboard metadata and supported embedded assets; source/version identification comes first.                                                                 |
| Scribus                  | `.sla`                                                                              | Document/page structure, text and supported layout; XML parsing alone is not full page rendering.                                                                                  |
| Additional typography    | `.eot`, `.dfont`, `.pfb`, `.pfm`                                                    | Family/style metadata and supported specimens/glyphs, extending the proposed font viewer.                                                                                          |
| Color swatches           | `.ase`, `.aco`                                                                      | Named colors, source color spaces and palette rendering; distinguish Adobe swatches from unrelated formats sharing the suffix.                                                     |
| Comic variants           | `.cb7`, `.cbt`, alongside proposed `.cbz`, `.cbr`                                   | Page navigation over a bounded archive reader. Additional archive codecs and page-order behavior still need implementation and qualification.                                      |

Adobe documents IDML's package/XML structure in its
[IDML cookbook](https://community.adobe.com/havfw69955/attachments/havfw69955/indesign/632677/1/IDML_cookbook_9627253.pdf).
That makes structural inspection a useful candidate, not proof of a cheap or
complete InDesign renderer. The same distinction applies to other XML/archive
families, MusicXML, slides and complex creative projects.

## Web captures, structured data, documents and knowledge candidates

| Family                              | Extensions or source form                                                      | Useful semantic preview / investigation boundary                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web captures/archives               | `.mhtml`, `.mht`, `.webarchive`, `.har`, `.warc`, `.warc.gz`                   | Saved pages/resources or recorded requests/responses, with explicit coverage of the archive/capture type. Page rendering reuses an isolated web-preview boundary. |
| API/schema descriptions             | `.proto`, `.avsc`, `.graphqls`, OpenAPI `.yaml`/`.json`                        | Messages, services, endpoints and schema relationships. Detect document structure; not every YAML/JSON document is OpenAPI.                                       |
| Additional serialized/columnar data | `.orc`, `.avro`, alongside proposed Parquet/Arrow                              | Schema, record windows, column types and supported statistics.                                                                                                    |
| Binary structured data              | `.cbor`, `.msgpack`, `.bson`                                                   | Typed tree/record inspection, preserving binary/type distinctions instead of coercing everything into JSON strings.                                               |
| Profiling/network traces            | `.har`, Chrome trace `.json`, `.perfetto-trace`                                | Events, processes/threads, requests, spans and timelines after identifying the actual trace schema.                                                               |
| Legacy/business databases           | `.mdb`, `.accdb`, `.dbf`                                                       | Tables, schema, columns and bounded records; version and companion-file coverage vary.                                                                            |
| Database dumps/backups              | `.sql`, `.dump`, `.bak`                                                        | Available schema/table/backup metadata without restoring or executing a dump. Vendor-specific binary backups need separate readers.                               |
| Excel variants                      | `.xlsb`, `.xlsm`, `.xltx`, `.xltm`                                             | Supported worksheets/cached values/formulas and template metadata; XLSB is a separate binary-reader task, not an extension alias.                                 |
| Word variants                       | `.docm`, `.dotx`, `.dotm`                                                      | Supported body/layout/template metadata. Reuse package infrastructure where applicable without executing macros or embedded objects.                              |
| PowerPoint variants                 | `.pptm`, `.ppsx`, `.ppsm`, `.potx`, `.potm`, alongside proposed `.pptx`/`.ppt` | Slides, notes, presentation/template metadata and supported assets; macros remain inert.                                                                          |
| Flat OpenDocument                   | `.fodt`, `.fods`, `.fodp`                                                      | Text, spreadsheet and presentation structure; shared XML components do not establish full layout fidelity.                                                        |
| Other fixed-layout/help documents   | `.chm`, `.xps`, `.oxps`                                                        | Pages/topics, navigation and supported text/rendering; HTML-based help remains isolated.                                                                          |
| LaTeX source ecosystem              | `.bib`, `.sty`, `.cls`, `.bst`, alongside existing `.tex` source coverage      | Source inspection and supported relationships; no arbitrary TeX compilation during preview.                                                                       |
| Bibliography/reference records      | `.bib`, `.ris`, `.enw`                                                         | Citation records, fields and search, without treating every record as executable markup.                                                                          |
| Additional mail stores              | `.pst`, `.ost`, `.emlx`, alongside proposed `.eml`, `.msg`, `.mbox`            | Folder/message/attachment navigation with bounded store readers; standalone messages and mailbox databases are distinct tasks.                                    |
| Outlines/subscriptions              | `.opml`                                                                        | Outline/feed-list structure, text and links without automatically following them.                                                                                 |
| Feeds                               | `.rss`, Atom XML, often `.xml`                                                 | Entries, dates, authors and supported content; identify the document namespace/structure.                                                                         |

## Inspectable binaries and packages

This is a first-class proposed capability family. A payload can be inspectable
even when it is neither human-readable text nor a renderable document. Describe
supported metadata precisely; a header reader does not imply complete decompilation,
signature/trust verification or a forensic analysis.

| Family                           | Extensions or source form                                                              | Useful semantic preview / investigation boundary                                                                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Certificates/public-key metadata | `.pem`, `.crt`, `.cer`, `.der`, `.p7b`, `.p7c`, `.p12`, `.pfx`, `.csr`, `.pub`, `.key` | Available subjects, issuers, validity, public algorithms and fingerprints. Containers/PEM may contain private keys; automatic metadata inspection and its fallbacks must not emit key bytes to the preview, logs, index or agent/model output. |
| Executables/libraries            | `.exe`, `.dll`, `.so`, `.dylib`, `.app`, `.elf`                                        | Architectures, sections, available symbols, dependencies and signing metadata. Never run/dynamically load the payload to inspect it. Missing/stripped symbols and unverified signatures stay explicit.                                         |
| Platform/mobile packages         | `.deb`, `.rpm`, `.apk`, `.aab`, `.ipa`, `.msi`, `.appx`, `.msix`                       | Manifests, files, icons, architectures, declared permissions and signing metadata where supported; no installation or installer-script execution.                                                                                              |
| Java/.NET packages               | `.jar`, `.war`, `.ear`, `.nupkg`                                                       | Archive plus manifests, dependencies and supported package metadata; no class/assembly initialization.                                                                                                                                         |
| Python packages/apps             | `.whl`, `.egg`, `.pyz`                                                                 | Package metadata, entry points and contained files without importing/running the package.                                                                                                                                                      |
| JavaScript packages              | npm package `.tgz`                                                                     | Package manifest, files and declared scripts/dependencies; existing TGZ archive viewing does not provide this semantic view.                                                                                                                   |
| macOS development artifacts      | `.xcarchive`, `.xcodeproj`, `.xcworkspace`                                             | Project/archive/bundle structure, targets and available signing/build metadata; directory-backed adapters rather than generic folder traversal alone.                                                                                          |
| Container images                 | OCI image layouts, Docker `.tar` exports                                               | Manifests, layer metadata, architectures, labels and composed filesystem inspection; layers/whiteouts are interpreted, not executed.                                                                                                           |
| VM appliances/disks              | `.vmdk`, `.vhd`, `.vhdx`, `.qcow2`, `.ova`, `.ovf`                                     | Available disk/appliance metadata and bounded filesystem inspection. No VM launch or automatic host mounting; snapshots, backing files and compression require explicit coverage.                                                              |

The private-key exclusion above is a proposed delivery requirement for automatic
metadata inspection, not a claim that the current generic text preview already
recognizes and redacts these files. An explicit source-editing action remains
separate and does not broaden agent/model data consent.
The [PEM encoding standard](https://datatracker.ietf.org/doc/html/rfc7468)
documents distinct certificate, request, public-key and private-key structures.
Encrypted containers need a defined metadata-only/password-handling scope before
support can be claimed.

Package folders, scientific stores, linked CAD assemblies and references mean
that preview sources cannot always be modeled as one filename plus an extension.
Resolve only the required bounded companion resources through the existing grant
boundary; a reference inside a file is not authority to fetch the network, mount
a disk, run a build or expand filesystem access.

## Ambiguous suffixes and content-aware routing

Use bounded signatures, package manifests, schema/root identifiers, MIME evidence
and explicit format/version recognition. Extension aliases remain useful hints.
When evidence is insufficient or contradictory, offer available views or an
identified unsupported state instead of guessing a domain.

| Suffix                                     | Distinct meanings to distinguish                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `.vcf`                                     | vCard contacts versus genomic Variant Call Format.                                     |
| `.sdf`                                     | Molecular structure-data records versus robotics/simulation SDFormat.                  |
| `.xyz`                                     | Point-cloud coordinates versus molecular XYZ data.                                     |
| `.nc`                                      | NetCDF scientific data versus CNC/manufacturing instructions.                          |
| `.pdb`                                     | Molecular structures versus program-debug databases.                                   |
| `.fig`                                     | Figma project data versus MATLAB figure data and other uses.                           |
| `.key` / `.pub`                            | Keynote/Publisher documents versus cryptographic key material.                         |
| `.lib`                                     | Circuit/model libraries versus binary/static libraries and other schema-specific uses. |
| `.img` / `.bin`                            | Raster, disk, firmware or unidentified binary data, depending on the actual format.    |
| `.prt` / `.asm` / `.brd` / `.sch` / `.msh` | Several vendor/version-specific engineering families.                                  |
| `.rst`                                     | Readable reStructuredText versus solver-specific binary results.                       |
| `.ts` / `.mts`                             | TypeScript source versus media transport streams.                                      |
| `.json` / `.yaml` / `.xml`                 | Generic data versus trace, API, feed, scene or application-specific schemas.           |

The [HTS specifications](https://samtools.github.io/hts-specs/) identify genomic
VCF/BCF; the [SDFormat specification](https://sdformat.org/spec/)
identifies worlds, models, links and joints. A shared suffix does not make these
formats interchangeable with contacts or molecular records.

## Roadmap promotion and feasibility

Promote the following into explicit investigation tracks rather than treating
every row in this catalog as an equal implementation commitment:

| Track                       | Proposed sequence / first useful result                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Broad file-manager coverage | Retain Office/ODF/RTF, archives, fonts, notebooks and database/data inspection; add subtitles and explicit Office package variants.   |
| Engineering/construction    | IFC/BIM, LAS/LAZ/E57 point clouds, then mechanical-kernel/JT research; connect to deeper CAD and manufacturing-project/toolpath work. |
| Medical/scientific          | DICOM/volume inspection, NetCDF/GRIB/Zarr, molecular structures and version-aware array/record readers.                               |
| Developer/admin             | HAR and web archives, ORC/Avro and binary records, certificate metadata, executable/package inspection.                               |
| Robotics/simulation         | URDF/SDFormat, followed by VTK/CAE meshes and qualified result adapters; distinguish geometry/metadata from simulation execution.     |

The proposed professional sequence from the review was IFC → point clouds →
DICOM → kernel/JT formats → subtitles → Office variants → web captures →
ORC/Avro → multidimensional science → molecular structures → binaries/packages →
robotics/CAE. Record it as a candidate investigation sequence, not a replacement
for the general-user delivery order or an approved schedule.

Do not inherit claims that a decoder is easy or an archive variant is nearly
free. Confirm format/version documentation, decoder suitability, distribution
terms, resource behavior, companion handling and representative native results
before estimating delivery. Share container/XML/array/scene infrastructure while
keeping semantic readers and their supported features explicit. Native vendor
CAD, medical codecs, mailbox stores and filesystem/disk readers remain substantial
individual investigations.

## Provenance for derived scientific views

Keep the source file identity/version, reader/version, selected entities/records,
units, coordinate frame and transformations with derived figures, sections,
measurements or extracts. Preserve the route from a visible value back to its
source. This is a proposed machine-readable provenance requirement, not an
implemented export format or a promise to expose private metadata to agents.
The existing [source-evidence architecture](architecture.md) is the starting point.

When a family is implemented, update [current coverage](preview-formats.md), its
format-specific guide and [verification](verification.md). A format remains
proposed here until runtime support and its tested boundaries exist.
