# Workflows and watch rules

Open **Workflows…** from Commands or Actions. A `viewer.workflow.jsonc` file is a portable
definition; opening or importing it does not execute it.

## Steps and inputs

Version 1 supports metadata/content inspection, folder comparison, reviewed copy, typed
conversion/optimization and existing recipes. Steps have unique IDs and explicit `needs`
dependencies. Cycles, missing references and unknown executors are rejected.

Sources can reference the captured selection, a declared input or a completed dependency's outputs.
Folder bindings resolve locations; native access must be granted independently. A selection workflow
needs a non-empty selection.

```jsonc
{
  "id": "webp",
  "kind": "convert",
  "sources": [{ "kind": "selection" }],
  "destination": { "kind": "input", "name": "exports" },
  "transform": { "kind": "image", "format": "webp", "quality": 85 },
}
```

This is a step to include in a valid workflow definition, with an `exports` input. It prepares WebP
copies and accepts no arbitrary processor arguments.

## Run, review and resume

Choose **Run workflow** to create a private run receipt. Copy, conversion and recipe steps prepare
existing editable reviews. Review and Apply there, then Resume. Dependency outputs come from actual
operation receipts, including final Keep both names. Changed sources or definitions block
continuation.

Cancelled/failed runs do not replay at launch. Interrupted reads pause; ambiguous mutations require
inspecting operation history. History allows 100 runs, 20 pending, bounded per-step artifacts and 64
MiB total. Removing a run receipt does not remove output files or ordinary operation receipts.

## Watch incoming files

Choose **Watch a folder…** for a selection workflow. Set its folder, extension filter, subfolder
scope and cooldown. Content inspection requires its own explicit permission. Enabling stores
approval for the exact workflow/recipe revision and bindings.

Watch rules prepare reviews; they cannot Apply proposals. Changed definitions, revoked grants and
unavailable locations require recovery or new approval.

## Related files

Relationship inspection distinguishes actual output receipts, local references and reported notes. A
relationship is evidence with a source/basis, not permission to edit or launch a program. Portable
definitions exclude private run records, credentials and effective approvals.

For shell-like Test → Build composition, [custom actions](actions.md) can be a simpler starting
point. [Media](media.md) and [file operations](file-operations.md) describe the transformations and
their output behavior.
