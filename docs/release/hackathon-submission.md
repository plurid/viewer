# Hackathon submission draft

This is working entry copy for the selected [film](hackathon-demo.md): prepare a robot mounting
plate and choose a cutting quote. It connects a generated model inspector, cutting view and
quotation comparison in one spatial project. The supplier conversation is a local two-agent
simulation. Review the script, then qualify the combined workflow before recording. The owner
supplied 27 October 2026 as the development baseline. The
[contribution inventory](hackathon-contributions.md) records the source comparison. Public URLs,
team credits and organizer eligibility remain to be confirmed.

## Project

**The person manages the project. The agent generates the interface for the task, on the spot.**

The creator describes writing about a million lines of code up to 2025, then modifying at most ten
thousand from 2025 to today, mostly configuration files. The projects still need to be made. The
person's attention has shifted toward how the pieces fit together, what should change and what those
changes affect. The film introduces browser, editor and terminal with a repeated keynote-style
sequence, then reveals their shared workspace. The line counts are personal estimates.

Viewer gives an agent the project context and a canvas where it can generate the interface needed
for the current task. The request drives the controls; a changed question can produce a changed
interface. Inputs persist through revisions, and a question about a passage can become an
independent conversation and alternative tool. The file workspace and generated interfaces serve
this way of working across different kinds of content.

Viewer and its spatial engine, Plurid, existed before this hackathon. The prior Viewer already had
file browsing, previews, linked planes, model configuration and ordinary chat. The additions include
generated canvases, saved inputs, exact quote branches, file snapshots, reviewed results and the
robot model/checking capabilities qualified in the retained rehearsal. Plurid also gained engine
improvements; credit those separately from the existing spatial foundation.

The proposed film, **There Is No Interface**, makes that argument explicit: the interface is
generated on the spot from the project and the person's request. Keep the personal account and the
change in how the creator works in the main narration. Introduce Viewer and Plurid as existing
projects while exploring their space, then identify the hackathon additions. The mounting job shows
different kinds of interfaces taking shape around the work: inspecting a model, preparing a drawing
and acting on a service reply. Generated tools use the host's capabilities for those tasks. An
optional synthetic homage must remain distinct from the real app.

## Proposed demonstration

In the fictional job, the person needs a plate to mount the robot to a workbench. They ask Meta for
an inspection interface, view the source robot and existing clamps, then request a plate using the
assigned demo specification. They edit its dimensions and measure the saved cutting file against the
values shown in the generated interface.

A browser plane shows a local conversation between Viewer's agent and a fictional cutting-service
agent. The service offers economy and express delivery for the same plate. Its reply becomes the
source for a generated comparison: changing the deadline changes which options qualify. The person
chooses an option and saves the reviewed cutting file with the selected simulated quotation.

Actual Meta-generated mounting and quote interfaces pass native width editing, independently
measured DXF export, source-bound quote selection, save/reopen and restart checks. Physical
fabrication is outside this fictional scenario and does not block the demo. Existing browser planes
do not grant an agent access to their page content or signed-in sessions. The simulation sends no
external messages and places no order. Job 1042's separate 48/50 mm fixture does not describe this
robot's mounting points.

The [screenplay](hackathon-demo.md) owns the proposed narration and shots. The
[implementation audit](../research/workshop.md#implementation-audit) records current canvas and
robot capabilities. The [fabrication reference](../reference/fabrication.md) owns that workflow's
behavior.

## Meta's role

Meta's `muse-spark-1.3` generated and revised the HTML/CSS/JavaScript from approved robot source
material and produced the quoted alternative. The retained run includes failed attempts and their
repairs. One intact provider response was recovered unchanged after fixing a local parser rejection,
without another request. Keep this provenance with the final demonstration.

The canvas foundation pairs native tool calls with actual results and validates structured
responses. Viewer owns source access, saved state, revision checks, sandboxing and reviewed exports.
Generated code has no direct file-write or shell capability through the canvas. The robot checker
operates outside generated HTML and reports the limits of what it checked.

## Existing evidence and its limits

- The canvas implementation supports source snapshots, generated revisions, retained inputs,
  independent quote branches and reviewed text results.
- Automated service and native fixture scenarios cover those contracts and their stated runtime
  behaviors. Their results do not establish an arbitrary generated tool's correctness.
- The retained supplier evaluation and replay concern fictional quotations with known arithmetic,
  separate from the planned cutting-service conversation and plate quote. The
  [testing guide](../development/testing.md#canvas-evaluation-and-replay) records reproduction and
  the distinction between model generation, fixtures and saved-output replay.
- The actual Meta-generated robot creation, refinement and quoted alternative passed native checks.
  Moving the alternative base produced endpoint candidates within the task's tolerance while the
  original remained unchanged. Comparison save, pose replay, export/reopen and cold restart passed.
- The robot reader, motion library and separate endpoint checker are Viewer capabilities. Generated
  UI uses those capabilities; Three.js supplies rendering, not robot semantics or physical
  simulation. Visual replay does not check the path between poses.

Keep run-specific evidence, failures, retries and usage in the evaluation report. Qualification of
one example does not qualify another example or the combined workflow proposed in the film.

## Claims requiring qualification

The film must visibly demonstrate the generated inspection, cutting and quotation interfaces, their
working controls and saved output. Existing robot rehearsal qualifies a different task. The story
cut must make the spatial relationships understandable and show the supplier reply driving the
comparison. Identify the service as fictional and credit the local exchange simulation. Its
continuous passages and input cues support review; technical capture checks alone do not establish
audience comprehension. Restart is verified separately; show it only if it is recorded.

Ambiguous units, dimensions and source associations require human confirmation. An unresolved
numerical solve is not proof of unreachability. Kinematic checks do not establish collision safety,
physical grasping, load capacity or calibrated hardware control. The demonstration must say which
poses or intervals were checked.

Photo-to-3D, SAM segmentation and broad format expansion remain separate capabilities or proposals.
Job 1042 retains its own fabrication evidence. Verify the mounting plate from its actual attachment
sources and accepted requirements. Attribute source assets and supporting libraries independently of
Viewer's generated interface.

## Before submitting

1. Retain the completed foreground checks and the actual recorded workflow. Keep evidence of
   failures as well as successful runs; obtain a new explicit budget before further paid model
   sessions.
2. Confirm the current requirements in the
   [official event guide](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details) and
   [terms](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver), including duration,
   source availability, asset use, synthetic portrayals and eligibility of prior work.
3. Review the story cut using the [production handoff](hackathon-demo.md#final-production-handoff).
   Check whether a first-time viewer can follow the actions before recording final narration and
   finishing the opening. Identify edited saved-session playback and staged reveals; retain source
   takes, exact message excerpts and the edit decision list. Attribute local layout refinements
   separately.
4. Complete the [contribution inventory](hackathon-contributions.md) from the confirmed development
   baseline. Fill in authors and final source references, then check the organizer's eligibility
   rules. Keep the existing Viewer and Plurid foundation distinct from the post-baseline additions.
5. Replace proposed claims with only those established by the final demonstration. Add public
   source, reproduction instructions, video and team details to the organizer's form. Inspect public
   materials for credentials and personal data.
6. Have the owner review the complete entry and publish through the chosen submission channel.
