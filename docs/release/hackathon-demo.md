# There Is No Interface

**Narration and shot script for the submitted cut.** The words and times below match its captions
(`demo-v3.vtt`) and its narration track. The film is 2 minutes 51.2 seconds at 2880 × 1800.

Viewer and Plurid are existing projects. Viewer brings files, a browser and a terminal into one
spatial workspace. The film shows two things added during the hackathon. First, Meta reads real
work: a laser job checked live with Muse Spark and SAM 3.1, with Viewer measuring every number. Then
Meta builds the tool a task needs: a robotics plugin it extends, operates and branches to choose a
mounting point for an SO-101 arm at six tray slots.

## How the cut was made

| Part                | Time             | Source                                                                                         |
| ------------------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| Opening             | 0:00 to 0:09.1   | A rendered title sequence: CSS 3D planes with frames of the film, ending on the real workspace |
| The workspace       | 0:09.1 to 0:39.1 | Native recording of the released app (the earlier cut's footage, shortened)                    |
| The laser-job check | 0:39.1 to 1:07.0 | Native recording of a live check in the released app, Viewer 1.0.0 build 553                   |
| The robotics tool   | 1:07.0 to 2:45.5 | Native recording; Meta's edits and choices replay retained live responses                      |
| End card            | 2:45.5 to 2:51.2 | What was built during the event and the Meta models used                                       |

The opening's lines are titles: lower case, no full stops, in the picture and the captions. The
narration is one voice from start to end, generated with ElevenLabs (`eleven_multilingual_v2`) from
a clone of the author's own voice. It speaks the author's script; nothing in it is a model's reply.
Each passage starts where the picture needs it. The finished film plays 5% faster than it was
edited, picture and voice together; the voice keeps its pitch. Captions write numbers as numerals.

Key moments are zoomed into the native footage (up to 2.5×) and some are held as a still frame so
they can be read: the laser finding, the drawing, the DXF measurement and the saved correction; each
request sent to Meta, the table it adds, the target rows, the Front recommendation and the Rear
comparison. Holds add 10.4 seconds in total; nothing inside a frame is altered. Where a cut jumps
within one workspace, a short dissolve joins the shots.

Four short rendered scenes are cut in. They are drawn like the opening, and each starts and ends on
the footage's own frame at its cut:

- the flights from the Six-slot station workspace to Laser jobs (0:39.1) and back (1:07.0);
- the two moments Meta writes the robotics tool (1:23.9 and 1:49.3). Each shows the lines its saved
  response changed in the canvas HTML (+43, then +12 −8), taken from that response, with the tool's
  two sources and attached assets linked around it. The code then fades into the revised tool.

These scenes are the film's illustration. Viewer shows a canvas's code through **Tools → Source
code**, not as this animation.

## Script

### 0:00.5 to 0:07.8: the opening

> do not try and use the interface · that's impossible · realize the truth · there is no interface

Picture: Out of the dark, one distant plane. With each line more planes appear in depth, holding
frames of the files, terminal, browser, robot tool and laser drawing seen later. With "realize the
truth" thin links glow between them, as Plurid draws its links. On "there is no interface" the
planes come into focus, then the camera flies into the central plane, which is the first frame of
the real workspace.

### 0:08.3 to 0:20.9

> By twenty twenty-five, I'd written about a million lines of code. Since then, I've changed at most
> ten thousand lines, mostly configuration files. Now I spend less time in files, and more on how it
> all fits together.

Picture: Open the robot definition in a linked plane, then return to the project. Expand the mesh
folder and open the linked arm geometry.

### 0:22.3 to 0:32.3

> A browser. An editor. A terminal. A browser. An editor. A terminal. Are you getting it? One
> workspace.

Picture: Short cuts between the project brief in its browser plane, the source definition and the
terminal running ls. Then frame all planes to reveal the shared workspace.

### 0:33.5 to 0:38.7

> I built Viewer on Plurid, my spatial framework. I was working on both before the hackathon.

Picture: Move from the workspace into the Viewer conversation.

### 0:39.5 to 1:05.0: the laser-job check

> For this hackathon, I brought Meta into this space. I prepare laser jobs. Muse Spark reads the
> email and the drawing. Viewer checks every number. Then it walks me through my own files. SAM 3.1
> marks the feature. The part says forty-eight millimetres. The drawing says fifty. Caught before a
> sheet is cut.

Picture: A rendered flight from the Six-slot station workspace to Laser jobs. Job 1042's folder.
**⌘K**, **Check laser job…**, the check panel listing what is sent to Meta; **Check 7 files** and
"Muse Spark is reading the request, 1 drawing page and 5 DXF parts". The finding, graded
**Confirmed**: requirement 50 mm, DXF measured 48 mm, zoomed and held. **Play the tour**: the camera
flies to the request, to the drawing with SAM 3.1's outline, and to the DXF with its 48 mm pitch,
each zoomed. "Saved: pitch 48.00 mm → 50.00 mm, measured again."

### 1:07.5 to 1:15.0

> That check is built in, and Meta worked through it. When nothing is built in, the interface gets
> made on the spot, right beside my files.

Picture: A rendered flight back to the Six-slot station. Open the existing robotics plugin and orbit
its model before requesting an edit.

### 1:17.0 to 1:22.3

> Here, I'm extending a robot tool to find where the arm can reach all six tray slots.

Picture: Type an exact retained request; zoom into it as sent and hold. A rendered scene: the camera
pulls back from the chat to the canvas, where the 43 lines Muse Spark's saved response added are
written, then flies into the revised plugin.

Typed request:

> Add a compact per-target results table for the selected mounting point, showing target name,
> measured residual in mm and whether it meets the tolerance.

### 1:25.6 to 1:40.4

> It adds the table, then runs the plugin's calculations for all four places we could mount the arm.
> From the centre, it reaches all six slots. I can click a row to look at that position.

Picture: Meta invokes the plugin evaluation and selects Central; the activity row names its actor.
Zoomed: the results, then the new target table as a row is clicked to inspect the measured pose.

### 1:41.9 to 1:47.1

> But now I need to keep the middle of the bench clear. I ask Meta to leave that area out.

Picture: Finish the first saved turn, then type the retained reserved-area request; zoom into it as
sent and hold. A rendered scene shows the response's change to the canvas HTML (+12 −8), then flies
into the changed tool.

Typed request:

> Reserve the central mounting area: X 140 to 260 mm, Y 120 to 240 mm, including its boundary. Use
> the existing control and bench overlay, and add an explanation of which candidates this
> restriction excludes.

### 1:50.8 to 1:56.9

> It adds an explanation to the tool and runs the calculations again. This time, it recommends the
> front.

Picture: The plugin shows the restriction explanation. Meta evaluates and selects Front, zoomed and
held.

### 2:01.1 to 2:13.6

> I'd like to check the rear too, so I select the recommendation and ask about it in a separate
> conversation. The rear works, but I'd have to move the base another sixty-seven millimetres.

Picture: Select the actual recommendation and open its quote branch in a new plane. Meta invokes the
plugin checks and selects Rear in the quoted alternative; its comparison is zoomed and held.

Typed request:

> Compare the rear mounting point with the front mounting point.

### 2:17.4 to 2:24.3

> I'll use the front. Now I can save the result and the tool I used to get it.

Picture: Return from the alternative to the Front tool through the workspace. Save the plugin result
through the Viewer file picker, then export the tool.

### 2:28.7 to 2:32.7

> When I reopen it, my settings are there and I can carry on using it.

Picture: Reopen the unchanged exported plugin and use its target table.

### 2:33.6 to 2:44.9

> We used to build the interface before the work could begin. Now, working on the project tells us
> what the interface needs to become. As we understand more, as we change our minds, the tools
> change with us.

Picture: Use the new target controls and watch the arm adopt that pose. Open the Tool library. Pull
back to the connected project, tools and alternative.

### 2:45.5 to 2:51.2: end card

On screen: **Viewer**, _a plurid technology_; "Built during the hackathon, Oct 27 to Nov 4" with
rows of what was built; "Meta models: Muse Spark · SAM 3.1"; `plurid.com/viewer`. No narration.

## What each part contributes

| Part            | Observable responsibility                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Meta            | Muse Spark reads the laser job and writes its finding and tour; SAM 3.1 outlines a feature. In the robotics tool, Muse Spark adds the table and explanation, invokes actions and picks each mount |
| Viewer          | Measures every DXF and grades each finding, plays the tour, saves the reviewed correction; supplies the canvas host, actions, revisions, saved inputs, export and the Tool library                |
| Robotics plugin | Interprets the robot, renders its meshes, solves candidate poses and checks endpoints using its attached calculation module                                                                       |
| Plurid          | Connects project files, the check, conversations, tools and alternatives through navigable planes                                                                                                 |

The laser check's finding is **Confirmed** because Viewer measured the DXF and the model quoted the
drawing's full requirement. Of three live checks recorded for the film, this one was confirmed; in
the other two the model quoted only "50", so Viewer left the finding Unverified. In the recorded
take SAM 3.1 outlined the centre hole, not the pitched holes. The live evaluation of the same build
is in the [fabrication reference](../reference/fabrication.md#live-evaluation).

The robotics parser, solver and checker are reused plugin code. The film does not attribute them to
the Meta requests or to the Viewer host. The station is fictional; its checks cover endpoints and
hard joint limits, not continuous motion, collisions, grasping or hardware.

## Production notes (not on screen)

- Viewer and Plurid existed before the event; the laser check, canvases, actions, quote branches and
  the Tool library were built during it.
- The laser scene is a live check. The model's wait, 129 seconds, is cut between shots, and the
  tour's flights are shortened.
- The whole film plays 5% faster than its edit, picture and voice together.
- The robotics scenes replay retained Meta responses, with duplicate writes and a repair condensed,
  a staged entrance for the first revised tool and camera moves slowed by 75%.
- The narration voice is generated with ElevenLabs from a clone of the author's voice.
- The opening is a rendered title sequence, not app footage, ending on the app's first frame. The
  workspace flights and the two code scenes are rendered the same way.
- SO-ARM100 robot model: TheRobotStudio. The station is fictional.

## Reproduce

The laser takes come from `tools/fabrication/record.ts`
([media production](../media/README.md#record-the-laser-job-check)). The robotics footage comes from
the [plugin recording](../media/README.md#record-the-plugin-workflow). Keep the source takes, the
edit list, the narration takes with their request IDs and the caption file with the delivered MP4.

## Implementation and evidence

The [canvas reference](../reference/canvases.md) defines the generic host contracts and the
[generated-tool decision](../adr/0015-generated-tool-host.md) assigns domain behaviour to plugins.
The [fabrication reference](../reference/fabrication.md) owns the laser check. The
[contribution inventory](hackathon-contributions.md) distinguishes prior work, event changes and
third-party components.
