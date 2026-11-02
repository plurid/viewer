# Viewer Workshop: interfaces built around a task

This page records the hackathon direction and implementation audit. The canvas foundation is
implemented. The robot workflow has passed native qualification for articulated controls, target
solving, independent endpoint checks, comparison and export/reopen. Those checks establish the
mechanics of the generated tool. The film must connect those mechanics to the decision being made:
where to place the arm so its gripper can reach two fixed work points.

The selected [screenplay](../release/hackathon-demo.md) follows a project acquiring the tools needed
for that decision. Meta first produces a model inspector, then adds target testing in response to a
changed requirement. The person uses the new controls to move the base, solve and independently
check the endpoints. The generated interface's transformation is the main event. The separate
mounting workflow has reviewed canvas DXF output and a local supplier fixture. Actual Meta-generated
mounting and quote interfaces pass native width editing, drawing measurement, save/reopen, deadline
selection and restart checks. The mounting job is fictional; physical adapter qualification is
outside the demo and does not block recording. Final narration and the opening remain separate
production work. The [contribution inventory](../release/hackathon-contributions.md) uses the
owner's 27 October 2026 baseline to distinguish prior work.

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
placement. Generated tools use Viewer capabilities for source access, geometry and verification.
File formats alone do not supply those capabilities. The demonstration establishes the selected
operations across different interfaces, not complete replacement of Photoshop or AutoCAD.

Plurid makes the relationships navigable. Quote branches keep another investigation beside its
source; independent canvases retain both alternatives. Spatial proximity does not grant access or
prove a dependency. The film's browser/editor/terminal repetition ends by revealing those views in
one workspace. See [spatial development](spatial-development.md) and the
[product principles](../../PRODUCT.md).

## Selected task and related mounting example

The selected task is a base-placement study using a real robot description and two assigned fixed
work points. Its output is a saved working tool with a checked set of endpoint poses. The filmed
requirement change must visibly add target testing to the initial inspector.

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

The retained robot exercise below qualifies generation, revision and comparison mechanics for the
selected base-placement study. It does not qualify the mounting plate or physical fabrication.

### Can this arm reach the targets?

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

The table records source coverage and qualification boundaries. Automated service checks,
fixture-based native scenarios and native replay of actual provider output are different kinds of
evidence. Keep run-specific results outside this page and follow
[testing](../development/testing.md).

