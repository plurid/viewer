# Documentation media

These are recordings of the real packaged macOS app in a dedicated sample workspace. Samples and
generated profiles are separate from the user's files.

| Asset                         | Demonstration                                         |
| ----------------------------- | ----------------------------------------------------- |
| `hero.png`                    | A folder and linked document preview                  |
| `files.png`                   | Quick Preview of a PDF over its folder                |
| `columns.png`                 | Columns view with a PDF preview beside the trail      |
| `palette.png`                 | The command palette offering convert actions          |
| `optimize.png`                | Optimize results for a PDF and a photograph           |
| `suggested.png`               | A file menu suggesting Extract here for an archive    |
| `insights.png`                | Insight cards above a folder's files                  |
| `explore.png`                 | A model's answer to Explore this folder               |
| `overview.png`                | File overview cards across an indexed Home folder     |
| `layout.png`                  | A collage of three photographs in the Layout plane    |
| `nesting.png`                 | DXF parts nested on a sheet, with the estimates       |
| `files.mp4` / `files.gif`     | Search a folder and open Quick Preview                |
| `create.mp4` / `create.gif`   | Export a WebP through Image tools and open the result |
| `develop.mp4` / `develop.gif` | Create a branch task and write its project note       |

The README keeps animations inside expandable sections. MP4 links provide a separate
playback/download option. PNGs support the task guides and non-animated reading. `manifest.json`
records public asset hashes, capture platform and timing. The combined image/animation/video budget
is 20 MiB.

## Reproduce

Build a current local app first, then run from the repository root:

```sh
pnpm docs:media --binary <packaged-Viewer-executable>
```

The default binary is the regular macOS package output. `--binary` selects a retained candidate. The
tool registers a new owned fixture, disables removals, uses hidden windows and preserves all frames,
files, profiles and failed attempts. It records actual delivered frames with elapsed timing and uses
bundled FFmpeg for MP4/GIF encoding. It does not activate the user's working Viewer.

Review the retained captures before using `--publish` to copy a new capture set into this directory.
Review changes alongside the corresponding instructions. The demo should use readable, meaningful
files and actual completed actions.

## Make recorded input visible

For a walkthrough that needs a pointer and keyboard cues, use `inputOverlay` from
`packages/viewer-electron/app/tools/docs/input-overlay.ts`. Give the returned connection to both the
recording function and the input controls. The overlay follows the mouse coordinates and keyboard
chords actually dispatched to Viewer. It does not invoke application actions.

For a canvas in a separate renderer, use `mapPointer()` to project its local input coordinates onto
the recorded window. Dispatch the input to that renderer; the overlay records both coordinate sets.

Use `cue()` to name the current action, such as **Open linked plane** or **Back to parent plane**.
Modifier keys and navigation keys appear as separate keycaps. Click feedback stays neutral, and the
cue remains briefly after release. Ordinary typed text is excluded from the overlay and its input
log; only its character count is retained. This avoids displaying private paths or credentials as
keystroke annotations.

Call `reset()` at the start of a take, save `events` beside the frame timestamps, and call
`dispose()` before closing the owned app. Keep the annotation separate from product functionality in
capture attribution. Review keycaps at the delivered video's actual size and keep captions out of
their area. Preserve native camera movement and its triggering input in the same shot.

## Replay a retained session for a film

Use `sessionReplay` from `packages/viewer-electron/app/tools/docs/session-replay.ts` for an
explicitly edited playback of saved model output. This is a recording tool, not a shipped chat or
streaming feature. Run it in an isolated profile without configured providers.

1. Call `mount()` with the visible conversation selector, retained user message and a public context
   label. An optional `start`/`end` range selects an exact excerpt; the event log retains its
   offsets and the complete message hash. A supplied `providerName` must match the retained run's
   attribution. It uses the native toolbar, transcript and composer markup, with the app's existing
   styles. The cloned composer has no provider send handler.
2. Call `type()` to enter that exact request or selected excerpt through recorded input. Dispatch
   **Command+Enter** or **Control+Enter** to advance the replay. This composer never sends a
   provider request.
3. Call `answer()` with an assistant message and the exact start/end offsets of its excerpt. Keep
   the source IDs, excerpt offsets and condensed repair history in the capture evidence.
