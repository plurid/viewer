# Bounded human Journal projection

Accepted October 25, 2026.

Viewer needs a shared inspection history across planes and independent workspace windows. Existing
operation receipts, agent consent/audits, transcripts, terminal screens and server request logs
already own their respective state and authority.

Use a closed, versioned event vocabulary projected from desktop service entry and completion. Copy
origins before asynchronous work; refine them from validated service targets. Correlation IDs
connect lifecycle records. There is no renderer append route, arbitrary message field or agent query
tool. Paths, filenames, arguments, content and raw errors are excluded from the stored schema.

Use an append-only private JSONL store capped at 8 MiB/10,000 records, with a 256-event ingestion
queue and bounded typed query pages. The maximum resident history makes a linear scan and a
virtualized reader sufficient for this first slice. This avoids another database/worker dependency
before larger volume or retention requirements are measured. Query snapshots fix a sequence
boundary; each reader can pause, page and ignore stale responses independently.

A full, replaced or damaged store stops appends and exposes its condition and dropped-event counter.
It never changes an observed action's result. No automatic pruning, replacement, rotation or removal
occurs. Exact-file native review plus identity-checked OS Trash is the only history reset. Export
uses an expiring, owner-bound preview ticket and exclusively creates a new user-selected file.

This is support history, not a durable mutation receipt or tamper-proof audit. Viewing, restoring or
exporting it cannot replay an operation. Parent/child command spans, richer producers, larger
indexed retention and scoped agent reads need separate increments and authority tests. See
[Journal scope](../reference/journal.md).
