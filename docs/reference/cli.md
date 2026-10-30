# Viewer CLI

This page lists every `viewer` terminal command with its options, permissions, output and exit
codes.

## Install

| Item         | Behavior                                                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install      | **⌘K** → **Install Viewer CLI**, or **Settings → Navigation → Shell command → Install shell command**.                                                                 |
| File         | `~/.local/bin/viewer`, a `/bin/sh` script that runs this Viewer installation's executable with your arguments.                                                         |
| Folders      | `~/.local` and `~/.local/bin` are created when missing. Neither may be a symbolic link.                                                                                |
| Existing     | Another file at that path is never replaced: Settings shows **This path contains another command. It will be preserved.** Installing the same script again is a no-op. |
| `PATH`       | Not changed. Viewer edits no shell startup file. Run `~/.local/bin/viewer` or add `~/.local/bin` to `PATH`.                                                            |
| Uninstall    | **Uninstall shell command…** confirms the path, checks the file is still this Viewer's script, then moves it to the Trash.                                             |
| After a move | Moving Viewer leaves a script that no longer matches. It is preserved, and installing again is refused until that file is gone.                                        |
| Availability | Direct build only. The App Store build shows **Shell integration is available in the direct build only.**                                                              |

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

| Argument                 | Behavior                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Paths                    | Up to 100 paths, resolved against the terminal's current folder. `~` and `~/` expand to your home folder.                   |
| `--new-window`           | Open the paths in a new independent window.                                                                                 |
| `--workspace ID_OR_NAME` | Open in that workspace's window, or a new window for it. Wins over `--new-window`. Zero or several matches fail.            |
| `--terminal`             | Open a terminal plane in each folder (a file's own folder) instead of opening the paths; with no path, the window's folder. |
| `--`                     | Treat every later argument as a literal path.                                                                               |

Viewer starts if it is not running; otherwise the running app receives the request. Any other
argument starting with `-` fails with `Unknown Viewer option`.

A first argument that is a command name or a global option starts a [command](#commands), not an
opening. The reserved names are `action`, `ask`, `command`, `completion`, `config`, `export`, `git`,
`help`, `inspect`, `layout`, `plane`, `preview`, `read`, `relations`, `review`, `search`, `speech`,
`status`, `table`, `task`, `tools`, `workflow` and `workspace`. To open a file with one of these
names, use `viewer -- NAME` or `viewer ./NAME`.

## Connect

Commands other than `help`, `--help`, `--version` and `completion` talk to the running app through
the same local connection as MCP clients. They create no window.

1. Keep Viewer open.
2. In **Settings → Agents**, turn on **Allow local agent clients** and confirm the system dialog.
3. Under **Agent clients**, enter a **Name**, choose **Choose folder…** for each folder, tick the
   capabilities, then choose **Create client**.
4. Copy the `VIEWER_AGENT_TOKEN` value from **Client MCP configuration**. It is shown once.
5. Set it in your shell: `export VIEWER_AGENT_TOKEN=…`.

The CLI reads no other credential. Without the variable it exits with code `4`. If the app's
connection is missing it fails with **Viewer's agent connection is unavailable. Open Viewer and
approve agent access in Settings → Agents.** A custom profile set with `VIEWER_DATA_DIRECTORY`
(absolute path) must be the same for the app and the CLI.

| Capability   | Settings label              | Allows                                                                |
| ------------ | --------------------------- | --------------------------------------------------------------------- |
| `metadata`   | **Metadata and discovery**  | Names, sizes, dates, tools, workspaces and planes in granted folders. |
| `content`    | **Read file contents**      | Extracted passages, tables, patches and indexed text.                 |
| `navigation` | **Navigate without review** | Open paths, focus planes and switch workspaces at once.               |
| `propose`    | **Propose changes**         | Submit commands, exports, configuration and setup for your review.    |

A named client's navigation applies at once, except opening a `viewer.project.jsonc`, which waits
for review. Every other change waits for review in Viewer. Native folder access and model data
permission stay separate. [Agents](agents.md#connect-an-agent) covers access in full.

## Commands

`viewer COMMAND --help` prints one command's usage; `viewer help FAMILY` (for example
`viewer help workflow`) lists a family. Paths in arguments and path options resolve against the
terminal's folder. A command's capability is checked again by the app on every call.

### Discover and navigate

| Command                                  | Needs        | Does                                                                         |
| ---------------------------------------- | ------------ | ---------------------------------------------------------------------------- |
| `status`                                 | a token      | Checks the connection.                                                       |
| `tools list`                             | a token      | Lists every service tool and its input schema.                               |
| `tools call NAME [--args JSON]`          | the tool's   | Calls a tool with a JSON object; `--args` defaults to `{}`.                  |
| `workspace list`                         | `metadata`   | Lists workspaces visible within your folders.                                |
| `workspace switch NAME`, `--id ID`       | `navigation` | Switches to a workspace by exact unique name or by ID; give one, not both.   |
| `workspace create`, `workspace rename`   | `propose`    | Opens the new-workspace or rename form after review.                         |
| `plane list [--workspaceID ID]`          | `metadata`   | Lists granted planes; the active workspace by default.                       |
| `plane open PATH [--placement P]`        | `navigation` | Opens a path; `P` is `current`, `root` (default) or `linked`.                |
| `plane focus PANE_ID`                    | `navigation` | Focuses a plane from `plane list`.                                           |
| `preview PATH`                           | `navigation` | Opens a linked preview.                                                      |
| `layout horizontal`, `vertical`, `frame` | `propose`    | Proposes arranging planes horizontally, vertically, or framing all.          |
| `command list`                           | `metadata`   | Lists the commands available for the folder and selection focused in Viewer. |
| `command explain COMMAND_ID`             | `metadata`   | Explains a command and its review.                                           |
| `command run COMMAND_ID`                 | `propose`    | Proposes the command for review.                                             |

### Read files

| Command                                              | Needs                   | Does                                                                        |
| ---------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------- |
| `search QUERY [--root DIR] [--content] [--offset N]` | `metadata`              | Searches an indexed granted folder by name. `--root` defaults to `.`.       |
| `search … --content`                                 | `content`, named client | Also matches indexed document text and returns match evidence.              |
| `inspect PATH`                                       | `metadata`              | Reads bounded metadata.                                                     |
| `read PATH`                                          | `content`               | Reads bounded extracted passages with source versions.                      |
| `table PATH [--sheet NAME] [--offset N] [--limit N]` | `content`               | Reads CSV, TSV or XLSX rows: stored values and formula text, no evaluation. |
| `relations PATH [--content]`                         | `metadata`              | Reads operation provenance; `--content` also scans reference syntax.        |
| `git status [DIR]`                                   | `metadata`              | Reads repository status; `DIR` defaults to `.`.                             |
| `git diff [DIR] [--base REF]`                        | `metadata`, `content`   | Reads a tracked-file patch against `REF` (default `HEAD`).                  |
| `config show`                                        | `metadata`              | Reads effective configuration without credentials or grants.                |
| `config validate PATCHES`                            | `metadata`              | Validates a JSON array of patches without applying them.                    |

`search` returns `entries`, `more`, `indexed` and `running` (indexing still in progress); with
`--content` also `evidence`. Query syntax is in [search](search.md). `--offset` is 0 to 100,000.
`table` reads 1 to 200 rows (`--limit`, default 100) from `--offset` 0 to 100,000; an XLSX defaults
to its first visible worksheet. A result larger than the client's **Maximum returned content (MiB)**
fails with a request to read a smaller window.

### Propose changes and run work

| Command                                                          | Needs                   | Does                                                                                    |
| ---------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| `export PATH… --destination DIR --name NAME --plan JSON`         | `propose`, `content`    | Prepares an image, PDF or media export (1 to 16 sources) for review.                    |
| `action list`                                                    | `metadata`              | Lists configured recipe actions and the data they read.                                 |
| `action run RECIPE_ID PATH… [--instructions TEXT] [--recursive]` | `propose`               | Prepares a recipe; `content` too when the recipe reads contents.                        |
| `action status ID`, `action cancel ID`                           | your own task           | Reads or cancels a recipe task you started.                                             |
| `review status ID`, `review cancel ID`                           | your own proposal       | Reads or cancels your proposal; cancelling keeps its evidence and output.               |
| `config propose PATCHES`                                         | `propose`               | Submits configuration patches for review.                                               |
| `task list [--workspace ID_OR_NAME]`                             | `metadata`              | Lists task areas whose checkouts are in your folders.                                   |
| `task create NAME --branch B --path DIR …`                       | `propose`, `navigation` | Proposes a branch, worktree and task area. See below.                                   |
| `workflow read FILE`                                             | `metadata`              | Validates a saved workflow without running it.                                          |
| `workflow run FILE [--bindings JSON]`                            | `metadata`              | Runs inspection steps and prepares file-change steps for review.                        |
| `workflow list`, `workflow status ID`                            | your own runs           | Lists or reads workflow runs this client started.                                       |
| `workflow resume ID`, `workflow cancel ID`                       | your own run            | Resumes after its reviews, or cancels it keeping its evidence.                          |
| `ask PROMPT`                                                     | `metadata`              | Asks the **Use for Ask Viewer** model for a command proposal (up to 12,000 characters). |
| `speech models`, `speech status`                                 | `metadata`              | Lists pinned speech models and installation state; records nothing.                     |
| `speech install MODEL`, `speech use MODEL`                       | `propose`               | Proposes downloading or selecting a model.                                              |
| `speech import MODEL PATH`                                       | `propose`, `content`    | Proposes importing a local file that matches a pinned checksum.                         |
| `completion bash\|zsh\|fish`                                     | nothing                 | Prints a completion script to stdout; edits no profile.                                 |

After review in Viewer, the commands that propose a command (`command run`, `workspace create`,
`workspace rename`, `layout`), `config propose`, `task create` and the speech commands also need a
native confirmation; declining it returns the proposal to review and runs nothing.

Configuration patches are `[{ "path": "…", "keys": […], "value": … }]`: up to 100 patches, `path` up
to 200 characters, `keys` optional (up to 10). The [configuration](configuration.md) reference lists
the paths. `ask` sends only permitted names and the command context; its answer is a proposal and is
never run. Workflow bindings are a JSON object of folder names to absolute existing paths; shell
expansion does not apply inside JSON. Workflow steps are described in [automation](automation.md).

Service tools without their own command, such as `get_context`, `inspect_file`,
`read_drawing_geometry`, `propose_selection`, `read_terminal` and `report_session`, are reachable
with `tools call`. [Agents](agents.md#what-an-agent-can-do) describes each tool.

### Git reads

| Rule       | Value                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| Setting    | **Settings → Browsing → Git → Show Git status** must be on; otherwise **Git is disabled in Settings.**              |
| Platform   | macOS direct build. Git runs in a sandbox that denies writes, network and child processes.                          |
| Git        | System Git 2.36 or later.                                                                                           |
| Scope      | The whole checkout must be inside your folders.                                                                     |
| Filters    | A repository that configures `filter.*.clean`, `smudge` or `process` is refused.                                    |
| Diff base  | A branch or commit up to 300 characters, resolved to a commit first.                                                |
| Status     | At most 8 MiB of output, 5 seconds.                                                                                 |
| Diff       | Tracked files only, no renames, submodules ignored, no external diff or text conversion; at most 4 MiB, 30 seconds. |
| Concurrent | 8 Git inspections at once.                                                                                          |

The CLI never stages, commits or runs other Git programs.

## Create a task from a branch

```sh
viewer workspace list --json
viewer task create "Improve search" --repo ./viewer --branch feature/search \
  --path ./worktrees/search --base main --workspace "Development" --json
viewer review status PROPOSAL_ID --json
viewer task list --workspace "Development" --json
```

| Option                   | Default          | Rule                                                                          |
| ------------------------ | ---------------- | ----------------------------------------------------------------------------- |
| `NAME`                   | required         | 1 to 100 characters, one shell argument.                                      |
| `--branch B`             | required         | New branch name; with `--existing`, a local branch with no worktree.          |
| `--path DIR`             | required         | A new folder in an existing parent. It must not exist.                        |
| `--repo DIR`             | `.`              | The repository folder.                                                        |
| `--base REF`             | `HEAD`           | `HEAD` or an existing local branch. No other revision expression.             |
| `--existing`             | off              | Use `--branch` as an existing local branch. Cannot be combined with `--base`. |
| `--workspace ID_OR_NAME` | active workspace | An ID or exact unique name; duplicate names need the ID.                      |

Requirements: the direct build; the workspace's window open; your folders covering the repository,
the destination's parent and every plane in that workspace; no plane searching **All indexed
locations**; fewer than 50 task areas in the workspace. A request expires five minutes after it is
made. Up to 100 requests can wait for review.

After review in Viewer and a native confirmation, Viewer creates the worktree and opens five planes:
the task, its folder, a private note, a terminal and **Git changes**. The terminal stays stopped,
and Git changes load only when you choose **Load Git changes**. The CLI runs no tests, shell, hooks,
submodule commands or repository filters. Checkout writes Git objects directly: LFS pointers stay
pointers, submodules stay uninitialized, and links leaving the working files or unsafe paths are
refused.

| Checkout limit | Value   |
| -------------- | ------- |
| Files          | 20,000  |
| One file       | 64 MiB  |
| Total          | 512 MiB |

A larger repository, or one with executable Git filters, needs **New task from branch…** in the app.

The proposal's `taskResult` has `workspaceID`, `taskID`, `path`, `branch`, `commit`,
`terminal: "stopped"`, `stage` and, once ready, `planeIDs`. `stage` moves from `worktree-pending` to
`worktree-created` to `ready`. The first reply is a review request, not a created task.

If creation fails or is cancelled, Viewer keeps any created worktree, branch and note and removes
nothing. Check `stage`: `worktree-pending` does not prove Git finished. A failed `--json --wait`
includes the last proposal in `result` and its `operationID`.

## Local speech model weights

```sh
viewer speech models --json
viewer speech install whisper-tiny --json
viewer review status PROPOSAL_ID
viewer speech use whisper-tiny --json
```

| Model ID        | Name          | Bytes       | License |
| --------------- | ------------- | ----------- | ------- |
| `whisper-tiny`  | Whisper Tiny  | 77,691,713  | MIT     |
| `whisper-base`  | Whisper Base  | 147,951,465 | MIT     |
| `whisper-small` | Whisper Small | 487,601,967 | MIT     |

All three are multilingual and pinned by revision and SHA-256. `speech models` prints each digest.

| Rule      | Value                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------- |
| Review    | Install, import and use need review in Viewer and a native confirmation.                             |
| Download  | HTTPS from `huggingface.co` and `cdn-lfs.huggingface.co` only; 20 minutes; size and digest verified. |
| Storage   | Free space of the model's size plus 1 MiB.                                                           |
| Reuse     | A verified installed model is reused, not downloaded again.                                          |
| Selection | `speech use` selects an installed model. Installing does not select it.                              |
| Attempts  | At most eight retained attempts. Failed, cancelled and interrupted files stay, unselected.           |
| Restart   | Quitting does not resume a download or record audio.                                                 |

The CLI manages weights only. It cannot record, grant microphone access, set hosted keys or send
audio. [Speech](speech.md) covers dictation.

## Global options

Global options can come before or after the command.

| Option            | Behavior                                                                  |
| ----------------- | ------------------------------------------------------------------------- |
| `--json`          | Writes one JSON object to stdout. Messages go to stderr.                  |
| `--wait`          | Waits for a submitted operation. Never approves anything.                 |
| `--timeout MS`    | Deadline for the request and the wait: 100 to 600,000 ms, default 30,000. |
| `--help`, `-h`    | Prints usage for the command or family.                                   |
| `--version`, `-v` | Prints the app version. Accepts only `--json`.                            |

Without `--json`, a text result prints as text with control characters escaped; any other result
prints as indented JSON.

| `--json` result | Shape                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------- |
| Success         | `{"ok": true, "command": "workspace list", "result": …}`                                       |
| Failure         | `{"ok": false, "error": {"code": EXIT_CODE, "message": "…"}, "operationID": "…", "result": …}` |
| Missing token   | `{"ok": false, "error": {"code": "CREDENTIALS_REQUIRED", "message": "…"}}`                     |

`operationID` appears when an operation was submitted; `result` holds the last status of a failed
wait.

`--wait` applies to commands that submit work: `command run`, `workspace switch`, `create` and
`rename`, `plane open` and `focus`, `preview`, `layout`, `export`, `config propose`, `task create`,
`speech install`, `import` and `use` (proposals); `action run` (recipe tasks); `workflow run` and
`resume`. It polls every 300 ms.

| Operation   | `--wait` returns at                     | Fails at                          |
| ----------- | --------------------------------------- | --------------------------------- |
| Proposal    | `completed`                             | `failed`, `rejected`, `cancelled` |
| Recipe task | `review` or `completed`                 | `failed`, `rejected`, `cancelled` |
| Workflow    | `paused`, `waiting-review`, `completed` | `failed`, `rejected`, `cancelled` |

A completed proposal can be a form that opened; check the app.

## Input limits

| Limit           | Value                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| Arguments       | 256, with 64 KiB of argument text and no null characters.                                                   |
| JSON from stdin | Pass `-` as one JSON argument (`--args`, `--plan`, `--bindings`, `PATCHES`): one per command, up to 64 KiB. |
| Options         | Unknown, duplicated or valueless options and invalid JSON fail with code `2` before any call.               |
| Retries         | None. A request is sent once.                                                                               |

```sh
printf '%s' '[{"path":"ui.space.grid","value":false}]' | viewer config validate - --json
viewer tools call list_planes --args '{}' --json
viewer completion zsh > ./viewer-completion.zsh
```

**Control-C** (or `SIGTERM`) stops the CLI request or wait, not work Viewer already accepted. A
cancelled or timed-out command prints the operation ID when it has one. Stop submitted work with
`review cancel`, `action cancel` or `workflow cancel`; cancelling keeps completed output and
evidence.

## Exit codes

| Code  | Meaning                                                                         |
| ----- | ------------------------------------------------------------------------------- |
| `0`   | Success. A review may still be pending.                                         |
| `1`   | Viewer refused or could not complete the request, or a waited operation failed. |
| `2`   | Invalid command, argument, option or JSON.                                      |
| `3`   | No connection to the app, or an incomplete reply.                               |
| `4`   | `VIEWER_AGENT_TOKEN` is not set.                                                |
| `124` | `--timeout` passed. The operation may still be running.                         |
| `130` | Interrupted by Control-C or `SIGTERM`.                                          |

**Related:** [Make repeated work a command](../guides/automate.md#open-viewer-from-your-terminal) ·
[Agents](agents.md) · [Command language](command-line.md) · [Tasks and Git](tasks-and-git.md) ·
[Search](search.md) · [Terms](terms.md)