4. Call `coverCanvas()` before following the native **Canvas** action. Wait for the real canvas and
   assets to load, then call `revealCanvas()` with its frame connection. Selectors can identify the
   working view and inspector in the qualified generated layout. The temporary mask reveals those
   actual elements. For one spatial entrance, use `arriveCanvas()` instead: the viewport and
   inspector approach from opposite sides and settle before the next input. It restores their
   original styles and uses a short fade when reduced motion is requested. Keep this entrance to the
   first revised tool; subsequent edits use normal navigation.
5. Exercise the real controls. Call `dismiss()` when returning to the original transcript or closing
   the take. Save `events`, which identifies message hashes and excerpt offsets, with the input and
   frame logs.

The controller changes presentation DOM only. It does not rewrite transcripts, change generated
scripts or add native APIs. Assembly timing is editorial, not measured model latency. Retain the
original messages and the qualified revision mapping, including omitted repairs, outside the cut.
Credit saved-session replay, staged reveals and local layout refinements in the cut's production
notes. The plugin film and clean exports keep these notes in the accompanying script, off screen.
Keep editorial labels out of the chat controls. Inspect prompt legibility, the staged reveal and the
first working interaction together before assembling the full film.

Generate the delivered narration transcript and captions from the same timed cues used to assemble
the audio. Put spoken words, on-screen titles and scene directions in separate fields of the full
script. Check the delivered audio against those cues; an earlier story outline is not its
transcript.

The plugin film ends with an eight-second editorial sequence. A centered request types “I need an
image editor”, replaces “image” with “video” while changing “an” to “a”, then replaces “video” with
“file”. The final request holds with a blinking caret and stays unsent.

Keep the exact **Viewer** signature with **a plurid technology** below it. Under **Built during the
hackathon**, five rows of feature pills scroll in alternating directions. Their 32 labels come from
the [contribution inventory](../release/hackathon-contributions.md). Production credits stay in
`Script.md`, off screen in both the plugin review cut and clean export. The generated
`closingPrompt` evidence records edit times, unsubmitted status and each feature's fully visible
duration. Keep this editorial sequence distinct from footage showing an actual generated tool.

## Record the evolving interface

From `packages/viewer-electron/app`, use the retained robot session and a tested packaged app:

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 node --import tsx tools/robotics/record-story.ts \
  --run <retained-robot-run> --binary <packaged-Viewer-executable>
```

The recorder creates an isolated profile without providers. It records project navigation, native
chat request excerpts, the generated inspector, target testing, changed base placement and canvas
export/reopen. It checks the actual endpoint reports and restored task before marking the capture
complete. The local browser page introduces the project; it is demonstration material, not model
output or an external service.

To keep an approved opening while revising the ending, pass `--opening-from <completed-capture>`.
The recorder reuses that capture's first six clips without re-encoding them, recreates the workspace
relationships, and records the remaining sequence. Both captures must use the same retained robot
run. The new manifest identifies the opening's source.

The endpoint annotations use checked report values and the recorded camera projection. Show a value
only while its corresponding saved pose is sampled, and hide it during interpolation. These are film
annotations, not generated controls or measurements of the path between endpoints. The recorder
preserves the report and asserts that replay does not alter the task.

Presentation preparation retains the provider HTML and records script hashes before and after its
local playback repair. It clamps a negative first-frame elapsed time to zero when an animation
timestamp predates the click handler's clock reading. Robot calculations and saved poses remain
unchanged. The recording observes the playback status throughout the motion and rejects even a
temporary error. Credit this repair with the other local edits.

Use a 1440 × 900 logical viewport with `deviceScaleFactor: 2` and an explicit viewport of the same
logical size at scale 1. Setting only the device scale can leave compositor recordings at the
logical resolution. `recordFrames` verifies that every PNG contains 2880 × 1800 native pixels. It
keeps compositor timing and input logs. Idle passages can contain fewer frames because the picture
has not changed. Preserve the source frames; do not enlarge a lower-resolution movie.

After the native sequence passes, assemble the full review cut:

```sh
python3 tools/robotics/assemble-story.py <capture-folder>
```

For a silent export to record the final narration against, add `--clean`:

```sh
python3 tools/robotics/assemble-story.py <capture-folder> --clean
```

This produces `Viewer - Clean footage.mp4` with no audio stream, burned-in subtitles or production
credits, plus `Captions.srt`, `Narration.txt` and `Script.md`. Product text, keyboard cues and
opening titles remain visible. The plugin film also keeps the closing request, **Viewer** signature,
**a plurid technology** byline and feature roll. Attribution and production notes stay in
`Script.md`. The separate subtitles use the temporary narration's timing as a recording guide;
adjust them to the final voice recording. The clean cut is encoded directly from the original
frames.

## Pace a cut to recorded narration

Record again with `record-station.ts` when command selections were too brief to read. The shared
film controls wait until the requested command is selected, hold it for 1.5 seconds, then execute.
The capture retains `commandReads` and each action's `workEnd` so the edit can keep those reading
intervals and trim only unused time after an action finishes.

To use supplied narration, give the assembler a folder containing `Narration.wav` and
`Captions.srt`, plus the `script.json` from the cut that voice was recorded against:

```sh
python3 -B tools/robotics/assemble-story.py <fresh-plugin-capture> \
  --narration <recorded-voice-folder> --timing-from <original-cut>/script.json
