# Format coverage and expansion

This is the proposed preview, conversion and optimization roadmap. The baseline below was audited
against the working tree on 1 November 2026. A candidate in this document is not a shipped feature.
The exact current limits remain in [preview formats](../reference/formats.md),
[media tools](../reference/media.md), [Office](../reference/office.md),
[PDF tools](../reference/pdf.md) and [speech](../reference/speech.md).

Use this page for format coverage, transformation capabilities and qualification. The companion
[file workflows specification](actions.md) owns the proposed interfaces, typed connections, recipes,
batch behavior and delivery packages. Neither page changes current command or workflow syntax.

Start with [the baseline](#where-viewer-stands), [projected scale](#projected-scale),
[the service catalog](#file-service-catalog),
[media and transcription](#priority-video-audio-transcripts-and-subtitles),
[scan-to-CAD](#priority-scans-to-cad-and-dimensional-inspection),
[conversion routes](#directional-conversion-backlog) or [optimization](#optimization-expansion).

## Product goal

Make Viewer the place to open, understand, transform and hand off the files people encounter in
ordinary life, creative work, engineering and research. Finish the common tasks before chasing a
large extension count. Specialist support must retain the meaning of the data: a map needs its
coordinate system, a part needs units, a transcript needs timing, and a workbook needs its sheets.

Proposed coverage targets:

- **Everyday previews:** at least 90% of a representative, frequency-weighted set of everyday file
  viewing tasks, including the variants people actually receive.
- **Everyday conversion and optimization:** at least 80% of the common tasks in each category,
  measured separately. Only tasks with a meaningful output belong in the denominator.
- **Professional coverage:** maintain an explicit matrix for each discipline below. Qualify the
  common open interchange formats first, then prioritize native formats by actual demand and decoder
  feasibility. A high overall score must not hide a missing engineering or arts category.

These are targets, not measured current percentages. There is no defensible way to claim support for
90% of files encountered over a lifetime from extensions alone. Native applications, proprietary
versions, encrypted content and linked projects prevent an honest promise of every professional
format. The goal is broad coverage with an exact explanation of what each file can do.

The first delivery priorities are:

1. Make existing capabilities discoverable and consistently available across previews, commands,
   batches and agents.
2. Complete video-to-audio, long-file transcription, subtitle creation and optional speaker
   labeling.
3. Fill everyday image, document, archive and data gaps; broaden optimization beyond five families.
4. Add substantive engineering and scientific readers, including calibrated scan-to-CAD workflows.
5. Expand costly native formats through qualified adapters without making the core app enormous.

## Where Viewer stands

### Inventory and counting rules

| Inventory                      |       Baseline | What the number means                                                                                                                                 |
| ------------------------------ | -------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview modules                |             27 | Includes the generic byte/hex fallback.                                                                                                               |
| Explicit preview format labels |            338 | Distinct labels in the registry, including aliases, source languages, compound suffixes and saved-preview formats. Not 338 complete semantic readers. |
| Image conversion routes        |            107 | Conventional source-extension to destination-format pairs across quick actions, image tools and layout export, including RAW sources.                 |
| Audio/video conversion routes  |             98 | Audio export, video export and still-frame export for the media tools' declared inputs.                                                               |
| PDF rasterization routes       |              2 | PDF pages to PNG or JPEG through layout export.                                                                                                       |
| Office-to-PDF routes           |             35 | The Office family's **Save PDF copy** command, including supported OpenDocument and drawing formats.                                                  |
| Scoped conversion total        |        **242** | The four conversion rows above, with 89 source labels and 10 destination formats.                                                                     |
| Unified Optimize               | **5 families** | PDF, JPEG, PNG, WebP and AVIF; six extensions when `jpg` and `jpeg` are counted separately.                                                           |

The earlier 207-route figure counted image, media and PDF routes only. It omitted the 35
Office-to-PDF routes. The corrected scoped total is 242, not a claim that every Viewer export is in
this count. ZIP creation/extraction, edited DXFs, nesting reports, handoffs, generated documents,
same-format copies and optimization are separate capabilities. Internal preview renditions are not
additional user-facing conversions.

Count a directed pair once across entry points. Keep source aliases separate only for this raw
inventory; merge them for coverage scoring. Do not count quality presets, compression levels,
rotations or operating systems as new conversions. A container extension is not a codec guarantee.
The ten destinations in this inventory are JPEG, PNG, PDF, WebP, AVIF, MP4, MOV, M4A, WAV and FLAC.
A competitor's advertised pair count is comparable only after applying the same rules.

This is a code inventory, not a fresh execution of every route. Primary local evidence:

- [Preview registry](../../packages/viewer-electron/app/src/renderer/previews/registry.ts) and
  [Office format catalog](../../packages/viewer-electron/app/src/domain/previews/documents/layout.ts).
- [Image inputs](../../packages/viewer-electron/app/src/domain/operations/image-conversions.ts),
  [layout sources](../../packages/viewer-electron/app/src/domain/layout/sources.ts),
  [RAW inputs](../../packages/viewer-electron/app/src/domain/previews/images/rendered.ts) and
  [media transform contracts](../../packages/viewer-electron/app/src/domain/operations/transforms.ts).
- [Office conversion command](../../packages/viewer-electron/app/src/renderer/commands/folder.ts)
  and
  [desktop operation validation](../../packages/viewer-electron/app/src/desktop/operations/operations.ts).
- [Optimize eligibility](../../packages/viewer-electron/app/src/domain/operations/optimization.ts)
  and
  [speech response handling](../../packages/viewer-electron/app/src/desktop/speech/transcription.ts).

The qualified desktop baseline is primarily direct macOS on Apple Silicon. Shared JavaScript,
packaged WASM or an upstream library's platform list does not qualify Viewer on another platform.
Keep Intel macOS, Windows, Linux and Store-build results separate; see
[platform status](../reference/platforms.md).

### Current strengths and limits

| Family                       | Implemented today                                                                                                                                           | Important boundary or gap                                                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Everyday images              | Common browser formats, SVG, system-decoded images, extended bitmap readers and 21 RAW labels. Crop, resize, rotate and selected format exports.            | RAW camera/encoding coverage varies. Image tools reject animated and multipage inputs. HEIC has quick conversion but is not an Image tools input.                     |
| Documents                    | PDF, EPUB, FB2, DjVu; layout for 35 Office/ODF/RTF/Publisher/metafile labels. Office-to-PDF export.                                                         | Exact Office fidelity varies. PDF page operations have documented losses. General editable document interchange and searchable-PDF creation are separate gaps.        |
| Saved document pictures      | Pages, Numbers, Keynote, Krita, OpenRaster, Sketch, XPS and OXPS.                                                                                           | An embedded picture is not full page, layer, sheet or object support.                                                                                                 |
| Audio/video                  | 40 explicit preview labels plus MIME/content routes; bounded compatibility copies. Editing, trimming, joins, audio replacement/mixing and selected exports. | Preview coverage exceeds conversion input coverage. MP3 is an input but not an export. Container, codec and stream layout need separate qualification.                |
| Speech and subtitles         | Local Whisper and hosted microphone dictation; SRT/VTT/ASS/SSA reading and matching video sidecars.                                                         | Dictation is limited to 60-second recordings. No general file-transcription job, durable timed transcript, generated subtitle export or speaker-diarization workflow. |
| Tables and source            | CSV/TSV tables, SQLite schema/table browsing, structured text trees, source highlighting and notebook cells with saved outputs.                             | No general Parquet/Arrow/HDF5/DuckDB reader. Source or XML views do not establish domain semantics. Notebook code is not executed.                                    |
| Mail, contacts and calendars | EML/EMLX/MBOX, vCard and iCalendar readers.                                                                                                                 | MSG/PST/OST, deeper archive navigation and structured exports remain separate work. Genomic VCF is not contact VCF.                                                   |
| Archives                     | ZIP, TAR, TAR.GZ/TGZ, ZIP-based packages and bounded standalone GZip content; file operations create ZIPs.                                                  | 7z, RAR, broader compression/encryption variants and semantic package inspection remain gaps. APK archive browsing is not an Android application reader.              |
| 3D and CAD                   | 17 model labels including STEP/IGES geometry and common meshes/scenes. ASCII DXF inspection, measurement, reviewed corrections and nesting.                 | Tessellated CAD is not editable solid geometry. No general mesh/CAD conversion service, native DWG reader, BIM reader or scan reconstruction workflow.                |
| Fonts and metadata           | TTF/OTF/WOFF/WOFF2 specimens; certificates, keys, shortcuts, torrents and provisioning metadata. Binary identification/hex fallback.                        | Not every font collection, credential container or executable structure is understood. Metadata inspection does not execute, install or establish trust.              |

## Projected scale

If the full format roadmap is implemented, the planning envelope is approximately **600 to 650
preview format labels**, **2,000 to 3,000 directed conversion routes**, and **several dozen formats
with meaningful optimization**. These figures are estimates of scope, not release claims or measured
coverage percentages.

| Measure                    | Current inventory | Full-roadmap projection | Basis and limitation                                                                                                                                                      |
| -------------------------- | ----------------: | ----------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview format labels      |               338 |               About 625 | Expanding the named ecosystems into representative extensions/package forms gives about 287 additional labels after deduplication. Includes aliases and source languages. |
| Directed conversion routes |               242 |    About 2,000 to 3,000 | A planning range for selected image, media, document, archive, data and specialist outputs. The complete validated route graph has not been enumerated.                   |
| Optimize formats           |        5 families |           Several dozen | Expand only where a qualified writer and a meaningful preservation contract exist. This is not an exact count yet.                                                        |

The preview estimate normalizes named ecosystems into file labels; it is not a count of 625
independent semantic engines. Several meanings share extensions, and some new readers deepen an
existing label without adding one. Open-ended vendor families also need their versions enumerated.

For scale, 40 supported media input labels with five transcript destinations would produce up to 200
directed file-to-text routes. Timing and export qualification determine which actually ship.
Diarization on/off, three quality presets, multiple menu entry points and different operating
systems do not multiply this count. A chained path is not an additional direct conversion.

Keep deterministic conversion, extraction, model inference and reconstruction as separate classes in
inventories. Do not count a summary, inferred CAD model, report or successful metadata inspection as
an interchangeable encoding of the original. New ideas below are not automatically added to the
projection; update it from the explicit capability graph when routes are designed.

## File service catalog

The suite should support these verbs through a common review and output experience. A service may
produce files, typed selections, an editable project or a report. Its output type and actual
consequences must be clear before it runs.

| Service              | Existing foundation                                                      | Proposed complete experience                                                                                                       |
| -------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Identify and inspect | Format routing, metadata and selected semantic readers.                  | Explain the actual variant, its contents, missing dependencies and available actions.                                              |
| Preview and navigate | Document, image, media, model and source views.                          | Consistent full-content navigation with appropriate pages, sheets, frames, tracks, layers and entities.                            |
| Convert and export   | Scoped 242-route inventory and specialized exports.                      | Choose a valid target or delivery purpose, inspect losses and save verified copies.                                                |
| Extract              | Archive entries, page tools and selected content/attachment readers.     | Extract selected pages, tracks, subtitles, images, attachments, tables, layers, meshes, entities or data slices.                   |
| Assemble and split   | PDF assembly, media segments, layout and nesting.                        | Merge or split typed selections while preserving ordering, timing, units and provenance.                                           |
| Optimize             | Five families and media export presets.                                  | Meet a size, quality or runtime budget with measured results and a preservation contract.                                          |
| Normalize            | Format-specific resize, orientation and media transforms.                | Explicit encoding, units, CRS, color, sample rate, schema, timezone or metadata normalization.                                     |
| Recognize            | OCR-related reading and short speech dictation.                          | Reviewed OCR, long-form transcription, subtitle timing and optional speaker labeling.                                              |
| Compare and verify   | Folder comparison, Git review and specialized fabrication checks.        | Semantic comparison across versions or formats, plus independent output checks.                                                    |
| Diagnose and repair  | Reader errors and selected editing/correction tools.                     | Explain specific damage or missing resources, propose a copy and verify what was recovered or changed.                             |
| Reconstruct          | Generated visual assets and specialized CAD evidence are distinct today. | Calibrated scan-to-vector/CAD and document/table reconstruction with measured versus inferred facts.                               |
| Enrich and generate  | Notes, model-assisted work and conversation canvases.                    | Captions, descriptions, indexes, chapters, plots and explanations linked to evidence, without relabeling them as original content. |
| Prepare for delivery | Existing layout, nesting and fabrication handoffs.                       | Purpose-specific export sets with dependency checks, manifests and a recipient preview.                                            |
| Reuse and refresh    | Custom actions, reviewed workflows and watch rules.                      | Save the reviewed transformation as a reusable recipe; refresh only affected descendants after a source changes.                   |

The proposed [file-to-file interfaces](actions.md#file-to-file-interfaces) must make a one-step
conversion quick and keep complex work inspectable. Users should not have to build a graph to
extract audio or resize a photograph.

## What counts as support

Record independent capabilities, not a single `supported: true` flag:

| Capability       | Required meaning                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Identify         | Recognize content, variant and version with bounded evidence; distinguish an extension hint from a verified signature. |
| Thumbnail        | Show a representative embedded or generated image, labeled when incomplete.                                            |
| Render/play      | Read the actual pages, frames, scene or audio with disclosed feature and size limits.                                  |
| Inspect          | Expose the domain's structure: sheets, streams, layers, elements, datasets, entities or records.                       |
| Extract/search   | Return text or structured facts with source locations and explicit omissions.                                          |
| Convert/export   | Produce a declared destination, disclose lost features and reopen the output successfully.                             |
| Optimize         | Preserve stated properties while reducing size or improving a named delivery constraint.                               |
| Edit/reconstruct | Save reviewed changes or inferred geometry with provenance; separate from decoding.                                    |

Each capability also needs a status: implemented, partial, proposed, blocked by a dependency, or
unsupported. Include the operating system, reader/build version, variants, size limits and evidence
of qualification. An installed engine can support more than Viewer exposes; unexposed features do
not count. A generic container reader and its semantic readers remain separate entries.

### Measuring the targets

Build a versioned corpus of representative tasks, not a bag of extensions. Sample ordinary
household/office, student, creator, developer, mechanical, electrical, civil/AEC and research
workflows. Use public or permissioned samples; no background collection of private user files.
Record the origin of frequency weights and publish unweighted family coverage alongside them.

For each category, calculate `sum(weight of passed tasks) / sum(weight of all in-scope tasks)`.
Report preview, conversion and optimization separately, then report each professional discipline. Do
not quietly remove difficult files from the denominator. Fix the corpus version and expected results
before measuring a release.

A task passes only when the expected content or output is correct within its declared tolerance.
Opening a window, showing an icon or displaying the first page of a ten-page document does not pass
full-document preview. Test multiple encodings/versions of popular formats, non-Latin filenames and
content, missing companion files, damaged inputs and realistic large files. Unknown coverage stays
unknown until this corpus exists.

## Priority: video, audio, transcripts and subtitles

### Video-to-audio and media conversion

Video-to-audio already works through **Edit media…** with M4A, WAV or FLAC output. Make **Extract
audio…** a direct action and expose the same operation in batch conversion. This is an integration
and breadth improvement, not a new decoder from zero.

| Work                         | Proposed result                                                                             | Acceptance boundary                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Extract a track              | Choose audio stream, language and destination; export the whole clip or a selected range.   | A silent video reports no audio; multiple tracks are never silently mixed or discarded.          |
| Copy compatible audio        | Remux the selected stream without another lossy encode when the destination supports it.    | Clearly distinguish stream copying from transcoding; preserve timing and codec parameters.       |
| Broaden audio exports        | MP3, Opus/Ogg, AAC, AIFF and supported WAV/FLAC variants, alongside existing M4A/WAV/FLAC.  | Qualify the actual bundled encoders, bit depth, channel layout, sample rate, tags and cover art. |
| Broaden video exports        | MP4/MOV, WebM and MKV with explicitly supported H.264, HEVC, VP9 or AV1 routes.             | Container and codec compatibility, HDR/color handling and encoder availability are explicit.     |
| Extract existing subtitles   | Export a selected text track as SRT or WebVTT; preserve supported ASS styling separately.   | Image-based PGS/VobSub captions require a distinct OCR step, not a renamed text export.          |
| Deliver subtitles with video | Sidecar export first; later soft-subtitle muxing or burned-in captions.                     | Burn-in changes pixels and needs video encoding; muxing depends on the target container.         |
| Make media smaller           | Size/quality presets, downscale, chosen stream retention and a verified output-size report. | No guaranteed target size or quality improvement from transcoding lossy audio.                   |

FFmpeg's [stream model](https://github.com/FFmpeg/FFmpeg/blob/master/doc/ffmpeg.texi) distinguishes
containers, streams, stream selection and transcoding. Viewer should expose those choices in plain
language while keeping fixed, validated processor arguments underneath.

### Video/audio-to-text

Add a durable **Transcribe…** operation for selected media files. Reuse the existing speech model
and provider owners, but create a file-job contract separate from microphone capture. Increasing the
microphone limit is not a long-form transcription implementation.

The proposed flow is:

1. Choose files, audio track, language or detection, local/hosted processing and optional speaker
   labels. Show duration and processing requirements before starting.
2. Decode only the selected audio. Use bounded chunks with source-time offsets, silence handling,
   overlap reconciliation, cancellation and resumable checkpoints tied to source identity.
3. Open a transcript plane beside the media. Clicking text seeks the original; selecting a range can
   create a linked quote chat with a timestamped source reference.
4. Let the person correct words, timing, punctuation and speaker names without overwriting the raw
   recognition result. Show uncertain or unaligned segments where the engine provides evidence.
5. Save TXT/Markdown, SRT, WebVTT and structured JSON. Preserve segment timing, optional word
   timing, speaker labels and edits in the durable project representation. Add ASS/TTML export after
   timing and styling rules are qualified.
6. Reopen the export and the saved session after restarting Viewer. A changed media file invalidates
   alignment until reviewed; a retry does not submit completed paid chunks again without a choice.

Word timing and diarization are optional engine capabilities. Keep transcription, translation,
summary, audio cleanup and speaker labeling as distinct operations. A summary is not a transcript;
translated subtitles retain a link to the original-language text. Offer channel-separated
transcription when the recording already assigns participants to separate channels.

Diarization groups speech by speaker; it does not establish a person's identity. Start with
**Speaker 1**, **Speaker 2** and editable names. Preserve overlap and uncertain assignments.
Reconcile speaker labels across chunks so the same participant does not change number halfway
through a recording. Forced alignment is a separate capability when exact word timing is needed.

| Execution option     | Starting point                                                                               | Work still required                                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local transcription  | Existing verified Whisper weights and bundled whisper.cpp runtime.                           | File decoding, long-job lifecycle, timed results, model/performance choices and export. Upstream supports local inference and VAD; Viewer must qualify its own build. |
| Local diarization    | Evaluate pyannote.audio or another maintained local pipeline.                                | Model terms/downloads, optional runtime footprint, CPU/GPU performance, overlap and global speaker assignment. Do not assume Whisper text output supplies this.       |
| Hosted transcription | Existing Meta, OpenAI, Deepgram and compatible speech adapters.                              | Per-model file limits, languages, timestamps, costs, retries and normalized results. Existing adapters currently consume plain transcript text.                       |
| Hosted diarization   | Evaluate explicitly supported provider/model combinations, including Deepgram or pyannoteAI. | Separate capability discovery and permission, speaker/timestamp schema, limits and price reporting. A generic transcription endpoint does not promise diarization.    |

The [whisper.cpp project](https://github.com/ggml-org/whisper.cpp) documents its local runtime and
VAD. [pyannote.audio](https://github.com/pyannote/pyannote-audio) documents local and hosted speaker
pipelines; model access conditions are separate from the code license.
[Deepgram's diarization documentation](https://developers.deepgram.com/docs/diarization) describes
versioned speaker output. These are integration candidates, not claims of existing Viewer file
transcription or chosen long-form providers.

Keep offline processing available with installed models. A hosted job must show the selected
provider and audio scope; microphone permission and chat access do not authorize file uploads.
Expose estimates where the provider makes them possible, without inventing a price. No silent cloud
fallback. Keep keys in the existing credential store and model/runtime installation in the verified
download flow. Persist enough state for recovery without putting recordings or credentials into
unrelated workspace exports.

Qualification must cover hours-long media as well as short clips: silence, music-only sections,
accents, Romanian and English, mixed languages, technical terms, crosstalk, multiple audio tracks,
variable frame rate, nonzero start times and interrupted processing. Measure word/character error,
timing error, diarization error, latency, peak memory and cost separately. Record the reference
transcripts and acceptable thresholds before comparing engines.

## Priority: scans to CAD and dimensional inspection

This deserves its own workflow, not another input/output pair. Separate three tasks:

| Source                                 | Proposed service                                                                             | Result that can honestly be claimed                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Flatbed scan of a flat part or drawing | Calibrate, trace edges, fit lines/arcs, review contours and dimensions.                      | A measured 2D profile exported as SVG/DXF; optional later extrusion with reviewed thickness.         |
| Mesh or point-cloud scan               | Align, segment surfaces, fit features, inspect deviations and reconstruct selected geometry. | A fitted model or editable reconstruction with an error report and explicit unsupported regions.     |
| Ordinary photo or generated 3D asset   | Perspective correction where possible, or visual reconstruction.                             | A visual approximation unless scale, geometry and critical dimensions are independently established. |

[ScanRuler](https://github.com/CNCKitchen/scanruler) is a reference for this class of workflow. It
documents browser-local 2D calibration and fitting, 3D feature measurement, deviation inspection,
mesh tools and reverse engineering with STEP output. Its 2D workflow exports SVG/DXF/CSV, and its
project format keeps an editable session. Its
[MCP bridge](https://github.com/CNCKitchen/scanruler/blob/main/mcp/README.md) provides a possible
agent integration path. These are upstream capabilities; none establishes a Viewer integration or
Viewer accuracy result. The product goal is Viewer's own calibrated scan-to-CAD experience. It does
not require embedding ScanRuler or making that application a runtime dependency.

### Proposed first slice

Start with a calibrated 2D scan because its correctness can be checked with a small physical part:

1. Open a PNG/JPEG/TIFF scan in a plane, beside a trace/measurement plane.
2. Require a known length or calibration artifact, units and independent X/Y scale checks. DPI is an
   initial hint, not proof of calibration. Flag perspective or distortion that the workflow cannot
   correct reliably.
3. Fit editable lines, circles and arcs; retain the image overlay and fitting residuals. Let the
   person choose edges where shadows, chamfers or background make the boundary ambiguous.
4. Review closed contours, self-intersections, holes, minimum features and tolerances. Never round a
   measured value to a nominal dimension without confirmation.
5. Export a new 1:1 DXF/SVG with units and a calibration record. Reopen and independently remeasure
   the exported geometry before sending it to nesting or manufacturing.
6. Save the reviewed project and checks so the comparison survives a restart.

For 3D reconstruction, add alignment/datums, unit confirmation, selected feature fitting, sections,
scan-to-model deviation and a review of missing surfaces. A watertight tessellated mesh, a faceted
STEP wrapper and a reconstructed analytic solid are different outputs. Preserve which features were
measured, manually constrained or inferred. Unknown hidden geometry and ambiguous dimensions still
need human confirmation. Compare with the physical reference where accuracy matters; agreement with
a noisy scan alone cannot prove fit.

### Implementation choices

| Option                    | Proposed use                                                                                                        | Gate before implementation                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Viewer-owned workflow     | Build calibration, fitting, editable constraints and export/review around qualified geometry components.            | Define numerical contracts, bounded processing, source evidence and independent dimensional checks; the UI and saved project belong to Viewer.             |
| External handoff          | Export selected resources, open a user-selected ScanRuler session, reimport reviewed outputs.                       | Verify file/project interoperability and a repeatable measurement case without bundling upstream code.                                                     |
| MCP adapter               | Drive a paired session through typed operations and return measurements, project and output files to linked planes. | Inspect the tool surface, source grants, cancellation, model data exposure and exact scope of mutations. A bridge must not bypass Viewer's removal policy. |
| Embedded engine/workspace | An integrated Viewer experience for fitting and reconstruction.                                                     | Validate API boundaries, worker lifecycle, packaged dependencies and license compatibility before copying or distributing code.                            |

Recommendation: define and prototype the calibrated 2D Viewer workflow first. Use upstream tools as
references and comparison candidates. External/MCP interoperability or licensed embedding may
accelerate selected capabilities, but neither is a prerequisite. Do not load a remote web app into a
privileged document frame or give it unrestricted filesystem access. ScanRuler's
[commercial terms](https://github.com/CNCKitchen/scanruler/blob/main/COMMERCIAL.md) state
AGPL-3.0-only with a commercial exception available; its CAD-kernel terms remain separate. The
distribution choice is unresolved, so this roadmap does not select an embedding license.

Initial acceptance cases: a flat gasket with known hole spacing, a scanned bracket with planes and
bores, and a deliberately incomplete/noisy scan that must remain unverified. Save both the source
and reviewed result; check dimensions after export/reopen and session restart. AI-generated 3D
assets must stay labeled as generated, without inheriting measured-CAD status.

## Everyday format expansion matrix

**P1** is the first broad delivery wave. **P2** deepens coverage after the shared job and capability
work. **P3** needs a separate feasibility, licensing or demand decision. Priorities describe
proposed order, not dates or an assurance that every variant is feasible.

| Family and formats                                                  | Where we stand                                                  | Required next capability                                                                                                                             | Priority |
| ------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| JPEG, PNG, WebP, AVIF, GIF, BMP, TIFF, HEIC/HEIF                    | Preview and selected conversion exist; Optimize is narrower.    | Consistent conversion inputs, TIFF export, explicit frame/page selection, color/alpha/metadata fidelity; qualify additional HEIF encoders.           | P1       |
| SVG/SVGZ, ICO/ICNS, APNG and animated GIF/WebP/AVIF                 | Preview paths exist; image tools reject animation.              | Vector-to-raster/PDF, icon sizes, animation timelines and frame-preserving exports. SVG optimization must preserve appearance and IDs that matter.   | P1/P2    |
| JPEG XL, JPEG 2000, HDR/EXR and camera RAW                          | JP2/EXR and 21 RAW labels render bounded images.                | JXL investigation, actual camera samples, multipage/high-bit-depth/color handling and labeled tone-mapped output.                                    | P2       |
| PDF and scanned documents                                           | Viewing, assembly, layout rasterization and optimization exist. | Reviewed OCR to searchable PDF/TXT/Markdown, table extraction and explicit forms/tags/bookmarks preservation rules.                                  | P1       |
| DOC/DOCX/RTF/ODT, XLS/XLSX/ODS, PPT/PPTX/ODP and supported variants | Layout and PDF export already exist for 35 labels.              | Structured interchange, worksheet CSV/TSV export and clearer fidelity diagnostics; qualify XLSB/PPSM and additional legacy formats separately.       | P1/P2    |
| Pages, Numbers, Keynote, XPS/OXPS                                   | Saved picture only.                                             | Full page/sheet rendering or an explicit external converter, followed by qualified PDF/data export.                                                  | P2       |
| TXT, Markdown, HTML, RST, JSON/JSONL, YAML, XML, CSV/TSV            | Text, selected structured views and tables.                     | Consistent encoding/newline conversion, data-aware JSON/CSV/TSV export, Markdown/HTML/document export and bounded JSONL tables.                      | P1       |
| MP4/MOV/MKV/WebM/AVI/MPEG and MP3/M4A/WAV/FLAC/Ogg/Opus             | Playback and selected media tools.                              | Direct audio extraction, more export codecs, stream selection and media optimization.                                                                | P1       |
| SRT/WebVTT/ASS/SSA, TTML/DFXP, SUB/IDX, PGS                         | First four have cue readers.                                    | Generated/edited captions, subtitle conversion and timing; separate styled text and bitmap-caption paths.                                            | P1/P2    |
| ZIP/TAR/GZip, 7z/RAR, BZip2/XZ/Zstandard, CAB/CPIO                  | ZIP/TAR/GZip and package browsing; ZIP writing.                 | More listing/extraction formats, explicit password/multipart support and ZIP/TAR/compressed-TAR output. RAR read support does not imply RAR writing. | P1/P2    |
| EPUB/FB2/DjVu, DRM-free MOBI/AZW3, CBZ/CBR/CB7/CBT                  | First three have readers; CBZ is generic ZIP browsing.          | Dedicated comic navigation and broader book conversion, preserving reading order, covers and navigation. No DRM bypass.                              | P2       |
| EML/EMLX/MBOX, MSG/PST/OST                                          | First three have readers.                                       | MSG and mailbox indexing, attachment handling and reviewed export; large stores require incremental work.                                            | P1/P3    |
| ICS/iCalendar, VCF/vCard, OPML, RSS/Atom                            | Calendar/contact readers; other XML may show as text/tree.      | Event/contact export, timezone/recurrence fidelity, outline/feed views without automatic network fetch.                                              | P2       |
| TTF/OTF/WOFF/WOFF2, TTC/OTC and legacy fonts                        | First four have specimens and metadata.                         | Collections, variable axes, coverage comparison; conversion/subsetting only with embedding rights and shaping checks.                                | P2       |
| DMG/ISO and common packages                                         | Generic byte/container inspection where available.              | Bounded read-only contents and metadata without automatic mounting, execution or installation.                                                       | P2/P3    |

OCR reading and searching do not imply an exported searchable PDF. Likewise, rendering Office to an
internal PDF and the existing **Save PDF copy** are implemented, while editing or round-tripping all
Office semantics is not. Keep these boundaries visible in the capability catalog.

## Engineering, construction and manufacturing

Existing ASCII DXF, mesh, STEP/IGES geometry, reviewed DXF correction and nesting are the starting
point. The semantic capabilities in the next table are additions unless explicitly identified as
current.

| Domain and formats                                                                         | Current boundary                                                            | Target preview, conversion or service                                                                                                                 | Priority                         |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 2D CAD: DXF, DWG, DGN, DWF/DWFX                                                            | ASCII DXF only; a job containing DWG is recognized but DWG is not measured. | Broader DXF entities/versions, layouts and references; qualified DWG/DGN decoding; publish sheets as PDF/SVG and exchange supported entities as DXF.  | P2; DWG feasibility early        |
| Solid interchange: STEP/STP, IGES/IGS                                                      | Tessellated viewing with normalized dimensions.                             | Bodies, topology, assembly names and units; reviewed tessellation and STEP/IGES/mesh export through a capable geometry engine.                        | P2                               |
| Mesh/scene exchange: STL, OBJ/MTL, PLY, GLB/glTF, FBX, DAE, 3DS, 3MF, USDZ, X3D/WRL, OFF   | Geometry viewing, with format-specific companion limits.                    | General conversion, material/texture bundling, explicit loss reports, mesh validity and bounded simplification.                                       | P2                               |
| BIM: IFC/IFCZIP, BCF                                                                       | No semantic BIM reader.                                                     | Spatial/entity hierarchy, GUIDs, properties, quantities, materials and linked geometry; property-table and review export.                             | P2                               |
| Native building models: RVT/RFA, SKP, NWD/NWC                                              | No qualified native readers.                                                | Versioned building/family/model adapters with explicit metadata, geometry and semantic coverage.                                                      | P3                               |
| Mechanical kernels: Parasolid X_T/X_B, ACIS SAT/SAB; JT                                    | No qualified readers.                                                       | Topology or product structure/PMI where supported; separate licensed decoder and version decisions.                                                   | P3                               |
| Native CAD: SLDPRT/SLDASM/SLDDRW, IPT/IAM/IDW, CATPart/CATProduct, PRT/ASM, F3D/F3Z, FCStd | No general native CAD workflow.                                             | Parts, drawings, assemblies, references and appropriate neutral exports. Native constraints/features cannot be promised by a mesh converter.          | P2 open projects; P3 proprietary |
| Scans/point clouds: LAS/LAZ, E57, PTS/XYZ, PCD; mesh scans                                 | Mesh preview is not a point-cloud or metrology service.                     | Streamed clouds, attributes, calibrated measurements, sections, deviation and reviewed reconstruction.                                                | P2                               |
| PCB: KiCad PCB/SCH, BRD/SCH, DSN/SES, BOM, IPC-2581                                        | No domain reader.                                                           | Board/schematic layers, components, nets, stackup, dimensions and BOM/neutral exports, with vendor-aware identification.                              | P2                               |
| Fabrication: Gerber/GBR/GTL/GBL, Excellon DRL                                              | No fabrication-layer reader.                                                | Overlay copper/mask/outline/drills, verify scale and layers, inspect manufacturing facts and export review plots.                                     | P2                               |
| Circuits: CIR/SP/SPICE/LIB, waveform results                                               | Text where recognized, not circuit semantics.                               | Netlist hierarchy, model references and waveform inspection; simulation is a separate explicit operation.                                             | P2                               |
| Robotics: URDF, Xacro, SDFormat SDF, SRDF, MJCF                                            | No robotics semantic reader.                                                | Links, joints, transforms, limits and scoped mesh references; inspect before any constrained expansion or simulator use.                              | P2                               |
| CAM/slicers: GCODE/GCO/BGCODE, NC/TAP, GCODE.3MF, slicer-project 3MF                       | 3MF geometry does not read plates or toolpaths.                             | Layers/moves, extrusion or cutting paths, machine/profile metadata and estimates with known assumptions. Never send motion to a machine from preview. | P2                               |
| Firmware: HEX/IHEX/SREC/S19/UF2/BIN/ELF                                                    | Generic text/binary evidence.                                               | Address ranges, segments and architecture facts; BIN cannot supply an absent base address or architecture.                                            | P2                               |

### BIM must retain its own structure

IFC is not another mesh extension. Link project/site/building/storey/space navigation, containment,
property sets and geometry where those relationships exist, without forcing every file into a single
hierarchy. Selecting an element should synchronize its geometry and property views; comparisons
should retain GUIDs, schema version and units. The Plurid workspace coordinates remain separate from
the building's coordinate system.

The
[buildingSMART spatial model](https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD1/HTML/schema/templates/spatial-decomposition.htm)
and [IfcOpenShell documentation](https://docs.ifcopenshell.org/) are starting references. Native
Revit/SketchUp/Navisworks support remains a separate investigation. Similarly,
[OCCT STEP exchange](https://dev.opencascade.org/doc/overview/html/occt_user_guides__step.html) is a
geometry-engine reference, not evidence that Viewer's current importer exposes a solid editor.

## Science, medicine, mathematics and geospatial work

Every row needs a semantic reader beyond a generic bitmap, text tree or hex view. Preserve units,
axes, calibration, missing values, coordinate frames and data types. First qualify inspection and
controlled exports; do not imply clinical diagnosis or validated scientific analysis from viewing.

| Domain and formats                                                       | Current boundary                                                | Proposed first complete experience                                                                                         | Priority |
| ------------------------------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------- |
| GIS vectors: GeoJSON/TopoJSON, GPX/KML/KMZ, SHP, GPKG, FlatGeobuf        | Generic structured text or ZIP views.                           | Map, attributes, geometry selection and CRS-aware conversion with sidecar handling.                                        | P2       |
| GIS rasters/maps: GeoTIFF, ASC/DEM, VRT/IMG, MBTiles/PMTiles             | TIFF bitmap preview is not geospatial support.                  | Bands/elevation, nodata, coordinates and local tile navigation; controlled raster/vector exports.                          | P2       |
| Survey/activity: LAS/LAZ/E57, FIT/TCX                                    | No semantic reader.                                             | Spatial samples or tracks, timestamps, laps and device fields, with correct coordinate metadata.                           | P2       |
| Medical volumes: DICOM/DCM/series, NIfTI NII/NII.GZ, NRRD, MHA/MHD       | No volume reader.                                               | Slice/series navigation, spacing, orientation, window/level and metadata; transfer syntax and companion coverage explicit. | P2       |
| Microscopy/astronomy: OME-TIFF, OME-Zarr, CZI/LIF/ND2, FITS              | A TIFF rendition does not expose scientific axes.               | Channels, Z/time axes, scales and bounded planes; start with open formats, then vendor readers.                            | P2/P3    |
| Multidimensional arrays: H5/HDF5, NetCDF NC, GRIB/GRIB2, Zarr            | No array-semantic reader.                                       | Variables, groups, dimensions, coordinates and bounded slices; local directory stores and companions.                      | P2       |
| Numerical/statistical data: MAT, NPY/NPZ, RDS/RData, DTA/SAV/SAS7BDAT    | Source languages have text views, not these binary data models. | Typed arrays/tables/labels and chosen CSV/Arrow/NPY exports; no arbitrary object deserialization or runtime execution.     | P2/P3    |
| Molecular structures: PDB/CIF/mmCIF, MOL/SDF/MOL2/XYZ                    | No molecular reader.                                            | Atoms, bonds, chains, residues and structure metadata, with structure-aware interchange.                                   | P2       |
| Genomics: FASTA/FA/FASTQ, SAM/BAM/CRAM, genomic VCF/BCF, BED/GFF/GTF     | Contact VCF support is unrelated.                               | Bounded records, indexed views and explicit reference-genome/sidecar requirements.                                         | P2/P3    |
| CAE meshes: VTK/VTU/VTP, MSH/MED/XDMF                                    | General mesh preview does not show fields/time.                 | Meshes, scalar/vector fields, time steps, sections and provenance.                                                         | P2       |
| Solver results: ODB/OP2/RST/CASE/FOAM ecosystems                         | No solver-specific reader.                                      | Individual versioned readers for fields/results and linked files, with neutral extracts.                                   | P3       |
| Experimental signals: EDF/BDF/WFDB, mzML/mzXML, JCAMP-DX, instrument CSV | CSV can show values, not instrument semantics.                  | Channels, units, sampling/time axes, spectra and metadata; preserve raw measurements and transformations.                  | P2/P3    |
| ML artifacts: safetensors, ONNX, GGUF, HDF5 models                       | Generic byte inspection.                                        | Tensor/graph metadata, shapes, types and bounded samples; opening does not load executable model code.                     | P2       |
| Technical publishing: TeX/BibTeX, RIS/ENW, notebook IPYNB                | Source and saved notebook outputs exist.                        | Bibliography semantics, static document export and separately sandboxed typesetting; no notebook execution on open.        | P2       |

The
[DICOM standard](https://dicom.nema.org/medical/dicom/current/output/chtml/part10/chapter_7.html),
[NetCDF format guidance](https://docs.unidata.ucar.edu/netcdf-c/current/faq.html),
[Zarr storage model](https://zarr.readthedocs.io/en/stable/user-guide/storage/),
[MAT-file versions](https://www.mathworks.com/help/matlab/import_export/mat-file-versions.html) and
[HTS specifications](https://samtools.github.io/hts-specs/) establish distinct layouts and companion
requirements. For example, an HDF5 adapter covers the relevant MAT v7.3 branch, not every MAT file.
Do not claim a whole ecosystem from one successful fixture.

## Arts, design and creative production

| Domain and formats                                                        | Current boundary                                           | Proposed expansion                                                                                                               | Priority |
| ------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Layered raster: PSD/PSB, ORA/KRA, XCF, AFPhoto                            | PSD composite; ORA/KRA saved pictures.                     | Layers, channels, blend modes, high-bit-depth color and explicit composite export; native editing fidelity separately qualified. | P2/P3    |
| Illustration: SVG, AI/EPS/PS, CDR, AFDesign                               | SVG renders; other native illustration semantics absent.   | Artboards, vectors, embedded fonts/images and PDF/SVG/raster output with an appearance comparison.                               | P2/P3    |
| Publishing: INDD/IDML, SLA, AFPub, PUB                                    | Publisher layout/PDF export exists.                        | Package inspection, page layout and assets for additional families; IDML structure alone is not an InDesign renderer.            | P2/P3    |
| Diagrams/design: VSD/VSDX, FIG/XD/Sketch, Draw.io                         | Sketch saved picture; no qualified Visio reader.           | Pages, layers, components, links and vector exports through explicit format/version adapters.                                    | P2/P3    |
| Scene/animation: USD/USDA/USDC/USDZ, BLEND, ABC, FBX, BVH                 | Selected scene geometry, including bounded USDZ/FBX views. | Hierarchy, instances, materials, animation, cameras and dependencies; distinguish baked geometry from editable native scenes.    | P2/P3    |
| Motion/edit projects: OTIO, EDL, FCPXML, Premiere/Resolve project formats | Media playback is not project support.                     | Timeline/media-reference inspection and interchange where schemas are documented. No plugins or external scripts run on opening. | P2/P3    |
| Audio/music: MID/MIDI, MusicXML/MXL, SF2/SFZ                              | Audio waveform playback does not read scores.              | Notes, tracks, instruments and score/timeline views; render with explicitly selected sound resources.                            | P2       |
| DAW sessions: RPP, ALS, FLP, Logic projects                               | No native session reader.                                  | Structure, missing assets and declared track metadata first; audio rendering requires supported engines/plugins.                 | P3       |
| Cinema/photography: DPX/CIN, EXR/HDR, DNG and vendor RAW                  | Bounded bitmap/RAW rendering.                              | Channels, exposure/tone mapping, image sequences, frame rate and qualified high-bit-depth exports.                               | P2       |
| Textures: DDS, KTX/KTX2, ASTC, Basis                                      | KTX/ASTC bounded renditions.                               | Mip levels, cubemaps, arrays, compression/normal-map semantics and texture export.                                               | P2       |
| Typography: TTC/OTC, EOT/DFONT/PFB/PFM, variable fonts                    | Four common font formats have specimens.                   | Collection faces, variable axes, shaping/glyph inspection and licensed subsets/exports.                                          | P2       |
| Color: ICC/ICM, ASE/ACO, CUBE/3DL                                         | No dedicated color-resource reader.                        | Profiles, palettes and LUT views, with intentional color conversion and sample comparison.                                       | P2       |
| Crafts: DST/PES/JEF/EXP embroidery, SVG/DXF cutting patterns              | SVG/DXF viewing does not read stitches.                    | Stitch paths, thread colors and dimensions; machine-specific output only after independent qualification.                        | P3       |

Keep a flattened visual export distinct from an editable interchange. Layers, animation, fonts,
constraints and plugin state need explicit loss reporting. A project folder is a graph of assets,
not one blob that can be renamed to another suite's extension.

## Data, business, development and inspectable packages

| Family                                                                    | Current boundary                                     | Proposed expansion                                                                                                    | Priority |
| ------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------- |
| Columnar/table stores: Parquet, Arrow/Feather, ORC, Avro, DuckDB          | CSV/TSV and SQLite readers exist.                    | Paged schemas/tables, typed filtering and intentional CSV/JSONL/Parquet/Arrow export.                                 | P1/P2    |
| Binary records: CBOR, MessagePack, BSON, Protobuf                         | Text/schema views only where recognized.             | Typed trees and schema-aware records; Protobuf without its schema must disclose incomplete interpretation.            | P2       |
| Legacy databases: MDB/ACCDB/DBF; SQL/DUMP/BAK                             | Generic text/bytes; SQLite DB is not every database. | Read-only schema/records for qualified engines; never restore or execute a dump merely to preview it.                 | P2/P3    |
| Web captures: MHTML/MHT, WebArchive, WARC/WARC.GZ                         | WebArchive renders in isolation.                     | Offline packaged pages, resource/URL indexing and intentional export with network access disabled by default.         | P2       |
| Diagnostics: HAR, Chrome trace JSON, Perfetto traces, PCAP/PCAPNG         | Generic JSON/bytes.                                  | Requests, timelines, flows and selected records with secrets handled explicitly.                                      | P2/P3    |
| APIs/configuration: OpenAPI, GraphQL, Proto, AVSC, JSON Schema            | Generic source/tree preview.                         | Schema relationships, endpoints and examples without running requests or executable configuration.                    | P2       |
| Business exchange: UBL/XML invoices, Factur-X/ZUGFeRD, QIF/OFX/QFX        | PDF/XML/text may render.                             | Structured fields, attached-document linkage and reviewed tabular export; distinguish extracted from validated facts. | P2/P3    |
| Credentials: P7B/P7C/P12/PFX/CSR                                          | PEM/DER/OpenSSH/OpenPGP metadata exists.             | Additional container/request metadata and explicit encrypted-container handling; private-key bytes remain excluded.   | P2       |
| Executables/libraries: EXE/DLL/SO/DYLIB/ELF/APP                           | Binary identification/header facts and hex.          | Sections, architectures, dependencies and available symbols/signatures without loading or launching.                  | P2       |
| Installable packages: DEB/RPM/APK/AAB/IPA/MSI/APPX/MSIX                   | ZIP-based entries where supported.                   | Manifests, permissions, architecture and signing metadata; no installation.                                           | P2/P3    |
| Language packages: JAR/WAR/EAR/NUPKG/WHL/EGG/PYZ/npm TGZ                  | Some have generic archive views.                     | Package/dependency/resource metadata without imports, hooks or builds.                                                | P2       |
| Development bundles: XCARCHIVE/XCODEPROJ/XCWORKSPACE, OCI/Docker archives | No complete semantic reader.                         | Build/project metadata and container layers/whiteout semantics without running tools or images.                       | P2/P3    |
| VM/disk artifacts: VMDK/VHD/VHDX/QCOW2/OVA/OVF/ISO/DMG                    | No general filesystem-aware service.                 | Bounded metadata and read-only contents; filesystem, encryption and sparse-image variants are separate work.          | P3       |

## Directional conversion backlog

Treat conversion as an explicit directed capability with preconditions and losses. Do not derive a
complete cross-product from a decoder list and an encoder list. Some destinations need a rendering
engine, some preserve structure, and some are reconstructions needing review.

| Direction                                                      | Current status                                                      | Next boundary to deliver                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Raster/RAW → common raster/PDF                                 | Selected routes exist.                                              | Reuse one qualified input catalog across quick, batch and layout tools; add TIFF and explicit animation/multipage choices.   |
| Video → audio; audio → audio                                   | M4A/WAV/FLAC export exists.                                         | Direct extraction, stream copy where valid, MP3/Opus/AIFF and track/channel choices.                                         |
| Video → video/frames                                           | MP4/MOV and PNG/JPEG frames exist.                                  | Additional containers/codecs, sequences and consistent stream preservation.                                                  |
| Audio/video → transcript/subtitles                             | Not implemented as a file workflow.                                 | Timed text, local/API engines, optional diarization, correction and durable export.                                          |
| Subtitle → subtitle/video                                      | Cue reading and sidecar playback exist.                             | SRT/VTT first, styling-aware ASS/TTML later; distinguish muxing, burn-in and bitmap OCR.                                     |
| Office/ODF/RTF → PDF                                           | Implemented for the declared Office family.                         | Fidelity checks and discoverability; additional native suites remain separate.                                               |
| Markdown/HTML/structured documents ↔ selected document formats | Rendering/source views exist, not a general interchange service.    | PDF/DOCX/ODT/EPUB/HTML/Markdown routes with explicit layout-versus-structure tradeoffs.                                      |
| Scanned PDF/images → searchable PDF/text/tables                | Reading/OCR evidence is not an export service.                      | Preserve page appearance, overlay aligned text, review uncertain text and export selected tables.                            |
| PDF → editable DOCX/XLSX or vector drawing                     | Not a general qualified route.                                      | Separate reconstruction service; disclose reading-order, table, font and geometry uncertainty.                               |
| Worksheets/tables ↔ CSV/TSV/JSONL/Parquet/Arrow                | Viewing exists for a subset.                                        | Sheet selection, types, locale, formulas-versus-values, missing data and nested-column handling.                             |
| ZIP/7z/TAR/compressed archives → another archive               | ZIP creation and limited extraction exist.                          | Verified member-by-member repackaging; preserve paths/metadata deliberately, never treat extraction as semantic conversion.  |
| Mesh/CAD → GLB/STL/OBJ/PLY/3MF/STEP/IGES                       | Preview plus specialized DXF/nesting output, not a general service. | Qualified geometry engine, units/materials/assembly checks; prohibit claiming recovered parametric intent from tessellation. |
| Calibrated raster/scan → SVG/DXF/reconstructed STEP            | Not implemented.                                                    | Trace/fit/review workflow and independent dimensional verification described above.                                          |
| GIS/scientific data → selected interchange/table/figure        | Not a general service.                                              | CRS/axes/units/types preserved or losses explicitly accepted; figures remain linked to source selections.                    |
| Mail/contacts/calendar → selected text/table/interchange       | Readers exist for a subset.                                         | Attachment, recurrence, encoding and timezone rules; prevent silent loss of records.                                         |
| Native creative project → PDF/SVG/raster/neutral scene         | Mostly composite/partial views.                                     | Versioned adapters and clear flattened-versus-editable output.                                                               |

## Optimization expansion

Offer **Optimize…** only where Viewer can explain the preserved properties and verify the output. A
file that is already compact can complete without a new copy. "Smaller" does not mean equivalent,
and a larger replacement does not count as an optimization success.

| Family                   | Baseline                                                        | Proposed work and verification                                                                                                                        |
| ------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| JPEG/PNG/WebP/AVIF       | Implemented, with defined presets and metadata choices.         | Broaden compatible inputs, compare decoded orientation/alpha/color, qualify animations and high-bit-depth variants.                                   |
| PDF                      | Structural optimization and selected image recompression exist. | Broader scanned-image cases; preserve text/vectors and disclose forms, tags and signature constraints. OCR is a separate operation.                   |
| Audio                    | Quality choices through media export; not unified Optimize.     | Bitrate/codec presets, optional resampling, chosen tags/channels and loudness changes kept explicit. Lossless audio cannot regain data lost upstream. |
| Video                    | Quality choices through media export; not unified Optimize.     | Quality/size targets, scaling, compatible codecs and stream retention; check duration, A/V sync, colors and subtitle presence.                        |
| SVG/animation/icons      | No unified optimization.                                        | Simplify representations with visual comparison; retain frame timings, transparency and externally meaningful IDs.                                    |
| Meshes/textures          | No unified optimization.                                        | Mesh reduction within a declared deviation, texture resizing/compression, material/UV/normal checks and model reopen. No tolerance-free "repair".     |
| Office/creative packages | No unified optimization.                                        | Optional embedded-image compression only through a qualified writer. Never blindly rewrite ZIP entries and claim document fidelity.                   |
| Archives/data stores     | ZIP compression exists; no general optimizer.                   | Appropriate codecs/levels, Parquet row groups or array chunking where meaningful; verify record values, schemas and access patterns.                  |
| Scientific/medical data  | No optimizer.                                                   | Preserve measurements exactly by default. Quantization, resampling, anonymization and geometry changes are separate reviewed transformations.         |

Use lossless at the correct level: identical file bytes, identical decoded samples/pixels, or
preserved document/geometry semantics are different promises. Never use one label for all three.
Keep before/after size, duration, parameters and any measured differences with the output operation.

### Optimize for a purpose

Add purpose-based profiles without multiplying format counts. A profile declares constraints and
preserved properties; it is not a hidden sequence of arbitrary quality reductions. The controls and
batch review belong to [delivery profiles](actions.md#delivery-profiles).

| Purpose                         | Proposed controls                                                                             | Success evidence                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Fit an attachment budget        | User-entered maximum size per file or for a package; dimensions and quality floor.            | Actual final bytes, readable/decodable output and an explicit unmet target when constraints conflict. |
| Publish images on the web       | Sizes, crop policy, format fallbacks, color space and metadata choice.                        | Correct dimensions/orientation/alpha, visual comparison and all declared variants present.            |
| Deliver a recording             | Compatible container/codec, resolution, audio tracks, subtitles and chapters.                 | Complete decode, duration/A/V sync, retained tracks and reopened captions.                            |
| Keep an archival copy           | Supported lossless representation, metadata and dependency preservation.                      | Reopened content and a manifest; no promise that a lossy source becomes lossless evidence.            |
| Use a 3D asset interactively    | Triangle, texture, draw-call or transfer-size budgets with geometry/material tolerances.      | Dimensions, bounded deviation, preserved UV/material behavior and renderer measurements.              |
| Work with large scientific data | Compression, chunking and spatial/column indexes appropriate to the requested access pattern. | Identical logical data where promised and measured access/memory improvement.                         |
| Prepare print or manufacturing  | Physical size, resolution, color and defined geometry requirements.                           | Units and dimensions checked; calibrated/qualified output, with unresolved issues visible.            |

Distinguish making bytes smaller from making a file faster to view or query. Adding an index or
tiles can increase size while improving interaction. Such an operation reports that tradeoff and is
not counted as a size-reduction success.

Use bounded candidate searches with a resource budget and a stop rule. Show the original beside
candidate output and expose changes that matter for its domain. No optimization should silently drop
animation, pages, subtitles, channels, precision, formulas, coordinate metadata or CAD detail.
Content hashes, decoded equality, perceptual comparison and geometric tolerance are different checks
and must be named accurately.

### Repair, restoration and reconstruction boundaries

Separate damaged-format recovery from content-changing enhancement. Candidate repair tools include
missing companion relinking, recoverable archive/document structure, media indexes, mesh normals or
holes and malformed encodings. Each needs an explicit supported failure mode and a new output copy;
"repair anything" is not a capability.

Denoising, deblurring, super-resolution, colorization, audio separation, inpainting and inferred
surface completion are optional content-changing services to investigate. Preserve the original,
label synthetic content and allow comparison. These must not quietly become an optimizer fallback or
provide evidence for a dimension, text passage or sound absent from the source.

## Shared architecture and adapter strategy

Extend the existing owners rather than adding a second file-access, job or permission service. This
section proposes the contract to design; it is not an implemented universal format system.

1. **One capability catalog over existing owners.** Describe canonical format IDs, aliases,
   signatures/variants, available representations, directed transformations, fidelity/losses,
   operating systems and required processors. Generate user-facing support tables and inventory
   reports from it. Keep actual decoder work lazy and out of registry imports.
2. **Domain representations.** Reuse bounded text, table, paginated-document, raster/frame,
   stream/timeline, transcript, mesh/solid, spatial-feature and multidimensional-array contracts. A
   universal JSON blob or conversion-to-PNG intermediate would discard too much meaning.
3. **Typed operation plans.** Specify inputs, source versions, selected pages/streams/entities,
   output constraints and destination before work starts. Integrate progress, cancellation, retries,
   new-file publication and recovery with existing file operations. Keep semantic reconstruction and
   model calls distinguishable from deterministic conversion.
4. **Isolated processors.** Run expensive/untrusted decoding in workers or bounded processes with
   cancellation, memory/time/output budgets and a shared concurrency budget. Do not freeze the UI or
   spawn an unrestricted search/transcode for every visible thumbnail.
5. **Companion resources.** Grant required textures, MTLs, fonts, sidecars, linked assemblies,
   scanner calibration and directory stores explicitly. References inside files do not grant
   filesystem or network access. Identify stale/missing companions in the result.
6. **Caches and provenance.** Key derived content by source identity/version, options and processor
   version. Reuse authorized cached work; revoke stale resources. Preserve the relation from a
   transcript segment, drawing entity or data slice back to its source.
7. **Optional processor packs.** Keep heavy science/CAD/speech engines out of the default install
   where practical. Use pinned, verified resources with clear size/platform/license requirements. A
   missing pack offers a specific setup choice; it never silently downloads or calls a cloud API.
8. **One interaction contract.** Offer relevant actions from Quick Preview, linked planes, command
   search and batch selection. Show applicable outputs, the few consequential options and a clear
   result. Keep implementation details out of the ordinary user flow.

Start from [preview extension guidance](../development/previews.md),
[the current architecture](../development/architecture.md),
[file operations](../reference/file-operations.md),
[speech ownership](../adr/0009-window-owned-speech.md) and [layout output](../reference/layout.md).
Preserve exact-scope approval and OS Trash for removals; new adapters, saved grants and agents
cannot create another removal route.

### Backend investigations

Reuse bundled engines before adding overlapping dependencies. An upstream's feature list is a
candidate list; the shipped build, licensing, resource behavior and Viewer integration determine
actual support.

| Track                        | Starting point or candidate                                                                                | Decision required                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Images                       | Existing sharp/libvips, system decoding and LibRaw processors.                                             | Reader/encoder variants, animation, metadata, color and platform parity.                                                                |
| Audio/video                  | Existing bundled FFmpeg/ffprobe.                                                                           | Actual enabled demuxers, decoders and encoders; network stays out of file conversion. New codecs require build and distribution review. |
| Office/PDF                   | Existing sandboxed ZetaOffice/LibreOffice layout, PDF.js and qpdf.                                         | Reuse layout/export paths; qualify any additional conversion filters or writers individually.                                           |
| Structured publishing        | Evaluate Pandoc alongside existing document rendering.                                                     | Structure-preserving routes versus exact layout, math/assets/fonts and bounded external-tool use.                                       |
| Archives                     | Evaluate libarchive against current archive ownership.                                                     | Read/write asymmetry, encryption, multipart support and extraction bounds.                                                              |
| Speech                       | Existing Whisper/provider services; evaluate an optional diarization pipeline.                             | Timed contracts, local footprint, model conditions and provider-specific capabilities.                                                  |
| Scan reconstruction          | Viewer-owned calibration/fitting with existing geometry/layout owners; optional upstream interoperability. | License/API suitability, deterministic measurements, calibration and independent output verification.                                   |
| CAD/BIM                      | Existing OCCT importer; evaluate richer OCCT and IFC-specific adapters.                                    | Topology/semantics, version/PMI support, native distribution and licensed formats.                                                      |
| GIS                          | Evaluate GDAL/OGR drivers.                                                                                 | Distinct read/write drivers, CRS handling, sidecars and disabled automatic remote access.                                               |
| Arrays/tables                | Evaluate Arrow/DuckDB/HDF5 and format-specific scientific readers.                                         | Typed windowed reads, compression/layout variants, runtime footprint and safe deserialization.                                          |
| Volumes/CAE                  | Evaluate domain readers and dedicated volume/field rendering.                                              | Orientation/units/fields, multi-file behavior and version-specific correctness.                                                         |
| Native creative/vendor files | Documented export APIs or qualified licensed adapters.                                                     | Actual demand, supported versions, fidelity and redistribution terms before a delivery promise.                                         |

References for these investigations include
[LibreOffice's conversion filters](https://help.libreoffice.org/latest/en-US/text/shared/guide/convertfilters.html),
[Pandoc's conversion model and limits](https://pandoc.org/MANUAL.html),
[libarchive's reader/writer overview](https://www.libarchive.org/), and GDAL's
[raster](https://gdal.org/en/stable/drivers/raster/index.html) and
[vector](https://gdal.org/en/stable/drivers/vector/index.html) driver tables. Availability in these
projects does not imply that all their features belong in Viewer's default package.

### Ambiguous suffixes

Use content signatures, manifests, schema roots and format versions to resolve these cases. When
identification is inconclusive, offer the known representations and explain the missing decoder.

| Suffix                       | Meanings to distinguish                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| VCF                          | Contacts and genomic variants.                                                                            |
| SDF / XYZ                    | Molecular data, simulation descriptions and point-cloud coordinates, depending on the suffix and content. |
| NC / PDB                     | CNC versus NetCDF; molecular structure versus program-debug data.                                         |
| FIG / KEY / PUB              | Design or mathematical figures; presentations/publishing versus cryptographic keys.                       |
| LIB / IMG / BIN              | Circuit libraries, static libraries, rasters, disk images, firmware and unidentified bytes.               |
| PRT / ASM / BRD / SCH / MSH  | Multiple unrelated vendor and version families.                                                           |
| RST / TS / MTS               | Source text versus solver results or media streams.                                                       |
| JSON / YAML / XML / ZIP / DB | Generic containers shared by many semantic formats; not a domain identifier by themselves.                |

## Delivery sequence and completion gates

| Wave                       | Deliverable                                                                                        | Completion gate                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Foundation                 | Current capability audit, generated catalog design and versioned coverage corpus.                  | Counts reproducible; aliases and partial readers separated; every task has an expected result and owner.                            |
| P1 media                   | Direct extraction, additional audio outputs, file transcription, SRT/VTT and optional diarization. | Real-file export/reopen, saved corrections after restart, bounded long jobs and qualified local/provider behavior.                  |
| P1 everyday                | Consistent image inputs, document/data exports, searchable-PDF work and broader archives.          | Batch recovery and fidelity cases pass; existing previews and Office-to-PDF behavior remain intact.                                 |
| P2 professional foundation | Mesh/CAD exports, scan-to-DXF slice, IFC, point clouds, GIS and columnar data.                     | Units/coordinates/identifiers survive export; calibration and source evidence remain attached; stale inputs cannot pass as current. |
| P2 domain packs            | Science volumes/arrays, robotics/CAE, PCB/toolpaths and deeper creative readers.                   | Each discipline has a meaningful complete workflow and its own quality/resource evidence.                                           |
| P3 native breadth          | Selected proprietary CAD, creative projects, mail stores and disk formats.                         | Decoder/version coverage, licensing and performance settled before advertising support.                                             |

Diarization evaluation and a Viewer-owned scan-calibration prototype can start early, but neither
should block the first reliable audio-extraction and timed-transcript release. ScanRuler integration
is optional. DWG feasibility should also start early because of engineering demand, while
implementation depends on a qualified decoder decision.

For every promoted capability:

- Test representative real files and adversarial variants, including wrong extensions, corruption,
  encrypted inputs, missing resources and expansion/resource limits.
- Reopen the output with an independent reader where possible. Compare samples, pages, records,
  timings, dimensions or geometry against the source and declared transformation.
- Exercise cancellation, source changes, revoked access, partial failures, unavailable processors,
  restarts and repeated preview open/close. Preserve completed outputs and reviewed edits.
- Measure first-preview latency, steady-state memory, CPU/GPU usage, batch throughput and idle
  behavior on each claimed platform. Large files need streaming/windowing, not unbounded loading.
- Verify orientation/color/alpha for images; layout/text for documents; duration/sync/streams for
  media; schema/types for data; units/topology/deviation for geometry.
- Update the canonical current reference and guide only after implementation and qualification. Keep
  run-specific results in qualification artifacts, not in this roadmap.

The first demonstration set should include a video converted to audio and reviewed subtitles, a
scanned document made searchable, an Office file exported to PDF, a calibrated part traced and
remeasured after DXF export, and a specialist data/model file inspected with its structure intact.
These workflows show service quality that a large nominal conversion count cannot establish.
