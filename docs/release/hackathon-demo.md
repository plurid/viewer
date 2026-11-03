# There Is No Interface

**Exact script of the station review cut.** The spoken words and times below are generated from the
same cues as its audio, `Narration.txt` and `Captions.srt`. The opening and system voice are
temporary. This script replaces the previous reading draft; it does not describe older cuts.

The task is to choose a mounting point for an SO-101 arm serving six slots in two trays. Meta builds
the tool, invokes its actions, reads Viewer's independent checks and adapts it to a reserved area.
The operator selects Central after Meta recommends it. Meta selects Front and the Rear alternative.
Plurid connects the sources, conversation, alternatives and saved result.

## Script

### 00:00:00.467 to 00:00:02.533

> Do not try and use the interface.

Picture: Opening title study.

### 00:00:03.328 to 00:00:04.372

> That's impossible.

Picture: Opening title study.

### 00:00:04.829 to 00:00:06.071

> Realize the truth.

Picture: Opening title study.

### 00:00:06.688 to 00:00:08.012

> There is no interface.

Picture: Opening title study.

### 00:00:09.405 to 00:00:18.763

> Until twenty twenty-five, I had written about a million lines of code. Since then, I have modified
> ten thousand at most, mostly configuration.

Picture: Open the robot definition in a linked plane, then return to the project.

### 00:00:20.636 to 00:00:28.612

> I still build projects. But my attention has moved: how the pieces connect, what changes what, and
> whether the result works.

Picture: Expand the mesh folder and open the linked arm geometry.

### 00:00:33.670 to 00:00:34.424

> A browser.

Picture: Pull back through the workspace, focus the project brief and let the browser plane settle.

### 00:00:39.003 to 00:00:39.630

> An editor.

Picture: Move through the workspace to the source definition, then use Command+E to edit it.

### 00:00:44.696 to 00:00:45.427

> A terminal.

Picture: Move through the workspace to the terminal and run ls after arriving.

### 00:00:47.528 to 00:00:52.392

> A browser. An editor. A terminal. Are you getting it? One workspace.

Picture: Frame all planes to reveal the shared spatial workspace.

### 00:00:54.282 to 00:00:58.229

> This is Viewer, built on Plurid. Both existed before the hackathon.

Picture: Move from the workspace into the actual Viewer conversation.

### 00:01:02.029 to 00:01:09.158

> For the hackathon, I gave Meta tools of its own. Here, it must place a robot that can reach six
> tray slots.

Picture: Type the retained request, send it and open the generated canvas.

Typed request:

> Build a placement tool from this robot and station brief. Test the mounting points and tell me
> which one needs the smallest move.

### 00:01:12.908 to 00:01:16.995

> It turns the robot files and station brief into this working interface.

Picture: Reveal the actual station view and working controls.

### 00:01:18.996 to 00:01:26.926

> Meta runs the tool. Four mounting points. Six targets each. Viewer checks the computed poses
> against the source robot.

Picture: The activity row names Meta. Show the independently recomputed report.

### 00:01:29.171 to 00:01:32.875

> Central reaches all six with the shortest move. I select it.

Picture: The operator selects Central, inspects a target and checks the saved selection.

### 00:01:35.870 to 00:01:40.548

> Now the central area is needed for something else. I ask Meta to reserve it.

Picture: Return to the same conversation and type the reserved-area request.

Typed request:

> Reserve the central mounting area: X 140 to 260 mm, Y 120 to 240 mm. Add a control and bench
> overlay for this mounting-point restriction.

### 00:01:43.725 to 00:01:48.694

> It adds the restriction to the interface, evaluates again, and selects Front.

Picture: The revised tool adds the restriction. Meta evaluates and selects Front.

### 00:01:50.942 to 00:01:58.117

> The choice changes for a reason: six targets reached, within a millimetre, with the central
> mounting point excluded.

Picture: Read the checked candidate values and the Front recommendation.

### 00:02:00.710 to 00:02:06.213

> What about the rear mounting point? I branch from that recommendation and ask Meta to test it.

Picture: Select the actual recommendation and open its quote branch in a new plane.

Typed request:

> Compare the rear mounting point with the front mounting point.

### 00:02:09.169 to 00:02:15.368

> Rear passes too. But it needs a sixty-seven millimetre longer move. Front wins this comparison.

Picture: Meta selects Rear. Show the independent comparison and movement distances.

### 00:02:22.460 to 00:02:25.270

> I keep the checked result and the working tool together.

