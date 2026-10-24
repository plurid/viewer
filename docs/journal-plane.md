# Viewer Journal plane

Product proposal, October 24, 2026. Requested during the
[spatial development discussion](spatial-development.md). Not implemented yet.

## Purpose

Open Journal as a normal Plurid plane to answer: what happened, where, why did it
fail and what can I inspect next? It should offer the filtering and correlation
of a log explorer while staying local and understandable without a cloud account.

Examples:

- Show failed actions in this workspace in the last hour.
- Show this plane's navigation, watcher failures and Git actions.
- Follow one Chat request through consent, provider response, bounded file tools
  and a proposal, with durations and safe error codes.
- Explain a workspace save failure or fullscreen transition timeout.
- Follow a local-server event to that server's own request log.
- Return to the exact test result or operation that needs attention.

Journal is searchable history. The proposed attention list is the smaller set of
current items needing action. A resolved historical error need not remain an
alert. Both views can reference the same task and event identities.

## First interface

Provide **Open Journal**, **Journal for workspace** and **Journal for plane**
commands. Contextual commands prefill filters; every plane uses the same query
service rather than maintaining independent copies of events.

The initial plane contains:

1. Time range, severity, category and workspace/plane/task filters.
2. Search, saved filters and an explicit Follow live/Pause control.
3. A virtualized table: time, severity, source, workspace/plane, event and duration.
4. Expandable details with a readable summary, structured fields, correlation
   links and available source links.
5. Explicit export of filtered events, with a preview of included data.

Start with visible filters and useful presets: Errors, Running work, Waiting for
me, File operations, Git, Chat/provider, Local servers and Saves. Advanced queries
can later express `severity >= warning`, categories and named scopes. Parse a
bounded typed query; never accept raw SQL or execute JavaScript. Invalid queries
retain the previous result and reading position.

New rows must not move someone reviewing older events. Show an unread count and
Jump to latest. Keyboard navigation, copyable event IDs, wrapping detail fields
and an accessible text view matter more than decoration.

## Structured events

Record events at the authoritative service rather than scraping interface text.

| Field                      | Meaning                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------- |
| Event ID and sequence      | Stable identity and deterministic ordering within a recorded session               |
| Time and duration          | Wall-clock time for navigation; monotonic duration for an operation                |
| Severity                   | Debug, info, warning or error; expected cancellation is not automatically an error |
| Category and event type    | Stable vocabulary: Git, Chat, saves, windows, file operations                      |
| App session and build      | Associate evidence with the actual process/version                                 |
| Workspace, plane and task  | Optional captured origins; global events can have none                             |
| Correlation and parent     | Connect a request, child activity and outcome                                      |
| Safe summary and details   | Bounded, validated fields appropriate to the event type                            |
| Producer and trust         | Desktop observation, validated renderer report, worker event or external report    |
| Outcome and source version | Reported, observed, verified, stale or unknown where relevant                      |

Capture workspace and plane identity when an action starts. Do not label its
completion with whichever workspace is active later. A renderer or terminal
program cannot impersonate native approval, successful mutation or another
session's events. A file watcher may not know which external program made a
change: record that uncertainty instead of blaming the nearest agent turn.

## Existing owners remain authoritative

Viewer already has diagnostic logs and renderer reports in `desktop/diagnostics`,
private agent audit records, durable operation/Undo receipts, execution events
and local-server logs. Journal projects and links these records. It is not a
second mutation journal or an authorization store.

The operational journal remains authoritative for recovery and eligible Undo;
native consent remains authoritative for grants. Debug history is useful support
evidence, not a tamper-proof security audit. Viewing or exporting an event never
applies, undoes, cancels or replays its action.

Raw terminal scrollback, detailed server requests and transcripts retain their
existing bounded owners. Journal records lifecycle and links into details when
access permits. Avoid copying every terminal byte and server request into a
global database.

## Privacy and authority

Default events contain no credentials, authorization headers, cookies, chat text,
file excerpts, terminal input or environment dumps. Provider failures use the
safe fixed classifier; do not retain raw error responses for convenience.
Arguments can contain secrets: record a known action kind and target summary
rather than arbitrary argv or shell text.

Paths and filenames are private data too. Their indexing and export need a clear
local policy and preview. Do not upload telemetry by default. A separate,
explicit diagnostic mode may include more detail only with visible scope and a
bounded lifetime.

Following a Journal link grants no access. Agents must not discover unrelated
workspace metadata through global queries or correlation. The first release can
be human-only; a later agent reader needs scoped projections, redaction and
budgets. Missing or inaccessible records remain honest placeholders.

## Storage, retention and reliability

Use a private bounded event store behind record/query/subscribe operations. An
indexed SQLite store in a worker is a reasonable candidate, consistent with
existing indexing, but measure initial volume before committing to it. Keep the
event store separate from workspace layout and engine state.

Bound event size, ingestion queues, query pages, subscriptions and disk usage.
Coalesce repeated watcher/progress events with a visible count. Dropped events
produce a visible gap; the history must not claim completeness. A log flood
cannot block camera input or fill memory indefinitely.

Retention must respect the owner's exact-path, Trash-only removal policy. Do not
introduce automatic file rotation, pruning, database replacement or cleanup that
silently bypasses it. Initially cap ingestion and report a full store. Managed
archival/retention needs a separate reviewed design. Closing a Journal plane
removes a view; clearing a filter does not erase events.

For ordinary telemetry, a failed sink should preserve bounded buffered records
and increment a visible diagnostic counter without failing the observed action.
Existing durable mutation and consent receipts retain their stronger persistence
requirements independently of Journal.

## Delivery and acceptance

1. Wire a few complete paths: Git action, safe Chat/provider failure, workspace
   save and local-server lifecycle.
2. Deliver the human Journal plane, contextual filters, correlation navigation
   and bounded live history, preserving existing record owners.
3. Add durable queries, saved filters and reviewed export. Design retention before
   enabling unattended archival or cleanup.
4. Connect attention badges, test evidence and future structured agent sessions.
5. Consider agent queries only after explicit scope and permission tests.

Acceptance covers two independent windows, a workspace switch during a task, a
closed/reopened source plane, restarts, inaccessible linked resources, errors
containing fake secrets, event floods, ingestion failure and query cancellation.
Restoration must run no recorded operation. Consent and Undo must remain correct
when Journal is unavailable.

The first demonstration is small: one Git action and one failed Chat request
produce correlated entries; following either opens its result/error; a workspace
filter hides unrelated activity; no message text or secret appears in history
or export.
