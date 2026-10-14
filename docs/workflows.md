# Workflows, watch rules and file relationships

Open **Workflows…** from Command-K or the native Actions menu. A workflow is a
portable `viewer.workflow.jsonc` definition. Reading, importing or opening it
does not execute it. Choose Run workflow to create a private run receipt.

## Definitions

Version 1 supports metadata/content inspection, folder comparison, reviewed copy
and existing recipes. Steps have unique IDs and explicit `needs` dependencies.
A dependency must finish before its outputs can be consumed. Cycles, missing
references and unknown executors are rejected.

Sources use these references:

```jsonc
// The files selected when Run was invoked, or files supplied by an approved rule.
{ "kind": "selection" }
// A declared input, relative to the definition's folder or a named folder binding.
{ "kind": "input", "name": "source" }
// Actual outputs of a completed dependency, checked against its source versions.
{ "kind": "step", "id": "inspect" }
```

Folder bindings describe destinations on this Mac; they never grant access.
Select native folders to grant access separately. JSONC comments survive explicit
saves, and stale revisions cannot overwrite newer external edits. Selection
workflows reject an empty selection before creating a receipt.

Copy and recipe steps create the existing editable reviews. Review and Apply
there, then Resume the workflow. Resume uses actual operation receipts, including
resolved keep-both names. Changed sources or definitions reject further work.
Cancelled/failed runs are not replayed. Interrupted read steps pause; an ambiguous
mutation step requires examining task history before starting a new run.

History retains at most 100 runs, with at most 20 pending. Artifacts are bounded
to 4 MB each, a run to 8 MiB and the history to 64 MiB. Removing a completed run
receipt does not remove its files or the ordinary operation/Undo receipts.

## Watch rules

Inside Workflows, choose **Watch a folder…** for a selection workflow. Choose a
folder, optional extension filter, subfolder scope and cooldown; explicitly allow
local content inspection if its steps need it. **Enable watch rule** stores a
private approval for this exact workflow revision, bindings and referenced local
recipes. Editing a public definition cannot create or broaden an approval.

Existing files form a metadata baseline at approval and are skipped. New or
modified regular files become the next selection. Copies and local renames still
wait for review and Apply. Only one run can remain pending for each rule. Approvals
persist across app restart, so approved rules can watch while the app runs; opening
a project or workflow never enables one.

Current watched steps are inspection, reviewed copy and nonrecursive local
batch rename. Comparison and model recipes run manually. Reading content/OCR may
download cloud files. Rename proposals use a frozen approved recipe at planner
admission, so changing it to a provider recipe cannot cause an automatic request.

Rules exclude Viewer’s private data, their definition and copy-output subtrees.
They skip symlinks, reject changed canonical roots and scope changes, and pause on
failed/cancelled runs, lost grants or unavailable sources. Completed rename output
versions prevent self-triggering; later user edits remain eligible. An interrupted
run-admission receipt pauses instead of creating a duplicate proposal.

Limits: 20 rules, 2,000 matching files and 5,000 visited entries per rule, tree depth
32, 50 changed files per run and a minimum 30-second cooldown. Larger bursts pause
for manual review. A revoked root stops dependent watches before its native grant
is released. Review notifications open the existing run UI. Pause stops further
steps; finish or cancel its pending run before changing/removing its approval.

Watch approvals, baselines and run receipts belong to private app state. They
must not be copied into project/configuration JSONC or treated as executable
authority by an agent. MCP currently cannot enable watch rules.

## Related files

**Related files…** shows relationships from retained operation, recipe and
workflow receipts. The list and bounded map distinguish observed receipts,
declared references, inferred source syntax and reported user notes. Current
source versions mark changed/unavailable files rather than silently presenting
stale evidence as current.

Content scanning is an explicit option. Current local readers cover Markdown
links, relative JavaScript/TypeScript imports, CSS references and OBJ material
files. They never execute code or follow remote references. These readers do not
resolve a whole project dependency graph; unsupported formats retain their receipt
relationships without claiming complete reference coverage.

The map shows up to 20 related files; the paged list retains up to 500 relations
per query. Parent folder labels distinguish repeated filenames. User notes are
separate reported claims, with deletion and cold-process persistence. The
`get_relationships` MCP tool requires metadata capability, content capability for
scans, filters both endpoints through client/native folder access, and omits all
private reported notes and commentary.

## Evidence and release scope

`tests/workflows.test.ts`, `watch-rules.test.ts` and `relationships.test.ts`
exercise actual temporary file services, revision/source races, guarded review,
private approvals, cold state and bounds. `native-workflows.ts` and
`native-watch-rules.ts` exercise the owned packaged app against generated files.
Their results do not establish physical native picker, cloud-offline, accessibility
or Mac App Store distribution qualification.