| Film capability                           | Current implementation                                                                                                             | Evidence and remaining boundary                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Build a tool from selected files          | Implemented: the command creates a contextual draft; sending is explicit.                                                          | [Command entry](../../packages/viewer-electron/app/src/renderer/commands/window-commands/comparison.ts). This does not inspect an entire robot package automatically.                                                                                                                                                                                                                      |
| Generate and revise selectable HTML       | Implemented: complete revisions, revision checks, saved state and bounded runtime-error repair.                                    | [Chat owner](../../packages/viewer-electron/app/src/desktop/chat/service.ts), [runtime](../../packages/viewer-electron/app/src/desktop/canvases/runtime.ts), [chat tests](../../packages/viewer-electron/app/tests/chat.test.ts). A loaded page does not establish correct calculations.                                                                                                   |
| Bind files as evidence                    | Implemented: bounded facts, excerpts, coverage and table snapshots; explicit refresh.                                              | [Snapshot builder](../../packages/viewer-electron/app/src/desktop/canvases/sources.ts), [source tests](../../packages/viewer-electron/app/tests/canvas-productivity.test.ts). Large text excerpts can be partial. Complete URDF inputs now also carry a bounded semantic joint tree; incomplete definitions are refused.                                                                   |
| Preserve inputs and branch from a passage | Implemented: exact quote offsets, frozen context, independent canvas state and conflict-aware application.                         | [Chat tests](../../packages/viewer-electron/app/tests/chat.test.ts), [canvas tests](../../packages/viewer-electron/app/tests/canvases.test.ts). Robot alternatives use this foundation without changing the original task.                                                                                                                                                                 |
| Render a 3D model                         | Implemented: bundled Three.js, OrbitControls, GLTFLoader, STLLoader and a pure forward-kinematics module.                          | [Bundled libraries](../../packages/viewer-electron/app/tools/canvas-libraries.ts), [model viewer](../../packages/viewer-electron/app/src/desktop/canvases/model-app.ts), [native fixture](../../packages/viewer-electron/app/tests/native/canvases.ts). URDF joint transforms are available through `viewer/robotics`; bounded position solving is available; collision checks are absent. |
| Open source evidence                      | Implemented for generic snapshots and their captured anchors.                                                                      | [Source controls](../../packages/viewer-electron/app/src/renderer/canvases/CanvasSources.tsx). URDF joints retain exact captured definitions. `openSource(sourceID,jointName)` selects one for host review and source navigation; it cannot supply arbitrary paths.                                                                                                                        |
| Review and save output                    | Implemented for CSV, JSON, Markdown and text, with revision checks and exclusive new-file saves.                                   | [Canvas service](../../packages/viewer-electron/app/src/desktop/canvases/service.ts), [result tests](../../packages/viewer-electron/app/tests/canvas-productivity.test.ts). JSON syntax validation is not robot motion validation.                                                                                                                                                         |
| Export, reopen and retain state           | Implemented for canvas HTML, state, assets and portable snapshots.                                                                 | [Canvas tests](../../packages/viewer-electron/app/tests/canvases.test.ts), [native productivity fixture](../../packages/viewer-electron/app/tests/native/canvas-productivity.ts). The robot comparison fixture covers saved candidates and paused visual replay; portable imports retain their own check and drop the fork link.                                                           |
| Read robot structure and linked meshes    | Implemented for a bounded URDF subset and scoped binary STL visual meshes. MJCF is not supported.                                  | [Robot reader](../../packages/viewer-electron/app/src/domain/robotics/urdf.ts), [mesh attachment](../../packages/viewer-electron/app/src/desktop/canvases/robot.ts). The SO-101 fixture pins the follower definition and all visual assets. Publication rights still need final review.                                                                                                    |
| Move joints and solve targets             | Implemented: forward kinematics, bounded position-only solving and hard position-limit reporting.                                  | [Motion library](../../packages/viewer-electron/app/src/domain/robotics/kinematics.ts), [independent pose tests](../../packages/viewer-electron/app/tests/robotics.test.ts) and [native robot fixture](../../packages/viewer-electron/app/tests/native/robotics.ts). The fixture UI is supplied test code, not live Meta evidence.                                                         |
| Independently check robot results         | Implemented for endpoint positions and hard joint limits, with saved-input and source bindings.                                    | [Desktop checker](../../packages/viewer-electron/app/src/desktop/robotics/check.ts) uses separate point propagation. [Target tests](../../packages/viewer-electron/app/tests/robot-targets.test.ts) cover SciPy reference agreement, stale inputs and restart. No interval, orientation or collision verification is provided.                                                             |
| Compare base placements and replay poses  | Implemented: native comparison requires equal model, world targets, tool and tolerance; offline replay interpolates copied joints. | [Comparison owner](../../packages/viewer-electron/app/src/desktop/canvases/robot-check.ts), [replay module](../../packages/viewer-electron/app/src/domain/robotics/replay.ts), [native comparison fixture](../../packages/viewer-electron/app/tests/native/robot-comparison.ts). Both tasks are checked again after restart. Visual interpolation does not check intervals.                |
| Qualify the generated robot workflow      | Verified in native replay of actual Meta output: articulated creation, target-solving refinement and an exact quoted alternative.  | The alternative keeps the original unchanged and passes independent endpoint checks. Comparison save, paused replay, export/reopen and cold restart passed. A valid response rejected by a local parser was recovered unchanged; failures remain retained. This is functional qualification, not finished footage.                                                                         |
| Browse a service page                     | Implemented: the local supplier runs in a real browser plane and saves a reply for the exact drawing hash.                         | [Browser owner](../../packages/viewer-electron/app/src/desktop/browser/browser-planes.ts), [supplier fixture](../../packages/viewer-electron/app/tools/mounting/supplier.ts). The exchange is a local simulation; browser access does not grant agent access.                                                                                                                              |
| Prepare the mounting plate                | Generated plate controls pass width editing, measured DXF export, native reopen and input persistence.                             | [Drawing validator](../../packages/viewer-electron/app/src/domain/canvases/drawing.ts), [native qualification](../../packages/viewer-electron/app/tools/mounting/qualify.ts). Source meshes are displayed with assigned dimensions for the fictional job. Physical fabrication is outside the demo.                                                                                        |
| Compare a simulated cutting quote         | The generated comparison reads the saved reply, changes deadline eligibility and saves the selected quote with the drawing hash.   | Native qualification covers the three-to-seven-day transition, Economy selection, Markdown save and restart. The model repaired an unsupported import after native execution exposed it. No external supplier or order is involved.                                                                                                                                                        |
| Show the interface acquiring capabilities | The selected robot study has generated controls and saved-output evidence.                                                         | Record the initial inspector, changed request, added target controls and the resulting checked base position. Match narration to actual actions. Tool qualification does not establish audience comprehension.                                                                                                                                                                             |

