# Viewer feature delivery

This ledger tracks the roadmap accepted on 14 October 2026. A feature is complete
only when its public controls, permission boundaries, persistence and affected
checks work together. Store qualification remains a separate gate.

## Product decisions

- Agents may read and navigate within explicit client capabilities and folder
  grants. File changes require a reviewed plan. Opaque shell, executable and terminal-input routes remain unavailable to agents; saved grants cannot bypass fresh command or removal review.
- Project definitions and named arrangements are saved explicitly as JSONC.
  Everyday session changes stay in private application state.
- Checkpoints are opt-in during change review, with a 5 GiB default total budget.
  Built-in guarded Undo remains available independently.
- Project folder views take precedence inside that project only.
- Close project detaches the saved definition while retaining open planes, layout
  and preview notes in the ordinary workspace. It performs no file operation;
  shared folder preferences resume. Missing files offer Close project directly.
  Dismiss remembers the unchanged problem across folder-watch notifications.
- Content indexing, embeddings, OCR, transcription and provider transmission are
  opt-in. Opening a project never starts its commands or workflows.

## Milestones

| Milestone                                                        | Delivery                                                                                                                                                                                                                                             | Verification                                                                                                                                                      |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Portable project workspaces and durable spatial state         | Project controls, JSONC saves, arrangements, project views, notes, preview-state persistence and external edit/review notice delivered; unbound plane placeholders and export refinements remain                                                     | Focused tests, actual external watch notification and packaged cold-session checks pass                                                                           |
| 2. Shared inspection and search with navigable evidence          | Shared inspection, original passages, PDF/EPUB/text/Word block/worksheet cell/image anchors and shared DXF geometry facts delivered; semantic/media indexing and fact columns remain                                                                 | Source-evidence and worker tests pass; packaged inspector, CSV/Office cell, Word passage, image region and DXF worker verified                                    |
| 3. Revisioned change plans and optional checkpoints              | Recipe and built-in operation review envelopes, source preconditions, editable/excludable rows, worker-bounded rename previews, full-tree checkpoint manifests and serialized guarded recovery copies delivered; metadata/conversion adapters remain | Source-tree changes, empty-folder/unrecorded-file corruption, restore/removal races, legacy manifests and actual packaged review/checkpoint/regex checks pass     |
| 4. Per-client agent capabilities, tasks and audit                | Private hashed credentials, folder/capability grants, owned task status, budgets, revocation/stop, activity and bounded inspection/content/table/DXF geometry tools delivered; 3D geometry and additional planning tools remain                      | Client isolation, canonical/private boundaries and actual packaged geometry-worker/navigation/revocation checks pass                                              |
| 5. Comparison, collections and cross-folder basket               | Metadata/hash comparison, unknown/partial coverage, one-way reviewed copy, virtual collection planes, durable basket, indexed-query snapshots and text/image difference planes delivered; paired docking remains                                     | Queue/source race tests, 1,200-match snapshot, packaged text/image differences and collection/basket cold-process checks pass                                     |
| 6. Workflows, relationships and provenance                       | Portable DAG workflows, durable review/resume receipts, private opt-in watch rules, local reference readers, recorded relationship list/map and reported notes delivered; richer format readers and history navigation remain                        | 459-test suite passes; actual packaged run/review/apply/resume, real macOS incoming-file watches, scope invalidation and cold-process receipts verified           |
| 7. File intelligence, formats, transformations and extension SDK | DOCX/XLSX shared readers, plane previews and named-agent worksheet windows delivered; intelligence tools, richer CAD interaction, transformations and SDK remain                                                                                     | Reader/permission/index regressions, packaged document/table citations, worksheet filtering, formula details and cold-session checks pass; see office-previews.md |
| 8. Finder integration, independent windows and release checks    | Independent native windows, opt-in global shortcut and shell command delivered; Finder integration and release qualification remain                                                                                                                  | Packaged second-process CLI and isolated workspace ownership pass; physical shortcut, shell installation and distribution acceptance remain                       |

The October 24 continuation also adds opt-in read-only Git, proposal-only private
Chat, workspace default profiles, Present/Tour integration, theme metrics and
individual tile resizing. See the [feature guide](spatial-tools.md) and the dated
[verification evidence](verification.md) for bounds and outstanding native checks.

