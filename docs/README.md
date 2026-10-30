# Viewer documentation

Viewer is a file explorer that opens everything: it shows a file beside its folder, gives each kind
of file the tools it needs, and keeps folders, files, terminals and browsers side by side as planes
in one 3D workspace.

## Start here

1. [Install and update Viewer](guides/install.md).
2. Spend [your first five minutes](guides/getting-started.md): open a folder, look inside a file,
   find things and find actions.
3. Learn [the words Viewer uses](reference/terms.md): plane, linked plane, Quick Preview, Suggested
   and the rest.

Looking for one feature? [Features and where to find them](reference/capabilities.md) lists every
feature with its key, its **⌘K** command and its menu. Something wrong?
[Get back to your work](guides/troubleshooting.md).

## Find what you want to do

| I want to                                      | Follow the guide                                   | Exact details                                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Browse, find, rename, copy and restore files   | [Browse and organize](guides/files.md)             | [Search syntax](reference/search.md) · [File operations](reference/file-operations.md)                                          |
| Look inside a file                             | [Read and inspect files](guides/previews.md)       | [Formats](reference/formats.md) · [Office](reference/office.md) · [3D and CAD](reference/models.md)                             |
| Know what a folder holds and what to tidy      | [Explore a folder](guides/explore.md)              | [Lenses and folder maps](reference/lenses.md)                                                                                   |
| Convert, shrink, trim or rearrange files       | [Make a quick change](guides/create.md)            | [Media and Optimize](reference/media.md) · [PDF tools](reference/pdf.md)                                                        |
| Make collages, booklets, posters or cut sheets | [Lay out photos and PDFs](guides/layout.md)        | [Layout output](reference/layout.md) · [Nesting](reference/nesting.md)                                                          |
| Keep a folder, documents and tools together    | [Keep your work together](guides/workspaces.md)    | [Notes and tasks](reference/tasks-and-git.md) · [Journal](reference/journal.md)                                                 |
| Edit, run and review a code project            | [Work on a project](guides/develop.md)             | [Git and worktrees](reference/tasks-and-git.md) · [Terminals](reference/terminals.md) · [Browser and servers](reference/web.md) |
| Turn repeated work into a command              | [Make repeated work a command](guides/automate.md) | [Custom actions](reference/actions.md) · [Workflows](reference/automation.md)                                                   |
| Add a model or connect an agent                | [Make repeated work a command](guides/automate.md) | [Models and agents](reference/agents.md)                                                                                        |
| Dictate requests and notes                     | [Dictate into Viewer](guides/speech.md)            | [Speech](reference/speech.md)                                                                                                   |

## For power users

Everything has a key or a typed command, and every setting lives in one file you can edit.

- **Keys:** [keyboard shortcuts](reference/shortcuts.md), and **⌘K** for any command by name.
- **Typed commands:** type `:` in **⌘K** for [the command language](reference/command-line.md). It
  runs commands, opens places, sets options and chains steps with `|`, and keeps aliases and macros.
- **Search:** [query filters](reference/search.md) such as `ext:pdf size>10mb`, saved searches and
  document text.
- **Your own commands:** [custom actions and sequences](reference/actions.md), and
  [workflows and watch rules](reference/automation.md) that prepare reviews for you.
- **From a terminal:** [the `viewer` CLI](reference/cli.md) opens files and folders and runs
  commands.
- **Settings:** [`config.jsonc`](reference/configuration.md), with every setting, its default and
  its range.

## For agents

**Operating Viewer for a person.** Connect through agent access: the person allows your client and
the folders you may use. [Models and agents](reference/agents.md) lists the tools, what each needs
and what always waits for the person's review. Use
[Features and where to find them](reference/capabilities.md) for command ids,
[the words Viewer uses](reference/terms.md) for terms, and
[file operations](reference/file-operations.md) for how copies, moves, the Trash and Undo behave.
Viewer never deletes a file permanently, and an agent's removals go to the Trash only after the
person approves them.

**Changing Viewer's code.** Read [AGENTS.md](../AGENTS.md) first, then
[contributing](../CONTRIBUTING.md), the [domain map](../CONTEXT.md), the
[architecture](development/architecture.md) and [testing](development/testing.md).

## Where things live

| Folder                               | Contains                                       |
| ------------------------------------ | ---------------------------------------------- |
| [guides](guides/README.md)           | Steps to follow with Viewer open               |
| [reference](reference/README.md)     | Exact commands, settings, formats and limits   |
| [development](development/README.md) | Building, testing, extending and releasing     |
| [adr](adr/README.md)                 | Decisions behind the architecture              |
| [research](research/README.md)       | Proposals, experiments and product direction   |
| [release](release/README.md)         | Drafts for a store release                     |
| [media](media/README.md)             | Screenshots, recordings and how they were made |

[Platform status](reference/platforms.md) says what is qualified on each system.
