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

## Attribution

`source.jpg`, the sample PDF image and the image-conversion demonstration derive from a frame at 150
seconds of **Big Buck Bunny**, © 2008 Blender Foundation, licensed under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
[Film and source](https://peach.blender.org/). Changes: frame extraction and the shown
image/document conversions.

The tutorial PDF and small website are original Viewer demonstration material. Additional
EPUB/Office samples use the project's public playground recipes. `--movie` can regenerate the frame
from the exact pinned public movie; the tool checks its source hash first. Ordinary reproduction
reuses the committed JPEG.
