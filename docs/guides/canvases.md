# Build a canvas with a conversation

1. Open a Chat plane and choose a configured model. Approve the data it may receive.
2. Ask for a tool, for example: “Build a trip budget canvas with editable expenses and a total.”
3. Use **Canvas** to open the linked app. Generated revisions appear in that same plane.
4. Change its controls, then ask the conversation to improve the app. Saved input values stay
   separate from the generated design.

A canvas uses selectable HTML text, ordinary controls, SVG and JavaScript. **Source** shows its
current code. **Undo** returns to the previous content revision while retaining compatible inputs.
**Stop** stops the running page; **Reload** opens the saved revision again.

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

1. Add a Meta model that supports object selection in **Settings → Models**.
2. Under **3D reconstruction**, enter your separate fal API key and choose **Save key**.
3. Drop a photo on the canvas toolbar and choose **Photo to 3D**.
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

Choose **Export…** and a destination folder. Viewer creates a new folder containing `index.html`,
assets, bundled runtime libraries and `canvas.viewer.json`. To continue with the saved values,
choose **Open canvas…** from a Chat plane and select that exported folder. Reopening does not call a
model.

Personal backups include canvases and their attached assets within the backup size limit. For large
canvases, use their individual export. Keep exports and backups private when their contents are
private.

[Canvas contracts and limits](../reference/canvases.md) ·
[Models and permissions](../reference/agents.md)
