# Agent navigation

Enable MCP in Settings → Agents and grant the folders the client needs. Use the generated client configuration with the running Viewer instance. Native macOS folder access and agent folder scope are separate; these tools never open an access picker or acquire either permission.

Navigation uses the same workspace records, folder sessions and plane controller as the interface. Each `propose_*` call returns an `id` and `requiresUserReview`. With the shared token it is `true`: the user approves or rejects the request in Viewer. A named client with the navigation capability navigates within its own folder scope without review and receives `false`; the same origin, identity and scope checks apply. Poll `get_proposal` for `review`, `running`, `completed`, `rejected` or `failed`; submission alone does not mean the action ran. Executor/terminal grants do not authorize unattended navigation. `settings.agents.allowLayout` remains reserved.

| Tool                       | Arguments                                                                     | Result or behavior                                                                                                                                                                                                                               |
| -------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list_workspaces`          | `{}`                                                                          | Live workspace IDs/names, active flag, granted planes and their root IDs. Inaccessible paths, global searches, history and arrangement are omitted. Empty workspaces remain discoverable.                                                        |
| `list_planes`              | `{ "workspaceID"?: "…" }`                                                     | Granted planes in the named workspace, or the active workspace when omitted. IDs, types, paths and folder view modes are returned.                                                                                                               |
| `propose_open_path`        | `{ "path": "/absolute/path", "placement"?: "current" \| "root" \| "linked" }` | `current` navigates the captured folder or opens a linked file preview. `root` creates an independent plane. `linked` opens a child of the captured plane. In an empty workspace, current/root creates its first root; linked requires a parent. |
| `propose_selection`        | `{ "paths": ["/absolute/path", "…"] }`                                        | Selects exact files/folders in the captured directory or active column. Paths are deduplicated; `[]` clears selection. At most 2,000 paths, within the transport size limit.                                                                     |
| `propose_focus_plane`      | `{ "paneID": "…" }`                                                           | Focuses a granted existing plane in the active workspace. Use this to return from a preview to its folder before selecting other files.                                                                                                          |
| `propose_workspace_switch` | `{ "workspaceID": "…" }` or `{ "name": "…" }`                                 | Switches to a workspace whose planes are all granted. Names must match exactly and uniquely, with Unicode normalization. Use IDs when names repeat.                                                                                              |

For example, discover the workspace, switch to it, focus the appropriate folder, open a subfolder and select its files. Wait for approval/completion and refresh discovery or `list_commands` between steps. The live contextual catalog is published after UI updates; requests tied to an obsolete context fail instead of silently targeting another folder.

```json
{"name":"propose_workspace_switch","arguments":{"name":"Engineering"}}
{"name":"propose_focus_plane","arguments":{"paneID":"folder-plane-id"}}
{"name":"propose_open_path","arguments":{"path":"/Users/you/Documents/Engineering/DXF","placement":"current"}}
{"name":"propose_selection","arguments":{"paths":["/Users/you/Documents/Engineering/DXF/panel.dxf"]}}
```

These are `tools/call` parameter examples, with placeholder paths and IDs. They do not supply an authentication token or bypass review. A file opened as a root has independent ownership; a linked preview retains its parent. Focus and current-folder navigation preserve docking through the existing controller.

The user interface also offers Back to parent plane, source-row link markers and View open plane. Generic `parent-plane` and `view-open-plane` agent commands and their custom-action aliases are blocked: use `propose_focus_plane` with an explicitly granted destination instead. Trash browsing has no MCP tool. Empty Trash/Recycle Bin is never a command or API operation; its native menu selection and confirmation belong only to the user.

Folder/root ownership and active column are checked again before applying a request. Selection checks all file identities before publishing any selection. Switching/focusing verifies the destination plane IDs, types and paths still match the reviewed snapshot. Removed or changed origins/destinations fail. Native access, canonical agent scope and Agents-enabled status are rechecked after review. Symbolic links cannot escape the granted roots. A partly visible workspace may appear in discovery, but switching to it requires every destination plane to be granted.

Clients sharing the shared token share its folder scope. A named client (Settings → Agents) has its own roots, capabilities and budgets. See [actions.md](actions.md) for MCP setup, command/configuration proposals and terminal capabilities.

`tests/native-agent-navigation.ts` verifies the actual packaged stdio client and rendered approval/rejection controls with a hidden owned app, private profile and generated files. It covers selection, independent/linked previews, plane focus, workspace switching and creation from an empty workspace. It does not constitute signed Store or physical third-party-client acceptance.