Picture: Save the check through Viewer's file picker, then export the tool.

### 00:02:34.415 to 00:02:38.688

> Reopen it, and the inputs, controls and checked decision come with it.

Picture: Reopen the exported tool and inspect another target using its controls.

### 00:02:41.411 to 00:02:51.175

> Meta wrote the tool, used it, and revised it when the job changed. I didn't open a robotics
> application. I opened my project and asked for what I needed.

Picture: Hold the reopened Front tool, then pull back into the project before the title.

### Credits

- Viewer + Plurid: existing projects
- Hackathon: generated tools, agent actions, quoted branches and independent checks
- Meta muse-spark-1.3 · Robot: TheRobotStudio / SO-ARM100
- Saved Meta responses · Condensed repairs · Local presentation edits and staged reveals
- Fictional station · Endpoint checks · Temporary opening and voice

## What each part contributes

| Part             | Observable responsibility                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Meta             | Generates and revises the interface; invokes its registered actions; uses actual results to choose its next step and explain the decision |
| Generated canvas | Renders the robot and task; provides the same working handlers to the person and agent                                                    |
| Viewer           | Owns source access, action execution, cancellation, independent checks, saved state and reviewed output                                   |
| Plurid           | Connects source, conversation and alternatives spatially; keeps both investigations accessible during comparison                          |

An invocation marked **Completed** only means the handler ran. The endpoint claim belongs to the
separate Viewer report. The station study checks endpoint positions, hard joint limits and mounting
points. Orientation, swept motion, collisions, physical clamp fit and hardware are outside this
fictional example.

## Capture and narrative requirements

- Record native 2880 × 1800 PNG frames with a 1440 × 900 logical viewport and double pixel density.
  Verify the source pixels. Encode once; do not enlarge an older low-resolution film.
- Use the real Viewer chat. Keep the actor, action, result and next decision readable. Do not add a
  second fake chat or typography that competes with the app.
- Preserve input cues for shortcuts and movements. Every camera move follows a visible action.
- Reveal capabilities as the question requires them. The first interface must not already contain
  the reserved-area controls that the second request supposedly adds.
- Retain exact requests, responses, usage, failures, repair history and generated revisions. Typed
  excerpts need their source-message offsets. Condensed waits and staged reveals belong in credits
  and edit evidence; do not describe replay timing as live model latency.
- Credit Viewer and Plurid as prior projects. Attribute the model name recorded by the qualified
  run, TheRobotStudio / SO-ARM100, bundled calculation/rendering libraries and local presentation
  edits. The station presentation copy adds scene labels, the fictional-station designation,
  saved-state wording and accessible control labels locally. Keep its edit manifest with the
  capture. The contribution inventory owns implementation attribution.

## Implementation and evidence

The generic action API and mounting-study contract are documented in the
[canvas reference](../reference/canvases.md). The
[Workshop audit](../research/workshop.md#implementation-audit) separates previous live-model
evidence from the new local station qualification. The
[station native test](../../packages/viewer-electron/app/tests/native/station-actions.ts) exercises
real handlers, constraint changes, takeover, exact quote branching, comparison and portable reopen.
Its supplied HTML is explicitly a fixture. It is not evidence that Meta generated or operated it.

The separate six-slot run starts from public source snapshots and meshes with a blank canvas. Meta
generated and repaired the HTML, invoked evaluation, selected Front after the constraint change and
selected Rear in the exact quoted branch. Native checks confirmed the original stayed unchanged.
Both actual tools were exported, reopened and restarted without a configured provider; their saved
inputs and independently recomputed checks survived. The retained evidence includes failed calls,
host fixes and the operator's initial Central selection. The
[frozen prompts and acceptance](../research/workshop.md#station-generation-and-acceptance) define
the scope. The review film replays those retained responses through the ordinary chat service and
native action handlers, with independently recomputed results. Its capture evidence records local
envelope conversion, revision bindings and presentation edits separately from provider output.

## Final production handoff

Deliver `Script.md`, `Narration.txt` and `Captions.srt` from the exact audio cues beside the MP4.
Keep this canonical script synchronized when the cut changes. Check that a first-time viewer can
identify the task, what Meta did and why the decision changed. The
[station recording instructions](../media/README.md#record-the-station-decisions) reproduce the
native sequence and timed edit.

Replace the temporary voice and opening study after reviewing that edit. Preserve native source
frames, input logs, attribution and measured outputs. Prepare the contribution receipt from the
actual demonstrated behavior and attach the final uncommitted patch when no Git commit is requested.
