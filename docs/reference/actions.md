# Custom actions and sequences

This page describes custom commands and recipes in **Settings → Actions**: their kinds, fields,
placeholders, limits and first-run confirmations.

## Custom commands

**Settings → Actions → Custom commands** lists them; **New command** adds one. Each appears in ⌘K
under **Actions** and in the file menu where its conditions match. Viewer keeps up to 200.

| Field               | Values                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| **Name**            | 1 to 100 characters                                                                            |
| **Search aliases**  | Up to 30, each up to 100 characters                                                            |
| **Shortcut**        | ⌘ or ⌃ plus a key, with optional ⌥ and ⇧; it may not clash with another shortcut or the prefix |
| **Pin in Commands** | Lists the command when ⌘K opens empty, and under **Pinned** in the file menu                   |
| **Order**           | Sorts custom commands                                                                          |
| **Icon**            | **Command**, **Terminal**, **Rename**, **Folder**, **External**, **Code** or **Copy**          |
| **Palette folder**  | Up to 4 nested folders under **Actions**, separated with `/`, each up to 60 characters         |
| **Available for**   | **Files and folders**, **Files**, **Folders** or **Folder background** (nothing selected)      |
| **File extensions** | Up to 100; every selected file must have one. Empty allows any format                          |
| **Selection count** | Minimum and maximum, 0 to 10,000                                                               |
| **Only in folders** | Up to 30 absolute folders; the command shows only in them and below                            |
| **Parameters**      | See [parameters](#parameters)                                                                  |
| **Execution**       | The kind, below                                                                                |

Conditions are checked against the target captured when you choose the command, not a later
selection. A command sequence without **Only in folders** is available everywhere, not only in
folders.

| Execution                    | `executor.kind` | Runs                                                                   |
| ---------------------------- | --------------- | ---------------------------------------------------------------------- |
| **Built-in command**         | `builtin`       | One command ID; not another custom command                             |
| **Command sequence (macro)** | `sequence`      | 1 to 50 command lines in order                                         |
| **Workflow**                 | `workflow`      | 1 to 20 steps: built-in command lines and executable or shell commands |
| **Action recipe**            | `recipe`        | Opens **Run action** with the recipe chosen                            |
| **Terminal plane**           | `terminal`      | Opens a terminal plane with a shell profile                            |
| **Executable**               | `executable`    | A program with literal arguments                                       |
| **Shell script**             | `shell`         | A script run by the shell you name, up to 16,000 characters            |

## Executables and shell scripts

| Executable argument | Becomes                                                     |
| ------------------- | ----------------------------------------------------------- |
| `{directory}`       | The captured folder                                         |
| `{path}`            | The one selected item's path                                |
| `{name}`            | Its name                                                    |
| `{extension}`       | Its extension                                               |
| `{paths}`           | Every selected path, each its own argument; standalone only |
| `{input:name}`      | A parameter's value                                         |

Each placeholder becomes part of one literal argument; nothing is passed through a shell. `{path}`,
`{name}` and `{extension}` need exactly one selected item, or **Run once per selected item**.

A shell script runs as `<shell> -c <script> viewer-action <directory> <paths…>`: `$1` is the folder
and `$2` onward are the selected paths. Both kinds also receive each parameter as an environment
variable, `VIEWER_INPUT_` plus its name in capitals (`VIEWER_INPUT_QUALITY`); a script never has
values spliced into its text.

| Behavior                              | Value                                                  |
| ------------------------------------- | ------------------------------------------------------ |
| Working folder                        | The captured folder; it does not confine the program   |
| Program arguments                     | Up to 100, each up to 32,768 characters                |
| Output kept                           | The last 256 KB, marked when truncated                 |
| Exit status other than 0, or a signal | Fails with `Command exited with status N.`             |
| **Cancel**                            | SIGTERM to the process group, then SIGKILL after 1.5 s |
| Running or starting at once           | 20                                                     |
| Runs kept in the list                 | 100, finished ones dropped first                       |

Before launch Viewer checks that the folder and every selected item are still the ones captured:
`Selection changed: name. Review the action again.` or
`The command folder changed before launch. Choose the command again.`

## Parameters

**Add parameter** adds an input that is asked for each time the command runs. A command has at
most 20.

| Field        | Values                                                              |
| ------------ | ------------------------------------------------------------------- |
| **Name**     | A lowercase letter, then up to 31 lowercase letters, digits or `_`  |
| **Label**    | 1 to 100 characters                                                 |
| **Type**     | **Text**, **Number**, **Choice** (1 to 100 choices) or **Checkbox** |
| **Default**  | Up to 4,000 characters                                              |
| **Required** | An empty value is refused                                           |

A checkbox value is `true` or `false`. A workflow collects its own parameters and those of its
executable and shell steps once; two different definitions of one name are refused.

## Command sequences

A sequence runs its lines one after another, as the [command language](command-line.md) reads them,
and stops at the first that fails: `“Name” stopped at “line”: reason`. A line can be a command ID or
a full line such as `vs ~/Documents | set grid!`. A sequence cannot run a custom command or a named
command, so none runs itself.

Give a sequence a command name (a capital, then up to 30 letters and digits) and it also runs as
`:Name` on the command line, with its words as `$1` to `$9` and `$*`. Two sequences cannot share a
name. **Record macro** saves the commands you run as a new sequence.

## Workflow commands

A workflow command runs its steps in order. A command step is a built-in command line; it may not
name a custom or named command. An action step runs an executable or shell command. The workflow
stops with `Name stopped at step N: reason` when a step fails, a process exits with an error, or the
workspace or originating plane changes. Dialogs a step opens still wait for you.

For inspection, comparison and reviewed file changes with explicit dependencies, use a
[workflow file](automation.md).

## Run command drafts

In **Run command…**, **Save as action…** then **Review in Settings** shows the draft at the top of
**Custom commands**. **Add command** adds it as a shell command; **Dismiss** drops it. Nothing runs
until you choose the command, and its first run asks as below.

## First-run confirmation

The first time an executable or shell command runs, Viewer asks in a native dialog, **Run “Name” for
the first time?**, showing the exact program, arguments or script. The approval belongs to the exact
executor: changing the program, arguments, script or **Run once per selected item** asks again;
renaming the command does not. Terminal profiles, a tmux program and a terminal application chosen
by path ask the same way. The built-in login shell profile and the default tmux need no approval.

Approvals are kept privately, outside `config.jsonc`, up to the latest 1,000. An edited or imported
configuration cannot approve itself. Importing a configuration that changes agent access, model
providers, program or shell commands, terminal profiles, or keys and sequences that type into
terminals, move to the Trash, rename or discard text asks before it applies.

## Recipes

**Settings → Actions → Recipes** holds recipes; **New recipe**, **Duplicate recipe**, **Export
recipes** and **Import recipes** manage them. Viewer keeps up to 100.

| Built-in recipe              | Kind           | Default data              | Template                                                                                                          |
| ---------------------------- | -------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Batch rename**             | `batch-rename` | **Filenames only**        | `{name}{extension}`; fields `name`, `extension`, `number`                                                         |
| **Rename as book**           | `book-name`    | **Metadata and excerpts** | `{year}, {authors}, {title}, {publisher}{extension}`; fields `year`, `authors`, `title`, `publisher`, `extension` |
| **Rename with instructions** | `rename`       | **Metadata and excerpts** |                                                                                                                   |
| **Organize files**           | `organize`     | **Filenames only**        |                                                                                                                   |
| **Summarize**                | `summarize`    | **Extracted text**        |                                                                                                                   |

| Recipe field           | Values                                                              |
| ---------------------- | ------------------------------------------------------------------- |
| **Name**               | 1 to 100 characters                                                 |
| **Formats**            | Up to 100 extensions; empty allows any                              |
| **Include subfolders** | Reads selected folders recursively                                  |
| **Filename template**  | Up to 1,000 characters; unknown fields are refused                  |
| **Instructions**       | Up to 12,000 characters                                             |
| **Model provider**     | A model, or **Local metadata / no model**                           |
| **Permitted data**     | **Filenames only**, **Metadata and excerpts** or **Extracted text** |
| **Shortcut**           | As for custom commands                                              |

**Rename as book** always reads local publication metadata and text, whatever it sends to a model.
In **Run action**, **Batch rename** runs without a model and offers **Filename template**,
**Prefix**, **Suffix**, **Find text**, **Replace with**, **Letter case** (**Keep**, **lowercase**,
**UPPERCASE**, **Title Case**), **Number padding**, **Start numbering at**, **Find with regular
expression**, **Ignore case** and **Read document metadata for template fields**.

## Review and Apply

A recipe prepares a proposal; nothing changes until you choose **Apply N changes**. Each row shows
its source, the proposed result and the evidence used. Untick a row to leave it out.

| Row marked and left unticked                | Message                                           |
| ------------------------------------------- | ------------------------------------------------- |
| A name that is not valid, or over 255 bytes | `The filename is too long.` or the name problem   |
| Two rows with one destination               | `Two files have the same destination.`            |
| A destination that exists                   | `The destination already exists. Edit the name.`  |
| An unchanged name                           | `The filename is unchanged.`                      |
| A changed extension                         | `Keep the original extension.`                    |
| A destination outside the action's scope    | `The destination is outside this action’s scope.` |

Edit a marked row's name to include it. A proposal that fails while it is prepared, for example when
a model names a file twice or leaves one out, shows only its error. Apply checks each source again;
an Apply that stops before moving anything fails, and one that stops after moving some files is
partial and offers **Review recovery**. **Undo changes** reverses an applied proposal while its
results are unchanged. **Keep a content checkpoint** keeps a copy of the affected files' contents
and mode before Apply, without Finder tags or ACLs, within `settings.checkpoints.budgetBytes` (5 GB
by default).

A model's answer never changes a file by itself. A model-backed recipe sends only its **Permitted
data**, and only with that provider's data permission.

## Agents

Agents can propose built-in commands and command sequences for your review. They cannot run
executable, shell, terminal-profile or workflow commands, because a program can bypass Trash-only
removal. See [what an agent cannot do](agents.md#what-an-agent-cannot-do).

**Related:** [Make repeated work a command](../guides/automate.md) ·
[Command language](command-line.md) · [Workflows and watch rules](automation.md) ·
[Terminals](terminals.md) · [Configuration](configuration.md) · [Terms](terms.md)
