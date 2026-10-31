# Make repeated work a command

Use this guide when you do the same thing twice: save a shell line as an action, type commands, open
Viewer from your terminal, prepare reviews automatically, and, if you want them, add a model or
connect an agent. Saved actions, typed commands, the CLI and workflows need no model or agent.

**Find it:** **Settings → Actions** · **⌘K** → **Command line…** (or type `:`) and **Ask in words…**
(or type `>`) · type `!` for a shell command · **File → Workflows…** · **Settings → Models** and
**Settings → Agents**

## Run a quick shell command

1. Press **⌘K**, type `!`, then enter a command such as `pwd` or `git status`.
2. Check the folder shown above the command. It is captured when you open the panel: the active
   folder or column, the terminal's starting folder, a preview's parent, or Home in an empty
   workspace.
3. Press **Return** to run. **Shift+Return** adds a line. Output appears in the panel with its
   status and exit code; **Stop**, **Copy output** and **Open receipt** act on that run.

Closing the panel keeps the command running. Open `!` again to return to its output. Use a terminal
plane for programs that ask for input. [Terminals and command output](../reference/terminals.md)
lists the limits and receipts.

## Save a shell line as an action

1. Press **⌘K** → **Run command…** in the folder you work in, type the line and choose **Run**.
2. When it does what you want, open **Run command…** again, pick the line under **Recent** and
   choose **Save as action…**. Type a **Name**, then choose **Review in Settings**.
3. **Settings → Actions** shows the draft under **Custom commands**. Choose **Add command**.
4. Open the new command to change it: **Available for** and **File extensions** say when it applies,
   and **Add parameter** asks for a part that changes between runs, such as a test name.

The action now appears in **⌘K** and the file menu whenever it applies. Its first run asks you to
confirm it. To chain steps, set **Execution** to **Command sequence (macro)**: a _Test_ step
followed by a _Build_ step runs in order and stops at the first failure. Choose **Executable** with
literal **Arguments** when a step needs no shell features; it is safer with unusual filenames.

## Type commands

Type `:` in the command palette, or choose **Command line…** in **⌘K**, to switch to the command
line. Try:

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
   replaces another file there. **Settings → Navigation → Install shell command** does the same.
2. In a terminal, run `viewer .` to open the current folder.
3. If your shell cannot find `viewer`, add `~/.local/bin` to your `PATH`.

To search and script from the terminal, keep Viewer open and
[create an agent client](#connect-an-agent) with only the folders it needs. Put its token in
`VIEWER_AGENT_TOKEN`:

```sh
viewer workspace list
viewer search 'invoice' --root ./Documents
viewer git status .
```

Anything that changes files opens a review in Viewer first. [The terminal CLI](../reference/cli.md)
lists every command.

## Prepare reviews automatically

A [workflow](../reference/terms.md#commands-and-automation) chains inspection, comparison and
proposed changes; open one with **File → Workflows…**. A watch rule starts one when new files arrive
in a folder, for example to propose names for new scans. Applying the changes always waits for your
review. [Workflows and watch rules](../reference/automation.md) shows how to write them.

## Add a model

A model is optional. It can answer requests in words, explore a folder, suggest names and actions,
and identify an unknown file.

1. Open **Settings → Models** and choose **Add model**. Pick the provider, or **Local endpoint** for
   a model on your Mac or network, then choose **Set up model**.
2. Enter the **API key** and the **Model** ID, or choose **Connect and load models** to pick from
   the provider's list.
3. Open **Data access**, choose what the model may read, and choose **Allow selected data**. Confirm
   with **Allow** in the system dialog. [What a model may read](#what-a-model-may-read) explains the
   choices.

The first model you add is the **Default for Ask Viewer**: it answers requests in words. To use
another, choose **Use for Ask Viewer** beside it.

To ask in words, press **⌘K** and type `>`, or choose **Ask in words…**, then describe what you
want, such as _show PDFs changed this week_. The model answers with a command line and what it does.
Nothing runs yet: press **Return** to run the line as if you typed it, or **Tab** to edit it first.
**Continue in Chat** carries the request into a Chat plane.

### What a model may read

Each model has one [data level](../reference/terms.md#models-and-agents). Each level includes the
one before it. Until you allow one, no file data is sent.

| Level     | Label in **Data access**                                                                | Used by                                                                  |
| --------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Names     | **filenames and file metadata**                                                         | Ask Viewer, model suggestions, Explore this folder                       |
| Excerpts  | **filenames, metadata and document excerpts**                                           | Explore reading inside files, identifying a file, renaming from contents |
| Full text | **filenames, metadata and extracted document text**                                     | **Summarize…**                                                           |
| Pictures  | **filenames, metadata, document text and pictures (photos and rendered drawing pages)** | **Check laser job…**                                                     |

Viewer asks for a level when a feature needs one you have not allowed. **Revoke access** withdraws
it. Changing the model's endpoint or clearing its key revokes access too, and stops its running
requests.

Actions an agent starts never use your approval on their own. To let them send the same data, turn
on **Allow agent-started actions to send the same data** under **Data access**; Viewer confirms in a
system dialog.

## Connect an agent

A coding agent on your Mac can connect to Viewer, look around the folders you allow and propose
changes for your review.

1. In **Settings → Agents**, turn on **Allow local agent clients** and confirm in the system dialog.
2. Under **Agent clients**, type a **Name** for the client and choose **Choose folder…** for each
   folder it may use.
3. Turn on only what it needs: **Metadata and discovery**, **Read file contents**, **Navigate
   without review**, **Propose changes** or **Read terminal output**.
4. Choose **Create client** and copy the configuration it shows into your agent.

An agent can never run shell commands or type into a terminal. Every change it proposes waits for
your review, and an item it removes goes to the Trash only after you approve it. **Permissions**
changes a client later, **Stop tasks** stops its work and **Revoke** disconnects it; **Remove** then
clears a revoked client from the list. Read [agents and permissions](../reference/agents.md) before
connecting one, and use [Journal](../reference/journal.md) to see what it did.

Folder access, agent access and model data access are
[three separate approvals](../reference/terms.md#three-separate-permissions); none of them grants
another.
