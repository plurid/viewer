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

In Chat, **Context** shows attached paths relative to the conversation's folder. Click a file or
folder to open it in a linked plane. Hover over an entry to see its full path.

Expand **Sources** or **Assets** above the canvas to inspect its inputs. File rows keep the source
action beside the filename; long lists scroll within the details area. Opening another details
section closes the previous one and leaves the canvas visible. Press **Escape** while working in an
open section to close it and return focus to its heading.

## Manage your tools

1. Choose **Tool library** from commands, Chat or the canvas toolbar. It opens in its own plane.
2. Search by tool or project name, then select a row. Choose **Open tool** to run it or
   **Conversation** to ask for a change.
3. Change **Name** and choose **Rename**. Turn off **Enable tool** to stop it and prevent actions
   from running. The setting survives restarting Viewer.
4. Choose **Duplicate** to start a separate conversation with a copy of the tool and its saved
   inputs. No model request is sent until you send a message.
5. Choose **New tool…** to begin another conversation. Attach the files it should use and describe
   the tool you need.

Reopening a saved tool runs its saved code. Use **Tools → Source code** to inspect it and **Undo
revision** to restore the preceding design.

## Start from a working plugin

To try a complete saved tool without configuring a model, follow
[Try the demo project](demo-project.md).

1. Choose **Open canvas…** in Chat to import an exported plugin folder, or find an existing tool in
   **Tool library**.
2. Choose **Duplicate** when you want a separate version for a new task.
3. Open **Conversation** and describe what to change. Keep the working calculations and controls
   that already fit the task.
4. Inspect the new revision, run its checks and use **Export canvas…** to share the resulting tool.

A plugin uses the same saved document as a canvas. Its package carries the interface, code assets,
captured sources and inputs. Code assets appear under **Assets** and travel with exports. They run
inside the canvas sandbox. Importing a robotics plugin does not install a solver in Viewer's host.
The agent can reuse a plugin's implementation, add functions and adapt its interface across several
requests.

## Let the agent use its tool

1. Ask the conversation to register actions for the tool's controls and run the needed calculation.
2. Keep its canvas open. The activity row names the model and action while it runs. The model
   receives the handler's actual result before continuing its answer.
3. Choose **Take over** to cancel pending work and stop that model turn. You can then use the
   controls yourself. **Stop** stops the entire page; **Tools → Reload** starts it again.
4. Inspect the output. **Completed** means the action ran. Ask for tests in the generated tool and
   compare its results with the source data.

Controls and agent calls use the same registered handler. Inputs are held while an action runs and
its saved changes appear together when it finishes. Closing or revising the canvas cancels pending
work. Reopening the saved tool does not make a provider request.

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

Tools can propose CSV, JSON, Markdown, plain text and cutting DXF results. For a DXF, Viewer shows
the drawing and measured width, height and hole diameters. Inspect these, then choose **Save
drawing…**. Open the saved file to measure it in the drawing preview. The export check does not
confirm a mounting fit, material choice or load capacity; confirm those requirements separately.

Canceling the review or save picker leaves the result unsaved. Source snapshots and saved inputs
survive restarting Viewer.

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

Photo reconstruction produces a mesh. An articulated model needs its own source definition and
controls.

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

## Ask for a specialist tool

Attach the source files and describe the work: an image adjustment, a drawing editor, or controls
for a robot definition. Start with an existing plugin when one fits. Ask the agent to reuse or
extend its calculations and checks together with the controls. Viewer provides context, saved
inputs, the execution sandbox and linked planes. The application logic belongs to the plugin.

Ask the agent to register a test action and run it. Inspect the returned cases and source evidence.
A successful generated test reports what that plugin tested; Viewer does not independently certify
its domain conclusions.

[Canvas contracts and limits](../reference/canvases.md) ·
[Models and permissions](../reference/agents.md)