The current foundation decisions are recorded in [architecture](architecture.md)
and [ADRs](adr/0001-window-local-profiles.md). The [capability map](capabilities.md)
separates new-user controls, advanced commands, agent scope, review/recovery and
remaining limits. General AI-guided folder organization remains deferred.

## Existing baseline

Finder metadata and aliases, native sharing and Quick Look, spring-loaded folder
navigation, guarded operations and Undo, DXF/model/document previews, reviewed AI
recipes, and the MCP navigation bridge are already present. The last baseline
passed 391 tests and packaged native navigation checks. That evidence does not
qualify later builds for the Mac App Store; see mac-app-store-readiness.md.

## Current implementation evidence

- 459 tests across 64 files pass after the project, inspection, checkpoint, client,
  comparison, collection, basket, workflow, watch-rule, relationship and Office
  changes. A reproduced native FIFO coordination wait is now rejected before
  requesting the native accessor; archive descriptors also reject special files.
- TypeScript checks and the local production package pass.
- `tests/native-projects.ts` verifies actual packaged controls, parent/docking
  export, comment preservation, dormant imported terminals, the inspection worker,
  and note persistence after graceful Quit and a new process.
- `out/project-acceptance/result.json` and `inspection.png` record that run.
- The project/inspection corrections and comparison/collection focus corrections
  passed their bounded finish verdicts. Workflow selected metadata, editor fields,
  native disclosures and receipt layout also passed their scored finish verdict.
  Watch-rule and Related files review requested explicit map link bases; that sole
  correction was scored resolved. Documentation preserves all prior tokens and
  records the verified list/map/approval/review states at their scoped verdict.
- `tests/native-agent-clients.ts` verifies Settings-only client management,
  capability and folder boundaries, source-versioned content, actual automatic
  navigation, actor-owned proposals, actual shared DXF geometry and named XLSX
  windows, and immediate credential revocation. Metadata-only credentials cannot
  read geometry or worksheet cells.
- `tests/native-change-review.ts` verifies opt-in checkpoint review, journaled
  recovery copies and termination of a pathological regex in its dedicated worker.
- `tests/native-comparison-collections.ts` verifies actual comparison and operation
  review controls, checkpoint-before-copy, collection planes and cross-folder
  basket persistence after Quit and a fresh process.
- `tests/native-workflows.ts` verifies dormant opening, actual run/review/apply/resume,
  shared DXF facts, original CSV cell/image-region anchors, recorded relationships,
  reported notes and completed receipts after a fresh process.
- `tests/native-watch-rules.ts` verifies actual pause/reapproval controls, real macOS
  directory events, unchanged destination before review, one pending run per rule,
  cold startup and definition-change invalidation. Initial scope is seeded through
  the real private API; native picker interactions are explicitly excluded.
- Watch-rule tests cover bounded bursts, escaped symlinks, revoked access,
  interrupted run admission, self-trigger prevention and recipe changes at the
  actual planner admission boundary.
- Explicit inspections retain validity during unrelated index reconfiguration;
  actual native grant revocation and worker resets still retire their results.
- Checkpoints now validate the entire source/retained tree, including empty
  folders, and serialize create/restore/remove admission. Earlier hash manifests
  remain readable, with unrecorded retained files rejected before publication.
- Application code uses top-level type imports; lint rejects inline type imports.
- `tests/native-office.ts` verifies DOCX body rendering and block citations,
  XLSX source-addressed cells/filtering/saved formulas, persisted sheet choices,
  cold citation restoration, visible coverage details and empty/error recovery.
  Its final captures wait for full opacity and stable camera transforms.
- Existing packaged workflow and named-client checks pass after the shared table
  and native coordination changes. The Office finish review scored its sole
  coverage-disclosure fix resolved; the corrected compact Word capture closes
  the earlier camera-transition evidence gap. This is not whole-app approval.
- Real native pickers, cloud-provider edge cases, supported macOS versions and
  distribution signing remain separate release qualification requirements.

Public controls and limits are described in [workflows.md](workflows.md). This
ledger records delivered capability slices, not full milestone or Store completion.
