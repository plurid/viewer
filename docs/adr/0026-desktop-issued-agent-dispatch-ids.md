# Desktop-issued per-request agent dispatch IDs

Status: accepted. Date: 2026-11-21.

## Context

Marking an entire window as agent-driven while an agent command was pending caused two problems: a
person's own actions in that window (such as saving a note or invoking a menu command) could be
blocked as agent-driven, while a late renderer IPC call could lose its agent attribution. The owner
decided to replace the window-wide lock with per-request IDs issued by the desktop.

## Decision

When the desktop sends an `agent-command` or `agent-task` event to a workspace window
(`Desktop.dispatchAgentEvent` in `src/desktop/bridge.ts`), it generates a random UUID, records the
`(id, webContents.id)` pair in `issuedDispatches` (bounded to 1,000 entries) and sends the ID with a
24-second deadline.

The renderer echoes that ID only for synchronous IPC calls started inside `withAgentDispatch`
(`src/renderer/app/agent-dispatch.ts`), propagated through command, navigation and task paths
(`src/renderer/App.tsx`, `src/renderer/workspace/agent-navigation.ts`,
`src/renderer/commands/registry.ts`, `src/renderer/commands/folder.ts`,
`src/renderer/commands/programs.ts`, `src/renderer/command-line/run.ts`) via `window.viewerDispatch`
in `src/preload.ts`.

On every `viewer:request`, `Desktop.call` (`src/desktop/bridge.ts`) checks that any supplied
dispatch ID was issued for that `senderID`, rejects unknown or cross-window IDs, and runs the
handler inside an `AsyncLocalStorage` context (`requestDispatch`). `isAgentDriven` reads that
per-request context. The window-level `hasPendingAgentCommand` remains only for the Start panel's
Run notice.

## Consequences

A person's own actions in a window are never attributed to a pending agent command, and agent
requests stay attributed to the agent across asynchronous desktop work. A renderer cannot forge or
reuse another window's dispatch ID.

See [Private agent authority](0002-private-agent-authority-v2.md) and
[Defined workspaces and explicit command starts](0020-defined-workspaces.md).
