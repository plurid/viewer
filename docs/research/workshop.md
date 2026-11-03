# Viewer Workshop: interfaces built around a task

The current direction is a generic generated-tool host. The agent assembles and adapts plugins from
working code, templates and new code where needed. Viewer supplies scaffolding, context, sandbox
execution, persistence and tool management.
[Generated tool ownership](../adr/0015-generated-tool-host.md) replaces the earlier built-in
robotics solver and checker design.

The existing robotics implementation is packaged as an optional plugin. Meta extends its interface
with a target-results table and a mounting restriction explanation, then uses the plugin's actions
to evaluate, select and check placements. The parser, solver and checker remain reused code. Keep
the starting package and provider revisions separate when presenting the contribution. The earlier
recordings show the former ownership boundary and need a new capture for this workflow.

The [screenplay](../release/hackathon-demo.md) is the exact script for the current review cut. It
must change together with the next recording. The
[contribution inventory](../release/hackathon-contributions.md) uses the owner's 27 October 2026
baseline to distinguish prior work.

## Product thesis

The creator's account is central: about a million lines of code written up to 2025, then at most ten
thousand modified from 2025 to today, mostly configuration files. These are personal estimates. The
work has shifted toward understanding how the project fits together, choosing what should change and
following the consequences of those changes. Files remain the material of the project. The film
explains this shift in natural language without turning the file-manager example into a slogan.

The film's “there is no interface” hook means the agent generates the interface needed for the task,
on the spot. The person asks what they need to do with the project, and the agent builds controls
around its files. The controls can change when the question changes. Viewer keeps sources,
conversations, alternatives and saved results together throughout that work.

The base-placement study gives the evolving interface a shared purpose. The source model supplies
the joints and geometry; the task supplies fixed targets; the new controls enable a tested
placement. Viewer supplies approved source access and graphics libraries. The generated plugin must
implement the file interpretation, geometry calculations and checks needed for its task. The
demonstration establishes the selected operations across different interfaces, not complete
replacement of Photoshop or AutoCAD.

Plurid makes the relationships navigable. Quote branches keep another investigation beside its
source; independent canvases retain both alternatives. Spatial proximity does not grant access or
prove a dependency. The film's browser/editor/terminal repetition ends by revealing those views in
one workspace. See [spatial development](spatial-development.md) and the
[product principles](../../PRODUCT.md).

## Selected task and related mounting example

The selected task uses the real SO-101 definition with assigned station geometry: a 600 × 400 mm
bench, two trays and six tool targets at Z 80 mm. The targets have X 440/520 mm and Y 100/160/220
mm. Four candidate mounting points are Existing (40,180), Central (200,180), Front (220,40) and Rear
(300,320), in millimetres with zero rotation. The tool is the gripper-frame origin. Endpoint
tolerance is 1 mm.

The retained offline experiment produced passing candidates for 3/6 targets at Existing and 6/6 at
the other three points. Central requires the least movement. A new reserved mounting-point
rectangle, X 140–260 mm and Y 120–240 mm, excludes Central. Front becomes the least-movement passing
choice. Rear remains a valid endpoint alternative for a quote branch. That experiment used a
supplied solver. These numbers are reference fixtures for qualifying the reusable plugin. They do
not claim that Meta wrote its solver. Front moves the base 228.04 mm and Rear 295.30 mm. The
canonical input is
[station.json](../../packages/viewer-electron/app/tests/fixtures/robotics/station.json).

The intended output is a selected mounting point, calculated results and a portable working canvas.
The plugin must compute its own results; an external qualification harness checks them against
independent reference cases. The study does not model tray or robot footprints, orientation,
collisions, intervening motion or physical mounting. The fictional dimensions are assigned; no
physical-fit confirmation blocks the demo. Ambiguous real source dimensions still require review in
real work.

