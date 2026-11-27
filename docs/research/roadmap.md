# Product priorities

Viewer should remain easy for everyday work while gaining depth in the tools people already use.
**Now**, **Next** and **Later** give the working order. The sections after them are longer-term
directions, not a release schedule.

## Now

The review's fix waves are over. They closed every finding of the highest severity and most of the
next, across agents and actions, operations and the Trash engine, previews, windows and saved state,
files and native helpers, models and speech, settings and commands, the CLI, license, updates and
build, persistence, the explorer and workspaces, and canvases, Git and runtimes. What remains is
listed in [Review findings](../development/findings.md) and is fixed when a person meets it or when
it blocks a release. The layout, fabrication and media items are the largest group left.

1. **Keep every push green.** The source checks on GitHub run types, lint, formatting and the whole
   suite; a red run is fixed before anything else.
2. **Use the packaged build.** Each build is run through every
   [review scene](../development/review.md) and its changed screens are looked at before it is
   handed over; what the owner meets in daily use goes to the findings page or is fixed at once.
3. **Qualify what only a real run can.** The hidden-window native scenarios and `electron-smoke`,
   and a signed Mac App Store build with dictation (the Store entitlement and sandboxed helper are
   written and unit-tested, not yet run signed) ([Testing](../development/testing.md),
   [Release gates](../development/releases.md)).
4. **The improvements left from the interface audit**, when there is room: dragging to reorder PDF
   Tools pages, tour times with their unit, readable megapixel choices, hiding the update row in
   Store builds, turning off the Git column option while Git is off, one place for Tree and Source
   in the structured tree header, and disabled menu-button rows.

## Next

Ship the first public alpha (`0.1.0-0`, then `0.1.0-N`, never `1.x` for the direct build; see
[Alpha versioning](../adr/0019-alpha-versioning.md)) and close the gaps people meet in their first
days:

1. **Owner steps for release 0.1.0-0.** The offline 30-day trial, key verification and post-trial
   reminder are built and stay off until configured ([The paid build](paid-build.md),
   [License reference](../reference/license.md)). Before shipping 0.1.0-0, the owner writes the
   release notes, generates the license key pair, sets up the payment link and seller details, signs
   and notarizes the direct build, updates the website and settles the source license question
   against paid keys ([Release gates](../development/releases.md)).
2. **Run the checks only a person can run.** Use Viewer as the only file manager for two days, run
   VoiceOver and keyboard-only passes through the main flows, test dictation with a real microphone,
   send one live request to each hosted provider and qualify native acceptance on an Intel Mac
   ([Platform status](../reference/platforms.md),
   [Usability protocol](../development/usability.md)).
3. **Close the first-hour gaps.** Bundle offline Help inside the app, support more archive formats
   and show Finder tags in folder views ([File-manager gaps](file-manager-gaps.md)).
4. **Make the laser-job check confirm what it finds.** Verify each requirement from the drawing's
   own text at the place the model points to so grading stops depending on how the model words its
   quote, and reduce false-positive reviews
   ([Answer and grading](../reference/fabrication.md#answer-and-grading)).
5. **Finish everyday media tasks and earn trust.** Add direct one-step audio extraction, long-file
   transcription with reviewed subtitles, a first
   [3D video preview](formats.md#stereoscopic-and-immersive-video), published release measurements
   (startup time, memory and idle energy) and a Homebrew tap beside the disk image
   ([Performance audits](../development/performance.md)).

## Later

Planned features and deferred improvements not yet started:

1. **Learned workspace arrangements.** Deleting an ad-hoc workspace built mostly inside one project
   remembers its planes in that project's workspace with an Undo notice, alongside carriers for open
   workspaces and **Save as Definition…** for a found workspace
   ([Found workspaces](../adr/0021-found-workspaces.md),
   [Defined workspaces](../adr/0020-defined-workspaces.md)).
2. **Terminal starts for declared commands.** A stopped terminal plane lists the folder's declared
   command lines; starting one is remembered and offered on reopen behind a one-time approval
   ([Declared commands](../adr/0022-declared-commands-are-typed-lines.md),
   [Terminals reference](../reference/terminals.md)).
3. **Remote planes, packages 4 to 14.** Packages 1 to 3 (location model, SFTP v3 client and OpenSSH
   transport) are built behind `VIEWER_REMOTE=1` in the direct build, with rechecks of the SFTP
   client and SSH transport due before resuming. Packages 4 to 14 add desktop read routing (4),
   browsing UI (5), previews (6), server Trash and Undo (7), same-server operations (8), Mac and
   server transfers (9), clipboard and drag (10), remote terminals (11), remote filename search
   (12), NetFS WebDAV (13) and real-`sshd` qualification with the gate removed (14)
   ([Remote planes](remote-planes.md),
   [ADR 0023](../adr/0023-remote-planes-over-system-openssh.md)).
4. **Fix mouse-wheel handling in Plurid.** The space's own wheel handler in `@plurid/plurid-react`
   (`source/services/logic/input/wheel.ts`) reads a slow mouse wheel as a trackpad and needs to be
   fixed in the Plurid package ([Runtime dependencies](../development/dependencies.md)).
5. **Smaller deferred items.** Rotate an image file in place with Undo
   ([Media reference](../reference/media.md)), rotate PDF pages ([PDF tools](../reference/pdf.md))
   and add [review-sheet scenes](../development/review.md) for the dialogs and commands that still
   lack one.

## Make the existing experience dependable

Continue long-session resource audits, real-file qualification, source-change recovery and complete
workflows. Test native permissions, external disks/providers, window restoration and accessibility
in actual platform builds. Keep UI input, document lifetimes and runtime lifetimes distinct.

The current implementation already includes defined and found workspaces, declared commands,
worktrees/tasks, hunk review, parameterized commands, reported agent sessions, Journal and focused
creative tools. Future planning must start from that
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
Bounded robot controls, target checks and comparison are implemented in the optional robotics
plugin, not in the app; the mounting-specific geometry, generated fabrication controls and mock
service handoff need integration or qualification. The
[strategy and implementation audit](workshop.md) records those boundaries.
[Job 1042](fabrication-workflow.md) remains a separate fabrication workflow.
