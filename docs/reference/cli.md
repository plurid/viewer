# Viewer CLI

Open a folder, search its contents or prepare a workflow from your terminal. Start with `viewer .`;
use `viewer --help` to discover more.

## Install

In a direct build, choose **Install Viewer CLI** in the command palette or **Settings → Navigation →
Install shell command**. This creates `~/.local/bin/viewer` pointing to that Viewer installation.
Reinstalling the same launcher is safe. Another command already at that path is preserved.

If your shell cannot find it, use `~/.local/bin/viewer` and add `~/.local/bin` to your `PATH` when
convenient. Viewer does not edit shell startup files. Moving Viewer can leave an old launcher;
inspect it before replacing it. **Uninstall shell command…** confirms the exact launcher and moves
it to OS Trash. Shell integration is unavailable in the sandboxed App Store build.

## Open files and folders

```sh
viewer .
viewer ./notes.md
viewer --new-window ~/Documents
viewer --workspace "Research" ./notes.md
viewer --terminal .
viewer -- ./-draft.txt
viewer -- search
```

| Argument                 | Behavior                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| Paths                    | Open up to 100 paths, relative to the terminal's current folder.                         |
| `--new-window`           | Open an independent window.                                                              |
| `--workspace ID_OR_NAME` | Target an existing workspace by ID or unique name; takes precedence over `--new-window`. |
| `--terminal`             | Request a terminal plane for the launch target.                                          |
| `--`                     | Treat following arguments as literal paths, including reserved command names.            |

Paths understand `~` and `~/`. Quote spaces with your shell's ordinary rules.

## Connect service commands

Keep Viewer running. In **Settings → Agents**, enable the local connection and create a named client
with the folders and capabilities you want to use. Put that client's token in the
`VIEWER_AGENT_TOKEN` environment variable. Service commands use the same private local connection as
MCP clients; they do not read or manufacture credentials automatically.

```sh
viewer status --json
viewer workspace list
viewer command list
viewer search 'invoice' --root ./Documents
viewer search 'invoice' --root ./Documents --content
viewer read ./Documents/notes.md --json
```

Metadata, content, navigation and proposals have separate grants. Content-reading service commands
require a named client with content permission. Native folder access and provider data permission
remain separate. `--content` opts into indexed contents; filename search is the default. Search
reports whether results are indexed and whether indexing is still running. Its supported query
operators are in [search syntax](search.md).

The captured Viewer folder and selection supply context for commands, actions and workflows. Focus
the intended granted folder before using them. A stale target fails validation rather than silently
using a different selection. A custom app data profile must be selected with the same
`VIEWER_DATA_DIRECTORY` for the running app and the CLI.

Help, version and completion work without credentials or a running app. Service commands run without
creating a Viewer window.

## Commands

Run `viewer COMMAND --help` for exact arguments and options. `viewer help workflow` lists a family;
`viewer tools list --json` returns all service tool schemas.

| Commands                                                                          | Purpose                                                                                           |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `status`                                                                          | Check the authenticated connection.                                                               |
| `workspace list`, `workspace switch NAME`                                         | Discover or navigate accessible workspaces.                                                       |
| `workspace create`, `workspace rename`                                            | Review opening the corresponding parameter form.                                                  |
| `plane list`, `plane open PATH`, `plane focus ID`                                 | Discover and navigate planes; open accepts `--placement current\|root\|linked`.                   |
| `preview PATH`                                                                    | Open a linked preview through the navigation service.                                             |
| `layout horizontal`, `layout vertical`, `layout frame`                            | Submit the corresponding contextual layout command.                                               |
| `command list`, `command explain ID`, `command run ID`                            | Discover, explain or propose a contextual command.                                                |
| `search QUERY --root DIR [--content] [--offset N]`                                | Search a granted folder; the root defaults to the terminal working folder.                        |
| `inspect PATH`, `read PATH`                                                       | Read bounded metadata or extracted original content.                                              |
| `table PATH [--sheet NAME] [--offset N] [--limit N]`                              | Read saved worksheet or delimited-table values; at most 200 rows per request.                     |
| `relations PATH [--content]`                                                      | Inspect granted relationships, optionally reading local reference syntax.                         |
| `export PATH… --destination DIR --name NAME --plan JSON`                          | Prepare a typed export for separate review.                                                       |
| `action list`, `action run RECIPE PATH…`                                          | Discover and prepare configured recipe actions.                                                   |
| `action status ID`, `action cancel ID`                                            | Inspect or stop your recipe task.                                                                 |
| `review status ID`, `review cancel ID`                                            | Inspect or cancel your proposal.                                                                  |
| `git status [DIR]`, `git diff [DIR] [--base REF]`                                 | Read repository status or a bounded tracked-file patch; folder defaults to the current directory. |
| `task list`, `task create`                                                        | Discover granted task areas or review opening branch-to-task setup.                               |
| `workflow read FILE`, `workflow run FILE [--bindings JSON]`                       | Validate or start a saved typed workflow.                                                         |
| `workflow list`, `workflow status ID`, `workflow resume ID`, `workflow cancel ID` | Manage runs owned by this client.                                                                 |
| `config show`, `config validate JSON`, `config propose JSON`                      | Inspect configuration or validate/propose an array of patches.                                    |
| `ask PROMPT`                                                                      | Return a checked natural-language command proposal without executing it.                          |
| `speech models`, `speech status`                                                  | Inspect the pinned local model catalog and verified installations.                                |
| `speech install MODEL`, `speech import MODEL PATH`, `speech use MODEL`            | Review a pinned model download, verified local import or selection.                               |
| `tools list`, `tools call NAME [--args JSON]`                                     | Discover and call the same authorized service tools directly.                                     |
| `completion bash\|zsh\|fish`                                                      | Print completion source without editing a profile.                                                |

