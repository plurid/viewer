# Workflows and watch rules

This page describes workflow files (`*.workflow.jsonc`), how a run is reviewed and resumed, watch
rules, and their limits.

## Open a workflow

Choose **File → Workflows…** or **Workflows…** in ⌘K. With one `*.workflow.jsonc` file selected, it
opens that file. **Open workflow…** reads a file. **New workflow** picks a template (**Inspect
files**, **Compare folders**, **Inspect and copy**, **Inspect selection** or **Inspect and copy
selection**) and **Create…** writes it as `viewer.workflow.jsonc` in the folder you choose. Opening,
importing or editing a file never runs a step.

| Control                    | Effect                                                                     |
| -------------------------- | -------------------------------------------------------------------------- |
| **Choose folder…**         | Sets a folder binding for this run                                         |
| **Allow workflow folder…** | Grants native access to the workflow's folder                              |
| **Run workflow**           | Starts a run with the current selection                                    |
| **Edit definition**        | Edits the JSONC; **Save definition** or **Cancel editing**                 |
| **Reload file**            | Reads the file again                                                       |
| **Resume workflow**        | Continues after you finish a step's review                                 |
| **Cancel run**             | Stops the run                                                              |
| **Remove run history**     | Removes a finished run's receipt; output files and operation receipts stay |

## File format

```jsonc
{
  "version": 1,
  "id": "web-exports",
  "name": "Web exports",
  "bindings": [{ "name": "exports", "label": "Export folder" }],
  "inputs": { "exports": { "path": ".", "binding": "exports" } },
  "steps": [
    {
      "id": "webp",
      "kind": "convert",
      "sources": [{ "kind": "selection" }],
      "destination": { "kind": "input", "name": "exports" },
      "transform": { "kind": "image", "format": "webp", "quality": 85 },
    },
  ],
}
```

