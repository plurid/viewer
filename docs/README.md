# Viewer documentation

Viewer is a file explorer that opens everything: it shows a file beside its folder, gives each kind
of file the tools it needs, and keeps folders, files, terminals and browsers side by side as planes
in one 3D workspace.

## Start here

1. [Install and update Viewer](guides/install.md): download, allow folder access, update or remove
   the app.
2. Spend [your first five minutes](guides/getting-started.md): open a folder, look inside a file,
   find things and find actions.
3. Learn [the words Viewer uses](reference/terms.md): plane, linked plane, Quick Preview, Suggested
   and the rest.
4. [Try the demo project](guides/demo-project.md): open saved tools and compare results without a
   model key.

Looking for one feature? [Features and where to find them](reference/capabilities.md) lists every
feature with its key, its **⌘K** command and its menu. Something wrong?
[Get back to your work](guides/troubleshooting.md).

## Find what you want to do

| I want to                                           | Follow the guide                                   | Exact details                                                                                                               |
| --------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Browse, find, rename, copy and restore files        | [Browse and organize](guides/files.md)             | [Search syntax](reference/search.md) · [File operations](reference/file-operations.md)                                      |
| Look inside a file                                  | [Read and inspect files](guides/previews.md)       | [Formats](reference/formats.md) · [Office](reference/office.md) · [3D and CAD](reference/models.md)                         |
| Know what a folder holds and what to tidy           | [Explore a folder](guides/explore.md)              | [Lenses and folder maps](reference/lenses.md)                                                                               |
| Convert, shrink, trim or rearrange files            | [Make a quick change](guides/create.md)            | [Media and Optimize](reference/media.md) · [PDF tools](reference/pdf.md)                                                    |
| Make collages, booklets, cut sheets or check a job  | [Lay out photos and PDFs](guides/layout.md)        | [Layout output](reference/layout.md) · [Nesting](reference/nesting.md) · [Fabrication checks](reference/fabrication.md)     |
| Keep a folder, documents and tools together         | [Keep your work together](guides/workspaces.md)    | [Journal](reference/journal.md)                                                                                             |
| Edit, run and review a code project                 | [Work on a project](guides/develop.md)             | [Tasks and Git](reference/tasks-and-git.md) · [Terminals](reference/terminals.md) · [Browser and servers](reference/web.md) |
| Build an interactive tool with a conversation       | [Build a canvas](guides/canvases.md)               | [Canvases and reconstruction](reference/canvases.md)                                                                        |
| Automate repeated work, add a model or use an agent | [Make repeated work a command](guides/automate.md) | [Custom actions](reference/actions.md) · [Workflows](reference/automation.md) · [Models and agents](reference/agents.md)    |
| Dictate requests, notes and captions                | [Dictate into Viewer](guides/speech.md)            | [Speech](reference/speech.md)                                                                                               |
| Use the trial and enter an offline license key      | [Try Viewer and enter a key](guides/license.md)    | [License keys and trial state](reference/license.md)                                                                        |

## For power users

Everything has a key or a typed command, and every setting lives in one file you can edit.

- [Keyboard shortcuts](reference/shortcuts.md): every default shortcut, prefix key and **⌘K**
  command lookup.
- [Command language](reference/command-line.md): type `:` in **⌘K** to run commands, open places,
  set options, chain steps with `|` and keep aliases or macros.
- [The `viewer` CLI](reference/cli.md): open files and folders and run commands from a terminal.
- [Configuration files and settings](reference/configuration.md): `config.jsonc`, personal backups
  and every setting with its default and range.

## For agents and contributors

**Operating Viewer for a person.** Connect through agent access: the person allows your client and
the folders you may use. The models and agents reference above lists every tool, what each needs and
what waits for the person's review. Viewer never deletes a file permanently unless the person
chooses **Empty Trash…** in the Trash window and confirms it; agents can never reach **Empty
Trash…**, and an agent's removals go to the Trash only after the person approves them.

**Changing Viewer's code.** Read [AGENTS.md](../AGENTS.md) first, then
[contributing](../CONTRIBUTING.md), the [domain map](../CONTEXT.md), the
[architecture](development/architecture.md), [testing](development/testing.md),
[screen review sheets](development/review.md) and [open review findings](development/findings.md).

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

[Platform status](reference/platforms.md) says what is qualified on each system and edition.
