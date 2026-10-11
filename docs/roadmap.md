# Remaining file-manager work

This implementation establishes root ownership, reliable browsing/preview context, searchable Settings, an indexed search service and reviewed action recipes. It does not establish Finder, Explorer or Everything feature parity, nor a bug-free claim for every file or workload.

The following priorities preserve the current compact plane/navigation/command interface. Add capabilities through shared commands and desktop services before adding permanent toolbars.

| Area | Present | Next substantial work |
| --- | --- | --- |
| File navigation | Independent roots/history, shared configurable navigation, four virtualized views, path entry, search roots | Per-folder view preferences, type-ahead jump, selection across result pages, tabular column customization |
| Native integration | Default-app opening, Reveal in Finder, native dialogs/menus/Trash adapter | Finder clipboard interoperability, Open With, Finder tags/labels and metadata editing, app-managed Trash recovery |
| Indexed search | Local filename/metadata FTS5, filters, folder-granted text, saved queries | Structured filter editor, snippets with evidence, configurable background resource budgets, live mount recovery, larger real datasets |
| Preview quality | Images, media, PDF, safe EPUB text, code/data, archives and 3D | Office documents, HEIC/TIFF, EPUB images/layout, additional ebooks/CAD/USD, very large models/CSV, broader codec fixtures |
| Spatial work | Root-scoped reuse, explicit copies, minimap facing, culling sessions, arrangement undo | Durable camera/playback state per preview; instrument and reduce engine commit volume under many planes and previews |
| File operations | Safe jobs, collision review, guarded move/rename Undo, reviewed batch/model actions | Folder comparison/synchronization, checksums/duplicate finder, bulk metadata tools, cross-volume metadata fidelity |
| Models and agents | Reusable recipes, explicit text-sharing choices, evidence/review, scoped proposal-only MCP | Real-provider evaluations against mixed books, better edition/author/year confidence, per-client grants, credential UX in a signed release |
| Reliability and distribution | Isolated native/unit checks, atomic metadata, action recovery | Removable/network-drive fault tests, permission revocation during real operations, long-running profiling, signed/notarized releases, Windows/Linux adapters |

The remaining jagginess work should follow recorded interactions and traces. Earlier menu hover scrolling, quadratic selection, unnecessary job snapshots and a file-finder render loop were specific defects. Bounded local samples do not prove that every camera gesture, mount, archive, decoder or large document is responsive. Keep a repeatable workload and compare frame times, long tasks, React commits, IPC and decoded/GPU memory before changing architecture further.

For the publication recipe, build an evaluation corpus with varied EPUB metadata, scanned PDFs, edited editions, multiple authors and ambiguous publishers. Keep unresolved proposals unchecked. The preferred template should remain a recipe rather than a special case in the explorer. Future agents should use the same action/proposal services and user review boundary.
