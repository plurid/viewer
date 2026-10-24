# Capability map

This map describes the implemented application on October 24, 2026. It separates
ordinary browsing, advanced commands and agent authority so that a visible feature
does not imply an unattended API or unrestricted filesystem access. Implementation
status is separate from the candidate-specific evidence in
[verification](verification.md) and [release qualification](release-qualification.md).

The familiar baseline is deliberate. Finder's sidebar, four views and previews
inform browsing; GNOME Files' paths, bookmarks and separate locations inform
navigation. These are product references, not claims of platform parity.
[Finder guide](https://support.apple.com/en-in/guide/mac-help/mchle9f0a1b2/mac),
[GNOME Files guide](https://help.gnome.org/gnome-help/files-browse.html).
Total Commander's two-folder work, comparison and rename preview inform explicit
source/destination commands. File Explorer's pinned locations, common file actions
and properties inform the basic desktop baseline.
[Total Commander features](https://www.ghisler.com/),
[File Explorer guide](https://support.microsoft.com/en-gb/windows/experience/fileexplorer/file-explorer-in-windows?nochrome=true).

| Capability                  | New user                                         | Power user                                                      | Agent/API                                                | Review and Undo                                               | Resource limits                                                      | Remaining gaps                                                 |
| --------------------------- | ------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| Browse and select           | Sidebar, paths, history, four views              | Columns, ranges, invert, type-ahead, folder views               | Scoped listing; captured selection/navigation            | Navigation changes no files                                   | Virtual rows; shared folder watches                                  | Marquee and selection across result pages                      |
| Find files                  | Folder filtering and indexed names               | Query filters, saved searches, content evidence                 | Bounded search within granted roots                      | Read-only; content needs its own scope                        | Result windows; indexing/content opt-in                              | Rich filter UI, semantic search, mount recovery                |
| Preview and edit            | Images, media, documents, code, archives, models | Linked planes, scratch, citations, measurements                 | Bounded excerpts, tables and DXF facts                   | Explicit Save; guarded replacement Undo where eligible        | Per-format byte/page/geometry budgets                                | Broader codecs; durable state for every module                 |
| HTML and local sites        | Rendered HTML with Preview and Source tabs       | Start local server; linked plane, URL controls and request logs | No agent listener-start authority                        | Explicit source Save; start/stop owned by window and plane    | Opaque HTML sandbox; loopback-only static server; bounded reads/logs | Framework build/hot reload requires its own development server |
| Manage files                | Copy, move, rename, new items, Trash             | Jobs, conflict choices, archives, metadata                      | Typed proposals; opaque execution denied                 | Desktop review, version recheck, eligible guarded Undo        | Serialized mutation admission; bounded transfers                     | Adverse device/provider acceptance; bulk metadata              |
| Rename a selection          | Preview proposed names                           | Deterministic rules, regex and recipes                          | Revisioned reviewed plans                                | Include/exclude rows; source checks; guarded reversal         | Regex worker timeout; bounded preview rows                           | Larger representative book corpus and richer rules             |
| Compare and inspect storage | Folder comparison and duplicate inspection       | Hashes, text/image differences, size scans                      | Bounded comparison/inspection tools                      | Copy plans reviewed; no automatic consolidation               | Chunked hashing; cancellable size worker                             | Perceptual duplicates; richer synchronization                  |
| Git                         | Opt-in badges and branch status                  | Git column and HEAD differences                                 | No repository mutation authority                         | Read-only; editable comparison uses ordinary Save             | Hardened Git process; bounded output; direct build                   | Large/replaced repository and platform acceptance              |
| Spatial work                | Folder and preview planes; Overview              | Independent roots, tiling, per-tile resize, views, Tour         | Scoped navigation and reviewed window commands           | Arrangement undo is separate from file Undo                   | Engine events coalesced; sessions survive culling                    | Measured many-plane workloads; all preview cameras             |
| Profiles and themes         | Focus, Present, Full; Workspace look             | Workspace default/custom profiles; theme metrics                | Allowed presentation commands remain reviewed            | Local overlays; shared Settings edits stay explicit           | Exact field schema; cached effective values                          | Legacy diagnostic repair; physical multi-display checks        |
| Projects and collections    | Reopen saved work; collect related files         | JSONC projects, arrangements, basket, lenses                    | Scoped project/navigation tools                          | Imported definitions stay dormant; project changes reviewed   | Bounded records and indexed snapshots                                | Missing-path placeholders; richer export and identity recovery |
| Terminals and quick entry   | Terminal plane and command palette               | Prefix keys, macros, command line, hotkey, shell entry          | Separate terminal-read scope; shell/write routes blocked | Human program execution explicit; agent commands reviewed     | Owned PTYs; bounded output and shutdown                              | Physical shortcut, real shell/PATH and platform qualification  |
| Recipes and workflows       | Run a named recipe and inspect its plan          | Portable DAGs, checkpoints, opt-in watch rules                  | Scoped tasks, receipts and proposals                     | Apply is explicit; recovery returns to review                 | Task/content budgets; one admitted watch run per rule                | More transformation adapters; long-running fault evidence      |
| Chat and requests           | Conversation with selected/dropped context       | Read-only folder tools and `>` requests                         | Provider data consent is separate from agent grants      | Model suggestions become proposals; no autonomous Trash/apply | Bounded excerpts, tool calls and cancellation                        | Live provider/consent acceptance; broader evaluations          |
| Native integration          | Open With, Get Info, volumes, Trash              | Finder clipboard/drag, aliases, Quick Look/Share                | Native scopes checked independently of client grants     | Native consent; identity-bound Trash; no deletion fallback    | Revocable capabilities; drained workers before eject                 | Signed Store, physical panels, other operating systems         |

The direct build additionally implements [human Git quick actions](git-actions.md):
status/history, staging, staged-only commit, fast-forward pull and upstream push.
They use a fixed desktop API and owned bounded terminal results; the person's
explicit command triggers execution. Saved results never replay programs. Agents cannot invoke these
actions or read their terminal output. Background badges retain their separate
opt-in, hardened read-only behavior. Current package evidence remains in
[verification](verification.md).

The matrix is a maintenance checklist. New UI, shortcuts and agent tools should use
the same typed command, inspection, proposal and operation services. A feature
without a checked target, a bounded workload and an appropriate recovery path is
incomplete even if its button renders.

The approved continuation concentrates on correctness, durable state, explicit
consent, module boundaries and this capability inventory. General AI-guided folder
organization remains deferred. Chat and recipes retain their existing bounded,
proposal-only behavior.

See [roadmap](roadmap.md) for priorities, [architecture](architecture.md) for owners,
and [feature delivery](feature-delivery.md) for the historical milestone ledger.
