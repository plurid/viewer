# Hackathon submission draft

These answers are prepared for the
[submission form](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit). The
installer and presentation site are public. The entry has not been submitted. Review the answers,
contributor list and model-feedback fields before sending it.

The [participant guide](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details), checked on
3 November 2026, sets the deadline at **4 November, 9 PM EST**, or **5 November, 4 AM in
Bucharest**. It requires a public repository and a three-minute demo focused on the event's
contributions. The judging weights are impact 30%, Meta tooling 25%, technical execution 20% and
demo 25%.

## Entry fields

| Field                             | Prepared value                                                             |
| --------------------------------- | -------------------------------------------------------------------------- |
| Team name                         | Plurid, subject to the owner's choice                                      |
| Team members                      | Jan Cavel is listed in the form; confirm any additional human contributors |
| Track                             | Indie Developer Track                                                      |
| Problem statement                 | Build for Your World                                                       |
| Public GitHub repository          | <https://github.com/plurid/viewer>                                         |
| Website and live product download | <https://plurid.com/viewer/>                                               |
| Release                           | <https://github.com/plurid/viewer/releases/tag/v1.0.0>                     |
| Demo video                        | <https://www.youtube.com/watch?v=eClnvICbzRI>                              |
| Captions                          | <https://plurid.com/viewer/demo.vtt>                                       |
| Downloadable project              | **Viewer-1.0.0-Demo.zip** on the 1.0.0 release                             |
| X post                            | <https://x.com/plurid_viewer/status/2118034476060103001>                   |

The film is at most three minutes. Its generated-tool scenes replay retained Meta responses; its
laser-job scene is a live recording of the released app. The opening, the flights between workspaces
and the two scenes of Meta writing the tool are rendered; the code in those scenes is the change
Meta's saved responses made. The narration is generated with ElevenLabs from a clone of the author's
voice. The [screenplay](hackathon-demo.md) lists every edit.

### Project Description

Working on a project means moving between a file manager, a browser, an editor, a terminal and
specialist apps. The work is connected; the tools are not.

Viewer is a Mac file explorer that opens more than 300 kinds of file and keeps folders, files, a
browser and a terminal side by side as planes in one 3D workspace. Viewer and Plurid, its spatial
engine, existed before the event. During the hackathon I made Viewer a place where Meta's models do
real project work, in two ways.

**Generated tools.** Meta builds and changes the interface a task needs, beside the project files,
then operates it through the same controls I use. In the film, Muse Spark extends a robotics plugin
with a results table, runs its calculations to choose where to mount an arm, changes its
recommendation when I reserve part of the bench, and checks an alternative in a branched
conversation. The tool, its inputs and its results are saved and reopen without a model.

**Laser-job checks.** I prepare laser jobs, where one wrong number costs a sheet of steel and a day.
Muse Spark reads the customer's email, the drawing pages and photos. SAM 3.1 outlines the feature in
question. Viewer measures every DXF itself and grades each finding. On 8 synthetic jobs checked 3
times each with the released build, Muse Spark found all 30 planted problems and raised none that
was not there. A reviewed correction is written beside the original and nested for cutting. Spoken
requests use Muse Voice Transcribe.

The model proposes; Viewer verifies, keeps the originals and asks before anything changes. Viewer
1.0.0 is a signed, notarized Mac app with a public repository. Its robotics demo opens and runs
without a key; asking Meta and the laser check need a Meta Model API key.

### Describe your use of Meta products to build the submitted project

Viewer uses three Meta models through the Meta Model API (`https://api.meta.ai/v1`):

- **Muse Spark (`muse-spark-1.3`)** edits a generated tool's HTML and JavaScript and invokes its
  registered actions, each call paired with its actual result and bound to the current revision. It
  reads a laser job with pictures, the request text, drawing pages at 2048 px, photos and Viewer's
  DXF measurements, and answers in a strict JSON schema with exact quotes and page boxes. It turns a
  spoken request into a plan of commands that Viewer checks before running. Reasoning effort is
  configurable.
- **SAM 3.1** outlines the feature each finding is about, on the drawing or the photo. Against the
  true shape its median intersection over union is 0.65, against 0.12 for Muse Spark's own box.
- **Muse Voice Transcribe (`muse-voice-transcribe-1.0`)** transcribes spoken requests, such as
  "Check this job and prepare the cut sheets".

