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
