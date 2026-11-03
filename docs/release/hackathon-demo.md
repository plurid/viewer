# There Is No Interface

**Exact script of the plugin review cut.** The spoken words and times below come from the same cues
as its audio, `Narration.txt` and `Captions.srt`. The opening and system voice are temporary. This
script describes the current cut, not the earlier host-owned robotics experiments.

Viewer and Plurid are existing projects. Viewer brings files, a browser and a terminal into one
spatial workspace. The hackathon adds a host where an agent can create, revise and operate
specialized interfaces alongside those project views. This example starts with the existing robotics
code packaged as a plugin. Meta adds controls, uses its calculations and investigates an
alternative. The task is to choose a mounting point that gives an SO-101 arm a passing pose at each
of six tray slots.

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

### 00:00:09.481 to 00:00:19.245

> By twenty twenty-five, I'd written about a million lines of code. Since then, I've changed at most
> ten thousand lines, mostly configuration files.

Picture: Open the robot definition in a linked plane, then return to the project.

### 00:00:20.718 to 00:00:28.985

> I still have projects to build. I'm spending less time inside individual files, and more time
> figuring out how everything should work together.

Picture: Expand the mesh folder and open the linked arm geometry.

### 00:00:34.582 to 00:00:35.337

> A browser.

Picture: Pull back through the workspace, focus the project brief and let the browser plane settle.

### 00:00:39.957 to 00:00:40.584

> An editor.

Picture: Move through the workspace to the source definition, then use Command+E to edit it.

### 00:00:45.714 to 00:00:46.445

> A terminal.

Picture: Move through the workspace to the terminal and run ls after arriving.

### 00:00:48.534 to 00:00:53.399

> A browser. An editor. A terminal. Are you getting it? One workspace.

Picture: Frame all planes to reveal the shared spatial workspace.

### 00:00:55.286 to 00:01:00.812

> I built Viewer on Plurid, my spatial framework. I was working on both before the hackathon.

Picture: Move from the workspace into the actual Viewer conversation.

### 00:01:02.744 to 00:01:11.127

> For this hackathon, I added a way for Meta to create specialized interfaces right here, alongside
> my files, browser and terminal.

Picture: Open the existing robotics plugin and orbit its model before requesting an edit.

### 00:01:14.258 to 00:01:19.587

> Here, I'm extending a robot tool to find where the arm can reach all six tray slots.

Picture: Type an exact retained request excerpt and open the revised plugin. Its real viewport and
controls arrive from either side, then settle before use.

Typed request:

> Add a compact per-target results table for the selected mounting point, showing target name,
> measured residual in mm and whether it meets the tolerance.

### 00:01:22.773 to 00:01:28.462

> It adds the table, then runs the plugin's calculations for all four places we could mount the arm.

Picture: Meta invokes the plugin evaluation and selects Central. The activity row names its actor.

### 00:01:30.499 to 00:01:35.852

> From the centre, it reaches all six slots. I can click a row to look at that position.

Picture: Click the new target table and inspect the measured pose in the viewport.

### 00:01:38.895 to 00:01:43.841

> But now I need to keep the middle of the bench clear. I ask Meta to leave that area out.

Picture: Finish the first saved turn, then type the retained reserved-area request.

Typed request:

> Reserve the central mounting area: X 140 to 260 mm, Y 120 to 240 mm, including its boundary. Use
> the existing control and bench overlay, and add an explanation of which candidates this
> restriction excludes.

### 00:01:46.308 to 00:01:52.670

> It adds an explanation to the tool and runs the calculations again. This time, it recommends the
> front.

Picture: The plugin shows the restriction explanation. Meta evaluates and selects Front.

### 00:01:55.001 to 00:02:01.166

> I'd like to check the rear too, so I select the recommendation and ask about it in a separate
> conversation.

Picture: Select the actual recommendation and open its quote branch in a new plane.

Typed request:

> Compare the rear mounting point with the front mounting point.

### 00:02:03.910 to 00:02:09.749

> The rear works, but I'd have to move the base another sixty-seven millimetres. I'll use the front.

Picture: Meta invokes the plugin checks and selects Rear in the quoted alternative.

### 00:02:16.871 to 00:02:19.878

> Now I can save the result and the tool I used to get it.

Picture: Save the plugin result through the Viewer file picker.

### 00:02:29.235 to 00:02:33.229

> When I reopen it, my settings are there and I can carry on using it.

Picture: Reopen the unchanged exported plugin and use its target table.

### 00:02:36.322 to 00:02:41.791

> I can find it again in the tool library, or make a copy when I need to try something different.

Picture: Open the Tool library and show the saved tool controls.

### 00:02:44.886 to 00:02:50.203

> I want to be able to open any project and ask for the tools I need, right where I'm working.