The results table links each measured endpoint to its pose in the viewport. The reserved-area
follow-up selects Front, and a quoted conversation investigates Rear. Exported alternatives retain
the interface, calculation module, meshes, source snapshots and saved controls. Acceptance checks
the actual actions, table interaction and restart behavior, including reuse without a configured
model.

The related mounting example prepares an adapter plate and compares fictional cutting quotes. It
uses an assigned plate specification and a simulated supplier. Its controls, drawing, measurements
and quote must agree with those scenario inputs. It is supporting evidence, not the film's payoff.

The supplier mock presents two delivery options for the same part. The generated comparison reads
that reply and lets the person change the deadline. The screenplay owns the exact sample values and
dialogue. Real service messaging, browser session access and order submission are outside this local
simulation.

The accepted attachment approach uses the existing two table clamps with an adapter plate. The
pinned SO-ARM100 parts list identifies those clamps. The base STEP is
[`STEP/SO101/Base_SO101.step`](https://github.com/TheRobotStudio/SO-ARM100/blob/a758567c3978dfeefe282ede0500085a48fe8f78/STEP/SO101/Base_SO101.step).
Its source-frame envelope measures 110.925 × 72 × 87 mm; this is an envelope, not a bolt pattern.
The STEP's axes differ from the assembled URDF frame. The demo starts with a 160 × 140 × 6 mm
aluminium plate and four 6.5 mm holes on a 120 × 100 mm pitch, then changes its width to 180 mm.
These are assigned scenario inputs, not dimensions measured from the robot. Physical fit and
fabrication are outside the fictional job; they require no confirmation before filming.

The retained two-target exercise below qualifies its own generation, revision and comparison
mechanics. It does not qualify the six-slot action sequence. It does not qualify the mounting plate
or physical fabrication.

### Earlier two-target exercise

Use the [SO-101 project](https://github.com/TheRobotStudio/SO-ARM100), with the exact follower
model, meshes and documentation pinned before qualification. Its
[simulation documentation](https://github.com/TheRobotStudio/SO-ARM100/blob/main/Simulation/SO101/README.md)
describes model and calibration conventions that must be preserved.

1. Read the project and build a canvas for exploring articulated joints and their limits.
2. Change the question: add target placement and a model-based reach check through another agent
   revision, retaining the person's saved inputs.
3. Expose an actual constraint and open the exact model definition behind it.
4. Branch from the explanation to investigate moving the base while keeping the targets fixed.
5. Compare the original and alternative, independently check the candidate motion, then export and
   reopen the work.

The result is a kinematic workbench and a checked candidate sequence. It does not establish physical
actuation, successful grasping, payload capacity, calibrated device commands or collision safety. Do
not treat an unsuccessful numerical solve as proof of unreachability.

## Implementation audit

The [canvas reference](../reference/canvases.md) owns the current APIs and limits.

| Capability                   | Owner and current boundary                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Generate and revise tools    | Chat publishes complete HTML/JavaScript revisions, preserves saved inputs and records provider messages.                                 |
| Supply context               | The host captures bounded source text, facts and explicitly attached assets. It does not interpret robot models for the plugin.          |
| Render graphics              | The sandbox provides Three.js and its standard loaders. The plugin supplies application behavior.                                        |
| Execute actions              | The host runs named plugin handlers, validates the input contract, enforces revision checks and commits the returned state.              |
| Manage tools                 | The Tool library opens, renames, enables, disables and duplicates saved canvases. Each duplicate has a separate conversation and inputs. |
| Branch and compare           | Exact quoted context creates a separate investigation. Any domain comparison is authored in the plugin.                                  |
| Solve and check a robot task | Owned by the reusable robotics plugin. The shipped host has no robot solver, checker or robot-check IPC operation.                       |
| Image, video and CAD montage | Proposed. Each example needs actual generated code and a visible edit before filming.                                                    |

The earlier station and two-target recordings are retained experiment evidence. Their tools used
supplied robotics algorithms; they do not qualify the new ownership boundary. Native scripts that
refer to that experiment's protocol are only applicable to its recorded build. They are not current
product acceptance tests. The generic host is exercised by
[tool library checks](../../packages/viewer-electron/app/tests/tool-library.test.ts) and the
[native library scenario](../../packages/viewer-electron/app/tests/native/tool-library.ts).

## Qualification and work before filming

Use existing document, canvas, preview, operation and conversation owners. Extend their capabilities
where needed; avoid a parallel application or a hardcoded success demonstration.

### Station generation and acceptance

Prepare an isolated profile with the existing robotics plugin, original source text and explicitly
attached meshes. Reuse its working interface, solver and checker. Retain the starting package, every
response and each resulting revision. Separate reused code from changes made by Meta. A fresh
qualification requires a separately approved session allowance; the earlier station allowance is not
a new generation grant. Count failed, canceled and repair requests. Review each stage in the native
app before continuing.

The [qualification runner](../development/testing.md#generated-tool-qualification) prepares the raw
inputs without creating an allowance. Its
[action contract](../../packages/viewer-electron/app/tools/robotics/station-contract.ts) asks for
callable evaluation, selection, pose inspection and self-tests. The plugin supplies the working
implementation. The external reviewer checks observed results against source geometry and altered
inputs. Expected answers are not supplied as computed results.

**Creation request**

> Adapt this robotics plugin to the robot and station brief. Test the mounting points and tell me
> which one needs the smallest move. Use the attached snapshots and meshes. Show the bench, two
> trays, six labeled targets and the articulated robot. Register actions to evaluate all four
> mounting points and select one; wire the visible buttons to those same handlers. Invoke the
> evaluation yourself, then select and recheck the least-movement passing candidate. Reuse the
> plugin’s parser, transforms, solver and endpoint checks. Add a per-target results summary so I can
> see which tray slots each mounting point reaches. Preserve its controls, state keys and camera.
> Explain only results you received from the tools.

**Changed-requirement request**

> Reserve the central mounting area: X 140 to 260 mm, Y 120 to 240 mm. Use the existing control and
> overlay, and add an explanation of which candidates this restriction excludes. Keep the same
> robot, tray targets and 1 mm endpoint tolerance. Revise the existing tool, run its evaluation and
> self-tests, then select and check the least-movement passing candidate using the plugin's own
> calculations. Preserve the camera and other inputs.

**Quoted-alternative request**

Select the actual sentence recommending Front. Use **Ask about this…**, retaining the exact text and
range, then send:

> Compare the rear mounting point with the front mounting point. Use the same robot, targets and
> reserved area. Select Rear in this alternative through its registered action, check the saved
> poses with the plugin checker and explain the measured tradeoff. Do not change the source brief or
> the original conversation's inputs.

| Gate        | Required evidence                                                                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creation    | Starting plugin retained; actual Meta interface revision; recorded `canvas_invoke`; results for all four mounts; external reference agreement; Central selected; native controls respond |
| Revision    | Actual Meta revision explains the changed constraint; state and camera persist; another invocation; Central excluded; Front selected and checked                                         |
| Branch      | Exact quote range; separate canvas; Rear selected; generated comparison against Front; original inputs unchanged                                                                         |
| Handoff     | Checked JSON saved and read back; portable canvas reopened; native cold restart reruns the plugin check                                                                                  |
| Attribution | Provider envelopes, usage, rejected responses and local edits retained; reused plugin code never attributed to fresh Meta generation                                                     |

Use the same live handlers in the person's controls and the agent calls. A fixture passing these
mechanics is necessary preparation, but it does not establish that the model uses them successfully.
Only after all gates pass should the new film present the sequence as Meta behavior.

For each plugin revision, run known pose fixtures and perturb a target and a joint limit to check
that results respond to changed inputs. Run the independent reference outside the app. It is test
equipment, never an imported dependency of the generated plugin. Preserve the distinction between a
plugin-reported result and independently established agreement.

### Ending montage

Use three short request-to-operation sequences in the same spatial workspace:

- “I want an image editor.” Generate crop and exposure controls for the attached photograph, make an
  edit and export the changed image.
- “I want a video editor.” Generate an in/out timeline for the attached clip, change the range and
  play that selection. Claim only preview editing until an exported cut is verified.
- “I want a CAD tool.” Generate a parameterized plate editor, change its width and export a DXF
  whose measured width agrees with the control.

Each tool lives in the same library, links to its conversation and reopens with its saved inputs.
Use real Meta responses for the assembly sequence. Show one purposeful interaction per example, then
pull back to the connected planes. The montage proves that the host can run different generated
tools; it does not claim complete replacements for large specialist applications.

### Retained robot qualification

This section records the earlier two-target experiment with supplied robotics algorithms. Its
checklist and recordings do not qualify the current generic host or a newly generated solver.

| Order | Required work                                                                                                         | Acceptance                                                                                                                                                               |
| ----- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Pin and inspect the model package. Resolve approved meshes and record source versions, calibration, units and frames. | Complete selected joint tree and resources; missing or unsupported data remains explicit. No network or arbitrary file access from generated HTML.                       |
| 2     | Add articulated motion from the parsed model and source-linked joint controls.                                        | Known poses agree with an independent reference; limits and transform composition are tested. Clicking a constraint returns to its exact definition.                     |
| 3     | Add target placement and bounded solving through the generated workbench.                                             | Preserve input state across agent revisions; distinguish validated poses, established constraint violations and unresolved solver outcomes.                              |
| 4     | Add trusted checking outside generated HTML and bind results to model, inputs and candidate motion versions.          | Altered targets, base placement or source versions invalidate an earlier pass. Report units, residuals and which poses or intervals were checked.                        |
| 5     | Connect quoted alternatives to the completed task.                                                                    | Fork the actual explanation, retain original targets and show a changed base placement without silently changing the original.                                           |
| 6     | Export, reopen and qualify the complete workflow.                                                                     | Read back the saved result; recover the canvas and motion after restart; complete the real Meta creation/refinement/branch sequence within a separately approved budget. |

That experiment completed the functional loop: the original candidates miss the fixed targets, an
explicitly moved base yields candidates within tolerance, and its experimental desktop checker
independently checked and saved the comparison. This does not prove the original placement
unreachable. The [robot snapshot decision](../adr/0013-robot-model-snapshots.md) records the
superseded foundation. The [target-check decision](../adr/0014-robot-target-checks.md) records the
solving and endpoint-check boundary. The work items above remain the acceptance checklist; they
describe the completed bounded experiment. The presentation copy has passed a foreground input
rehearsal. Retained footage covers that exercise's controls and handoff. The selected film must make
the added capabilities and the resulting decision clear. A supplied HTML fixture cannot qualify
generated controls or a model explanation. The
[staged robot runner](../development/testing.md#robot-creation-revision-and-quoted-alternative)
prepares pinned public inputs, records the paid allowance across restarts and stops between stages
for native review. Its offline provider tests establish harness behavior, not live generation.

The retained run includes failed generated JavaScript, camera interaction and replay attempts. The
successful revisions were produced by the provider; native review did not rewrite their HTML. The
foreground rehearsal covers every movable joint, a captured joint definition, camera orbit and
editing/restoring a target coordinate. Keep later visual edits identifiable and separate from the
retained provider output. Native loading and selected automated interactions do not establish every
control's quality.

### Mounting-plate workflow before recording

1. Use the existing clamps and assigned plate specification as the fictional brief. Introduce that
   job clearly before showing its generated controls.
2. Rehearse the 160-to-180 mm width edit. Viewer measures the saved DXF independently; compare those
   measurements with the displayed demo dimensions.
3. Rehearse the implemented local cutting-service conversation and explicit reply handoff. Browser
   access does not grant agent access. The quote records the exact saved drawing hash.
4. Film the qualified deadline transition and saved quote together with the cutting file. Keep mock
   service behavior distinct from actual model output.

The [screenplay readiness table](../release/hackathon-demo.md#implementation-and-evidence) separates
the implemented workflow from the remaining presentation and recording work. The
[mounting runner](../development/testing.md#mounting-and-quote-generation) retains request counts,
failed responses, native repair evidence and the original model output. Only the demonstrated
controls and file operations are qualified; camera persistence, arbitrary inputs and physical fit
are not established by those checks. Further paid generation must fit an explicit allowance.

## Model and human responsibilities

- **Meta:** interpret approved source material, generate and revise the interactive tool, invoke its
  registered actions, and investigate the quoted alternative. Verify the actual configured model
  before recording.
- **Viewer:** own source access, persistent state, assets, revision checks and reviewed output. The
  generated plugin owns model interpretation and its calculations. External test equipment verifies
  selected outputs during qualification; that equipment is not a Viewer capability.
- **The person:** frame the task, inspect assumptions and alternatives, confirm ambiguous units or
  dimensions, and approve the output.

A runtime `ready` observation only establishes that the page loaded. Reconstruction from a photo
would produce inferred geometry and is outside this film. SAM and photo-to-3D are not required for
the selected case and must not be credited as exercised unless separately demonstrated.

## Other workflows and references

### Investigating neural artifacts

The [weight-space programming experiments](https://github.com/RikiyaT/lm_understand-logs) suggest
another application of generated instruments: inspect a small controller's weights and recorded
failure, construct a diagnostic interface, propose an edit and compare both controllers on fixed
test episodes. Connected planes could hold the source tensors, generated controls, behavioral replay
and measured differences. This is a research proposal, not an implemented Viewer capability or
evidence about Meta's weight-editing ability. The reported experiments used GPT-6 Astra.

Keep the independent evaluator and held-out episodes outside the generated tool's authority. A local
evaluator would own architecture validation, bounded inference and recorded scores. Start with a
small controller and an offline reproduction before requesting a separate model allowance. The
larger Qwen experiment used 158 turns over about 20 hours; its results do not justify promising a
quick model-improvement feature. The current station qualification remains the selected film
workflow.

The [supplier regression](../development/testing.md#canvas-evaluation-and-replay) remains a small
case with known arithmetic, retained model responses and native export/restart checks. The
[Job 1042 plan](audit-and-hackathon-plan.md) describes a separate fabrication workflow. Its
requirement-verification and durable-check decisions still apply. Its 48/50 mm mismatch and the
supplier regression's quotes do not establish the mounting job or new service conversation.

[RP1](https://github.com/Roboparty/RP1) and Forge informed the earlier investigation of physical
projects and connected artifacts. RP1 is not the selected demonstration asset. The RP Hand
[license inventory](https://github.com/Roboparty/rp_dexhand/blob/main/LICENSES.md) leaves several
resource permissions unresolved; verify exact asset terms before any later use.

## Submission gates

The target is a competitive Indie entry. The
[official event overview](https://events.cerebralvalley.ai/e/meta-ai-developer-hackathon) describes
that track in terms of creativity, technical ambition and whether the project works. Confirm the
current [event details](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details) and
[terms](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver) before publication,
including video duration, eligibility, prize conditions, source availability, asset use and
contribution window.

Retain real requests, failed attempts and measured outcomes. Model budgets require explicit
approval; a new case does not renew an exhausted allowance. Use the
[contribution inventory](../release/hackathon-contributions.md) to separate prior work, new code and
third-party assets. Public source, package release, live-model qualification and final recording are
separate gates. Follow the [screenplay](../release/hackathon-demo.md) only after its readiness
checks pass.
