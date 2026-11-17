# Review every screen

`pnpm review` drives the packaged app through a catalog of scenes, captures each one at two window
sizes in light and dark, checks every capture for layout defects and writes a review sheet you open
in a browser. People, agents and the owner read the same sheet.

## Run a review

1. Package the app, or keep the build you have. The default binary is the regular packaged output,
   `packages/viewer-electron/app/out/Viewer-darwin-arm64`.
2. From the repository root, run:

   ```sh
   pnpm review
   ```

3. Open the `index.html` the run prints, in `packages/viewer-electron/app/out/review/<run>/`.

A full run takes about 15 minutes. Narrow it while you work:

| Option                | What it does                                                                |
| --------------------- | --------------------------------------------------------------------------- |
| `--area <name>`       | Only this area, such as `exports` or `settings`. Repeat or separate by `,`. |
| `--scene <id>`        | Only these scenes, such as `image-tools`.                                   |
| `--variant <id>`      | Only these variants, such as `wide-dark` or `narrow-light-long`.            |
| `--binary <path>`     | Another packaged binary, such as a retained candidate.                      |
| `--accept`            | Make this run the baseline once it finishes.                                |
| `--accept-run <name>` | Make an earlier run the baseline, without running anything.                 |
| `--list`              | List the areas and scenes.                                                  |

`VIEWER_TEST_BINARY` also chooses the binary.

A run never shows a window on your screen. Each capture starts the app in hidden offscreen windows,
out of the Dock and never active, on a new profile and a generated sample home. It never reads your
profile, your files or your Trash. One run at a time: `out/review/review.lock` names the run in
progress. If the app does not start or does not quit cleanly, the run stops at once and the sheet
says why; it never retries.

## Read the review sheet

The sheet groups scenes by area. Each scene shows:

- its title and id, and the lines that **must be true**, in plain words, for a person to check;
- every variant side by side; click a capture to enlarge it;
- the automatic checks' findings in red, each with the element's selector and text, and the element
  outlined on the capture. Point at a finding to brighten its outline. Known false alarms show gray,
  with the reason;
- against the accepted baseline: **Same as baseline**, **Changed** with the share of pixels, or
  **Size changed**. **Baseline** shows the accepted capture and **Difference** marks the changed
  pixels in red;
- a note box. **Copy note** copies the scene id and the note, ready to paste into a chat. **Copy all
  notes** copies every note on the sheet. Notes stay in the browser for that run.

The filters show only scenes with problems or scenes that changed. **Coverage**, at the end, lists
every registry command, dialog, Settings section and preview kind, marked covered or not covered by
a scene.

Look at every capture yourself. The checks find wrapped labels, clipped text, overflow, long paths
and layout shift; they do not judge spacing, alignment, color or wording.

## Accept a baseline

When the captures are right, accept them:

```sh
pnpm review --accept-run <run>
```

or run and accept in one go with `pnpm review --accept`. A partial run replaces the baseline of its
own scenes only. Accepting never deletes: a scene's previous baseline moves to
`out/review/baseline-retired/<time>/`. Move retired baselines to the Trash when you no longer need
them.

## What the checks catch

The checks run in the page right after each capture.

| Check                  | Flags                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Label wraps            | A one-line control whose text takes more than one line: buttons, menu items, tabs, chips, segmented controls, toolbar and footer items, dialog titles. A toolbar or footer whose items sit on two rows. |
| Clipped                | Text or a control cut by its container's edge with no ellipsis. Text wholly outside its container is hidden on purpose and not counted.                                                                 |
| Past the window        | An element, dialog, menu or the plane in view that runs past the window's edge.                                                                                                                         |
| Scrolls sideways       | A container that scrolls sideways although it is not listed as a horizontal scroller.                                                                                                                   |
| Dialog scrolls         | A horizontal scroll bar inside a dialog.                                                                                                                                                                |
| Menu covers its button | An open menu or popover over the control that opened it.                                                                                                                                                |
| Full home path         | Visible text or a field showing the home folder as a full path instead of `~`.                                                                                                                          |
| Em dash                | An em dash in visible text.                                                                                                                                                                             |
| Broken value           | `undefined`, `NaN` or `[object Object]` in visible text.                                                                                                                                                |
| One with a plural      | A count of one with a plural noun, such as "1 files".                                                                                                                                                   |
| Name loses extension   | A file name cell cut at its end, so its extension does not show, or a file name field that opens a long name at its start.                                                                              |
| Layout shift           | The title bar, a toolbar, a footer or list columns that move or resize when a scene changes the selection.                                                                                              |