The [canvas reference](../reference/canvases.md) owns current APIs and limits. The SDK exposes
state, sources, assets and reviewed proposals/exports. The offline motion library computes supplied
joint poses. It supplies a bounded position solver and a request for independent endpoint checks in
Viewer. It does not expose arbitrary native execution. The current native robot fixture is
development evidence, not the completed movie.

## Qualification and work before filming

Use existing document, canvas, preview, operation and conversation owners. Extend their capabilities
where needed; avoid a parallel application or a hardcoded success demonstration.

### Retained robot qualification

The following checklist describes the qualified two-target exercise. Recording must still show the
requirement change and the resulting decision clearly.

| Order | Required work                                                                                                         | Acceptance                                                                                                                                                               |
| ----- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Pin and inspect the model package. Resolve approved meshes and record source versions, calibration, units and frames. | Complete selected joint tree and resources; missing or unsupported data remains explicit. No network or arbitrary file access from generated HTML.                       |
| 2     | Add articulated motion from the parsed model and source-linked joint controls.                                        | Known poses agree with an independent reference; limits and transform composition are tested. Clicking a constraint returns to its exact definition.                     |
| 3     | Add target placement and bounded solving through the generated workbench.                                             | Preserve input state across agent revisions; distinguish validated poses, established constraint violations and unresolved solver outcomes.                              |
| 4     | Add trusted checking outside generated HTML and bind results to model, inputs and candidate motion versions.          | Altered targets, base placement or source versions invalidate an earlier pass. Report units, residuals and which poses or intervals were checked.                        |
| 5     | Connect quoted alternatives to the completed task.                                                                    | Fork the actual explanation, retain original targets and show a changed base placement without silently changing the original.                                           |
| 6     | Export, reopen and qualify the complete workflow.                                                                     | Read back the saved result; recover the canvas and motion after restart; complete the real Meta creation/refinement/branch sequence within a separately approved budget. |

The generated workflow now completes the functional loop: the original candidates miss the fixed
targets, an explicitly moved base yields candidates within tolerance, and Viewer independently
checks and saves the comparison. This does not prove the original placement unreachable. The
[robot snapshot decision](../adr/0013-robot-model-snapshots.md) records the implemented foundation.
The [target-check decision](../adr/0014-robot-target-checks.md) records the solving and
endpoint-check boundary. The work items above remain the acceptance checklist; their implementation
is complete for this bounded case. The presentation copy has passed a foreground input rehearsal.
Retained footage covers that exercise's controls and handoff. The selected film must make the added
capabilities and the resulting decision clear. A supplied HTML fixture cannot qualify generated
controls or a model explanation. The
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

- **Meta:** interpret approved source material, generate and revise the interactive tool, and
  investigate the quoted alternative. Verify the actual configured model before recording.
- **Viewer:** own source access, persistent state, assets, revision checks and reviewed output. The
  URDF reader owns model interpretation. The desktop endpoint checker binds its inputs to the
  source, targets, base placement, tool point and candidate poses.
- **The person:** frame the task, inspect assumptions and alternatives, confirm ambiguous units or
  dimensions, and approve the output.

A runtime `ready` observation only establishes that the page loaded. Reconstruction from a photo
would produce inferred geometry and is outside this film. SAM and photo-to-3D are not required for
the selected case and must not be credited as exercised unless separately demonstrated.

## Other workflows and references

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
