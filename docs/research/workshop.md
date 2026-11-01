# Viewer Workshop: interfaces built around a task

This is the selected hackathon direction and its implementation audit. The canvas foundation is
implemented. The proposed robot workbench still needs model ingestion, kinematics and independent
verification. The [screenplay](../release/hackathon-demo.md) owns narration, timing and capture
requirements; it is not evidence that those missing capabilities work.

## Product thesis

A project outlives the interface used for a particular task. Viewer keeps its files, sources,
conversations, alternatives and saved results together while an agent creates the controls needed
for the next question. The person directs structure, dependencies and consequences without having to
edit every file personally.

The film's “there is no interface” hook means there is no single predetermined interface the person
must learn before working. The agent generates a task-specific tool on top of dependable Viewer
capabilities. File formats alone do not supply editing semantics, geometry or verification. This is
not a claim that Viewer can generate complete Photoshop or AutoCAD replacements.

Plurid makes the relationships navigable. Quote branches keep another investigation beside its
source; independent canvases retain both alternatives. Spatial proximity does not grant access or
prove a dependency. Browser, editor and terminal remain different capabilities viewing the same
project. See [spatial development](spatial-development.md) and the
[product principles](../../PRODUCT.md).

## Selected case: can this arm reach the targets?

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

The table records source and test coverage, not a newly qualified robot workflow. Automated service
checks, fixture-based native scenarios and live-provider evidence are different kinds of evidence.
Keep run-specific results outside this page and follow [testing](../development/testing.md).

| Film capability                           | Current implementation                                                                                     | Evidence and remaining boundary                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build a tool from selected files          | Implemented: the command creates a contextual draft; sending is explicit.                                  | [Command entry](../../packages/viewer-electron/app/src/renderer/commands/window-commands/comparison.ts). This does not inspect an entire robot package automatically.                                                                                                                                                     |
| Generate and revise selectable HTML       | Implemented: complete revisions, revision checks, saved state and bounded runtime-error repair.            | [Chat owner](../../packages/viewer-electron/app/src/desktop/chat/service.ts), [runtime](../../packages/viewer-electron/app/src/desktop/canvases/runtime.ts), [chat tests](../../packages/viewer-electron/app/tests/chat.test.ts). A loaded page does not establish correct calculations.                                  |
| Bind files as evidence                    | Implemented: bounded facts, excerpts, coverage and table snapshots; explicit refresh.                      | [Snapshot builder](../../packages/viewer-electron/app/src/desktop/canvases/sources.ts), [source tests](../../packages/viewer-electron/app/tests/canvas-productivity.test.ts). Large model descriptions can be partial. No semantic robot reader was found.                                                                |
| Preserve inputs and branch from a passage | Implemented: exact quote offsets, frozen context, independent canvas state and conflict-aware application. | [Chat tests](../../packages/viewer-electron/app/tests/chat.test.ts), [canvas tests](../../packages/viewer-electron/app/tests/canvases.test.ts). This is the existing foundation for comparing base placements.                                                                                                            |
| Render a 3D model                         | Implemented: bundled Three.js, OrbitControls and GLTFLoader; a supplied GLB viewer.                        | [Bundled libraries](../../packages/viewer-electron/app/tools/canvas-libraries.ts), [model viewer](../../packages/viewer-electron/app/src/desktop/canvases/model-app.ts), [native fixture](../../packages/viewer-electron/app/tests/native/canvases.ts). GLB display does not implement joint semantics or reach checking. |
| Open source evidence                      | Implemented for generic snapshots and their captured anchors.                                              | [Source controls](../../packages/viewer-electron/app/src/renderer/canvases/CanvasSources.tsx). The frame currently requests source review; it cannot address an arbitrary joint definition. Joint-to-source mapping is missing.                                                                                           |
| Review and save output                    | Implemented for CSV, JSON, Markdown and text, with revision checks and exclusive new-file saves.           | [Canvas service](../../packages/viewer-electron/app/src/desktop/canvases/service.ts), [result tests](../../packages/viewer-electron/app/tests/canvas-productivity.test.ts). JSON syntax validation is not robot motion validation.                                                                                        |
| Export, reopen and retain state           | Implemented for canvas HTML, state, assets and portable snapshots.                                         | [Canvas tests](../../packages/viewer-electron/app/tests/canvases.test.ts), [native productivity fixture](../../packages/viewer-electron/app/tests/native/canvas-productivity.ts). Robot-specific motion replay has not been qualified.                                                                                    |
| Read robot structure and linked meshes    | Missing: no URDF/MJCF reader with joint, transform, unit and scoped resource semantics was found.          | Generic XML/text and mesh previews are insufficient. A pinned model and companion-resource path are required.                                                                                                                                                                                                             |
| Move joints and solve targets             | Missing: no forward/inverse kinematics owner, joint-limit solver or target interaction was found.          | Generated JavaScript can draw an animation, but no such animation has been qualified against the actual arm.                                                                                                                                                                                                              |
| Independently check robot results         | Missing: no trusted robot checker or canvas-to-checker interface was found.                                | Existing DXF fabrication verification is a separate domain. Generated HTML must not certify its own conclusions.                                                                                                                                                                                                          |
| Complete the robot film                   | Unverified and blocked on the missing capabilities above.                                                  | Existing supplier evaluations and 3D fixtures do not establish this workflow.                                                                                                                                                                                                                                             |

