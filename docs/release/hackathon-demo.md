# There Is No Interface

**Reading draft: a project acquires the tools its task needs.** The delivered edit generates its
exact spoken transcript and captions from the timed capture cues. This page describes the story and
the actions that must support it.

The concrete question is where to place a robot so its gripper can reach two fixed work points.
Start with project files. Ask Meta for an inspector, then ask it to add target testing. Use the new
controls to change the base position and check the result. The transformation of the tool is the
main event. The mounting drawing and supplier comparison remain separate examples of the same
foundation; they are not the centre of this film.

Keep the film under three minutes, including credits. These are approximate scene allocations;
`Narration.txt` beside a delivered video is its exact transcript. Reuse retained Meta sessions with
their source messages and repair history. No new paid call is needed to record this sequence.

## Script

### 0:00–0:08 · Opening

**Voice**

> Do not try and use the interface.
>
> That's impossible.
>
> Realize the truth.
>
> There is no interface.

**Picture:** The proposed Matrix-style opening, followed by a cut into Viewer. Final opening footage
and voice are still to be made. Keep any synthetic homage distinct from the app footage.

### 0:08–0:22 · What changed

**Voice**

> Until 2025, I'd written about a million lines of code. Since then, I've modified ten thousand at
> most, mostly configuration files.

**Picture:** Begin in the robot project's folder. Open its model definition, then follow a related
file into another plane. Keep the pointer visible so each new view follows an action.

### 0:22–0:29 · Directing the project

**Voice**

> Now I spend more time deciding how a project fits together, what changes, and what that affects.

**Picture:** Pull back far enough to see the source, model and project notes together. Follow one
relationship between them. The files are the material of the project; their connections explain the
person's work.

### 0:29–0:43 · The keynote reveal

**Voice**

> A browser.
>
> An editor.
>
> A terminal.
>
> A browser. An editor. A terminal.
>
> Are you getting it?
>
> One workspace.

**Picture:** Focus each corresponding plane on its first mention. Repeat the sequence a little
faster, pause on the question, then pull back on “one workspace.” The three views are visibly part
of the same project. Use the cadence of the iPhone reveal; the spatial reveal in Viewer carries the
joke. Any Jobs homage belongs to the opening treatment, separate from the product recording.

### 0:43–0:51 · Viewer and Plurid

**Voice**

> This is Viewer. Plurid is its spatial engine. I was building both before this hackathon.

**Picture:** Hold the workspace, then follow the model's link back to the project folder. Let the
movement explain Plurid instead of adding an abstract diagram.

**On-screen text:** “Viewer + Plurid · Existing projects”

### 0:51–1:00 · The hackathon addition

**Voice**

> For the hackathon, I gave Meta a canvas. It builds working interfaces from the project's files.

**Picture:** Select the robot sources and open the native Viewer chat. Keep the empty area where the
generated tool will appear visible beside it.

**On-screen text:** “Built for the hackathon · Agent-generated interfaces”

### 1:00–1:22 · Ask for an inspector

**Voice**

> I need to choose where to mount this arm so its gripper can reach two fixed points. First, let me
> explore the model.
>
> The files become an interactive model. I can move a joint and open the definition behind it.

**Typed request**

> Build an interactive tool from the attached SO-101 robot folder.

**Picture:** Type the exact first sentence of the retained request in the native composer. Open the
resulting canvas. Reveal the actual model and joint controls. Move the shoulder, then follow its
source control into the model definition. Keep the request and the working result in the same
passage. The full retained request and repair history remain in the capture evidence.

### 1:22–1:40 · Change the requirement

**Voice**

> Now add the two work points, and let me test the base position.
>
> The same tool gains target controls, a solver, and a check against the robot model.

**Typed request**

> Read task.json and add editable world-coordinate targets A and B, base placement controls, and
> position solving for the stated tool and tolerance.

**Picture:** Return to the same conversation plane. Type this exact excerpt of the saved refinement
request. Open the revised tool. Keep the robot visible while the target and base controls appear.
Show both markers in world space. The new requirement produces new capabilities; changing a value in
a form alone would not demonstrate that.

The two points are assigned work positions for a kinematic study. Their coordinates come from the
retained task. Do not add a pick-and-place success, collision-free route or physical robot action
that was never implemented.

