# Custom actions and sequences

This page describes custom commands and recipes in **Settings → Actions**: their kinds, fields,
placeholders, limits and first-run confirmations.

## Custom commands

**Settings → Actions → Custom commands** lists them; **New Command** adds one. Each appears in ⌘K
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

| Execution                    | `executor.kind` | Runs                                                                      |
| ---------------------------- | --------------- | ------------------------------------------------------------------------- |
| **Built-in command**         | `builtin`       | One command ID; not another custom command                                |
| **Command sequence (macro)** | `sequence`      | 1 to 50 command lines in order                                            |
| **Workflow**                 | `workflow`      | 1 to 20 steps using built-in lines and saved executable or shell commands |
| **Action recipe**            | `recipe`        | Opens **Run Action** with the recipe chosen                               |
| **Terminal plane**           | `terminal`      | Opens a terminal plane with a shell profile                               |
| **Executable**               | `executable`    | A program with literal arguments                                          |
| **Shell script**             | `shell`         | A script run by the shell you name, up to 16,000 characters               |

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

| Behavior                              | Value                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| Working folder                        | The captured folder; it does not confine the program                             |
| Program arguments                     | Up to 100, each up to 32,768 characters                                          |
| Output kept                           | The last 256 KiB, marked when truncated                                          |
| Exit status other than 0, or a signal | Fails with `Command exited with status N.` or `Command exited with signal NAME.` |
| **Cancel**                            | SIGTERM to the process group, then SIGKILL after 1.5 s                           |
| Running or starting at once           | 20                                                                               |
| Runs kept in the list                 | 100, finished ones dropped first                                                 |

Before launch Viewer checks that the folder and every selected item are still the ones captured:
`Selection changed: name. Review the action again.` or
`The command folder changed before launch. Choose the command again.`

## Parameters

**Add Parameter** adds an input that is asked for each time the command runs. A command has at
most 20.

| Field        | Values                                                              |
| ------------ | ------------------------------------------------------------------- |
| **Name**     | A lowercase letter, then up to 31 lowercase letters, digits or `_`  |
| **Label**    | 1 to 100 characters                                                 |
| **Type**     | **Text**, **Number**, **Choice** (1 to 100 choices) or **Checkbox** |
| **Default**  | Up to 4,000 characters                                              |
| **Required** | An empty value is refused                                           |

A checkbox value is `true` or `false`. Executable, shell and workflow commands take parameters. A
workflow asks for its own parameters and those of its program steps once. Fields with the same name
must have identical definitions. Each program receives its own fields.

## Command sequences

A sequence runs its lines one after another, as the [command language](command-line.md) reads them,
and stops at the first that fails: `“Name” stopped at “line”: reason`. A line can be a command ID or
a full line such as `vs ~/Documents | set grid!`. A sequence cannot run a custom command or a named
command, so none runs itself.

Give a sequence a command name (a capital, then up to 30 letters and digits) and it also runs as
`:Name` on the command line, with its words as `$1` to `$9` and `$*`. Two sequences cannot share a
name. **Record Macro** saves the commands you run as a new sequence.

## Workflow commands

Choose **Add Command Step** to run a saved executable or shell command, or **Add Built-In Step** to
enter a built-in command line. Only the person can start a workflow command. A built-in line cannot
call a named command, another custom action or a command reserved for a direct choice.

Program steps run in the folder and selection where the workflow started. Each uses its own desktop
first-run confirmation, including after its program, arguments or script change. The next step waits
for completion. Before each launch, Viewer checks the child against the definition selected when the
workflow started. A change stops the workflow at that step, even if the replacement has its own
approval. A failed step also stops the workflow and reports its position. Changing the originating
workspace or removing its plane stops the workflow. Dialogs still wait for you.

For inspection, comparison and reviewed file changes with explicit dependencies, use a
[workflow file](automation.md).

## Run command drafts

In **Run Command…**, **Save as Action…** then **Review in Settings** shows the draft at the top of
**Custom commands**. **Add Command** adds it as a shell command; **Dismiss** drops it. Nothing runs
until you choose the command, and its first run asks as below.

## First-run confirmation

The first time an executable or shell command runs, Viewer asks in a native dialog, **Run “Name” for
the first time?**, showing the exact program, arguments or script. Scripts, arguments or terminal
settings longer than 6,000 characters page across native dialogs without cutting text, and every
page must be confirmed. The approval belongs to the exact executor: changing the program, arguments,
script or **Run once per selected item** asks again; renaming the command does not. Terminal
profiles, a tmux program and a terminal application chosen by path ask the same way. The built-in
login shell profile and the default tmux need no approval.

