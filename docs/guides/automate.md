# Make repeated work a command

Start by using **⌘K** to find an existing action. You can organize and compose commands without
adopting a model or connecting an agent.

## Save a useful action

**Run command…** captures the current folder and shows the shell line before it runs. **Save as
action** transfers a draft to Settings for review.

In **Settings → Actions**, give an action a clear name, choose its executor and set when it applies.
Group actions into palette folders, pin common ones and add parameters for information that changes
between runs.

For example, a Test action can accept a test name as an input. A Test → Build sequence runs the
steps in order and stops after a failed step. Literal arguments and shell scripts are different
choices; use literal arguments when shell syntax is unnecessary.

## Learn the command language gradually

Type `:` in the palette. Try `:help`, then `:set grid!` to toggle the grid. Completion explains
available verbs. Typo suggestions help you correct a line; they do not execute it.

You can later add aliases, key sequences and macros. See the
[command language](../reference/command-line.md) rather than learning every form before using the
application.

## Open Viewer from your terminal

In a direct build, press **⌘K** and choose **Install Viewer CLI**, or open **Settings → Navigation →
Install shell command**. Both install the `viewer` launcher at `~/.local/bin/viewer` without
replacing another command at that path. A message confirms when the launcher is ready or explains
the problem.

Run `viewer .` to open the current folder. If your shell cannot find it, run `~/.local/bin/viewer .`
and add `~/.local/bin` to your shell's `PATH` when convenient. Viewer does not edit your shell
startup files.

See [terminal launch options](../reference/command-line.md#launch-from-a-terminal) for new windows,
existing workspaces and terminal planes. The launcher is separate from the `:` command language
inside Viewer.

## Compose a file workflow

Workflows describe a sequence of inspection, comparison and proposed changes. Watch rules can
prepare a review when new files arrive. Applying a file-change proposal remains a separate review
step.

[Workflow reference](../reference/automation.md) covers definitions, bindings and what runs
automatically.

## Add a model when it helps

Open **Settings → Models → Add model**, choose the provider and select **Set up model**. Enter its
API key and model ID; **Connect and load models** lists IDs offered by compatible providers. Local
servers can use **Provider address** to change the endpoint. The list shows each saved model's full
name and ID, whether its connection has been checked, and which is the **Default for Ask Viewer**.
Use that selector, or **Use for Ask Viewer**, to change the default.

Open **Data access** for the model's current sharing permission. Allowing agent-started actions to
send the same data is a separate choice. Model-assisted naming, organization, summaries and requests
in words use these explicit permissions. Previewing files and using built-in tools do not require a
model.

Start with a small selection, inspect the evidence and review the proposed changes. A structured
answer is still a proposal.

## Connect an agent

Local agents have their own consent, identity and folder grants. Configuration cannot turn those
grants on. Agents can navigate, inspect authorized data and submit supported reviewed proposals.
Terminal read access is separate from input; opaque agent shell execution remains unavailable.

See [agents and permissions](../reference/agents.md) before connecting a client. Use
[Journal](../reference/journal.md) to inspect activity and command receipts to inspect an actual
process result.
