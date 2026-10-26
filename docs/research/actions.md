# Composable tools

Current custom actions already support palette folders, conditions, parameters and ordered
composition. [The action reference](../reference/actions.md) explains those paths. The ideas below
extend them.

## Treat outputs as useful objects

An action could produce a typed selection, table, file proposal, artifact or inspection result that
another tool understands. This differs from sequencing commands or treating a shell's stdout as an
unvalidated instruction stream.

Useful examples include inspect → filter → compare, select → convert → review, and a model returning
a validated file proposal with source evidence. A structured response still needs validation and
review for its consequences.

## Build a sequence visually

Expose inputs, steps, dependencies, results and failed-step recovery without requiring every user to
write JSONC. Parameter forms can explain types and defaults. Folder-specific tools should remain
discoverable beside global actions.

Keep one definition reachable through the palette, menu, shortcut, button or supported agent
proposal. Avoid parallel copies of execution/permission policy.

## Connect results to the workspace

Open outputs beside their sources and retain provenance, run identity and actual outcomes. Journal
can correlate activity while operation/command receipts retain authority. Saving a command is
different from executing it, and restoring a run view is different from replaying its steps.

An action builder should make a useful small tool easy to create before exposing branching, typed
data flow or agent coordination. Existing shell actions remain ordinary OS programs with their own
permissions and explicit trust.