The [canvas reference](../reference/canvases.md) owns current APIs and limits. The SDK exposes
state, sources, assets and reviewed proposals/exports. It does not expose a robotics solver or
arbitrary native execution. This audit does not add a public interface or change those boundaries.

## Work required before filming

Use existing document, canvas, preview, operation and conversation owners. Extend their capabilities
where needed; avoid a parallel application or a hardcoded success demonstration.

| Order | Required work                                                                                                         | Acceptance                                                                                                                                                               |
| ----- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Pin and inspect the model package. Resolve approved meshes and record source versions, calibration, units and frames. | Complete selected joint tree and resources; missing or unsupported data remains explicit. No network or arbitrary file access from generated HTML.                       |
| 2     | Add articulated motion from the parsed model and source-linked joint controls.                                        | Known poses agree with an independent reference; limits and transform composition are tested. Clicking a constraint returns to its exact definition.                     |
| 3     | Add target placement and bounded solving through the generated workbench.                                             | Preserve input state across agent revisions; distinguish validated poses, established constraint violations and unresolved solver outcomes.                              |
| 4     | Add trusted checking outside generated HTML and bind results to model, inputs and candidate motion versions.          | Altered targets, base placement or source versions invalidate an earlier pass. Report units, residuals and which poses or intervals were checked.                        |
| 5     | Connect quoted alternatives to the completed task.                                                                    | Fork the actual explanation, retain original targets and show a changed base placement without silently changing the original.                                           |
| 6     | Export, reopen and qualify the complete workflow.                                                                     | Read back the saved result; recover the canvas and motion after restart; complete the real Meta creation/refinement/branch sequence within a separately approved budget. |

The first milestone is a short working loop: load the real arm, move a target, expose a checked
constraint, change the arrangement and show a checked result. Production remains gated until this
works. Robotics additions need their own implementation design; the table records gaps and
acceptance, not an existing solver API.

## Model and human responsibilities

- **Meta:** interpret approved source material, generate and revise the interactive tool, and
  investigate the quoted alternative. Verify the actual configured model before recording.
- **Viewer:** own source access, persistent state, assets, revision checks and reviewed output. A
  future trusted robotics capability must own model interpretation and numerical validation.
- **The person:** frame the task, inspect assumptions and alternatives, confirm ambiguous units or
  dimensions, and approve the output.

A runtime `ready` observation only establishes that the page loaded. Reconstruction from a photo
would produce inferred geometry and is outside this film. SAM and photo-to-3D are not required for
the selected case and must not be credited as exercised unless separately demonstrated.

## Other workflows and references

The [supplier regression](../development/testing.md#canvas-evaluation-and-replay) remains a small
case with known arithmetic, retained model responses and native export/restart checks. It is not the
film's central task. The [Job 1042 plan](audit-and-hackathon-plan.md) remains the fabrication
workflow; its requirement-verification and durable-check decisions still apply there.

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