```

This mode uses NumPy and requires mono, 16-bit PCM narration with matching caption text. It finds
near-silent passage boundaries and preserves every nonzero source sample. It stops if a passage
cannot be separated safely, captions do not match the script, or the edit would cut a captured
input, camera move or command reading interval. Voice speed and the capture's camera retiming stay
unchanged.

The picture is assembled from native frames. Idle tails after completed actions are shortened, and
speech follows the corresponding action. In the station film, “I'll use the front” follows the
return from the alternative; the save line continues into tool export. The output includes the
narrated MP4, separate SRT, edited WAV and matching script. The video has no embedded subtitles,
burned captions or production notes. Keep the source recording and its original timing evidence; the
generated verification records source hashes, passage edits and command holds.

The capture can identify a navigation passage to omit. Assembly retains the original timestamps,
input log and selected source ranges, cuts only that passage, and keeps the included actions at
their original speed. It generates the closing artwork with the delivered script. The plugin close
adds no narration. Review the complete ending along with the native shots.

The assembler uses Pillow, macOS's Daniel voice and Homebrew FFmpeg. It encodes once from the PNG
sources, with bounded encoding threads. Playback stays at the recorded speed unless the capture
specifies camera retiming as described below. Timed capture cues produce the exact narration,
transcript and captions. The output includes an opening study, attribution, sample frames and
technical decode checks. Review the complete story and its input-to-result transitions before
replacing the temporary voice and opening.

## Record the plugin workflow

Use the qualified three-stage station run and a tested package. From `packages/viewer-electron/app`:

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 node --import tsx tools/robotics/record-station.ts \
  --run <qualified-station-run> --binary <packaged-Viewer-executable>
python3 tools/robotics/assemble-story.py <completed-station-capture>
```

The recorder copies the public station files, source snapshots and mesh assets into an isolated
profile. A loopback provider supplies retained Meta responses to the ordinary chat service. It has
no cloud transport or credentials. The cloud endpoint rules remain unchanged. The capture keeps the
original response hashes, request excerpts, local envelope conversion and current revision bindings.
Its local replay request count is separate from paid provider requests.

Start with the qualified run's `reused-plugin/starter.json`. The recorder requires a passing report
for each saved stage and keeps the reused code's provenance. It clears the old study for the opening
and retains the qualified camera. The robot parser, solver and checker are attached plugin code.
Viewer supplies the generic runtime, context, actions, revisions and tool management.

Meta's retained edit adds a target-results table to the existing interface. The local replay invokes
the same plugin handlers to evaluate the four mounting points and select Central. The next stage
explains the reserved area, evaluates again and selects Front. A native quote branch selects Rear
and runs the plugin checks. Save the result, export and reopen the tool, then show the Tool library.
Assertions verify those outcomes before the capture is marked complete. External qualification
checks the results after recording; it is not presented as a Viewer robotics feature.

