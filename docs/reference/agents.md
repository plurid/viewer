# Models, agents and reported sessions

These integrations are optional. Browsing, previews and built-in local tools do not require a model
account.

## Configure a model

Add a provider in **Settings → Models**. Choose the appropriate endpoint, model and private
credential. Different endpoints and tasks can require different capabilities, including structured
output. An unsupported request fails without applying file changes.

Provider data permission is separate from the credential. Requests in words use the command context
and permitted names, not file contents. Content-based recipes need their own permitted data level.
Revoke data permission in Settings.

## Connect a local agent

Settings → Agents manages local service consent, named clients, capability/folder scopes and
terminal-output read grants. Effective grants stay private; editable JSONC cannot turn them on.
Native file access and model permission remain separate.

An authenticated client discovers contextual commands and can submit supported proposals. Captured
origins, destinations, canonical folder scope and file identity are checked again after review.
Changed context fails instead of targeting a new selection. Exact agent removals always need fresh
scope approval and OS Trash. Opaque shell/executable routes and terminal input remain unavailable to
agents.

## Navigation tools

| Tool                       | Purpose                                        |
| -------------------------- | ---------------------------------------------- |
| `list_workspaces`          | Discover accessible workspace IDs/names        |
| `list_planes`              | Inspect granted views in a workspace           |
| `propose_open_path`        | Request current, root or linked opening        |
| `propose_selection`        | Request exact selection in the captured folder |
| `propose_focus_plane`      | Return to an explicitly granted view           |
| `propose_workspace_switch` | Request a uniquely identified workspace        |

Wait for review/completion and refresh discovery between steps. A partly visible workspace does not
imply every destination plane is granted. Trash browsing and Empty Trash are not MCP tools.

## File, development and setup tools

The [terminal CLI](cli.md) uses this same authenticated connection. `tools/list` returns exact
schemas; the CLI reference lists the corresponding terminal commands.

- `git_status` and `git_diff` read a granted checkout. Patch content requires a named content
  client.
- `list_task_areas` returns only names and checkout metadata for granted folders.
- `read_workflow`, `run_workflow`, `list_workflows`, `get_workflow`, `resume_workflow` and
  `cancel_workflow` use existing typed workflow services. Runs belong to their client and check
  current folder/content/proposal authority as they advance. Mutation steps prepare separate
  reviews.
- `ask_in_words` returns a checked command proposal using agent-specific model permission.
- `speech_models` and `speech_status` inspect managed weights without recording or networking.
  `propose_speech_install`, `propose_speech_import` and `propose_speech_use` prepare native-reviewed
  pinned model setup; they install no executable and do not enable speech recognition.
- `cancel_proposal` stops only the caller's pending or running proposal. It does not remove evidence
  or undo completed file output.

`search_files` accepts explicit `content: false` for filename-only search. `content: true` requires
a named content client and returns original-match evidence only for granted returned paths.

## Report a session

Tasks can attach Viewer conversations and explicit reports from an authenticated agent adapter.
`report_session` uses the client's identity and authorized folder. It does not start an agent, open
a view or grant new access.

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

Replace example paths with actual granted absolute paths. Status is `working`, `waiting`, `done` or
`failed`; the UI labels it **Reported** with sequence/time. Terminal output and elapsed time are not
status signals. File/diff links inspect current checkout content, not a preserved historical patch.

Session IDs are client-namespaced; sequence increases on updates and unchanged last reports are
idempotent. Existing message IDs are immutable. A session remains bound to its checkout identity.
Each call allows eight entries/48 KB; an entry allows 8,000 text characters and 16 references.
Private limits are 500 messages per session, 100 sessions and 8 MiB total.

Reports contain user-visible text, not credentials or hidden reasoning. Revocation blocks new
reports while retaining the user's saved transcript. Automatic Codex/Claude transcript import and
CLI resumption are still proposed work.

See [actions](actions.md), [tasks](tasks-and-git.md) and the
[private authority decision](../adr/0002-private-agent-authority-v2.md).
