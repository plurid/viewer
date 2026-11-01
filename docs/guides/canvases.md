# Build a canvas with a conversation

1. Select files and choose **Build tool from selection** from commands or their context menu. Choose
   a configured model and approve the data it may receive.
2. Complete the draft with the tool you need, for example: “Compare these supplier quotes. Let me
   change quantity, budget and deadline. Include a CSV export.” Send the request.
3. Use **Canvas** to open the linked app. Generated revisions appear in that same plane.
4. Change its controls, then ask the conversation to improve the app. Saved input values stay
   separate from the generated design. Viewer finishes pending input saves before sending a
   follow-up or creating a quote branch.

A canvas uses selectable HTML text, ordinary controls, SVG and JavaScript. You can also start in an
empty Chat plane. Under **Tools**, **Source code** shows the current code and **Undo revision**
returns to the previous design while retaining compatible inputs. **Stop** stops the page; **Tools →
Reload** opens the saved revision again.

Expand **Sources** or **Assets** above the canvas to inspect its inputs. File rows keep the source
action beside the filename; long lists scroll within the details area. Opening another details
section closes the previous one and leaves the canvas visible. Press **Escape** while working in an
open section to close it and return focus to its heading.

## Check sources and save a result

1. Open **Sources** to see the evidence snapshots used by the tool. **Open source** returns to the
   file or cited passage. **Inspect captured data** shows the data the tool received.
2. When a file changes, choose **Refresh snapshot**. The tool receives a new snapshot and keeps your
   saved inputs. A partial label means some content was omitted or could not be read.
3. Check calculations against the source evidence. A running preview does not verify conclusions.
   Confirm missing units, dimensions and assumptions before relying on them.
4. Choose the tool's export action. Viewer shows its proposed filename and exact text for review.
   Choose **Save result…** and a new destination. Existing files are not replaced. If the inputs
   change during review, prepare the result again.
5. Choose **Open saved file** to inspect the output in Viewer.

Tools can propose CSV, JSON, Markdown and plain-text results. Canceling the review or save picker
leaves the result unsaved. Source snapshots and saved inputs survive restarting Viewer.

## Explore an alternative

1. Select a passage in a message and choose **Ask about selection**. For a whole message, choose
   **Ask about this…**.
2. Continue in the linked conversation. **Inherited context** shows the messages captured through
   that passage. Later messages in the original conversation are not added to it.
3. Open its **Canvas** to work on an independent copy with its own inputs.
4. Use **Compare original** in the alternative canvas, then **Apply to original** when ready.

Applying preserves the original canvas's latest input values. If its content has changed since
branching, Viewer asks you to compare the versions instead of replacing that newer work. **Source
conversation** returns to the selected passage.

## Reconstruct one object from a photo

For an existing articulated robot definition, use the URDF workflow below. Photo reconstruction
produces a mesh without the machine's joints or constraints.

1. Add a Meta model that supports object selection in **Settings → Models**.
2. Under **3D reconstruction**, enter your separate fal API key and choose **Save key**.
3. Drop a photo on the canvas toolbar and choose **Tools → Photo to 3D**.
4. Choose the photo and selection model, describe the object, then choose **Find object**.
5. Inspect the highlighted object. If it is wrong, change the description and find it again.
6. Choose **Generate 3D…** and review the native confirmation before sending the photo and mask to
   fal. This generation is billed to your fal account.
7. When it finishes, choose **Show model in canvas**. Drag to orbit, scroll to zoom, and adjust the
   lighting, wireframe and background.

The result is an inferred mesh. It does not establish real dimensions or manufacturing accuracy.
Closing the panel does not resubmit the request. A saved request can resume checking its status
after restarting Viewer. If submission acknowledgment was lost, Viewer reports that uncertainty and
does not automatically pay for another generation.

## Export and reopen

Choose **Export canvas…** and a destination folder. Viewer creates a new folder containing
`index.html`, assets, bundled runtime libraries and `canvas.viewer.json`. To continue with the saved
values, choose **Open canvas…** from a Chat plane and select that exported folder. Reopening does
not call a model. Exports include captured sources and inputs but grant no access to original source
paths. Imported snapshots remain readable; refresh requires attaching the source again in a
conversation.

Personal backups include canvases and their attached assets within the backup size limit. For large
canvases, use their individual export. Keep exports and backups private when their contents are
private.

## Explore a URDF robot

1. Attach the folder containing the URDF and its relative STL meshes to a conversation. Approve the
   model's requested data access.
2. Ask it to build joint controls from that definition, using the bundled forward-kinematics module
   and approved meshes. The agent can bind the definition and attach its meshes in separate steps.
3. Move a joint and inspect the displayed limits. Angles use radians and distances use metres.
   Values outside the declared range are reported without being silently corrected.
4. Ask the tool to show the source of a constraint. In **Sources**, choose **Open joint definition**
   to inspect the captured passage in the original file.
5. Ask for world-coordinate target controls and a candidate-pose search. A search can find a
   candidate or remain unresolved. An unresolved search does not prove a target unreachable.
6. Request a Viewer check from the generated tool. Expand **Robot check** to inspect each target's
   measured error, tolerance and joint limits. Change a target, tool point, base placement or pose
   and use **Check poses** again.
7. Choose **Save check JSON…** to save the checked inputs and measured results as a new file. Export
   the canvas to retain the model snapshot, meshes, controls, inputs and check binding. Viewer
   recomputes the check when reopening it.

### Compare another base placement

1. Select the relevant passage in the conversation and choose **Ask about selection**. The branch
   keeps an independent copy of the canvas and its saved inputs.
2. Ask for another base placement while keeping the world targets, their order, tool point and
   tolerance fixed. Find candidate poses and request a Viewer check in each canvas.
3. Expand **Compare base placements** in the alternative. Viewer measures both saved tasks and shows
   their position errors beside one another. A changed original updates the comparison too.
4. Choose **Save comparison JSON…** to retain both checked inputs and results. Use **Compare
   original** to return to the original canvas.
5. Ask the generated tool for pose replay with play, pause and a scrub control. Replay interpolates
   the saved joint values for inspection. It must keep the candidate poses intact and reopen paused.

A standalone exported canvas retains its own task and check. It does not import a link to the
original canvas. Keep the comparison JSON with the exported work to retain both measured tasks.

The controls are generated for the conversation. A working page does not establish that the arm can
reach a target or move without collisions. The checker measures the listed endpoint positions and
hard joint limits. It does not check orientation or movement between those poses. Confirm the file's
calibration convention before interpreting its values as hardware settings. See the
[supported subset](../reference/canvases.md#robot-sources-and-motion).

[Canvas contracts and limits](../reference/canvases.md) ·
[Models and permissions](../reference/agents.md)
