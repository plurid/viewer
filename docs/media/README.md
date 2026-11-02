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
   label. The overlay identifies itself as **Saved session · edited playback**.
2. Call `type()` to enter that exact request through recorded input. Dispatch **Enter** to advance
   the replay. This composer never sends a provider request.
3. Call `answer()` with an assistant message and the exact start/end offsets of its excerpt. Keep
   the condensed repair-history disclosure when the qualified canvas follows repairs.
4. Call `coverCanvas()` before following **Open canvas**. That button delegates to the existing
   native **Canvas** action. Wait for the real canvas and assets to load, then call `revealCanvas()`
   with its frame connection. The temporary mask reveals the actual model and control group.
5. Exercise the real controls. Call `dismiss()` when returning to the original transcript or closing
   the take. Save `events`, which identifies message hashes and excerpt offsets, with the input and
   frame logs.

The controller changes presentation DOM only. It does not rewrite transcripts, change generated
scripts or add native APIs. Assembly timing is editorial, not measured model latency. Retain the
original messages and the qualified revision mapping, including omitted repairs, outside the cut.
Attribute static layout refinements separately. Inspect prompt legibility, the staged reveal and the
first working interaction together before assembling the full film.

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
