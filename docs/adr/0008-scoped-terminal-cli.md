# 0008: Reuse scoped agent authority for terminal automation

Accepted.

The external `viewer` command supports both ordinary file launching and headless service requests.
Automation must not gain unrestricted file, shell or model access merely because it originated in a
terminal.

Headless commands use the existing MCP transport and an explicitly supplied client token. The
running desktop process owns service execution, canonical folder checks, capability grants, read
budgets, review and cancellation. Help, version and completion are offline. Existing path launches
retain their single-instance behavior; explicit command words reserve their first argument, with
`--` available for literal paths.

One domain catalog owns command arguments, help and completion. The terminal adapter resolves
ordinary paths, validates bounded input, emits stable JSON/exit results and polls known IDs. It does
not implement file operations, Git writes, workflow execution or approvals independently. Service
adapters bind the existing feature owners to a client, including authorization after asynchronous
reads and before new work is admitted. Workflow receipts remain client-owned; stops retain evidence
and never delete completed output.

AI command requests retain the agent actor and provider data consent. Managed speech setup accepts
only typed catalog operations, pinned weights and verified local imports. It never accepts runtime
executables, package-manager scripts or arbitrary download addresses. Recognition availability is
separate from installing weights. Download cancellation and interruption retain unverified files;
cleanup requires its own exact-scope Trash review.

There is no CLI auto-approval switch or alternate shell route. File removals keep the desktop
service's fresh exact-scope approval and OS Trash policy. The CLI reports a pending review as a
pending review, rather than claiming the requested work completed.

Parameterized task creation uses a typed proposal and a private Git catalog lease. The desktop binds
the workspace window, source identity, commit, branch and destination. It reuses worktree
validation, creates the note privately, and sends a typed bundle to the workspace controller. The
controller waits for the overview and linked tools to mount, then persists the task before
acknowledging it. Completion is distinct from opening a form; partial results identify retained
output without claiming a successful task. Existing drafts flush before dispatch. The handoff
initializes only its newly created blank note; it does not open a private-note read route for the
requesting client or overwrite a person's edits.

Agent checkout materializes bounded raw blobs through one backpressured Git process, with hooks,
filters, lazy fetch and network transports disabled. Repositories with executable filters use the
human dialog because automatic folder status may invoke clean filters. Shells and Git review views
start on a person's explicit action. Cancellation never removes a checkout or branch.

The person's `task-new` form reuses the task engine with ordinary file access rather than client
grants. Its desktop-only owner binding fixes the originating window and workspace before
asynchronous preparation. Native confirmation and a second lease/permission check precede writes.
Ask Viewer, including reviewed speech, fills this form through typed parameters; it cannot answer
the native confirmation. Cancellation restores the form and partial failure identifies retained
output instead of retrying or removing it. Owner closure, renderer navigation and access revocation
cancel pending person requests as well as running task work.
