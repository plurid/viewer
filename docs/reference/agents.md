# Models and agents

This page describes how a local agent connects to Viewer over MCP, every tool it can call and what
each needs, what it can never do, its limits and errors, and the model settings agents depend on.

Agents and models are optional. Browsing, previews and the built-in tools work without either.

## What an agent can do

An agent works inside the folders the person gives it. It can look around the workspace, read what
its capabilities allow and propose changes. Changes to files, configuration, tasks and speech models
wait for the person's review in Viewer.

**Needs** names the capability a call requires (see [capabilities](#capabilities)). "Named" means
only a [named client](#named-client-or-shared-connection) can call it; the shared connection is
refused. Every path argument must be inside the client's folders.

### Discover the workspace

| Tool              | Needs      | What it does                                                                                                                                                                 |
| ----------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_context`     | `metadata` | The active workspace, root, plane and selected sources, keeping only granted paths                                                                                           |
| `list_workspaces` | `metadata` | Each workspace with its granted planes (ID, type, path, view mode) and root plane IDs. Planes outside the folders and search planes over all locations are left out          |
| `list_planes`     | `metadata` | The granted planes of one workspace; `workspaceID` defaults to the active one                                                                                                |
| `list_task_areas` | `metadata` | Task names, checkout paths, branches and commits inside the folders, for every workspace or one `workspace` (an ID or an exact unique name)                                  |
| `list_commands`   | `metadata` | The commands an agent may propose for the captured folder and selection: ID, label, group, aliases and key, with the removal policy                                          |
| `explain_command` | `metadata` | One command (`commandID`), its captured target, and a custom action's definition                                                                                             |
| `list_actions`    | `metadata` | Action recipes: ID, name, formats, data level and kind                                                                                                                       |
| `read_config`     | `metadata` | The effective configuration: `version`, `settings`, `ui` and `revision`. Terminal arguments and environment values, shell scripts and executable arguments read `[redacted]` |
| `validate_config` | `metadata` | Checks up to 100 patches without applying them                                                                                                                               |

### Read files and checkouts

| Tool                    | Needs                                                         | What it does                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read_metadata`         | `metadata`                                                    | One file's entry: name, kind, size, dates and identity                                                                                                                                               |
| `search_files`          | `metadata`; `content: true` needs `content`, named            | Searches an indexed granted folder (`root`) with the [search syntax](search.md); `query` up to 300 characters, `offset` for the next page. Matching passages come back only for `content: true`      |
| `get_relationships`     | `metadata`; `content: true` needs `content`, named            | Operation provenance between granted files and, with `content: true`, local references in the file. Private notes and reported links are left out                                                    |
| `inspect_file`          | `content`, named                                              | Source-versioned facts and original evidence; `ocr: true` runs OCR                                                                                                                                   |
| `read_content`          | `content`, named                                              | Bounded extracted passages with the source version and reader coverage                                                                                                                               |
| `query_table`           | `content`, named                                              | A row window of a CSV, TSV or XLSX file: `offset` 0 to 100,000, `limit` 1 to 200 (default 100), `sheet` for XLSX (default: the first visible sheet). Stored values and formula text; no formula runs |
| `read_drawing_geometry` | `content`, named                                              | DXF entity bounds, lengths, areas and radii: `offset` 0 to 50,000, `limit` 1 to 100 (default 50), optional `layer` and `points`. Units are declared, never guessed                                   |
| `git_status`            | `metadata`                                                    | Git status of the checkout that contains `path`                                                                                                                                                      |
| `git_diff`              | `content`, named                                              | A bounded tracked-file diff against `base`, a branch or commit (default `HEAD`)                                                                                                                      |
| `read_terminal`         | `terminal-read` and a [terminal read grant](#terminal-output) | A terminal's folder and the last 128,000 characters it showed. `id` is the terminal plane's ID from `list_planes`                                                                                    |

When `search_files` omits `content`, it searches document text if the client holds `content`, and
returns no passages.

`git_status` and `git_diff` run system Git 2.36 or later inside a macOS sandbox that denies writes,
network access and child processes. A repository that configures `filter.*.clean`, `smudge` or
`process` is refused. Both tools fail on other platforms, in the Mac App Store build and while
**Settings → Browsing → Git → Show Git status** (`settings.git.enabled`) is off. Use the Git review
plane in those cases.

### Move around the workspace

| Tool                       | Needs        | What it does                                                                                                        |
| -------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------- |
| `propose_open_path`        | `navigation` | Opens a granted `path`; `placement` is `current` (default), `root` or `linked`                                      |
| `propose_selection`        | `navigation` | Selects up to 2,000 `paths`, all in the captured folder; empty `paths` clears the selection                         |
| `propose_focus_plane`      | `navigation` | Focuses a granted plane of the active workspace by `paneID`                                                         |
| `propose_workspace_switch` | `navigation` | Switches to a workspace by `workspaceID` or exact unique `name` (one of the two); every plane in it must be granted |

A named client with `navigation` moves at once and gets `requiresUserReview: false`; opening a
`viewer.project.jsonc` file still waits for review. The shared connection's navigation always waits.

### Propose changes

| Tool                  | Needs                                                 | What it does                                                                                                                                                           |
| --------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `propose_command`     | `propose`                                             | Proposes a command from `list_commands` for the captured folder and selection                                                                                          |
| `propose_config`      | `propose`                                             | Proposes up to 100 configuration patches; see [configuration an agent may change](#configuration-an-agent-may-change)                                                  |
| `propose_transform`   | `propose`, `content`                                  | Proposes an image, PDF, PDF pages, media or layout export: `sources` (1 to 16), `destination` folder, output `name` and a typed `plan`. Creates a new file             |
| `run_action`          | `propose`; `content` for a recipe that reads contents | Starts a recipe (`recipeID`) on up to 2,000 `sources`, with optional `instructions` (up to 12,000 characters) and `recursive`. Returns `applyRequiresUserReview: true` |
| `ask_in_words`        | `propose`                                             | Asks the person's model to turn a `prompt` (up to 12,000 characters) into a checked command proposal; nothing runs                                                     |
| `propose_task_create` | `propose`, `navigation`                               | Proposes a worktree and task area: `name`, `repo`, destination `path`, `branch`, optional `base` or `existing`, and `workspace`. The terminal stays stopped            |

`propose_task_create` is available in the direct build only, and a prepared task expires after 5
minutes.

`propose_transform` accepts `image` and `pdf` plans for one source, and `media`, `pdf-pages` and
`layout` plans for 1 to 16 sources. The `name` must end with the format's extension. Sources must be
regular files; existing files are kept.

`run_action` and `ask_in_words` reach a model only when the person has turned on **Allow
agent-started actions to send the same data** for it ([Add a model](#add-a-model)).

### Run workflows

| Tool              | Needs                       | What it does                                                                                                                            |
| ----------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `read_workflow`   | `content`, named            | Reads and validates a granted workflow `file` without running it                                                                        |
| `run_workflow`    | `content`, `propose`, named | Runs a workflow `file` for the focused granted folder, with optional `bindings` (name to absolute path). Mutation steps prepare reviews |
| `list_workflows`  | `content`, named            | The client's own workflow runs that its current folders still cover                                                                     |
| `get_workflow`    | `content`, `propose`, named | Reads one of the client's runs by `id`                                                                                                  |
| `resume_workflow` | `content`, `propose`, named | Resumes one of the client's runs                                                                                                        |
| `cancel_workflow` | `metadata`                  | Cancels one of the client's runs                                                                                                        |

The workflow format is in [workflows and watch rules](automation.md).

### Follow up

| Tool              | Needs                                      | What it does                                                                 |
| ----------------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| `get_proposal`    | Any client                                 | The status of the client's own proposal by `id`                              |
| `cancel_proposal` | Any client                                 | Cancels the client's own pending or running proposal; completed output stays |
| `get_task`        | Any client; `content` for a content recipe | The client's own recipe task by `id`                                         |
| `cancel_task`     | Any client                                 | Cancels the client's own recipe task                                         |

A proposal's `status` is `review`, `running`, `completed`, `failed`, `rejected` or `cancelled`. Poll
`get_proposal` until it is one of the last four. There are no change notifications.

### Speech models

| Tool                     | Needs                       | What it does                                                                 |
| ------------------------ | --------------------------- | ---------------------------------------------------------------------------- |
| `speech_models`          | `metadata`                  | The local speech model catalog and what is installed                         |
| `speech_status`          | `metadata`                  | The same catalog and installation state                                      |
| `propose_speech_install` | `propose`                   | Proposes downloading a pinned catalog `model`                                |
| `propose_speech_use`     | `propose`                   | Proposes choosing an installed `model`                                       |
| `propose_speech_import`  | `propose`, `content`, named | Proposes importing a granted `source` file that matches the model's checksum |

None of them records, opens the microphone or installs a program. [Speech](speech.md) has the
catalog.

### Report a session

| Tool             | Needs      | What it does                                                                         |
| ---------------- | ---------- | ------------------------------------------------------------------------------------ |
| `report_session` | `metadata` | Saves the agent's own transcript, status and file or diff links for a granted folder |

The format is in [Report a session](#report-a-session).

## Connect an agent

Viewer must be running: the agent starts Viewer's executable with `--mcp`, which relays to the open
app over a private socket. If the agent client cannot use MCP, the [`viewer` CLI](cli.md) uses the
same connection and token.

### Named client or shared connection

| Connection        | Credential                               | Folders and capabilities | Use it for                                                   |
| ----------------- | ---------------------------------------- | ------------------------ | ------------------------------------------------------------ |
| Named client      | Its own token, shown once                | Its own                  | Each agent you connect. Content tools and workflows need one |
| Shared connection | Viewer's agent token, replaced on demand | Shared by every holder   | One agent that only discovers, searches and proposes         |

Viewer keeps up to 100 named clients, revoked ones included.

### Connect a named client

1. Choose **Viewer → Settings…** (**⌘,**), then **Agents**.
2. Turn on **Allow local agent clients**. A system dialog, **Allow local agent clients to use
   Viewer?**, lists the shared connection's folders and capabilities. Choose **Allow**.
3. Under **Agent clients**, in **New client**, enter a **Name**.
4. Use **Choose folder…** to add each folder the agent may use.
5. Turn on the capabilities it needs. A new client starts with **Metadata and discovery** only.
6. Set **Maximum returned content (MiB)** and **Concurrent requests and pending recipe tasks**, then
   choose **Create client**.
7. Copy the **Client MCP configuration** into the agent client's MCP settings. The token is shown
   once.
8. Restart or reload the agent client so it starts the server.

To change a client later, choose **Permissions**, edit, then **Save permissions**.

### Connect through the shared connection

1. Turn on **Allow local agent clients** and choose **Allow**, as above.
2. Open **Shared connection** and choose **Authorize folder…** for each folder. The folder panel is
   the approval.
3. Under **What the connection may do**, turn on what it needs. Adding a capability asks **Allow the
   shared agent connection more?**; choose **Allow**.
4. Choose **Generate MCP configuration** and copy the **MCP configuration** into the agent client.

**Generate MCP configuration** is available once access is on and a folder is authorized. Each use
makes a new token: it disconnects every earlier holder, stops the connection's work and revokes its
terminal read grants.

### The client configuration

Both buttons produce this JSON, with the path of the running Viewer and a 64-character hexadecimal
token:

```json
{
  "mcpServers": {
    "viewer": {
      "command": "/Applications/Viewer.app/Contents/MacOS/Viewer",
      "args": ["--mcp"],
      "env": {
        "VIEWER_AGENT_TOKEN": "<64 hexadecimal characters>"
      }
    }
  }
}
```

When Viewer runs with `VIEWER_DATA_DIRECTORY` set, `env` carries it too. A client configured with a
command line runs the same `command` and `args` with `VIEWER_AGENT_TOKEN` in its environment. Keep
the token private: anyone holding it acts as that client.

### Folders

- Viewer itself must be able to read the folder; see
  [Allow access to your folders](../guides/install.md#allow-access-to-your-folders).
- Each client and the shared connection hold up to 100 folders. Subfolders are included.
- Viewer's own data folder cannot be an agent folder.
- A path outside the folders, missing or denied gets the same answer, so an agent cannot probe the
  disk.

### Capabilities

| Capability       | Named client label                   | Shared connection label                                | Allows                                                                          |
| ---------------- | ------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `metadata`       | **Metadata and discovery**           | **Names, sizes, dates and available tools**            | Discovery, names, sizes, dates, configuration reads, session reports            |
| `content`        | **Read file contents**               | **Search document text and run actions that read it**  | Named: every content tool. Shared: document-text search and content recipes     |
| `navigation`     | **Navigate without review**          | **Propose opening folders and files, for your review** | Opening, selecting, focusing and switching; at once for a named client          |
| `propose`        | **Propose changes**                  | **Propose commands and changes, for your review**      | Commands, configuration, exports, recipes, tasks and speech setup, all reviewed |
| `terminal-read`  | **Read terminal output**             | **Read terminal output, where granted**                | `read_terminal`, with a terminal read grant                                     |
| `execute`        | **Unattended execution unavailable** | Not offered                                            | Nothing: the box cannot be turned on                                            |
| `terminal-write` | **Terminal input unavailable**       | Not offered                                            | Nothing: the box cannot be turned on                                            |

When agents are turned on and the shared connection has no capabilities yet, it gets `metadata`,
`navigation` and `propose`.

### Terminal output

Terminal output needs its own grant on top of `terminal-read`:

1. Select the client (**Permissions**), or open **Shared connection**.
2. Under **Agent permissions**, choose the folder in **Grant for folder**.
3. Turn on **Read terminal output**.

The grant covers terminals started in that folder, including after they change to another folder.
Git action terminals stay private. **Existing grants** lists and revokes them.

### What config.jsonc can do

`settings.agents` in [config.jsonc](configuration.md) only asks:

- `enabled: true` shows **config.jsonc turns agents on; they stay off until you allow it here.**
- A folder in `roots` appears under **Shared connection** marked **Requested in config.jsonc**, with
  **Allow…**, which asks **Allow agents to use this folder?**
- `enabled: false`, or removing a folder, applies at once.
- `allowLayout` is reserved and authorizes nothing.

Tokens, approvals and terminal read grants are kept in private app data, never in config.jsonc.
After an update from the first access format, Viewer asks for one new approval: turn **Allow local
agent clients** on again.

### Watch and stop

- **Activity** on a client shows its recent tool calls and reviews, newest first.
- **Stop tasks** cancels the client's proposals, recipe tasks and workflows.
- **Revoke** retires the client, its token and its grants.
- Saving a client's permissions stops its work.
- Turning access off, or removing a shared folder or capability, stops every client's work.
- Turning access back on does not resume cancelled work.

## What the person reviews

| Request                               | Review in Viewer                                         | Then a system dialog         |
| ------------------------------------- | -------------------------------------------------------- | ---------------------------- |
| `propose_command`                     | **Run action**, or **Move to Trash** for a removal       | **Run** or **Move to Trash** |
| `propose_config`                      | **Apply changes**                                        | **Change**                   |
| `propose_task_create`                 | **Create task**                                          | **Create task**              |
| `propose_speech_*`                    | **Download model**, **Import model** or **Choose model** | The same label               |
| `propose_transform`                   | **Run action**                                           | None                         |
| `run_action`, workflow mutation steps | **Action tasks**: **Apply _n_ changes**                  | None                         |
| Navigation, shared connection         | The proposal's title, such as **Open path**              | None                         |
| Navigation, named client              | None, except opening `viewer.project.jsonc`              | None                         |

**Reject** or closing the review rejects the proposal. Before anything runs, Viewer checks again
that the folder, selection, file identities and action definition are what was reviewed. A change
fails the proposal; it never retargets a new selection.

## What an agent cannot do

- **Run programs.** No shell scripts, executables, terminal profiles, external apps or terminal
  input. A custom action that runs one is refused, also through a sequence. `write_terminal` is not
  listed and always fails, and execution grants cannot be saved.
- **Delete anything.** Removal is the `trash` command on an exact selection in the captured folder.
  It needs the review and the system dialog every time, and goes to the system Trash only.
- **Remove protected items.** Trash contents, a granted folder itself, Home, a whole disk and system
  folders (`/Users`, `/System`, `/Library`, `/Applications`, `/Volumes`, `/private`, `/usr`, `/bin`,
  `/sbin`, `/etc`, `/tmp`, `/var`) are refused. So is a folder holding more than 10,000 items.
- **Use a volume without a Trash.** A removal there fails and nothing is deleted. An agent's copy or
  move that would replace an item there fails too.
- **Empty or browse the Trash, or use file Undo.** Those stay in the person's interface.
- **Run Git actions.** Staging, committing, pulling and pushing are the person's.
- **Paste.** The clipboard is outside the captured selection; use `copy-to` or `move-to`.
- **Save nestings or mail attachments.** `propose_transform` refuses them: nestings are saved from
  the Layout plane, attachments from the message preview.
- **Read Viewer's private data.** Credentials, grants, recovery files and saved transcripts are
  outside every file tool.
- **Grant itself access.** Editing config.jsonc, imported configuration, custom-action aliases and
  saved grants cannot add folders, capabilities or execution.
- **Use the browser's signed-in sessions, start a local server or dictate.**

### Commands an agent may propose

`list_commands` returns those of these that the captured folder and selection offer. Everything else
is refused, including commands added later.

| Kind              | Commands                                                                                                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files             | `trash`, `duplicate`, `compress`, `extract`, `make-alias`, `rename`, `new-folder`, `new-file`, `new-folder-with-selection`, `copy-to`, `move-to`                                                                                                         |
| New copies        | `rotate-copy-left`, `rotate-copy-right`, `convert-jpeg`, `convert-png`, `images-to-pdf`                                                                                                                                                                  |
| Dialogs           | `new-workspace`, `rename-workspace`, `new-task-from-branch`                                                                                                                                                                                              |
| Inspect           | `copy-path`, `path`, `add-to-basket`, `calculate-size`, `info`, `tags`, `inspect-file`, `related-files`, `quick-preview`, `native-quick-look`                                                                                                            |
| Select and find   | `select-all`, `invert-selection`, `refresh`, `hidden`, `search`, `find-file`, `go-to`, `back`, `forward`, `parent`                                                                                                                                       |
| Planes and layout | `linked`, `another-plane`, `frame-plane`, `frame-all`, `dock`, `arrange-horizontal`, `arrange-vertical`, `plane-notes`, `plane-sidebar`, `toggle-sidebar`, `focus-mode`, `profile-restore`, `wrap-file-names`, `reset-list-columns`, `reset-folder-view` |
| Prefixes          | `view-…`, `column.…`, `group.…`, `sort.…`, `recipe.…`                                                                                                                                                                                                    |
| Profiles          | `profile.focus`, `profile.present` and `profile.full`                                                                                                                                                                                                    |
| Settings          | `setting.<path>` and `setting.<path>=<value>` for an on/off or choice setting an agent may also change as configuration                                                                                                                                  |
| Custom actions    | `custom.<id>` for a built-in command, a recipe, or a sequence of built-in command IDs without arguments and without Trash                                                                                                                                |

`parent-plane` and `view-open-plane` are refused; use `propose_focus_plane`. A custom action changed
after review fails with
`The action changed after it was reviewed. Ask the agent for a new proposal.`

### Configuration an agent may change

`propose_config` and `setting.` commands accept only these paths and anything below them:
`settings.appearance`, `settings.browsing.mode`, `sort`, `descending`, `group`, `columnWidth`,
`density`, `foldersFirst`, `showHidden`, `newPlaneLocation`, `newPlanePath`,
`emptyWorkspaceLocation` and `emptyWorkspacePath`, `settings.folders`, `settings.previews`,
`settings.recipes`, `settings.savedSearches` and `ui`.

A patch is `{ "path": "settings.browsing.mode", "value": "columns" }`. Use `keys` (up to 10) for a
key that contains dots, such as a folder path:
`{ "path": "", "keys": ["settings", "folders", "/absolute/path"], "value": { "mode": "list" } }`.

## Limits and errors

### Limits

| Limit                               | Value                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| One request                         | 65,536 bytes on one line                                                         |
| One reply                           | 8,000,000 bytes; a larger reply closes the connection                            |
| Result size                         | **Maximum returned content**: 1 to 64 MiB, default 4; shared: 4 MiB              |
| Concurrent requests per client      | **Concurrent requests and pending recipe tasks**: 1 to 20, default 4; shared: 20 |
| Order                               | One connection's requests are answered one at a time, in order                   |
| Waiting replies per `--mcp` process | 100                                                                              |
| Time per request                    | 120 seconds                                                                      |
| Proposals waiting for review        | 100 across all clients                                                           |
| Pending task proposals              | 100; a prepared task expires after 5 minutes                                     |
| Task areas per workspace            | 50                                                                               |
| Path                                | 32,768 characters                                                                |
| Concurrent Git reads                | 8                                                                                |
| Activity                            | The last 1,000 calls are kept; **Activity** shows 50                             |

### Protocol

The `--mcp` process speaks newline-delimited JSON-RPC 2.0 on standard input and output.

| Method            | Reply                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `initialize`      | `protocolVersion` echoes `2026-07-28`, `2025-11-25` or `2025-06-18`; any other version gets `2025-11-25`. `serverInfo.name` is `viewer` |
| `tools/list`      | Every tool on this page with its input JSON Schema                                                                                      |
| `tools/call`      | `{ "content": [{ "type": "text", "text": "<JSON result>" }] }`                                                                          |
| `ping`            | `{}`                                                                                                                                    |
| `notifications/…` | No reply                                                                                                                                |
| Anything else     | Error `Unsupported MCP method.`                                                                                                         |

Tool failures come back as JSON-RPC errors, not as results. Code `-32700` is invalid JSON, `-32600`
an invalid request or one over 65,536 bytes, and `-32603` everything else, with Viewer's message.

### Errors

The `--mcp` process prints these on standard error and exits with status 1:

| Message                                                                                                | Meaning                                 |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| `Set VIEWER_AGENT_TOKEN to the token shown in Viewer Settings.`                                        | The client configuration has no token   |
| `Viewer’s agent connection is unavailable. Open Viewer and approve agent access in Settings → Agents.` | Agent access was never turned on        |
| A connection error naming a socket                                                                     | Viewer is not running, or access is off |

Calls fail with these:

| Message                                                                                                 | Meaning                                                                 |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `Agent access is disabled or its token is invalid.`                                                     | Access is off, or the token was replaced or revoked                     |
| `This file is outside the agent’s authorized folders.`                                                  | Outside the folders, missing or denied                                  |
| `This agent client has no … capability.`                                                                | Turn the capability on under **Permissions**                            |
| `The shared connection has no … capability. Allow it in Settings → Agents.`                             | Turn it on under **What the connection may do**                         |
| `Use a named client with content permission.`                                                           | A content tool called through the shared connection                     |
| `Focus a granted folder plane in Viewer first.` or `Open a workspace in Viewer first.`                  | The person's active plane is not in the folders                         |
| `Command is unavailable in the captured context.`                                                       | The ID is not in the current `list_commands`                            |
| `Agents cannot propose “…”. Ask the person to run it themselves.`                                       | The command is not on the agent list                                    |
| `Selection changed. Ask the agent for a new proposal.`                                                  | A file changed identity before the proposal ran                         |
| `The source changed. Read it again.`                                                                    | The file changed while it was read                                      |
| `Agent permissions changed while this request was running. Try again.`                                  | Access, folders or capabilities changed during the call                 |
| `This client has reached its concurrent request budget.`                                                | Too many calls at once                                                  |
| `Review or stop a task before starting another.`                                                        | The client's recipe tasks fill its budget                               |
| `The result exceeds this client’s read budget. Narrow the request or review its budget in Settings.`    | Ask for less, or raise **Maximum returned content**                     |
| `Review pending proposals before submitting another.`                                                   | 100 proposals are waiting                                               |
| `Proposal belongs to another actor.`                                                                    | The ID is another client's                                              |
| `Allow agents to send this data to the provider in Settings → Models before an agent runs this action.` | The model's agent permission is off                                     |
| `Viewer request timed out.`                                                                             | No reply within 120 seconds                                             |
| `Viewer disconnected. Reconnect to the running app.`                                                    | Viewer quit, access was turned off, or a reply was over 8,000,000 bytes |

## Report a session

Tasks can show a session an agent reports. `report_session` uses the client's identity and a granted
folder. It does not start an agent, open a plane or grant access.

```json
{
  "sessionID": "homepage-review",
  "directory": "/work/project",
  "title": "Review homepage change",
  "sequence": 1,
  "status": "waiting",
  "entries": [
    {
      "id": "message-1",
      "role": "assistant",
      "text": "The change is ready to review.",
      "links": [{ "kind": "file", "path": "/work/project/index.html", "line": 12 }]
    }
  ]
}
```

| Field       | Rule                                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `sessionID` | 1 to 128 characters, private to the client                                                                                          |
| `directory` | An ordinary granted folder, not a link. The session stays bound to it                                                               |
| `title`     | 1 to 200 characters                                                                                                                 |
| `sequence`  | A positive integer that grows with each report. Repeating the last report unchanged is accepted                                     |
| `status`    | `working`, `waiting`, `done` or `failed`; shown as **Reported** with the time                                                       |
| `entries`   | Up to 8 per report. `id` 1 to 128 characters, `role` `user`, `assistant` or `tool`, `text` up to 8,000 characters, up to 16 `links` |
| `links`     | `kind` `file` or `git-diff`, a granted absolute `path`, optional `line`                                                             |

A report is at most 48 KB. An entry ID cannot be rewritten; new IDs are appended. Viewer keeps up to
100 sessions, 500 entries each and 8 MiB in all. Links open the checkout as it is now, not a saved
patch. Report only text the person may read: no credentials and no hidden reasoning. Revoking a
client blocks new reports and keeps the saved ones.

## Add a model

Models are added in **Settings → Models**; [Add a model](../guides/automate.md#add-a-model) has the
steps.

| Label                                                 | What it does                                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Add model**, then **Set up model**                  | Adds a provider: OpenAI, Anthropic, z.ai, DeepSeek, Qwen, Gemini, OpenRouter or **Local endpoint** |
| **Default for Ask Viewer**                            | The model that answers requests in words                                                           |
| **Data access**                                       | What the provider may receive                                                                      |
| **Allow selected data**                               | Approves the chosen level                                                                          |
| **Revoke access**                                     | Withdraws it                                                                                       |
| **Allow agent-started actions to send the same data** | Lets `ask_in_words`, agent recipes and agent workflows use the model                               |

| Level       | Label in **Data access**                            |
| ----------- | --------------------------------------------------- |
| `names`     | **filenames and file metadata**                     |
| `excerpts`  | **filenames, metadata and document excerpts**       |
| `full-text` | **filenames, metadata and extracted document text** |

A named cloud provider uses its own endpoint; Qwen accepts its regional and workspace endpoints.
**Local endpoint** accepts HTTPS, or HTTP to `localhost`, `127.0.0.1` or `[::1]`. Changing the
endpoint or clearing the key revokes data access and stops running requests. The model's data
permission, an agent's capabilities and macOS folder access are three separate approvals.

## For an agent reading this

1. Call `initialize`, then `tools/list`: its schemas are exact.
2. Call `get_context` and `list_planes` to see where the person is. `list_commands` gives the
   command IDs for that place; never infer an ID from a label.
3. After a proposal, poll `get_proposal` until it is final, then read the context again. A reviewed
   change can move or rename files.
4. Expect a refusal for anything in [What an agent cannot do](#what-an-agent-cannot-do), and tell
   the person what they can do instead.

| To learn                                     | Read                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| Every command and where it lives             | [Features and where to find them](capabilities.md) and `list_commands` |
| The words Viewer uses                        | [Terms](terms.md)                                                      |
| How copies, moves, the Trash and Undo behave | [File operations](file-operations.md)                                  |
| Settings, defaults and ranges                | [Configuration](configuration.md); `read_config` for current values    |
| The query syntax of `search_files`           | [Search](search.md)                                                    |
| The workflow file format                     | [Workflows and watch rules](automation.md)                             |
| The same tools from a shell                  | [Terminal CLI](cli.md)                                                 |

**Related:** [Make repeated work a command](../guides/automate.md#connect-an-agent) ·
[Terminal CLI](cli.md) · [Custom actions](actions.md) · [Tasks and Git](tasks-and-git.md) ·
[Terminals](terminals.md) · [Private agent authority](../adr/0002-private-agent-authority-v2.md)
