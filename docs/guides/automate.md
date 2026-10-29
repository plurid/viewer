# Make repeated work a command

When you do the same thing twice, make it a command. None of this needs a model or an agent.

## Save a shell line as an action

1. Press **⌘K** → **Run command…** in the folder you work in, type the line and run it.
2. When it does what you want, choose **Save as action…**.
3. In **Settings → Actions**, give it a name, choose when it applies, and add parameters for the
   parts that change between runs, such as a test name.

The action now appears in **⌘K** whenever it applies. To chain steps, make a sequence: a _Test_ step
followed by a _Build_ step runs in order and stops at the first failure. Use literal arguments when
a step needs no shell features; it is safer with unusual filenames.

## Type commands

Type `:` in the command palette to switch to the command line. Try:

| Line         | What it does                     |
| ------------ | -------------------------------- |
| `:help`      | Lists every verb                 |
| `:set grid!` | Turns the space's grid on or off |
| `:vs`        | Opens a tile to the right        |
| `:pwd`       | Shows the current plane's folder |

Completion shows what each verb takes. A misspelled verb gets a suggestion; nothing runs until you
correct it. Aliases, key bindings, modes and macros are in
[the command language](../reference/command-line.md).

## Open Viewer from your terminal

1. Press **⌘K** → **Install Viewer CLI**. It installs `viewer` at `~/.local/bin/viewer` and never
   replaces another file there.
2. In a terminal, run `viewer .` to open the current folder.
3. If your shell cannot find `viewer`, add `~/.local/bin` to your `PATH`.

To search and script from the terminal, keep Viewer open, create a client in **Settings → Agents**
with only the folders it needs, and put its token in `VIEWER_AGENT_TOKEN`:

```sh
viewer workspace list
viewer search 'invoice' --root ./Documents
viewer git status .
```

Anything that changes files opens a review in Viewer first. [The terminal CLI](../reference/cli.md)
lists every command.

## Prepare reviews automatically

A workflow chains inspection, comparison and proposed changes. A watch rule starts one when new
files arrive in a folder, for example to propose names for new scans. Applying the changes always
waits for your review. [Workflows and watch rules](../reference/automation.md) shows how to write
them.

## Add a model

1. Open **Settings → Models**, choose **Add model**, then **Set up model**.
2. Enter the API key and model ID, or choose **Connect and load models** to pick from the provider's
   list.
3. Open **Data access** and choose what the model may read: names only, excerpts, or full text.

The model you mark **Use for Ask Viewer** answers requests in words. Every answer comes back as a
proposal that you review; nothing runs on its own. Start with a small selection.

## Connect an agent

A local agent gets its own identity, folders and permissions in **Settings → Agents**. It can look
around, read what you allow and propose changes for review. It can never run shell commands or type
into a terminal. Read [agents and permissions](../reference/agents.md) before connecting one, and
use [Journal](../reference/journal.md) to see what it did.
