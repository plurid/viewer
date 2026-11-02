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
   actual elements.
5. Exercise the real controls. Call `dismiss()` when returning to the original transcript or closing
   the take. Save `events`, which identifies message hashes and excerpt offsets, with the input and
   frame logs.

The controller changes presentation DOM only. It does not rewrite transcripts, change generated
scripts or add native APIs. Assembly timing is editorial, not measured model latency. Retain the
original messages and the qualified revision mapping, including omitted repairs, outside the cut.
Credit saved-session replay, staged reveals and local layout refinements once in the film credits.
Keep editorial labels out of the chat controls. Inspect prompt legibility, the staged reveal and the
first working interaction together before assembling the full film.

Generate the delivered narration transcript and captions from the same timed cues used to assemble
the audio. Put spoken words, on-screen titles and scene directions in separate fields of the full
script. Check the delivered audio against those cues; an earlier story outline is not its
transcript.

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

The capture can identify a navigation passage to omit. Assembly retains the original timestamps,
input log and selected source ranges, cuts only that passage, and keeps the included actions at
their original speed. It generates the closing title and its narration from the same cues as the
delivered script. Review the final title along with the native shots.

The assembler uses Pillow, macOS's Daniel voice and Homebrew FFmpeg. It encodes once from the PNG
sources, at the original playback speed, with bounded encoding threads. Timed capture cues produce
the exact narration, transcript and captions. The output includes an opening study, attribution,
sample frames and technical decode checks. Review the complete story and its input-to-result
transitions before replacing the temporary voice and opening.

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
