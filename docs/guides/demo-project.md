# Try the demo project

Choose a mounting point for the fictional six-slot station shown in the
[Viewer film](https://plurid.com/viewer/). Open the saved tools, inspect their results and change
the controls. This walkthrough runs locally without a model account or API key. The
[laser job](#check-the-laser-job) at the end needs a model that takes pictures.

## Open the Front tool

1. [Install Viewer](install.md), then download **Viewer-1.0.0-Demo.zip** from the
   [1.0.0 release](https://github.com/plurid/viewer/releases/tag/v1.0.0).
2. Extract the archive. In Viewer, press **⌘⇧O** and open its **Viewer Demo** folder.
3. Press **⌘K**, choose **Chat about files**, then choose **Open canvas…** in the Chat toolbar.
4. Select **Front** inside **Viewer Demo**. Viewer opens **Six-slot station · Front** with its saved
   inputs and results. Import the folder, not its `index.html` file.
5. Click a tray-slot row in the results table to see the corresponding robot pose. Drag in the
   viewport to orbit the model; choose **Reset view** to frame it again.

The table and controls run the saved plugin. Generating another interface change requires a model
configured in **Settings → Models**.

## Change the constraint

1. In the Front tool, leave **Target X offset (mm)** at **0**.
2. Clear **Reserve the central mounting area**, then choose **Evaluate placements**. Central has
   passing candidate poses at all six slots and requires the smallest move among those candidates.
3. Turn **Reserve the central mounting area** on and evaluate again. Central is excluded; Front is
   the passing choice requiring the smallest move.
4. Choose **Check poses** to check the plugin's saved endpoints against its target tolerance and
   joint limits. The station is an endpoint study; it does not simulate collision-free motion or
   control physical hardware.

## Compare the alternative

1. Open another Chat plane with **⌘K → Chat about files**. Choose **Open canvas…** and select
   **Rear** inside **Viewer Demo**.
2. Press **⌘0** to see the connected planes. Frame either tool with its title-bar **Frame plane**
   button.
3. Compare their saved results: Front moves the base **228.04 mm**; Rear moves it **295.30 mm**.
   Both have passing endpoint poses at the six slots, with the central area reserved.
4. Use **Sources → Inspect captured data** to read the inputs. The **Project** folder also contains
   `station.json`, the robot definition and the named mesh files.

The two tools were exported from the original conversation and its quoted alternative. Importing
them opens independent saved tools; the archive does not recreate that conversation history. The
[film and script](../release/hackathon-demo.md) show the quote-branch interaction.

## Save and return

1. Choose **Export result…** in a tool and review the JSON before saving a new file. The **Results**
   folder contains the original saved Front and Rear results for comparison.
2. Choose **Export canvas…** in the Viewer toolbar and a destination folder to save your version.
3. Quit and reopen Viewer. Choose **Tool library** from **⌘K**, select the tool and choose **Open
   tool**. Its saved inputs stay with it.
4. To reopen an exported version, use Chat's **Open canvas…** and select the exported folder.

## Check the laser job

The second download is a fictional laser job whose base plate DXF puts its holes 48 mm apart where
the drawing gives 50 mm. Checking it sends the job to the model you choose, so it needs a model that
takes pictures, such as Meta's Muse Spark.

1. Download **Viewer-1.0.0-Laser-Job.zip** from the
   [1.0.0 release](https://github.com/plurid/viewer/releases/tag/v1.0.0) and extract it.
2. [Add a model](automate.md#add-a-model). Under its **Data access**, choose **Text and pictures**,
   then **Allow selected data**.
3. In Viewer, press **⌘⇧O**, open **Viewer Laser Job**, then open **Job 1042**.
4. Press **⌘K**, choose **Check laser job…**, then **Check 7 files**. The model reads the request,
   the drawing and Viewer's measurement of every part; SAM 3.1 outlines each feature it names.
5. Read the finding: Viewer measures 48 mm in the DXF against 50 mm in the drawing and marks it
   **Confirmed**. Choose **Play the tour**, save the corrected copy beside the original, then choose
   **Prepare cut sheets**.

[Check a laser job](layout.md#check-a-laser-job) explains each step and what is sent.

## What was made by Meta

Meta `muse-spark-1.3` added the per-target results table and the restriction explanation to a
working robotics plugin. It invoked that plugin's actions, selected Central, changed to Front when
the constraint changed, and selected Rear in a quoted alternative. The parser, solver, endpoint
checker and starting interface are reused plugin code. Viewer supplies the general host and saved
state; Plurid supplies the connected spatial workspace.

In the laser-job check, Muse Spark reads the job and SAM 3.1 outlines the features it names. Viewer
measures every part itself and grades each finding; the archive holds only the job's files, and each
check is a new model request.

The **Licenses** folder credits SO-ARM100 / TheRobotStudio and the supporting libraries. Opening the
archive makes no provider request.

[Build a canvas with a conversation](canvases.md) ·
[Contribution inventory](../release/hackathon-contributions.md)
