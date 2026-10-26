# Agent session navigation

October 26, 2026. Tasks can attach existing Viewer conversations and explicit
session reports from authenticated local agents. Open **Agent sessions…** from
Commands, or choose **Attach conversation…** in a task. Closing a conversation
plane retains its task reference. Reopening restores its transcript without
starting an agent or replaying terminal input.

Viewer's own inspected-context messages have buttons to open their current
source as a linked plane. External reports can attach current file/line or Git
diff references to each message. Diff links compare the current checkout with
HEAD; they do not claim to preserve a historical patch.

## Adapter protocol

An agent connected through Viewer's existing local MCP service can call
`report_session`. This uses its authenticated client ID, metadata capability
and authorized folders. The report does not open anything automatically or
change the client's permissions. Example tool arguments:

```json
{
  "sessionID": "parser-task-1",
  "directory": "/absolute/path/to/worktree",
  "title": "Review parser change",
  "sequence": 1,
  "status": "waiting",
  "entries": [
    {
      "id": "message-1",
      "role": "assistant",
      "text": "The parser change is ready for review.",
      "links": [
        { "kind": "file", "path": "/absolute/path/to/worktree/src/parser.ts", "line": 42 },
        { "kind": "git-diff", "path": "/absolute/path/to/worktree/src/parser.ts" }
      ]
    }
  ]
}
```

Supported statuses are `working`, `waiting`, `done` and `failed`. The UI always
labels them **Reported** and shows the report timestamp and sequence. A silent
adapter never becomes Done by inference. Terminal text, CLI transcript files,
elapsed time and a restored window are not status sources.

Session IDs are namespaced by authenticated client. Sequence numbers increase
on every update; replaying an identical last report is idempotent. Existing
message IDs are immutable. Append new IDs or reference the same unchanged
message. A session stays bound to its canonical checkout path and filesystem
identity. Changing checkout requires a new session ID. Every referenced path
is checked against the client's live grants. Only user-visible text should be
reported; do not send credentials or hidden reasoning.

Each call is limited to eight entries and 48 KB; an entry has at most 8,000 text
characters and 16 references. A session supports 500 messages; the private
registry supports 100 sessions and 8 MiB total. Reports and transcripts remain
in the private application profile, outside exported workspace projects.
Revoking access prevents further reports; the user's already saved transcript
remains available to inspect.

Codex or Claude can use this protocol through the existing MCP connection.
Automatic provider-specific transcript import, resuming a CLI session from its
transcript and sending input to an agent are not implemented. Those require
adapters with explicit lifecycle and consent behavior.
