# There Is No Interface

This is the proposed three-minute film for Viewer. The screenplay is selected; the robot workflow is
not ready to film. The [implementation audit](../research/workshop.md#implementation-audit)
separates existing canvas capabilities from the robotics work still required.

The thesis is that the project persists while an agent creates the interface needed for the next
task. The person's work moves toward architecture, dependencies and consequences. The phrase “there
is no interface” introduces freedom from a fixed interface, not the absence of software.

Use one case: a maker or student opens the SO-101 robot project, explores its motion, checks target
positions, investigates a different base placement and saves the checked result. The robot is the
example; the product is creating tools around a person's project.

## Timeline and narration

The synthetic scene lasts nine seconds. Your voice carries the rest. All product shots are actual
Viewer footage. The demonstration starts at 0:47 and remains one task, with labeled cuts past
generation waits.

| Time      | Picture and action                                                                                                                                                                                        | Spoken words                                                                                                                                                                                                               |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:09 | A brief Matrix-inspired synthetic scene: a child and a visitor, a floating interface losing its rigid outline. On-screen caption: **AI-generated homage**. Cut directly into Viewer.                      | Character: “Do not try and use the interface. That’s impossible. Realize the truth. There is no interface.”                                                                                                                |
| 0:09–0:25 | Your narration begins over actual code and project navigation. Brief number overlays read **~1,000,000 lines written** and **≤10,000 lines edited since 2025**.                                           | “By 2025, I’d written roughly a million lines of code. Since then, I’ve edited at most ten thousand. Mostly configuration. I still build projects. What changed is where I spend my attention.”                            |
| 0:25–0:47 | Use the short shots below to connect source, result and consequence. End with browser, editor and terminal planes belonging to the same project.                                                          | “How the pieces fit together. What depends on what. What happens when something changes. I became the file manager. Browser. Editor. Terminal. Different views of the same project. So why should the interface be fixed?” |
| 0:47–1:18 | Open the robot files. Choose **Build tool from selection**, send the first prompt and show the canvas being created. Move one joint with its control. Keep the arm and its stated limit readable.         | “These files describe a machine. I ask the agent to build the tool I need to understand it.”                                                                                                                               |
| 1:18–1:46 | Send the second prompt. Show the workbench gaining target controls. Drag a target, display the actual check result and open the joint definition behind a constraint.                                     | “My question changes. The tool changes with it. The model’s constraints remain attached to their sources.”                                                                                                                 |
| 1:46–2:16 | Select the explanation of that constraint and choose **Ask about selection**. Send the third prompt. Show the independent alternative beside the original, with the same targets.                         | “A question about one detail becomes another line of investigation. I can compare both without losing where I started.”                                                                                                    |
| 2:16–2:45 | Run the independent check, inspect its result and replay the candidate motion. Review and save the JSON result. Reopen the exported canvas and replay the saved motion. Mark any cut between these steps. | “The agent proposes the motion. A separate calculation checks it against the model. I inspect the result, save it and reopen the work.”                                                                                    |
| 2:45–3:00 | Briefly pull back to show the connected files, conversations and alternatives. End on the working result, then the Viewer title and contribution card.                                                    | “The project stays. The tools change. Viewer. The interface your task needs, when you need it.”                                                                                                                            |

The line counts are the creator's personal estimate, not repository measurements or a productivity
benchmark. Record the voice-over at a natural pace and fit the edit to the three-minute ceiling.

### Short shots during the personal story

Keep each shot four to six seconds, with readable content and one visible action:

1. **Structure:** navigate from a project file to a linked view of its contents.
2. **Dependency:** put an actual source beside the result that uses it. Do not draw an inferred
   dependency graph and imply Viewer has analyzed the whole project.
3. **Consequence:** change a saved canvas input and show the resulting calculation or visual change.
4. **One project:** move through its browser, editor and terminal views. Use the three-part rhythm
   associated with the iPhone presentation, without depicting Steve Jobs or implying endorsement.

These shots explain the narration. They are not a separate feature tour or a claim that the robot
workflow already exists.

## The three requests

Show the submitted text clearly. The requests introduce new controls in the same workbench before
the final request creates an independent alternative.

**1. Understand the mechanism**

> Build a workbench for this arm. Let me explore its joints and keep their limits visible.

**2. Change the task**

> Let me place target points and check whether the arm can reach them.

**3. Explore an alternative**

> Explore moving the base while keeping the targets fixed.

Choose the third request from an exact passage in the model's actual response. Do not substitute a
scripted assistant message. If the response does not establish a constraint, resolve that in the
workbench before recording the branch.

## Inputs and continuity

Use the [SO-101 project](https://github.com/TheRobotStudio/SO-ARM100) and its
[simulation description](https://github.com/TheRobotStudio/SO-ARM100/blob/main/Simulation/SO101/README.md).
Pin the chosen follower model, meshes and documentation to one revision. Record hashes, notices,
units, coordinate frames and the selected calibration convention in the retained project manifest.
Confirm the rights of each published asset; a repository-level license does not resolve every
third-party component.

Prepare a public demonstration folder with no personal paths or credentials. Keep the same robot,
sources and target positions through the alternative comparison. The new base placement must be
visible and recorded. Pin the target coordinates only after independent checks establish the
intended contrast. A solver failing to find a pose is not proof that a target is unreachable.

Retain the actual generated HTML, prompts, responses, source snapshots, saved inputs and outputs.
The robot tool must visibly evolve through agent revisions. A supplied model and a tested geometry
library are supporting capabilities; identify them separately from the generated interface.

## Readiness before recording

The [implementation audit](../research/workshop.md#implementation-audit) owns code status. The
recording requires all of the following:

1. Load the actual model with its joint transforms, limits and approved mesh references.
2. Create the canvas through the configured Meta model and manipulate an articulated joint.
3. Add target interaction through a subsequent agent revision while preserving saved inputs.
4. Distinguish a validated pose, a demonstrated limit violation and an unresolved solver result.
5. Create the quoted alternative and compare both placements without changing the original.
6. Independently check the proposed poses and the stated scope of the motion sequence. A check of
   sampled poses must not be presented as continuous collision or physical safety validation.
7. Save the reviewed JSON, read it back, export and reopen the canvas, and replay its saved motion.
8. Verify persistence after a cold restart. Show that restart only if it is actually recorded.

First qualify a short prototype: load the arm, move a target, expose a checked constraint, change
the arrangement and demonstrate a checked result. If that loop fails, the film remains a script. Do
not replace it with fabricated success panels or a prerecorded animation labeled as computation.

## Capture and edit

- Film actual inputs and consequences. Use close framing for controls, source passages and check
  results. Reserve the wide spatial view for relationships and the closing reveal.
- Keep the source take. Label accelerated waits as **Generation accelerated** and replays as **Saved
  Meta session**. Keep failed requests in evaluation evidence.
- Existing inputs can survive an agent revision. Show the person changing a control when needed; a
  response claiming to have changed it is not evidence of a changed value.
- Capture the full application window, including native Save dialogs when shown. Renderer-only
  recordings omit those dialogs and cannot stand in for that footage.
- Use your narration and original or cleared audio. Keep the synthetic homage visibly separate from
  the real application. Confirm applicable event and asset requirements before production.
- Record a voice-over and captions after the task succeeds. Check their legibility and timing at
  delivery resolution. A silent rehearsal is not the completed film.
- Describe motion as kinematic. Do not claim physical actuation, successful grasping, load capacity
  or collision safety. Ambiguous dimensions and units still require human confirmation.
- Do not claim that Viewer generates complete replacements for Photoshop or AutoCAD. Show the
  bounded tool it creates and the underlying capabilities that make its result trustworthy.

The final card must distinguish the existing Viewer/Plurid foundation, verified event contributions,
the model actually used and third-party robot assets. Add public source and reproduction links only
when those destinations exist. See the [submission draft](hackathon-submission.md) and
[contribution inventory](hackathon-contributions.md).

Supplier-tool arithmetic and saved-response replay remain in
[canvas evaluation](../development/testing.md#canvas-evaluation-and-replay). Job 1042 remains the
[fabrication workflow](../research/audit-and-hackathon-plan.md). Neither is the current film
scenario.