Approvals are kept privately, outside `config.jsonc`, up to the latest 1,000. An edited or imported
configuration cannot approve itself. Importing a configuration that changes agent access, model
providers, program or shell commands, terminal profiles, or keys and sequences that type into
terminals, move to the Trash, rename or discard text asks before it applies.

## Recipes

**Settings → Actions → Recipes** holds recipes; **New Recipe**, **Duplicate Recipe**, **Export
Recipes** and **Import Recipes** manage them. **Remove Recipe** removes one of your own once no
custom command uses it; the five built-in recipes stay. Viewer keeps up to 100. Import skips
identical recipes. A different recipe with the same ID is added as a copy. Its shortcut is kept when
it is free.

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
| **Action type**        | One of the five built-in kinds; choosing one resets the template    |
| **Formats**            | Up to 100 extensions; empty allows any                              |
| **Include subfolders** | Reads selected folders recursively                                  |
| **Filename template**  | Up to 1,000 characters; unknown fields are refused                  |
| **Instructions**       | Up to 12,000 characters                                             |
| **Model provider**     | A model, or **Local metadata / no model**                           |
| **Permitted data**     | **Filenames only**, **Metadata and excerpts** or **Extracted text** |
| **Shortcut**           | As for custom commands                                              |

**Rename as book** always reads local publication metadata and text, whatever it sends to a model.
In **Run Action**, **Batch rename** runs without a model and offers **Filename template**,
**Prefix**, **Suffix**, **Find text**, **Replace with**, **Letter case** (**Keep**, **lowercase**,
**UPPERCASE**, **Title Case**), **Number padding**, **Start numbering at**, **Find with regular
expression**, **Ignore case** and **Read document metadata for template fields**.

## Review and Apply

A recipe prepares a proposal; nothing changes until you choose **Apply N Changes**. Review dialogs
open with keyboard focus on **Discard** (or **Cancel** in operation reviews), so pressing Return or
Space by mistake never approves changes. **Discard** cancels the plan. Each row shows its source,
the proposed result and the evidence used. Untick a row to leave it out.

| Row marked and left unticked                  | Message                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| A name that is not valid, or over 255 bytes   | `The filename is too long.` or the name problem                                      |
| Two rows with one destination                 | `Two files have the same destination.`                                               |
| A destination that exists                     | `The destination already exists. Edit the name.`                                     |
| An unchanged name                             | `The filename is unchanged.`                                                         |
| A changed extension                           | `Keep the original extension.`                                                       |
| A destination outside the action's scope      | `The destination is outside this action’s scope.`                                    |
| A model's name that holds a folder            | `Rename must contain only a filename.`                                               |
| A book name whose quotes are not in the file  | `Unresolved publication evidence. Review and edit the name.`                         |
| A book named without a model, a field missing | `Missing authors, publisher. Edit the name or configure a model.`, naming the fields |

Edit a marked row's name to include it. A proposal that fails while it is prepared, for example when
a model names a file twice or leaves one out, shows only its error. Apply checks each source again;
an Apply that stops before moving anything fails, and one that stops after moving some files is
partial and offers **Review Recovery** (completing the restore plan resolves the original partial or
recovery plan). **Undo Changes** reverses an applied proposal while its results are unchanged.
**Keep a copy of the originals** saves the affected files' contents and mode before Apply, without
Finder tags or ACLs, within `settings.checkpoints.budgetBytes` (5 GB by default).

A model's answer never changes a file by itself. A model-backed recipe sends only its **Permitted
data**, and only with that provider's data permission.

| Recipe limit               | Value                                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files in one task          | 2,000: `Choose at most 2,000 files per action.`                                                                                                            |
| Entries scanned in folders | 100,000; hidden items and symbolic links are skipped                                                                                                       |
| Tasks kept                 | 100; finished ones are dropped first (unfinished plans are kept across undo and recovery), then `Review or finish existing tasks before starting another.` |
| One model request          | 500,000 characters: `This batch contains too much document evidence. Select fewer files.`                                                                  |
| Quotes sent for one file   | **Metadata and excerpts**: 16 of up to 6,000 characters; **Extracted text**: 64 of up to 20,000                                                            |

## Agents

Agents can propose a custom command for your review when it runs a built-in command they may
propose, a recipe, or a sequence of such command IDs without arguments and without `trash`. They
cannot run executable, shell, terminal-profile or workflow commands, because a program can bypass
Trash-only removal. See [what an agent cannot do](agents.md#what-an-agent-cannot-do).

**Related:** [Make repeated work a command](../guides/automate.md) ·
[Command language](command-line.md) · [Workflows and watch rules](automation.md) ·
[Terminals](terminals.md) · [Configuration](configuration.md) · [Terms](terms.md)
