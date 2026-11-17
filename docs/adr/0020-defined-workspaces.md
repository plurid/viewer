# Defined workspaces and explicit command starts

Status: accepted.

## Context

Saved workspace state describes open views. A named definition describes how to open a workspace
from `workspaces.jsonc` or a local VS Code Project Manager source. Treating the catalog as open
state would expose hundreds of unopened entries and give automation a new execution path.

## Decision

The desktop owns the validated catalog, path resolution and source access. It decides opens using
window ownership and reservations. The renderer searches definitions and builds only the workspace
the desktop returned. Invalid overrides retain diagnostics and fall back to a plain imported stub.
Synthetic fallback planes never carry commands or match a command reference.

Open workspaces stay in saved state. Closing a defined workspace stores its remembered views,
arrangement and focus in the separate private `defined-workspaces-v1.json` memory file. The catalog
remains editable configuration; memory and native execution approvals cannot be imported as
authority from that configuration.

Nothing a definition names runs automatically. Every open, reopen, reset, launch restore and reload
shows a Start panel per command plane. Run and Run all are direct choices by the person; Shell only
starts a plain shell. Existing running planes attach without replaying input. CLI workspace launch
uses the same opening flow from every shell.

One shared execution-confirmation service owns window-local native queues and private approvals.
Approval fingerprints include the definition key, canonical real folder, exact executable,
arguments, environment and command. Native dialogs disclose these values, list only unapproved
commands and use bounded pages without truncating commands. A decline stores no approval. Window
closure declines pending work, including a late affirmative answer.

A Run request carries only a definition key, plane index and catalog basis. The desktop checks the
window's persisted workspace and pane association against the current catalog. It refuses a stale
basis before using an old approval for newly displayed text. Profile and canonical-folder snapshots
stay bound to approval and are checked again at spawn. Run all remains bound to one window and
reports each plane independently.

Agents see only open workspaces with definition metadata removed. MCP, the token CLI, model and
spoken plans, custom actions and macros cannot open definitions or start their commands. Desktop
checks refuse agent-driven windows before and after asynchronous approval and immediately before
spawn. Agent navigation and task opening defer terminal startup.

## Consequences and limits

Command text remains desktop-owned. The worker types one line once, holds ordinary typeahead and
passes only matching requested terminal reports. Unsolicited report shapes and all DECRQSS replies
are dropped. zsh and fish must announce the line editor through bracketed paste mode; an unanswered
query or absent readiness at the deadline cancels input and displays the literal command for manual
use. Offscreen xterms remain attached during startup.

A shell cannot distinguish Viewer typing from a person typing. Other shells still use output and
quiet time, so an rc startup question can consume the command as its answer. Profile startup files
run with the person's authority; neither the working folder nor this review is a shell sandbox.

See [workspace instructions](../guides/workspaces.md#open-a-defined-workspace),
[terminal reference](../reference/terminals.md#commands-a-workspace-starts) and
[testing](../development/testing.md#command-startup-with-real-zsh).
