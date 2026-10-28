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
