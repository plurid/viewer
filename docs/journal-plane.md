# Viewer Journal plane

Initial implementation, October 25, 2026. Requested during the
[spatial development discussion](spatial-development.md).

## Implemented scope

**Open Journal**, **Journal for workspace** and **Journal for plane** open a normal
Plurid plane. The latter two prefill its context. Multiple Journal planes share
the desktop store while keeping independent filters and reading cursors.
Journal commands are human-only, including through command aliases; there is no
agent Journal query or renderer append API.

The plane provides source, severity, workspace, plane and absolute time filters,
search by safe summary/IDs, presets, up to 20 named filters per plane, and trace
filtering from an event inspector. Its virtualized table pages through stable
snapshots, 200 events at a time. Selecting or scrolling older activity pauses
following; new matches increment a visible count without replacing those rows.
Resume explicitly returns to the latest results. Invalid ranges and failed or
superseded queries retain useful earlier results. Keyboard arrows/Home/End select
events. Details wrap IDs, expose a copy action and link to an existing source;
another workspace opens or focuses its independent window. Closed sources remain
honest placeholders. Restoration restores filters, never recorded operations.

The first event producers are:

| Source          | Recorded lifecycle                                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| File operations | Queued jobs, collision decisions, completion, cancellation and failure; completed item count. Background jobs may have no workspace origin.          |
| Git actions     | Start through terminal exit/error; process exit code, explicit plane-close cancellation. Commit messages, arguments and terminal bytes are excluded. |
| Chat            | Model-request start and final outcome, including stop/failure. Request text, transcripts, tool excerpts and provider error bodies are excluded.      |
| Workspace       | Save start and result, attributed to the workspace in that save request.                                                                             |
| Local server    | Explicit start, stop, restart and close; per-request logs stay with the server plane.                                                                |

Each event has a UUID, sequence, desktop producer, process-session UUID, timestamp,
monotonic duration where applicable, safe source/action/phase and a correlation ID.
Origins are copied when work starts; services with a validated target refine that
origin. Completion callbacks do not consult the focused window. Expected explicit
cancellation is informational. These are observations, not security attestations
or a new source of mutation/consent authority.

### Storage and privacy

`domain/journal/events.ts` owns the closed event vocabulary and bounded query
schema. `desktop/journal/store.ts` owns a private append-only
`<application-data>/journal/events.jsonl`; `activity.ts` projects service events;
`handlers.ts` owns human queries, export tickets and exact-file clear review.
`renderer/journal/session.ts` owns one reader's stable cursor and stale-response
protection. Presentation is split between the plane, virtual table, inspector and
export dialog.

The store is capped at **8 MiB or 10,000 events**, with a 256-event ingestion queue
and query pages capped at 500. File identity, regular-file type, single-link count
and private permissions are checked. A replaced/symlinked store or damaged tail
stops appends while preserving the file and earlier valid rows. Full stores stop
ingestion. A visible session counter reports rejected/dropped events. There is no
automatic pruning, rotation, replacement or cleanup. The sink cannot fail the
observed action. Mutation recovery and consent records retain their own stronger
persistence requirements; Journal is a bounded support history, not a crash-proof
transaction receipt or tamper-proof audit.

Events have **no free-form message/detail field**. The schema has no place for
paths, filenames, prompt text, credentials, argv, environment, transcripts or raw
errors. Workspace/plane names are resolved for the human interface from currently
known workspace state; they are not stored in event rows. Internal IDs are still
private local data. No telemetry upload is introduced.

**Export…** previews the exact JSON for up to the newest 2,000 matching events in
the visible snapshot. An owner-bound, ten-minute ticket binds that preview to a
native Save dialog. Saving creates a new private file exclusively; an existing
file or link is preserved. The preview explains included IDs and any truncation.
**Clear Journal filters** changes only the view. **Move history to Trash…** names
the exact private event file in native review, reuses identity-checked OS Trash,
and creates an empty store only after that succeeds. Cancellation preserves all
history. No alias, saved grant or agent command can bypass that review. Positive
native history removal remains an operator acceptance gate; automated checks
exercise denial and preservation without removing any fixture.

### Deliberate next slices

The design below remains a broader target. Command dispatch/child spans, provider
safe-error classifications, app build identities, window/watcher/agent audits,
running-work aggregation and attention badges are not yet Journal producers.
Storage is deliberately a capped append store rather than a second database;
larger retention/indexing needs measured volume and a separately reviewed policy.
Saved filters currently belong to their Journal plane; sharing/management can grow
when those workflows are needed. Portable project exports omit this private
history view. Browser fixtures can inspect events and preview exports; native
saving and history removal belong to desktop acceptance.

The original design follows as context for those extensions. Implemented behavior
and limits above take precedence over proposed future capabilities below.

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
