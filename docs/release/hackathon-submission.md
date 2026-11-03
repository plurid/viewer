# Hackathon submission draft

This is working entry copy for the [recorded-voice film](hackathon-demo.md): Meta extends a working
robotics plugin, invokes its calculations and adapts its interface to a changed constraint. The
qualified run includes interface edits, Central and Front selections and a quoted alternative that
selects Rear. Portable reopening and cold restart were checked separately. The film uses retained
Meta responses, native interactions and the creator's recorded narration. Its opening remains
temporary. The owner supplied 27 October 2026 as the development baseline. The
[contribution inventory](hackathon-contributions.md) records the source comparison. Public URLs,
team credits and organizer eligibility remain to be confirmed.

## Project

**The person manages the project. The agent generates the interface for the task, on the spot.**

The creator describes writing about a million lines of code up to 2025, then modifying at most ten
thousand lines from 2025 to today, mostly configuration files. The projects still need to be made.
The person's attention has shifted toward how the pieces fit together, what should change and what
those changes affect. The film introduces browser, editor and terminal with a repeated keynote-style
sequence, then reveals their shared workspace. The line counts are personal estimates.

Viewer gives an agent the project context and a canvas where it can generate the interface needed
for the current task. The request drives the controls; a changed question can produce a changed
interface. Inputs persist through revisions, and a question about a passage can become an
independent conversation and alternative tool. The file workspace and generated interfaces serve
this way of working across different kinds of content.

Viewer and its spatial engine, Plurid, existed before this hackathon. The prior Viewer already had
file browsing, previews, linked planes, model configuration and ordinary chat. The additions include
generated canvases, saved inputs, exact quote branches, file snapshots, shared actions, reviewed
results and tool management. The robotics implementation is a reusable plugin carried by that
environment. Plurid also gained engine improvements; credit those separately from the existing
spatial foundation.

The film, **There Is No Interface**, makes that argument explicit: the interface is generated on the
spot from the project and the person's request. Keep the personal account and the change in how the
creator works in the main narration. Introduce Viewer and Plurid as existing projects while
exploring their space, then identify the hackathon additions. The robot study shows an interface
gaining controls in response to a changed requirement. Meta uses the working plugin's calculations
to choose a mounting point and investigate an alternative. Viewer connects that tool to the files,
conversation and other project views. An optional synthetic homage must remain distinct from the
real app.

## Demonstration

The person needs one mounting point from which an SO-101 arm has candidate poses at all six tray
slots. They open the existing robotics plugin with the robot and station brief, then ask Meta for a
per-target results table. Meta adds the table, invokes the plugin's evaluation action and selects
Central. The person can use the new rows to inspect each candidate pose.

The person then reserves the central mounting area. Meta uses the existing restriction control, adds
an explanation of which mounting points it excludes and runs the calculations again. The
least-movement passing choice changes to Front. Quoting the recommendation creates a second
conversation and canvas for checking the rear mounting point against the same inputs. The person
compares the alternatives spatially, saves the decision and reopens the working tool.

The plugin yields 3/6 endpoints at Existing and 6/6 at Central, Front and Rear. Central is preferred
until the reserved region excludes it, when Front needs the smallest move among passing candidates.
Its own checker evaluates the saved candidate poses; separate test tooling checks the results
independently. Front moves the base 228.04 mm; Rear moves it 295.30 mm. Both satisfy the six
endpoint checks. These measurements describe the assigned station, not physical operation or proof
that other poses cannot exist.

The mounting plate and cutting-service comparison remain supporting examples. Their generated
interfaces pass native width editing, measured DXF export, source-bound quote selection, save/reopen
and restart checks. The service is a local simulation; it sends no external messages and places no
order. Those examples establish additional operations but do not carry this film's main argument.