Text inside a file's own content, such as a PDF page, an editor or a terminal, is left out. Planes
the camera leaves partly outside the window are framing, not layout, and are left out of the window
check. A scene with a `focus` reports only what is inside its subject, such as the open dialog, so
the folder behind it does not repeat findings its own scenes report.

Known false alarms are listed in `tools/review/allowlist.ts`, each with its reason. Keep the list
short: fix the screen, or make the check more precise, before allowing a finding.

## Add a scene

A change to the interface adds or updates the scenes that show it.

1. Open the area's module in `packages/viewer-electron/app/tools/review/scenes/`, or add a module
   and list it in `scenes/index.ts`.
2. Write the scene:
   - `id`: lowercase words joined by hyphens, unique in the catalog.
   - `title` and `mustBeTrue`: what a person must see, in plain words, taken from
     [DESIGN.md](../../DESIGN.md) and the rules below.
   - `setup`: the folder, view, sidebar, title bar, Recent folders, a second workspace or a project
     the profile starts with.
   - `steps(page, variant)`: the actions that reach the state. Run commands by their palette label
     with `page.palette`, select files with `page.select(page.path(...))`, press keys with
     `page.key`, and wait on what the page shows with `page.waitFor`. Wrap a selection change in
     `page.layoutShift` to check that nothing moves.
   - `variants`: the four standard ones by default; `across('name', ['short', 'long'])` adds a
     scene's own choice, read from `variant.data`.
   - `covers`: the command ids, dialog components, Settings sections and preview kinds it shows, for
     the coverage list.
   - `nameCells`: selectors of file name cells the extension check should read, beyond the shared
     ones.
   - `focus`: the scene's subject, such as `dialog[open]`; `planeInView` stands for the plane the
     space shows.
   - `blocked`: why the scene cannot run yet. The sheet lists it as not captured.
3. Run it alone with `pnpm review --scene <id>` and look at every capture.

Prefer roles, accessible names and palette labels to class names: they survive restyling. Palette
labels match in any letter case. If a scene needs a hook in the app, such as a stable data
attribute, add it with the feature that needs it.

Every scene keeps the owner's standards: no label wraps, toolbars and footers keep one fixed height,
selection moves nothing, fields fill their row, paths show the folder's own name and start from `~`,
file names lose their middle and keep their extension, help text states facts only, and menus never
cover their button.

## Samples and kept files

Each run generates its own sample home in a kept temporary folder, `/tmp/viewer-review-<random>`:
pictures, a PDF, a text file, an STL model and a movie; a file with a 180-character name of each
kind; a folder twenty levels deep with long names; names with spaces and in Japanese, Greek,
Cyrillic and Arabic script. The app runs with this folder as its home, so shown paths should start
with `~`. The folder lies in `/tmp` because Columns lists every folder above the one it shows.

The Trash scene is listed but not captured: the Trash lists the system Trash of every mounted
volume, and the packaged app's interface cannot be answered with generated items. It runs once a
review run can limit the Trash to the sample home's own generated `.Trash`.

Each scene's profile starts from the settings the packaged app reports on a first launch, so an
older or newer build accepts it. The run's folder is kept and listed in
`$TMPDIR/viewer-kept-test-folders.log`; each capture's app logs are kept in
`out/native-evidence/review-*`. Move both to the Trash when you no longer need them.