`tools/fabrication/evaluate-live.ts` runs the released build's own check service against the Meta
Model API on eight generated jobs. Across 24 runs Muse Spark found all 30 planted problems and
raised no finding that was not there. All 127 of its quotes were found on their page, it read all 54
requested parts correctly, and no answer failed the schema. Viewer confirms a finding only from an
unambiguous source passage and its own measurement; it marks the rest Unverified and asks the person
to review them.

Every call goes through Viewer's data permissions, approved per provider and endpoint. Keys are
encrypted in the macOS keychain. The robotics parser, solver and checker were written for the plugin
and reused by Meta, not generated by these requests.

### Why are Meta's models important to your solution?

Meta's models do what a fixed program cannot: read a project the way a person does, and turn a
request into something that works.

Muse Spark reads pictures and text together and holds to a strict schema, so its answer can be
checked: every quote is found on its page and every number is measured again by Viewer. SAM 3.1
turns "the hole pitch on the base plate" into an outline a person can verify at a glance. Muse Spark
can also change a working interface and then use it, so the tool grows with the question.

The model proposes; Viewer measures, saves and keeps the person in control. That is why its results
can be trusted and kept.

### Fields the owner answers

The form asks for the owner's likelihood of using Meta Model API, overall opinion, optional
recommendation scores and comparison with other models. It also asks for permission to promote the
submitted materials. Leave these choices to the owner. Partner feedback is optional; do not claim
use of a partner. The X post shows this entry's film and links to it.

## Supporting account

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

Before the robot study, the film shows the laser-job check, recorded live in the released app. Over
Job 1042, the person runs **Check laser job…** from **⌘K** and **Check 7 files**. Muse Spark reads
the request email, the drawing and Viewer's measurement of every DXF part; SAM 3.1 outlines a
feature on the drawing. Viewer measures the DXF itself: its holes are 48 mm apart where the drawing
gives 50 mm, and the model quoted the drawing's full requirement, so Viewer grades the finding
**Confirmed**. The tour walks through the request, the drawing and the part, and a reviewed
correction is saved beside the original and measured again. Job 1042 is a fictional sample from the
[sample playground](../development/playground.md). Of three live checks recorded for the film, this
is the one Viewer confirmed; in the other two the model quoted only "50", so Viewer left the finding
Unverified and offered no correction. In the recorded take, SAM 3.1 outlined the centre hole rather
than the pitched holes.

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

In the laser-job check, Muse Spark reads the request, the drawing pages and photos with Viewer's DXF
measurements and answers in a strict schema. SAM 3.1 outlines each feature a finding names. Viewer
grades every finding against its own measurement and the page text; the model's numbers are never
taken on trust. Spoken requests are transcribed by Muse Voice Transcribe and planned by Muse Spark
from the commands offered where the person spoke.

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
- The laser-job check's [live evaluation](../reference/fabrication.md#live-evaluation) runs the
  app's own check service against the Meta Model API on eight generated jobs with planted problems.
  Its retained report records every reply, grade and outline. It establishes the check on those
  synthetic jobs, not on every real job.
- The film's laser-job scene is a live recording of the released app. Its model wait is cut and
  identified in the production notes.

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

SAM 3.1 outlines show where a finding is; they do not verify dimensions, which Viewer measures from
the DXF. Photo-to-3D remains a separate capability. Job 1042 and the mounting plate retain their own
fabrication evidence. Attribute source assets and supporting libraries independently of Viewer's
generated interface.

## Before submitting

1. Retain the completed foreground checks and the actual recorded workflow. Keep evidence of
   failures as well as successful runs; obtain a new explicit budget before further paid model
   sessions.
2. Check the contribution boundary against the
   [official event guide](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details) and
   [terms](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver). The guide requires the
   demo to identify work built during the event. Keep the existing workspace introduction brief and
   identify the new agent capabilities as soon as they appear.
3. Review the cut against its
   [script and production notes](hackathon-demo.md#production-notes-not-on-screen): the rendered
   opening, the live laser scene, the replayed robotics responses and the generated narration voice
   are each identified there. Retain the source takes, narration request IDs and the edit list.
4. Review the [contribution inventory](hackathon-contributions.md), now tied to the published Viewer
   and Plurid revisions. Confirm authors and keep the existing foundation distinct from the
   post-baseline additions.
5. Use the published signed, notarized Viewer 1.0.0 installer and the
   [demo project walkthrough](../guides/demo-project.md). Check the public downloads in a fresh
   profile. Operating a saved tool requires no model account; asking for another edit does.
6. Add public source, download, reproduction instructions, video and team details to the organizer's
   form. Inspect public materials for credentials and personal data. Have the owner review the
   complete entry and publish through the chosen submission channel.