Git tools authorize the entire checkout before scanning. Diff resolves its base to a commit and
disables external diff/text conversion, hooks and network helpers. Its patch is limited to 4 MiB and
excludes untracked-file contents. CLI Git commands do not stage, commit or run arbitrary Git
programs.

Workspace creation, renaming and branch-to-task creation open the existing forms after review; their
proposal completing means the form opened, not that the person finished it. Workflow steps are typed
inspection, comparison, copy, conversion and recipe steps. They do not execute shell scripts or
approve their own changes. See [workflow definitions](automation.md).

## Prepare, review and inspect the result

```sh
viewer export ./photo.png --destination ./Exports --name Preview.png \
  --plan '{"kind":"image","format":"png","width":1280}' --json
viewer review status PROPOSAL_ID --json
viewer git diff . --base main --json
viewer workflow read ./viewer.workflow.jsonc
viewer workflow run ./viewer.workflow.jsonc --wait --json
```

Commands return proposal or task IDs. Complete the relevant review in Viewer, then inspect the
status or resume the workflow. Named navigation clients may use their explicit navigation grant;
commands, file changes, configuration and speech setup retain their applicable reviews. There is no
CLI approval flag. Every agent removal still needs fresh exact-scope approval and OS Trash; opaque
shell, executable and terminal-input routes remain unavailable.

`ask` uses the configured Ask Viewer model, sends permitted names and command context, and retains
the agent-specific provider permission. Its answer is a proposal for inspection; it is not sent back
to a shell or executed as a command line automatically.

## Local speech-model weights

`speech models` lists the pinned multilingual Whisper Tiny, Base and Small weights with their exact
byte sizes, SHA-256 digests and licenses. Downloads and imports require a renderer review and a
native confirmation. Imports require source-folder and content grants. The manager verifies size and
digest before marking weights installed. `speech use` explicitly selects verified installed weights;
installation alone does not change the selection.

```sh
viewer speech models --json
viewer speech install whisper-tiny --json
viewer review status PROPOSAL_ID
viewer speech use whisper-tiny --json
```

This manages model weights. Microphone capture, the bundled recognition runtime, transcription and
hosted speech adapters are not implemented; `speech status` reports recognition unavailable. The
[speech design](../research/speech.md) describes that remaining work.

Existing verified weights are reused. Downloads have a 20-minute bound and a pinned HTTPS host
allowlist. Failed, cancelled and interrupted files remain unselected and retained. Interrupted
downloads are not resumed automatically. There are at most eight retained installation attempts;
review their exact files before any separate Trash cleanup. Restarting Viewer does not restart a
download or record audio.

## Scripting and cancellation

Global options can appear before or after a command:

| Option         | Contract                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `--json`       | One JSON envelope on stdout: `{ "ok": true, "command": "…", "result": … }` or `{ "ok": false, "error": … }`. Diagnostics use stderr. |
| `--wait`       | Poll a submitted proposal, recipe or workflow; never approve a review.                                                               |
| `--timeout MS` | Overall request/wait deadline: 100–600,000 ms, default 30,000.                                                                       |
| `--help`       | Show catalog-generated usage for the selected command or family.                                                                     |
| `--version`    | Show the app version; accepts `--json`.                                                                                              |

`--wait` returns when a workflow is paused or waiting for review, or a recipe is ready for review. A
normal proposal remains pending until it is completed, rejected, cancelled or the deadline expires.
A completed command can have opened a parameter form; inspect the resulting app state.

Use `-` for one JSON argument to read stdin, limited to 64 KiB:

```sh
printf '%s' '[{"path":"ui.space.grid","value":false}]' | viewer config validate - --json
viewer tools call list_planes --args '{}' --json
viewer completion zsh > ./viewer-completion.zsh
```

Folder paths inside JSON workflow bindings are absolute existing paths; shell expansion is not
applied inside JSON. Ordinary path arguments resolve relative to the invoking terminal. Commands
allow at most 256 arguments and 64 KiB of argument text. Service output also respects the client's
read budget. Unsupported flags, duplicate options and malformed JSON fail before service calls.

Ctrl+C stops the CLI request or wait. Work already admitted may continue; failures and timeouts
include a known operation ID when available. Inspect that ID before retrying. To stop submitted
work, use `review cancel`, `action cancel` or `workflow cancel` with its ID. Cancelling preserves
completed output and evidence. Requests are not retried automatically.

| Exit code | Meaning                                                    |
| --------- | ---------------------------------------------------------- |
| `0`       | Request succeeded; a review may still be pending.          |
| `1`       | Viewer rejected or could not complete the service request. |
| `2`       | Invalid arguments, options or JSON input.                  |
| `3`       | Connection unavailable or incomplete transport response.   |
| `4`       | Missing client token.                                      |
| `124`     | Deadline exceeded.                                         |
| `130`     | Interrupted.                                               |

For the separate `:` language inside Viewer, see [command language](command-line.md). For grants and
reported conversations, see [agents](agents.md).
