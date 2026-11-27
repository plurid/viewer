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

A full run takes about 12 minutes with three hidden apps at once. Narrow it while you work:

| Option                | What it does                                                                |
| --------------------- | --------------------------------------------------------------------------- |
| `--area <name>`       | Only this area, such as `exports` or `settings`. Repeat or separate by `,`. |
| `--scene <id>`        | Only these scenes, such as `image-tools`.                                   |
| `--variant <id>`      | Only these variants, such as `wide-dark` or `narrow-light-long`.            |
| `--binary <path>`     | Another packaged binary, such as a retained candidate.                      |
| `--accept`            | Make this run the baseline once it finishes.                                |
| `--accept-run <name>` | Make an earlier run the baseline, without running anything.                 |
| `--parallel <n>`      | How many hidden apps run at once, 1 to 3; 3 by default.                     |
| `--list`              | List the areas and scenes.                                                  |

`VIEWER_TEST_BINARY` also chooses the binary.

A run never shows a window on your screen. Each capture starts the app in hidden offscreen windows,
out of the Dock and never active, on a new profile and a generated sample home. Up to three apps run
at once. Each capture has its own profile. Captures in the same run share the sample files. It never
opens your profile, your folders or your Trash; Columns lists only the system folders above the
sample home. One run at a time: `out/review/review.lock` names the run in progress. If the app does
not start or does not quit cleanly, the run stops at once and the sheet says why; it never retries.

A scene that shows a feature the build under review does not have reports **Needs a newer build**
with what is missing, instead of failing.

## Read the review sheet

The summary at the top counts distinct problems: areas down, checks across. Click a count to show
only that area's scenes with that check, or an area's name to show its scenes; **Show every area**
returns.

The sheet groups scenes by area. Each scene shows:

- its title and id, and the lines that **must be true**, in plain words. Press a line's button to
  mark it **Pass**, **Fail** or **Not checked** after you look;
- its captures in one row per scene choice, such as short and long names, all at one height; click a
  capture to enlarge it to its true pixels;
- the automatic checks' findings in red, one line per distinct problem: the check, what is wrong,
  how many elements share it, such as "4 file names", and the variants it occurs in, or "all 4".
  **Elements and text** opens each element's selector and text. Point at a line to brighten its
  outlines on the captures. Known false alarms show gray, with the reason;
- against the accepted baseline: **Same as baseline**, **Changed** with the share of pixels, or
  **Size changed**. **Baseline** shows the accepted capture and **Difference** marks the changed
  pixels in red;
- a note box. **Copy note** copies the scene id, the note and the marked lines, ready to paste into
  a chat. **Copy all notes** copies them for every scene. Notes and marks stay in the browser for
  that run.

The filters show only scenes with problems or scenes that changed. **Coverage**, at the end, lists
every registry command, dialog, Settings section and preview kind. A scene earns coverage when at
least one variant completes its steps and records a screenshot successfully.

Look at every capture yourself. The checks find wrapped labels, clipped text, overflow, long paths,
layout shift and the sizes a scene measures; they do not judge spacing, alignment or color.

## Accept a baseline

When the captures are right, accept them:

```sh
pnpm review --accept-run <run>
```

or run and accept in one go with `pnpm review --accept`. A partial run replaces the baseline of its
own scenes only. Accepting never deletes: a scene's previous baseline moves to
`out/review/baseline-retired/<time>/`. Move retired baselines to the Trash when you no longer need
them.

Each run's sample home has its own random folder name. A path the app shows from the disk root
instead of `~` therefore differs between runs and shows as **Changed**; the **Full home path** check
reports the same text.

## What the checks catch

The checks run in the page right after each capture. Text checks read rendered labels, details and
field text. They read a control's visible label across inline or flex items. For an input or text
area, they check the portion of its value or placeholder that is in view at its current scroll
position. A word can continue across a soft wrap while its letters are visible. A clipped gap or an
explicit line break in a field separates the text on either side. Hidden content includes the full
path a shortened path label keeps for screen readers.