### 1:40–1:48 · Establish the problem

**Voice**

> At this base position, the candidate poses miss both points.

**Picture:** Run **Check poses** and open Viewer's report. The existing candidate errors are about
167 mm and 127 mm. Identify the two points through their A/B labels. A failed candidate is not proof
that a point is unreachable. Keep the problem understandable before introducing the next action.

### 1:48–2:10 · Use the capability just added

**Voice**

> Move the base fifty-five centimetres, and solve again.
>
> Both endpoints are now within one millimetre of their targets. The result is checked outside the
> generated interface.

**Picture:** Open **Coordinates and tolerance**, set **base x** to **0.55 m**, then use **Solve
both** and **Check poses**. The robot moves while the world targets remain fixed. Display the new
measured endpoint errors. Replay the candidate poses briefly after the check, with the same tool and
target coordinates. The native checker must confirm the result before the narration claims it
passed.

This is the practical result: a tested base position for the stated endpoint task. The check covers
endpoint positions and hard joint limits. It does not check the intervening path, collisions or
physical hardware. Keep that scope visible in the tool and credits without interrupting the task
with unrelated warnings.

### 2:10–2:30 · Keep working beyond the conversation

**Voice**

> Save the tool with its sources and inputs. Open it again, and continue working.

**Picture:** Export the actual canvas through Viewer's picker. Reopen that export and operate its
replay controls. Verify that the reopened task matches the one just checked. This is a retained
working tool, not an image of a generated screen.

### 2:30–2:40 · Return to the project

**Voice**

> I opened a project. I asked for a way to work on it. The interface grew with the task.

**Picture:** Use **Frame all planes** to reveal the connected source, conversation, model and saved
tool. Preserve the triggering input and camera motion. Hold the workspace long enough to recognize
what was added during the sequence.

### Credits

Credit Viewer and Plurid as existing projects, then the hackathon additions. Identify Meta
`muse-spark-1.3`, TheRobotStudio / SO-ARM100, saved-session playback, condensed repairs, staged
reveals and local layout refinements. Temporary narration and the opening study are production
placeholders. The existing contribution inventory owns implementation attribution.

## Capture and narrative requirements

- Record native 2880 × 1800 PNG frames with a 1440 × 900 logical viewport and double pixel density.
  Verify each frame's dimensions. Encode the delivery once from those sources; never enlarge the old
  1440 × 900 cut to claim higher-resolution capture.
- Use actual Viewer chat and controls. Keep input cues clear and captions outside the working area.
- Introduce Viewer, Plurid and the hackathon addition before the technical example.
- Show the initial tool before the request that changes its capabilities. Preserve the visible cause
  and result of each action.
- Keep the full retained request, selected excerpt offsets, generated revisions and omitted repair
  rounds in the capture evidence. Reveal timing is editorial, not measured model latency.
- The drawing and quotation examples are supporting capabilities. Do not make choosing a cheap quote
  the payoff of this film.

## Implementation and evidence

The [Workshop audit](../research/workshop.md#implementation-audit) records the generated robot
interfaces, target solving, independent endpoint checks, comparison, export/reopen and restart. The
recording must exercise the selected revision's controls and record the resulting measurements.
Earlier qualification does not prove a new take completed its actions.

The [canvas reference](../reference/canvases.md) owns current APIs and limits. Viewer supplies
source access, motion calculations, verification, persistence and exports. The agent creates the
interface and connects those capabilities to the task. The film demonstrates this example, not
complete replacement of every specialist application.

The separate mounting demonstration retains native evidence for measured DXF export and a
source-bound simulated supplier reply. Its assigned plate dimensions do not describe this reach
study, and its fictional service is not a real ordering integration.

## Final production handoff

Review the delivered video with its generated `Narration.txt` and `Captions.srt`. Those files share
the exact cues used to synthesize the review audio. Confirm that a first-time viewer can explain
what Viewer is, what changed in the interface, and what decision the new controls enabled.

Replace the temporary voice and opening study after that review. Retain the native source frames,
input log, source-message attribution and measured outputs. Verify the final duration and encoded
resolution, then prepare the contribution receipt and submission materials from the demonstrated
behavior. A restart qualified outside the recording must not be described as a filmed action.
