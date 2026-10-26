# Remaining file-manager work

Updated October 26, 2026. The [capability map](capabilities.md) records what the
current implementation exposes to new users, advanced users and agents, including
review/Undo, resource limits and gaps. The [feature ledger](feature-delivery.md)
retains milestone history. Neither source implementation nor an older passing
candidate establishes native acceptance for the current package.

[Spatial development](spatial-development.md) records the October 24 research and
proposal for worktrees, read-only branch folders, linked Git review and structured
Codex/Claude sessions. The later [task workflow implementation](task-workflow-implementation.md)
records delivered branch/worktree task creation, Git hunk review, composable
commands and explicitly reported agent-session navigation. Automatic external
transcript import/resumption remains future work.

The [Journal plane](journal-plane.md) and its [ownership decision](adr/0006-bounded-human-journal.md)
record implemented bounded event inspection and correlation. Diagnostic logs,
durable operation receipts and agent audit retain their distinct owners.

[Composable actions](composable-actions.md) records typed parameters, contextual
directory predicates, user-organized palette folders and sequential/DAG workflows.
The task workflow ledger distinguishes the delivered paths from broader proposals.

The current [reliability follow-up](reliability-followup.md) replaces the remaining
shared image-thumbnail path, moves large table/mesh parsing off the interface
thread, bounds decoded allocations and checks lifecycle/recovery. The operator
confirmed the remaining approved generated note moved to Trash; both generated
documents are absent from their source paths, library and saved open views.
Exact Trash destinations were not independently inspected. General AI-guided
folder organization remains deferred. Existing
Chat, recipes and workflows keep their bounded inspection and reviewed proposals.

[Sharing and file-manager directions](file-manager-directions.md) records the
Loaf/Plurid research and proposed `plurid.link` modes: local reference, immutable
snapshot and later live sharing. It prioritizes useful recipient previews,
shareable views, explicit manifests and revocation over adding permanent chrome.
No hosted sharing implementation or domain availability is established yet.

## Reliability and acceptance first

The following table defines continuing acceptance criteria. Dated verification
records establish which candidate passed each check; it is not a list of wholly
unimplemented features.

| Priority | Work                              | Acceptance behavior                                                                                                                                                                                                 |
| -------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Profile and window isolation      | Workspace default, explicit profile and local choices resolve independently in two windows; Settings edits stay shared; missing/changed definitions and old global records recover without overwriting newer edits. |
| P1       | Save and close integrity          | Text/Chat drafts, preferences, engine state and layout join one flush; failed saves retain intents; wrong-window acknowledgements, timeouts and disconnects cannot report success or silently close.                |
| P1       | Spatial control access            | Minimap placement cannot cover plane-header controls; crowded/narrow workspaces expose keyboard-operable Overview; camera, resize and culling preserve lifecycle and focus.                                         |
| P1       | Reproducible dependencies         | Ordinary frozen installation and production build use declared registry artifacts, retain version/integrity provenance and do not depend on a locally modified package store.                                       |
| P1       | Physical shortcut and shell entry | Record actual Option-Space with a conflicting binding, multiple displays and fullscreen restoration; run installed shell paths/flags; native uninstall rechecks the reviewed script and uses Trash.                 |
| P1       | Live model and agent consent      | Record explicit provider endpoint/data consent and a live response; deny/revoke access correctly; shared version-1 records and edited JSONC never confer version-2 authority.                                       |
| P1       | Immutable candidate evidence      | Associate each result with the tested executable/source/dependency hashes; retain generated fixtures and report physical, provider and signed Store gates separately.                                               |

See [verification](verification.md), [release qualification](release-qualification.md)
and [native scenarios](release/native-acceptance.md) for dated evidence and precise
remaining gates. Fixture adapters, a real local native binding, an owned packaged
process and physical user interaction prove different parts of the boundary.

## Remaining desktop and scale gaps

The baseline remains compact browsing with shared commands and desktop services,
using familiar [Finder, GNOME Files, Total Commander and File Explorer patterns](capabilities.md).
Add permanent UI only when contextual actions cannot make a capability discoverable.

| Area                     | Already implemented                                                                                               | Remaining work                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Browsing and selection   | Four virtualized views, ranges, type-ahead, invert, columns, shared folder views and independent sessions         | Marquee selection, indexed-page selection and identity recovery for arbitrary external folder moves                          |
| Native integration       | Open With, Get Info, aliases, clipboard/drag, Quick Look/Share, Trash browser, volume inventory/eject adapters    | Physical panels and assistive technology; signed Store grants; tag filtering/sidebar and native Services                     |
| Operations and recovery  | Journaled jobs, conflicts, guarded eligible Undo/Redo, archives, deterministic reviewed rename and checkpoints    | Low-space/provider/device failures across supported filesystems; cross-volume Undo policy; bulk metadata                     |
| Search and inspection    | Local indexed names/metadata, granted content evidence, source-addressed tables, DOCX/XLSX and DXF facts          | Rich filter UI, snippets/navigation refinements, semantic/media indexing and mount recovery                                  |
| Comparison and storage   | Folder metadata/hash comparison, text/image diff, exact duplicates and explicit logical-size scans                | Richer synchronization, perceptual matching, hard-link/allocation accounting and cache freshness                             |
| Spatial work             | Independent roots/windows, readable tiling, compact related navigation, file-view recall and measured 20-plane close/reopen work | Longer mixed-session soak, wider preview-restoration corpus, missing project-path placeholders and physical compositor/GPU measurements |
| Automation and models    | Recipes, portable DAGs, dormant imports, private watch approvals, scoped agent tasks/audit and proposal-only Chat | Broader real-document evaluations, format transformations and richer content readers; general AI organization stays deferred |
| Formats and distribution | Modular document/media/archive/CAD previews and isolated platform adapters                                        | Larger codec/model/CSV corpora, release signing/notarization, other supported macOS versions and Windows/Linux qualification |

## Further delivery order

1. Retain correctness regressions and qualify the current native candidate. Keep
   configuration, profile overlays, consent, session data and operation authority
   distinct at their typed boundaries.
2. Complete baseline desktop gaps and adverse-I/O evidence through the existing
   commands, native scope checks, proposal review and operation queue.
3. Extend the [20-plane measurements and preview recall](mixed-workspace-followup.md)
   with longer mixed-session runs, representative larger files and physical
   compositor/GPU evidence before expanding background indexing or parsing budgets.
4. Improve publication recipes against a representative corpus, then extend
   bounded format readers and transformations with evidence and recovery.
5. Revisit broader intelligent organization only through a separate product
   decision, evaluated proposal model and explicit authorization boundaries.