Picture: Hold the final project overview as the narration finishes.

### Credits

- Viewer + Plurid: existing projects
- Hackathon: agent canvases, actions, quoted branches and tool management
- Meta muse-spark-1.3: interface edits and decisions · Reused robotics plugin
- Saved Meta responses · Condensed repairs · Staged entrance · Slower camera moves
- SO-ARM100 / TheRobotStudio · Fictional station · Temporary opening and voice

## What each part contributes

| Part            | Observable responsibility                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Meta            | Adds the target-results table and restriction explanation; invokes plugin actions; selects Central, Front and the quoted Rear alternative from their results |
| Robotics plugin | Interprets the robot, renders its meshes, solves candidate poses and checks endpoints using its attached calculation module                                  |
| Viewer          | Supplies context, isolated execution, action contracts, revisions, saved inputs, result review, portable export and the Tool library                         |
| Plurid          | Connects project files, conversations, tools and alternatives through navigable planes                                                                       |

The parser, solver and checker are reused code. The film does not attribute them to these Meta
requests or to the Viewer host. A handler marked **Completed** means that action finished; the
plugin owns its domain result. External qualification checked selected outputs independently and is
test equipment, not a Viewer robotics feature.

The station is fictional. Its assigned targets and dimensions support endpoint and hard joint-limit
checks. It does not establish continuous motion, collision avoidance, grasping or hardware
operation.

## Capture and narrative requirements

- Preserve the personal million-lines versus ten-thousand-lines account, the browser/editor/terminal
  repetition and “Are you getting it?” callback, and the introduction of Viewer and Plurid as prior
  projects.
- Explain the general purpose before showing robotics: Meta creates specialized interfaces inside
  the shared workspace. This example extends the existing robotics plugin.
- Start with the working plugin. Show the request, the actual interface edit and a working control
  together so the viewer can follow what Meta changed.
- Use native Viewer chat and exact excerpts of the retained requests. Keep saved-session labels out
  of the chat controls and identify replay in the credits and evidence.
- Keep the qualified HTML and attached calculation module unchanged. The recorded actions run that
  code locally; they are not animations of invented results.
- Give the first revised interface one restrained spatial entrance. Its real viewport and controls
  approach from either side, then settle before use. Keep the workspace palette and avoid flashes, a
  literal Matrix set or repeated entrance effects. Credit this staging as part of the edit.
- Show both movement values during the alternative comparison. Save and reopen the working plugin,
  then show its Tool library controls before the final spatial view.
- Keep visible inputs and shortcuts. Camera moves take 75% longer in this edit; all other footage
  keeps its recorded timing. Preserve every navigation route and hold each destination before the
  next action. Capture native 2880 × 1800 pixels and encode once.
- Keep narrated words, typed prompts and scene directions separate. Generate the transcript and
  captions from the delivered audio cues, then update this page with that exact script.

## Implementation and evidence

The [canvas reference](../reference/canvases.md) defines the generic host contracts. The
[generated-tool decision](../adr/0015-generated-tool-host.md) assigns domain behavior to plugins.
The [Workshop audit](../research/workshop.md#implementation-audit) separates current qualification
from the earlier experiments. The [contribution inventory](hackathon-contributions.md) distinguishes
prior work, event changes and third-party components.

The recorded workflow starts from the retained reusable plugin. Meta writes the interface changes
and invokes evaluation and selection. A native quote branch preserves the original inputs and checks
Rear through the plugin's registered actions. The film saves the result, exports the tool, reopens
it and uses its target table. An external review then checks the reopened plugin against held-out
poses, altered targets and joint limits.

The separate qualification also reopened both alternatives after restarting Viewer without a
configured provider. That restart is supporting evidence, not a shot in this film. Keep its report
with the exported packages.

The first live turn reached its cap after producing the edit and selecting Central; it has no final
assistant reply. Its saved artifact passed review. The film stops that local turn after the last
saved action without inventing a reply. Duplicate writes and the branch verification continuation
are condensed. The loopback adapter retains source response hashes and exact typed excerpts while
binding actions to the current replay revision. It makes no new cloud requests.

The image, video and CAD closing montage remains proposed. Each example needs working generated code
and a visible edit before inclusion. This cut qualifies the reusable-plugin workflow; it does not
demonstrate those additional applications.

## Final production handoff

Deliver `Script.md`, `Narration.txt` and `Captions.srt` beside the MP4. The
[plugin recording instructions](../media/README.md#record-the-plugin-workflow) reproduce the native
sequence and timed edit. Keep the source frames, input logs, replay adaptations and qualification
reports with the capture.

Replace the temporary opening and voice for final submission. Prepare the contribution receipt from
the demonstrated behavior and the final source revision or uncommitted patch. Creating commits and
publishing the entry remain separate actions.
