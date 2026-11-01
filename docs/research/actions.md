# File workflows and composable tools

This is the proposed interface and execution design for Viewer's file-processing suite. The
[format roadmap](formats.md) owns the input/output families, conversion directions, optimization
work and qualification criteria. Proposed labels and contracts here are not current command names or
valid additions to the existing workflow schema.

Current custom actions already support conditions, parameters and ordered composition. Current
workflows support typed inspection/comparison and reviewed copy, conversion and recipe steps, with
saved run state. Watch rules can prepare a review. Start from the
[action reference](../reference/actions.md), [workflow reference](../reference/automation.md) and
[file-operation owner](../reference/file-operations.md); extend them instead of creating a second
executor or permission system.

Read [the core experience](#start-with-the-result),
[file-to-file interfaces](#file-to-file-interfaces), [delivery profiles](#delivery-profiles),
[composable operations](#typed-results-and-connections),
[additional services](#additional-services-worth-building) or
[delivery priorities](#delivery-priorities).

## Start with the result

A person should be able to say what they need: extract the sound from a recording, make a document
searchable, fit an attachment budget, compare two drawings or prepare a model for the web. Offer a
short direct path for that task, then let the reviewed operation become a reusable tool.

1. Select one file, several files, a folder, or a region/page/track inside a preview.
2. Choose the operation or intended result. Show only applicable formats and explain specific
   blockers such as no audio track or missing units.
3. Resolve consequential choices: which content, what must be preserved, output destination and any
   local/model/provider requirement. Keep advanced settings behind an explicit control.
4. Preview the result or a representative sample, with expected losses visible. A sample is not a
   full-file validation result.
5. Run through the existing operation owner. Show progress for work that lasts, not a header flash
   for every tiny operation. Leave durable results discoverable in file operations and the
   workspace.
6. Open or compare the output beside its source. Offer to reuse the settings on another selection or
   save a recipe.

The same operation should be reachable from context menus, the command panel, preview tools, batches
and supported agent proposals. These are entry points to one contract, not separate implementations
with different validation.

## File-to-file interfaces

A file-to-file interface connects an explicit selection from one or more sources to an operation and
its outputs. It does not mean dragging any file onto any other file and guessing what to do. Spatial
connections are optional; focused forms and tables must complete the same work.

### Four interaction levels

| Level             | Intended experience                                                     | Example                                                                   |
| ----------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Direct action     | A small form with a sensible default and a visible destination.         | MP4 → selected audio track → M4A.                                         |
| Batch workbench   | A table of inputs, outputs, per-item options, warnings and status.      | A folder of images → web sizes, plus original-resolution archival copies. |
| Linked planes     | Source, transformation controls, output and comparison remain adjacent. | Scanned gasket → calibrated trace → DXF → dimensional comparison.         |
| Reusable workflow | A saved typed sequence with bindings and review points.                 | Recording → audio → transcript → reviewed captions → delivery package.    |

Opening a tool does not have to open several planes. Let the person expand a completed simple
operation into the richer views when context helps.

### Define the relationship

| Connection          | Meaning                                                           | Selection that must stay explicit                                                            |
| ------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Convert             | Change the representation of the chosen content.                  | Destination format and loss/preservation contract.                                           |
| Extract             | Select part of a source without claiming to reproduce everything. | Pages, time range, stream, layer, worksheet, table, attachment, entity or dataset slice.     |
| Assemble            | Combine compatible selections into a new output.                  | Order, alignment, transitions, layout, units and handling of duplicates.                     |
| Compare             | Inspect differences without changing either source.               | Matching rule, domain and tolerance.                                                         |
| Apply as a resource | Use one file to inform a transformation of another.               | Role: subtitle, audio track, schema, LUT/profile, texture, reference drawing or calibration. |
| Derive              | Create new facts or content from a source.                        | Recognition/inference method, uncertainty and whether review is required.                    |
| Package             | Collect a reviewed result and its selected dependencies.          | Recipient needs, included resources and export manifest.                                     |

Examples of resource connections include a subtitle file attached to a selected video, a color
profile applied to an image, a schema used to interpret binary records, or a reference drawing
compared with a CAD part. A filename relationship is a suggestion until content and scope agree.

### Selections inside files

Persist a selection using source identity/version and a typed locator, not just a path or a screen
coordinate. Locators may identify page numbers and rectangles, worksheet/range, stream/time range,
subtitle cues, layer IDs, mesh/entity IDs, spatial bounds or dataset axes/slices.

Show the selected extent in the source view. A coordinate alone is insufficient after a document
reflows or geometry changes. Revalidate the locator after a source change; offer remapping or a new
selection when its meaning is no longer established. Text quotes and time ranges should reopen the
relevant source, not a detached screenshot of it.

### Batch workbench

Show input, requested output, actual format/variant, parameters that differ from the batch default,
estimated work, warnings, destination and outcome. Group compatible files and report unsupported
items independently. Do not let one damaged file hide every successful result.

Allow one-to-one, one-to-many, many-to-one and package outputs only when the operation declares that
cardinality. Page extraction, multitrack export, contact sheets and PDF merging have different
output rules. Naming templates must resolve collisions before publication and retain the actual
output names chosen during review.

Offer a dry run that probes formats, estimates size/time where possible, lists missing components
and shows proposed writes without starting expensive inference or conversion. Estimates must say
when they come from a sample and cannot guarantee final cost or output size.

## Delivery profiles

A delivery profile describes what the recipient or destination needs. It can constrain format,
maximum size, dimensions, codecs, channels, physical units, embedded resources and preservation
requirements. It is not a credential, a destination grant or authority to publish anything.

| Proposed profile          | Output set                                                                        | Essential review                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Email or upload           | Compatible copies within a user-entered attachment budget.                        | Actual size and quality; report an impossible budget without silently discarding content.                |
| Web images                | Responsive sizes, declared fallback formats and optional contact sheet.           | Crop/alpha/color, attribution, location metadata and consistent filenames.                               |
| Lecture or interview      | Audio copy, editable transcript, SRT/VTT, optional chapters and captions.         | Track selection, timing, speakers, uncertain words and original-language versus translated text.         |
| Document packet           | Ordered PDF, searchable text and selected attachments or extracted tables.        | Page order, legibility, text alignment and any removed interactive features.                             |
| Print package             | Appropriate page size, bleed/margins, color resources and assets where supported. | Physical scale, fonts/images and the printer's explicitly supplied requirements.                         |
| Interactive 3D            | Selected GLB/glTF or other qualified target, textures and preview.                | Units, dimensions, materials, triangle/texture budgets and animation losses.                             |
| Fabrication package       | Reviewed geometry, drawing, cut sheets, quantities and checks.                    | Dimensions, material/thickness, units, unresolved issues and machine-specific assumptions.               |
| Research handoff          | Selected data, schema, units/coordinates, figure and processing record.           | Exact source selections, transformations and reproducibility within the available readers.               |
| Archival or portable copy | Qualified open representations, chosen originals and dependencies.                | What is preserved, what is flattened, and whether the package reopens without the originating workspace. |

Provide editable generic profiles first. Branded platform or machine presets need a versioned source
of requirements and independent output checks; do not invent limits or quietly change an existing
saved profile when a service changes.

## Conversion planning and output review

The capability catalog should answer both “what can this become?” and “what would be lost?”. It must
distinguish a decoder, an encoder, an exportable domain representation and a model-assisted
reconstruction. A successful file probe does not imply an available writer.

For a requested target, prefer a qualified direct route. If a chain is necessary, show each stage,
its intermediate representation and cumulative losses before running it. Bound the route search,
reject cycles and validate the selected plan. Do not route a vector or structured document through a
raster image unless the requested result explicitly accepts flattening.

| Preservation dimension | Examples to inspect before publishing                                           |
| ---------------------- | ------------------------------------------------------------------------------- |
| Appearance             | Layout, fonts, orientation, color, transparency, layers and animation.          |
| Content and structure  | Text, tables, formulas versus cached values, links, records and attachments.    |
| Time                   | Duration, sample/frame rate, offsets, audio/video sync, subtitles and chapters. |
| Geometry               | Units, scale, coordinates, topology, surfaces, holes and declared tolerances.   |
| Scientific meaning     | Types, precision, missing values, calibration, axes, CRS and measurement units. |
| Context                | Credit, licensing fields, timestamps and chosen metadata/dependencies.          |

A conversion preview should show expected losses before execution and observed results afterward.
For example, a spreadsheet-to-CSV export can retain one worksheet's chosen values while losing
formulas, formatting and other sheets. That is a valid reviewed extraction; it must not be reported
as a complete workbook conversion.

Use side-by-side, overlay, difference heatmap, waveform/timeline or semantic table comparison as
appropriate. Add an independent reader or measurement where feasible. “Written,” “reopened,”
“compared within tolerance” and “approved by the person” are distinct evidence states. A format that
cannot be independently verified should say so without claiming a successful semantic match.

## Typed results and connections

Extend the existing workflow engine with typed results and explicit selectors. Do not interpret
stdout, a filename convention or model prose as an authorized instruction stream.

Proposed result types include:

| Result type                   | Example downstream use                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| File set or package           | Convert selected members, verify dependencies, prepare a handoff.                   |
| Table or records              | Filter rows, join explicit keys, chart values or export a chosen schema.            |
| Document selection            | Extract pages/text, apply reviewed OCR or assemble a packet.                        |
| Audio/video selection         | Extract a stream, align captions or transcribe a marked interval.                   |
| Timed transcript              | Correct words, select quotes, create subtitles or derive chapters.                  |
| Image/layer selection         | Crop, compare, composite or derive a reviewed vector trace.                         |
| Geometry/spatial selection    | Measure, fit, compare, tessellate or export selected entities.                      |
| Array/data slice              | Compute a permitted transformation, render a figure or export a typed subset.       |
| Findings or validation report | Present issues, request a decision or gate a dependent output.                      |
| Proposed changes              | Review exact writes and conflicts before the existing operation owner applies them. |

A proposed step contract needs the capability/version, typed inputs, source versions and selectors,
parameters, output cardinality/types, preservation rules, required resources, local/provider mode,
review points and verification method. Implementation belongs with each existing feature owner; the
workflow engine coordinates dependencies and outcomes.

Connections should reject incompatible types before work starts. A table of dimensions cannot
silently become a calibrated CAD part, a summary cannot become an exact transcript, and a rendered
thumbnail cannot satisfy a full-document input. An explicit reviewed adapter can bridge types only
when its limits are declared.

Expose branching and joins after a linear sequence works well. Conditions consume validated results,
not unconstrained code. Fan-out batches and expensive branches share concurrency/resource limits.
Any aggregation must define ordering and behavior when one input fails. A failed verification may
keep a candidate for inspection, but cannot silently mark a dependent manufacturing or archival
handoff complete.

## Reusable recipes and personal file tools

Let a person save the parameters and declared inputs of a reviewed operation as a recipe, then use
it from a menu, shortcut, command search or folder-specific tool. A recipe should not capture an API
key, consent grant, arbitrary absolute path or a previously approved removal.

An advanced builder can expose the sequence as a list or connected planes. Show named input slots,
plain-language parameters, an output preview and review points. Keep the stored definition
inspectable and versioned. A generated interface may arrange these existing controls, but it cannot
invent privileged operations or broaden the underlying tool permissions.

Examples include “Prepare shop drawings,” “Make lecture notes,” “Export website images,” “Compare
supplier revisions” and “Create a research handoff.” Share a recipe definition separately from its
input data. Importing one does not install processors, execute commands or grant file access.

Natural-language requests can prepare the same typed plan. Before execution, show what will be read,
written and sent to a provider. Deterministic conversions should not require an LLM subscription. An
AI-generated parameter or geometry proposal follows the same validation and review as a manual one;
plausible prose is not evidence that a check passed.

## Source-linked outputs and refresh

Save the relationship between source versions, selected content, transformation parameters,
processor/model version, reviewed edits and produced files. The visible relation should be easy to
follow in either direction: “where did this come from?” and “what depends on this file?”.

When a source changes, mark affected outputs stale and offer a refresh plan. Recompute only the
necessary descendants. A manual transcript correction or tracing constraint must survive as an edit
to reconcile, not disappear because a model ran again. If a published output was edited outside
Viewer, preserve it and offer a new version or a review of conflicts.

Watch rules should prepare this plan using their existing review boundary. Opening a workspace,
reconnecting an agent or loading a recipe never replays jobs. Restore the views and state first;
resume local work or repeat a paid call only through the appropriate explicit run decision.

A dependency view should distinguish a source reference, cached rendition, proposed output, verified
output and manual edit. Paths alone are not authority or durable identity. Relinking a moved
dependency requires identity checks, and a missing dependency stays visible.

## Job lifecycle, recovery and performance

Use the existing file-operation and workflow owners for persistence, progress and mutation. Extend
their state models only where a new operation needs it. Proposed service phases include probe,
awaiting requirements/review, queued, processing, verifying and completed, with failed, cancelled,
interrupted or completed-with-issues outcomes when appropriate.

Record enough state to explain which outputs were actually published, which checks ran and which
steps remain. A batch may finish partially; rerunning it should not overwrite successful outputs or
repeat completed paid work by default. Provider jobs need submission IDs where available and a
reconciliation step after interruption. Do not promise exactly-once remote execution when a provider
cannot establish whether a request succeeded.

Publish outputs through staged writes and existing conflict handling. Verify sources again before
publication, and retain actual output identities for guarded Undo. A directory of outputs needs a
manifest of completed and failed members; partial results must not masquerade as a complete package.
Output or temporary-file removal follows the exact-scope approval and OS Trash policy. A workflow
cannot attach automatic cleanup that bypasses it.

Heavy decoders, model inference and encoders share explicit CPU/GPU, memory, temporary storage and
concurrency budgets. Prioritize foreground inspection, allow cancellation and stop work when no
consumer remains. Bound speculative thumbnails and previews; avoid a processor per visible row.
Resource use should return to the documented idle level when work finishes.

Estimate duration, storage and provider cost where enough evidence exists, and report actual work
separately. Cache keys include source/version, options and engine version, and every reuse still
requires authority to the source. Cache absence must not make saved projects unreadable when their
published outputs and project state remain available.

## Delivery packages and a recipient preview

A package should contain the chosen outputs, a manifest, necessary companion resources and an
optional static overview. Include checksums, declared formats, creation parameters and validation
results. Original sources are included only when selected; a package must not sweep in a whole
workspace because assets happen to be nearby.

Provide an “open as recipient” view before export. Test it without the originating workspace, caches
or unrelated file grants. Missing textures, fonts, linked sheets, captions and scientific sidecars
should be caught before handoff. Show unresolved checks as unresolved.

Use ordinary readable outputs alongside any Viewer-specific project. The manifest identifies what
needs Viewer and what can be opened elsewhere. Export/import of selected evidence is separate from
provider credentials, grants, private notes and full conversation history. A later live share uses
its own [sharing authority](sharing.md); a local delivery package is not permission to upload it.

## Additional services worth building

These are proposed services, not a commitment to implement them all before the core suite works.
Prioritize complete tasks with measurable outcomes over a menu of disconnected demos.

| Idea                               | Concrete experience                                                                                                                | Priority and dependency                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Destination-first export           | “Make these suitable for this upload,” then review a compatible output set and measured size.                                      | P1; capability catalog, profiles and verification.                         |
| Loss-aware comparison              | Show what changed after conversion: missing sheets, flatter geometry, shifted colors, altered timing or reduced precision.         | P1 foundation, P2 domain depth.                                            |
| Transcript-based media selection   | Select a passage in the transcript to mark a clip, produce captions or open a quote chat beside the original moment.               | P1/P2; durable timed text and media edits.                                 |
| Contact sheets and review indexes  | Create image/video contact sheets, waveform overviews or model thumbnails linked back to the selected originals.                   | P1/P2; layout plus bounded extraction.                                     |
| Format diagnosis and repair        | Explain why a file fails, locate a missing companion, and offer a verified repaired copy for a supported failure mode.             | P2; domain diagnostics and qualified writers.                              |
| Source-linked deliverables         | Update a drawing or recording, inspect which outputs became stale, and refresh only affected work without losing edits.            | P2; durable provenance and conflict handling.                              |
| Cross-format semantic comparison   | Compare PDF with DOCX, a table with a workbook, a drawing with a DXF, or a scan with reconstructed CAD.                            | P2; stable selectors and explicit tolerances.                              |
| Editable scientific/creative views | Turn a selected dataset into an interactive plot or a model into a section view, keeping controls and source citations in a plane. | P2; typed data bindings and sandboxed presentation.                        |
| Portable handoff verification      | Reopen a package as the recipient, with dependencies and checks visible before it leaves the machine.                              | P1/P2; manifests and isolated reopen.                                      |
| Search across understood content   | Find spoken phrases, table fields or CAD properties and open the exact time, row or entity.                                        | P2; reuse existing search ownership and scope.                             |
| Accessible deliverables            | Review OCR reading order, captions, descriptions and supported document structure before export.                                   | P2; qualification by output type, not a blanket accessibility claim.       |
| Reviewed redaction                 | Remove selected sensitive content and metadata, then inspect the exported bytes/rendered result for remnants.                      | P2/P3; domain-specific removal from the output, not a painted rectangle.   |
| Change-aware document extraction   | Extract tables, forms or invoice fields with locators, corrections and a trace back to each source value.                          | P2; explicit schemas and uncertain-value review.                           |
| Point-cloud/scan workspace         | Calibrate, fit, measure, compare and export a reviewed profile or solid through a Viewer-owned workflow.                           | P2; numerical checks and geometry engine.                                  |
| Media cleanup and restoration      | Optional denoising, source separation or image enhancement with an original/result comparison.                                     | P3; separate model/processor qualification and generated-content labeling. |

The first five product bets are destination-first export, direct audio extraction and timed
transcription, loss-aware review, calibrated scan-to-DXF, and a portable handoff that reopens with
its evidence. They reuse existing strengths and each has a clear observable result. Broader repair,
restoration and proprietary adapters should follow their own feasibility work.

## Delivery priorities

| Stage                          | Scope                                                                                                              | Completion evidence                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Contract and direct actions    | Capability/route discovery, captured selections, preservation rules, output review and existing owner integration. | One image conversion and one audio extraction work from preview, command and batch entry points with consistent behavior. |
| Transcription and profiles     | Durable timed text, SRT/VTT, selected provider/local execution and initial delivery profiles.                      | Transcript corrections, timing and outputs survive restart; media and captions reopen in sync.                            |
| Batch and reusable tools       | Mixed batches, naming/collisions, typed linear sequences and saved parameter forms.                                | Partial failures are recoverable; importing a recipe runs nothing; repeated use keeps reviewed behavior.                  |
| Relationships and verification | Source-linked outputs, stale-state detection, loss-aware comparison and recipient packages.                        | Source changes invalidate relevant checks; manual edits survive; recipient reopen catches missing dependencies.           |
| Professional connections       | Scan-to-DXF/CAD, BIM/PCB/scientific selections and richer semantic comparisons.                                    | Independent measurements and domain-specific fidelity gates pass on representative real files.                            |
| Advanced composition           | Branching, joins, optional model inference and qualified native adapters.                                          | Type-invalid paths are rejected, budgets are enforced and every result retains its actual evidence state.                 |

Keep this sequence aligned with the
[format delivery waves](formats.md#delivery-sequence-and-completion-gates). The existing workflow
schema remains authoritative until a reviewed migration and implementation extend it. New
architecture decisions belong in ADRs when adopted; this page records proposals.

## End-to-end qualification stories

1. **Recording to reusable knowledge.** Select a video with two audio tracks, extract the chosen
   one, transcribe locally, review speaker/timing edits, export SRT/TXT and reopen the media with
   captions. Restart and verify the reviewed state; change the source and confirm alignment is
   marked stale.
2. **Images to delivery.** Process a mixed folder with animation, transparency and a damaged input.
   Produce the requested variants within stated constraints, preserve required metadata, compare
   samples, recover the failed item and report any unmet size target honestly.
3. **Paper to editable evidence.** OCR a scan, correct a table cell, export searchable PDF and a
   typed table, then reopen both and locate the corrected value in the original region.
4. **Scan to fabrication.** Calibrate a flat-part scan, review the fitted contours, export DXF,
   independently remeasure it and prepare a package. An ambiguous dimension must stay unconfirmed
   and prevent the handoff from claiming a passed dimensional check.
5. **Changed sources to updated outputs.** Run a saved linear recipe, edit a source and a published
   output externally, then refresh. Only dependent work is proposed, the manual output is preserved
   and a conflict is presented instead of silent replacement.
6. **Specialist data to portable review.** Select a scientific slice or CAD entity, produce a figure
   or neutral export with its units and selection record, and reopen the package without the
   original workspace or cache.

Across these stories, test cancelled jobs, resource limits, changed inputs, missing processors,
revoked access, unavailable providers, Unicode paths and interrupted publication. Keep run-specific
measurements in qualification artifacts. Promote the resulting behavior to the current guides and
references only after implementation and platform qualification.
