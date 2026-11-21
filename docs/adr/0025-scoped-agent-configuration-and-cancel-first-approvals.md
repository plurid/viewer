# Scoped agent configuration and Cancel-first approval dialogs

Status: accepted. Date: 2026-11-21.

## Context

Viewer's editable configuration holds folder paths for browsing defaults, search roots, exclusions,
saved searches, layouts, profiles, custom actions and terminal executables. Returning unfiltered
settings to an agent would leak private paths outside the client's grants. In addition, focusing the
approve button when a review dialog opens risks approving agent or model work with a stray Return
press. The owner decided that agents see configuration only inside their granted folders and that
approval dialogs for agent or model work open on Cancel.

## Decision

`AgentBroker.scopedConfiguration` (`src/desktop/agents/agent-broker.ts`) strips credentials and
filters every path field for `read_config`, `validate_config` and `propose_config` against the
client's canonical granted roots. Viewer's private data folder and symbolic links escaping a granted
root are always excluded. Outside-grant paths are omitted or replaced with `[redacted]`, and
`validate_config` substitutes opaque placeholders for hidden custom paths so schema validation runs
without disclosing them.

Native confirmations for agent proposals (`confirmAgentProposal` in
`src/desktop/native/native-confirmation.ts`) place Cancel at index `0` with `defaultId: 0` and
`cancelId: 0`. Renderer dialogs that approve agent or model work put `data-autofocus` on **Reject**,
**Cancel** or **Discard**: `AgentReview` (`src/renderer/actions/AgentReview.tsx`),
`OperationReviewControls` (`src/renderer/ui/operations/OperationReview.tsx`) and `ActionHub`
(`src/renderer/actions/ActionHub.tsx`). `Dialog` (`src/renderer/ui/primitives.tsx`) honors
`data-autofocus` before falling back to a primary button.

## Consequences

Agents can inspect and validate configuration without discovering paths outside their granted
folders, and pressing Return as an agent or model approval dialog appears declines the work instead
of running it. Any new review dialog for agent or model work must keep Cancel, Reject or Discard as
its initial focus.

See [Agents reference](../reference/agents.md).
