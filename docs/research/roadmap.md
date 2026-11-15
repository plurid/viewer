# Product priorities

Viewer should remain easy for everyday work while gaining depth in the tools people already use.
**Next** is the working order. The sections after it are directions, not a release schedule.

## Next

A person has to be able to try Viewer, like its first hour and pay for it. The order follows that.

1. **Sell Viewer.** A free trial, then a license key bought once and checked on the Mac, with
   nothing sent anywhere. After the trial Viewer keeps working and shows a reminder.
   [The paid build](paid-build.md) has the rules and what stays out.
2. **Close the first-hour gaps.** Paste a picture as a file, go to a folder by habit and a report
   that is safe to share. Then Help that opens without a network, more archive formats and visible
   tags. [File-manager gaps](file-manager-gaps.md) gives each one's current state.
3. **Run the checks only a person can run.** Use Viewer as the only file manager for two days.
   VoiceOver and keyboard-only passes through the main flows, dictation with a real microphone, one
   request to each hosted provider, and native acceptance on an Intel Mac, which
   [platform status](../reference/platforms.md) lists as open.
4. **Make the laser-job check confirm what it finds.** In the last live evaluation the check found
   every planted problem, yet Viewer confirmed fewer than a third of them, and no hole pitch or
   thickness at all. It also asked for a review of about one requirement per run that was not a
   problem. Read the retained answers first. Then verify each requirement from the drawing's own
   text at the place the model points to, so a grade stops depending on how the model words its
   quote. [Answer and grading](../reference/fabrication.md#answer-and-grading) owns the rules.
5. **Finish the everyday media tasks.** Audio extraction as a direct action, file transcription with
   reviewed subtitles, and a first [3D video preview](formats.md#stereoscopic-and-immersive-video).
6. **Earn trust before asking for attention.** Publish how Viewer is built and tested, with measured
   startup time, memory and idle energy for the release build, and offer a Homebrew tap beside the
   disk image.

## Make the existing experience dependable

Continue long-session resource audits, real-file qualification, source-change recovery and complete
workflows. Test native permissions, external disks/providers, window restoration and accessibility
in actual platform builds. Keep UI input, document lifetimes and runtime lifetimes distinct.

The current implementation already includes worktrees/tasks, hunk review, parameterized commands,
reported agent sessions, Journal and focused creative tools. Future planning must start from that
[current capability map](../reference/capabilities.md).

## Deepen everyday tools

Complete the common file-processing tasks: direct video-to-audio extraction, broader audio exports,
long-file transcription, reviewed subtitles, optional speaker labeling, consistent image conversion,
searchable-document export and broader archives. Existing Office-to-PDF, media editing, PDF tools
and optimization are foundations to deepen, not features to rebuild from zero.
[File-manager gaps](file-manager-gaps.md) lists the smaller features people expect from any file
manager.

Improve search discovery, large-folder handling, metadata and preview fidelity alongside those
tasks. Treat fonts/layout, codecs, animated/multipage images and domain-specific data loss as
concrete qualification work. Measure completed tasks and correct outputs separately from format
counts.

## Build the file-processing suite

Use one capability catalog and existing operation/workflow owners for conversion, extraction,
assembly, optimization, recognition, comparison, repair and delivery. Start with direct contextual
actions and batch tables; linked planes and a visual sequence builder are deeper ways to use the
same contracts.

The [file workflow specification](actions.md) defines purpose-based delivery profiles, typed
file-to-file connections, loss-aware review, reusable tools and portable packages. High-value
additions are source-linked deliverables that can be refreshed without losing edits, semantic
comparison across formats, and a recipient preview that exposes missing dependencies before export.
More speculative restoration and native adapters follow their own feasibility gates.

## Expand file ecosystems

The [format roadmap](formats.md) owns the audited baseline, projected scale, per-discipline matrix,
directional conversion backlog and optimization contracts. Its proposed sequence covers everyday
gaps, then CAD/BIM, point clouds, GIS, columnar/scientific data, robotics, PCB/toolpaths and deeper
creative formats. Proprietary versions and licensed readers remain explicit investigations.

Preview 3D video properly. Side-by-side and over-under films, Apple spatial video and 180° or 360°
clips should open at their true shape, with a choice of one eye, both or anaglyph, and a look-around
view for the wide formats. The format roadmap's
[stereoscopic and immersive video](formats.md#stereoscopic-and-immersive-video) section gives the
first slice and what the bundled FFmpeg already allows.

The 90% everyday preview and 80% common conversion/optimization goals require a representative task
corpus with fixed denominators. Neither a decoder's presence nor a thumbnail proves semantic
support. Report qualified operating systems and professional disciplines separately.

## Connect work through space

Connect sources, selected regions, transformations, editable results and verification in space.
Examples include a recording beside its timed transcript, a drawing beside a measured CAD part, and
a dataset beside an interactive figure. Preserve exact source selections and reviewed edits when
creating quote chats or refreshing derived work. Keep ordinary focused use available.
[Spatial development](spatial-development.md) describes where extra space can improve comprehension.

## Share a useful result

Prioritize a portable local handoff with chosen outputs, companions, a manifest and checks that
survive reopening without the source workspace. Then explore links to local references, immutable
snapshots and later live content. [Sharing](sharing.md) keeps publishing, access and lifetime
separate from making a local package.

## Investigate physical workflows

Build a Viewer-owned calibrated scan-to-vector/CAD workflow: trace and review a flat scan, export
SVG/DXF, independently remeasure it, then deepen into fitted surfaces and reviewed solids. ScanRuler
is a reference and an optional interoperability candidate, not a required dependency. Distinguish
measured geometry, inferred reconstruction and generated visual assets.

Viewer Workshop connects source documents, models, generated tools and verification around a task.
Bounded robot controls, target checks and comparison are implemented; the mounting-specific
geometry, generated fabrication controls and mock service handoff need integration or qualification.
The [strategy and implementation audit](workshop.md) records those boundaries.
[Job 1042](fabrication-workflow.md) remains a separate fabrication workflow.