| Check                    | Flags                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Label wraps              | A one-line control that wraps, a Grid filename that takes more than two lines, or a toolbar or footer whose controls sit on two rows.               |
| Clipped                  | Text or a control cut by its container's edge with no ellipsis. Text wholly outside its container is hidden on purpose and not counted.             |
| Past the window          | An element, dialog, menu or the plane in view that runs past the window's edge.                                                                     |
| Scrolls sideways         | A container that scrolls sideways although it is not listed as a horizontal scroller.                                                               |
| Dialog scrolls sideways  | A horizontal scroll bar inside a dialog.                                                                                                            |
| Menu covers its button   | An open menu or popover over the control that opened it.                                                                                            |
| Search on a short list   | An open menu of 8 or fewer choices with a search field; such a list moves by type-ahead.                                                            |
| Full home path           | Visible text or a field showing the home folder as a full path instead of `~`.                                                                      |
| Em dash                  | An em dash in visible text.                                                                                                                         |
| Broken value             | `undefined`, `NaN` or `[object Object]` in visible text.                                                                                            |
| One with a plural        | A count of one with a plural noun, such as "1 files".                                                                                               |
| Name loses its extension | A file name cell cut at its end, so its extension does not show, or a file name field that opens a long name at its start.                          |
| Layout shift             | The title bar, a toolbar, a footer or list columns that move or resize when a scene changes the selection, or an element a scene clicks that moves. |
| Wrong size or place      | A visible box, gap or text that differs from the scene's expectation. A hidden element counts as absent.                                            |
| Wording                  | A retry button that does not read Try Again, or a raw code such as `ENOENT` or `mkdir` in visible text.                                             |

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
   - `setup`: the folder, view, sidebar, title bar, Recent folders, workspaces, project and custom
     commands the profile starts with.
   - `steps(page, variant)`: the actions that reach the state. Run commands by their palette label
     with `page.palette`, select files with `page.select(page.path(...))`, press keys with
     `page.key`, and wait on what the page shows with `page.waitFor`. Reveal a field below the fold
     with `page.scrollIntoView`. To check a second press on a menu button, use `page.pressAt` while
     the menu is open. It checks what receives the pointer at the button's center. Wrap a selection
     change in `page.layoutShift` to check that nothing moves. `page.settings(category)` opens
     Settings at a section and captures that window from then on.
   - `page.afterCapture`: settle work the scene started before the app quits. The replacement
     confirmation scene cancels its own paused copy after recording the dialog.
   - `variants`: the four standard ones by default; `across('name', ['short', 'long'])` adds a
     scene's own choice, read from `variant.data`.
   - `covers`: the command ids, dialog components, Settings sections and preview kinds it shows, for
     the coverage list.
   - `nameCells`: selectors of file name cells the extension check should read, beyond the shared
     ones.
   - `focus`: the scene's subject, such as `dialog[open]`; `planeInView` stands for the plane the
     space shows.
   - `blocked`: why the scene cannot run yet. The sheet lists it as not captured.
   - `requires`: what the scene needs from the build, checked before its steps: a palette command,
     an element, a text, or the QA runtime's hooks. Inside the steps, `page.needs(selector, what)`
     does the same for an element a step reveals.
   - Measurements: `page.expectBox` (a size, or a distance from the window's or a container's
     edges), `page.expectGap`, `page.expectAligned`, `page.expectFillsRow`, `page.expectWidth`,
     `page.expectInsideWindow`, `page.expectStill` (what a click must not move), `page.expectText`,
     `page.expectPresent` and `page.expectNone`. Each records a finding when the screen differs.
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

It also holds one file for each preview kind from the [playground](playground.md) (a system font for
fonts), models with each axis convention and one that cannot be read, a 2400 × 900 picture, a
picture with a 200-character name and a generated `.Trash`.

The Settings scenes show a list with every custom command kind and expanded editors for a shell
command and a two-step workflow. License needs a configured direct build. Dialog scenes use a sample
project, a Git repository and a folder with a lens. The batch rename, Basket copy, replacement and
Trash confirmation scenes stop before applying the proposed change. The Journal scene creates a
folder in the sample home's `Projects/Journal events` for each variant so it has an event to export.
The Dictate scene opens a sample note with local speech and no installed model to show the setup
error and the **Open Speech Settings** button.

## What the app does in the QA runtime

Review runs and native tests start the app in its hidden QA runtime: `VIEWER_RENDER_TEST=1`,
`VIEWER_BACKGROUND_TEST=1` and an isolated `VIEWER_DATA_DIRECTORY` (`backgroundTest` in
`src/main.ts`, passed to the desktop as `qaRuntime`). A normal launch never sets them. In that
runtime only:

- the Trash lists the home folder's `.Trash` and no mounted volume's, so a review shows the sample
  home's generated Trash (`src/desktop/operations/trash.ts`);
- Locations, the Copy to places and the folder chooser's places are the home folder's own folders,
  not the macOS ones (`src/desktop/bridge.ts`);
- the window lists its registered commands to review runs for exact coverage, read only
  (`src/renderer/App.tsx`).

The same runtime never shows a window or a native question (`backgroundTest` in `src/main.ts`): a
failed save or Quit step answers Keep Open, a main-process failure quits, error boxes go to the log
and the launch update check does not run. A scene cannot capture those dialogs.

In every runtime, the app marks the plane in view (`data-plane-in-view` on its pane marker) and
every file name with `data-file-name`; the checks read both. Builds without these hooks still run:
the Trash scene and the scenes that need them report **Needs a newer build**, the checks read the
space's status text and class names, and coverage scans the source for commands.

Each scene's profile starts from the settings the packaged app reports on a first launch, so an
older or newer build accepts it. The run's folder is kept and listed in
`$TMPDIR/viewer-kept-test-folders.log`; each capture's app logs are kept in
`out/native-evidence/review-*`. Move both to the Trash when you no longer need them.