The [screenplay](hackathon-demo.md) records the current cut's exact narration and shots. The
[implementation audit](../research/workshop.md#implementation-audit) records current canvas and
robot capabilities. The [fabrication reference](../reference/fabrication.md) owns that workflow's
behavior.

## Meta's role

The demonstration makes three model responsibilities visible: add working controls, invoke plugin
handlers and use their measured results to decide what to do next. The model edits, invocations and
explanations come from a retained live run. The operator can use the same controls and interrupt the
agent through **Take over**.

Meta's `muse-spark-1.3` adds a selectable target-results table and a restriction explanation to the
reused plugin. It invokes evaluation, selects Central, selects Front after the constraint changes
and selects Rear in the quoted alternative. The parser, solver, checker and starting interface
already exist in the plugin; these requests do not generate them from scratch. Source messages, full
tool results, model identity, usage, failed calls and repairs remain available. The earlier robot
and mounting/quote runs retain their own evidence and failures.

The canvas foundation pairs native tool calls with actual results and validates structured
responses. Viewer owns source access, saved state, revision checks, sandboxing and reviewed exports.
Generated code has no direct file-write or shell capability through the canvas. The robotics
plugin's attached code runs in the canvas sandbox. Viewer has no robotics solver, checker or
dedicated robot-check operation. External qualification is test tooling, outside the shipped host.

## Existing evidence and its limits

- The canvas implementation supports source snapshots, generated revisions, retained inputs,
  independent quote branches and reviewed text results.
- Automated service and native fixture scenarios cover those contracts and their stated runtime
  behaviors. Their results do not establish an arbitrary generated tool's correctness.
- The retained supplier evaluation and replay concern fictional quotations with known arithmetic,
  separate from the planned cutting-service conversation and plate quote. The
  [testing guide](../development/testing.md#canvas-evaluation-and-replay) records reproduction and
  the distinction between model generation, fixtures and saved-output replay.
- Earlier robot recordings used host-owned checks and retain their own evidence. Those recordings do
  not establish the current plugin ownership boundary.
- The robot reader, motion library, solver and endpoint checker belong to the reusable robotics
  plugin. Three.js supplies rendering. Visual replay does not check the path between poses.

Keep run-specific evidence, failures, retries and usage in the evaluation report. Qualification of
one example does not qualify another example or the combined workflow proposed in the film.

- The new generic action bridge and six-slot station pass local native fixture checks for actual
  execution, constraint changes, cancellation, exact quote branching, comparison and portable
  restart. The supplied HTML fixture is not Meta-generated evidence.
- The current Meta run starts with the working plugin and passes interface revision,
  changed-constraint and exact-quote checks. Meta selects Central, Front and the quoted Rear
  alternative. Both exported alternatives retain their code, inputs, sources and assets through
  reopening and cold restart without a configured provider. An external harness checks their
  returned poses, altered targets and joint limits.
- The first live turn reached its request cap without a closing reply. The recorded playback stops
  after the final action and does not invent a reply. Saved responses, condensed repairs and the
  staged interface entrance are documented in the production materials.
- The closing image/video/file-editor requests are an editorial sequence. They are not submitted and
  do not establish generated editors. Supporting demonstrations need their own working artifacts and
  evidence.

## Claims requiring qualification

The film must visibly connect the request, the added capabilities, the controls being used and the
measured result. A generated screen alone does not establish that progression. Record actual native
pixels at the delivery resolution, keep text readable and preserve the input that triggers spatial
movement. Continuous passages and input cues support review; technical capture checks alone do not
establish audience comprehension. Restart is verified separately; show it only if it is recorded.

Ambiguous units, dimensions and source associations require human confirmation. An unresolved
numerical solve is not proof of unreachability. Kinematic checks do not establish collision safety,
physical grasping, load capacity or calibrated hardware control. The demonstration must say which
poses or intervals were checked.

Photo-to-3D, SAM segmentation and broad format expansion remain separate capabilities or proposals.
Job 1042 and the mounting plate retain their own fabrication evidence. Attribute source assets and
supporting libraries independently of Viewer's generated interface.

## Before submitting

1. Retain the completed foreground checks and the actual recorded workflow. Keep evidence of
   failures as well as successful runs; obtain a new explicit budget before further paid model
   sessions.
2. Confirm the current requirements in the
   [official event guide](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details) and
   [terms](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver), including duration,
   source availability, asset use, synthetic portrayals and eligibility of prior work.
3. Review the story cut using the [production handoff](hackathon-demo.md#final-production-handoff).
   Check whether a first-time viewer can follow the actions with the recorded narration and finish
   the opening. Identify edited saved-session playback and staged reveals; retain source takes,
   exact message excerpts and the edit decision list. Attribute local layout refinements separately.
4. Complete the [contribution inventory](hackathon-contributions.md) from the confirmed development
   baseline. Fill in authors and final source references, then check the organizer's eligibility
   rules. Keep the existing Viewer and Plurid foundation distinct from the post-baseline additions.
5. Package a signed, notarized installer and a portable example that opens without a model key.
   Check the downloaded installer and example in a fresh profile. State which actions replay saved
   code and which require the visitor's model configuration. Follow the
   [release gates](../development/releases.md) before distributing the app.
6. Add public source, download, reproduction instructions, video and team details to the organizer's
   form. Inspect public materials for credentials and personal data. Have the owner review the
   complete entry and publish through the chosen submission channel.