| Field      | Value                                                                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`  | `1`                                                                                                                                                                                |
| `id`       | 1 to 100 of `A–Z`, `a–z`, `0–9`, `.`, `_`, `-`                                                                                                                                     |
| `name`     | 1 to 100 characters                                                                                                                                                                |
| `bindings` | Up to 100 `{ "name", "label" }`: folders chosen when the run starts; names are unique                                                                                              |
| `inputs`   | Up to 100 named locations `{ "path", "binding"? }`: a path relative to the workflow file's folder, or to a declared binding; `.` is that folder itself; no `..`, no absolute paths |
| `steps`    | 1 to 100 steps with unique `id`s                                                                                                                                                   |

Every step has an `id` and `needs`, the IDs of steps it depends on (up to 100). A reference names
the files a step reads or writes:

| Reference                          | Means                                                  |
| ---------------------------------- | ------------------------------------------------------ |
| `{ "kind": "selection" }`          | The files selected when the run started                |
| `{ "kind": "input", "name": "…" }` | A declared input                                       |
| `{ "kind": "step", "id": "…" }`    | The outputs of a completed step; it must be in `needs` |

| Step kind | Fields                                                              | Does                                                              |
| --------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `inspect` | `sources` (1 to 100), `content` (false), `ocr` (false)              | Reads metadata, and with `content` the text, of at most 100 files |
| `compare` | `left`, `right`, `hashes` (false)                                   | Compares exactly one location on each side                        |
| `copy`    | `sources` (1 to 100), `destination`                                 | Prepares a reviewed copy into one folder                          |
| `convert` | `sources` (1 to 100), `destination`, `transform`, `name` (optional) | Prepares a reviewed conversion                                    |
| `recipe`  | `sources` (1 to 100), `recipeID`, `instructions` (optional, 12,000) | Prepares a recipe's review; see [recipes](actions.md#recipes)     |

`transform.kind` is one of `image`, `media`, `pdf`, `pdf-pages`, `layout`, `nesting`,
`dxf-correction` or `mail-attachment`, with the fields Viewer's own tools use; see
[media](media.md), [PDF tools](pdf.md), [layout](layout.md), [nesting](nesting.md) and
[fabrication](fabrication.md#correction). A workflow cannot prepare a nesting, a correction or a
saved attachment. There is no field for processor arguments.

The file is refused when it has duplicate step or binding IDs, a `needs` cycle or a missing step, an
undeclared input or binding, or a step reference that is not in `needs`.

## Run, review and resume

**Run workflow** saves a private run receipt and runs steps in dependency order.

| Step                        | What happens                                                             |
| --------------------------- | ------------------------------------------------------------------------ |
| `inspect`, `compare`        | Runs and completes                                                       |
| `copy`, `convert`, `recipe` | Prepares an ordinary review and pauses the run at **waiting for review** |

Review and Apply in that review, then choose **Resume workflow**. A dependent step reads the outputs
the operation receipt recorded, including any Keep both names. Before each step the run checks that
its sources are unchanged; a changed source or a changed workflow file stops it.

| Run status       | Meaning                                                          |
| ---------------- | ---------------------------------------------------------------- |
| `running`        | A step is running                                                |
| `waiting-review` | A review waits for you                                           |
| `paused`         | Viewer quit during a read step; **Resume workflow** continues it |
| `completed`      | Every step finished                                              |
| `failed`         | A step failed; the run does not continue                         |
| `cancelled`      | You cancelled it                                                 |

A run never replays at launch. A file-changing step that was running when Viewer quit, and has no
recorded review, fails with
`The run stopped before recording its task ID. Check the task history before starting another run.`

| Limit                                   | Value                        |
| --------------------------------------- | ---------------------------- |
| Run receipts kept                       | 100                          |
| Runs running, waiting or paused at once | 20                           |
| Sources per run                         | 1 to 2,000                   |
| Files an `inspect` step reads           | 100                          |
| One step's recorded result              | 4,000,000 characters of JSON |
| One run receipt                         | 8 MiB                        |
| All run receipts                        | 64 MiB                       |

At the limits a run is refused with, for example,
`The workflow history is full. Export or remove old run receipts before starting another.` or
`Finish or cancel pending workflows before starting another.`

## Watch a folder

**Watch a folder…** in the workflow window turns a workflow into a watch rule. When files in the
folder are new or changed, the rule starts a run with them as the selection. It prepares reviews; it
never applies them.

| Field                              | Values                                                         |
| ---------------------------------- | -------------------------------------------------------------- |
| **Choose folder…**                 | The watched folder                                             |
| **File extensions**                | Up to 50, lowercase letters and digits; empty matches any file |
| **Include subfolders**             | Watches below the folder                                       |
| **Allow local content inspection** | Lets `inspect` steps read content or run OCR                   |
| **Minimum time between runs**      | 30 seconds to 24 hours                                         |

**Enable watch rule** stores an approval for the exact workflow file revision, bindings,
destinations and rename recipes. **Pause** stops it; **Review and enable…** approves it again;
**Remove rule** deletes it; **Open run** shows its latest run.

| A watch workflow must                                                                       |
| ------------------------------------------------------------------------------------------- |
| Read the selection in at least one step                                                     |
| Take sources only from the selection or earlier steps, never from fixed inputs              |
| Copy or convert only into a fixed input folder that is not the watched folder or its parent |
| Use only `inspect`, `copy`, `convert` and `recipe` steps; no `compare`                      |
| Use only local, nonrecursive **Batch rename** recipes with **Filenames only**               |
| Stay outside Viewer's private application data                                              |

| Watch limit                      | Value                                                      |
| -------------------------------- | ---------------------------------------------------------- |
| Watch rules                      | 20                                                         |
| Entries scanned                  | 5,000, at most 32 folders deep; symbolic links are skipped |
| Matching files                   | 2,000                                                      |
| Changed files that start one run | 50; more pauses the rule for a manual review               |

A rule pauses itself, with the reason, when its workflow, recipe or destination changes, when access
is revoked, when the folder moves or is unavailable, or when its last run failed or was cancelled. A
rename the rule itself completed does not trigger it again.

## Related files

**Related files…** shows how the selected files connect: outputs recorded by operation receipts,
references found in local files, and notes reported to Viewer. Each relationship shows its source
and basis. It is evidence, not permission to edit a file or start a program.

Portable workflow files never contain run receipts, credentials or approvals.

**Related:** [Make repeated work a command](../guides/automate.md) · [Custom actions](actions.md) ·
[File operations](file-operations.md) · [Media](media.md) · [Terms](terms.md)