Keep the exact provider HTML and attached library. This workflow makes no local edits to either.
Typed requests are exact excerpts from the retained conversations. The first saved turn ended after
selection without a closing reply, so finish its local replay with **Stop** before continuing. Do
not invent an assistant reply. The replay condenses duplicate writes and the verification
continuation; keep those omissions in its evidence and credit saved-response playback in the film.

Hold the reopened working tool before the final spatial pullback. Record every plane-to-plane move,
including the browser, editor and terminal sequence and the return from the alternative. Keep
visible actions inside takes and hold each destination after the camera settles. Do not cut away
navigation between takes or omit the reopening route. Move directly between the browser, editor and
terminal after the first overview so the sequence does not repeatedly pull out and zoom in.

The capture observes the engine's camera-motion marker and records those intervals separately from
the action cues. `cameraTimeScale: 1.75` makes each camera move take 75% longer in the edit. All
other footage keeps its recorded timing. The assembler maps frames, narration and captions through
the same time conversion and rejects overlapping motion intervals. Retain the original frames and
timestamps, and credit the slowed camera moves. Check that the destination remains readable before
the next action begins.

The assembler produces `Narration.txt`, `Captions.srt`, `Script.md` and `script.json` for that exact
cut. Use the timed cues when reviewing or replacing the temporary voice, and keep production notes
in `Script.md`.

## Record the mounting job

From `packages/viewer-electron/app`, use the qualified review copy and its retained source run:

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 node --import tsx tools/mounting/record.ts \
  --review <review-folder> --run <retained-mounting-run> --binary <packaged-Viewer-executable>
```

The recorder creates an isolated profile, copies the inputs and preserves every take. It uses no
configured provider. Native inputs replay request excerpts, open the generated tools, edit the plate
width, save and reopen the measured DXF, request a local supplier quote, change the deadline and
save the selected offer. Before using the retained quote interface, it checks that the new simulated
reply equals its captured source and identifies the newly saved drawing.

`capture.json` records the clips, timed actions, input cues, source excerpts and file checks. Review
the footage before assembling narration. The mounting session published its canvas without a final
assistant message; the capture shows its actual canvas output without inventing a reply. Keep local
review corrections and the supplier simulation identified in the edit's credits.

Assemble a passed capture with temporary narration on macOS:

```sh
python3 tools/mounting/assemble.py <capture-folder>
```

The assembler uses Python with Pillow, macOS's Daniel voice and Homebrew FFmpeg. It preserves the
capture's playback speed, places narration between recorded actions and writes a new output folder.
`Narration.txt` and `Captions.srt` come from the exact spoken cues. The output includes credits,
sample frames and decode verification. Review the video and transcript together before replacing the
temporary voice or incorporating this scene into the full film.

## Record the laser-job check

The film's laser-job scene is a live check. From `packages/viewer-electron/app`, with a packaged app
and a Meta Model API key:

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 META_API_KEY=<key> \
  node --import tsx tools/fabrication/record.ts --binary <packaged-Viewer-executable>
```

The recorder writes Job 1042 from the playground recipe into a new folder and creates an isolated
profile with one Meta provider, already allowed pictures. It enters the key in the owned app's
Settings window, as a person does; the key is never written to a file or the log. Each run makes one
paid check. `--effort minimal` asks for a faster answer.

It records three takes in native 2880 × 1800 frames: **Check laser job…** from **⌘K** and **Check 7
files**; the findings and the tour; the corrected copy and **Prepare cut sheets**. The model's wait
falls between the first and second takes and is not recorded. `capture.json` keeps the panel's
findings and reader line, the progress lines it showed, the tour's stops, the correction and the
nesting. Each take is also written as an MP4 at its recorded timing for the edit.

## Attribution

`source.jpg`, the sample PDF image, the image-conversion demonstration and the three collage
photographs derive from a frame at 150 seconds of **Big Buck Bunny**, © 2008 Blender Foundation,
licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
[Film and source](https://peach.blender.org/). Changes: frame extraction, crops and the shown
image/document conversions.

The tutorial PDF and small website are original Viewer demonstration material. Additional
EPUB/Office samples use the project's public playground recipes. `--movie` can regenerate the frame
from the exact pinned public movie; the tool checks its source hash first. Ordinary reproduction
reuses the committed JPEG.
