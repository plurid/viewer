# Generated tools own application logic

Status: accepted. Supersedes [robot snapshots](0013-robot-model-snapshots.md) and
[robot target checks](0014-robot-target-checks.md).

## Decision

Viewer hosts tools created for a request. The generated artifact contains its interface and the
logic that makes it work: parsing, calculations, transformations, validation and tests. A robotics
request must generate its solver and checker. Viewer must not supply those behind a generated page.

The host supplies domain-neutral scaffolding, bounded context snapshots, local assets, an isolated
browser runtime, shared action invocation, saved inputs, content revisions and reviewed exports.
Generic graphics libraries are explicit runtime dependencies. Model prompts describe this contract
without prescribing an installed domain application.

Use the existing canvas document and service as the plugin lifecycle. A tool remains linked to its
conversation. A tool library plane lists these documents and supports opening, naming, disabling and
duplicating them. Disabling is enforced in the desktop service and invalidates the frame's actions.
A duplicate has its own conversation and input state. Source and asset snapshots remain immutable.

The host checks input schemas, captured revisions, ownership, execution limits and persistence. A
completed action proves execution. Plugin-authored checks report their own conclusions and do not
become independent verification by running through Viewer. External qualification may compare their
outputs against separate test fixtures.

## Consequences

The app no longer injects a robotics module or exposes robot-check operations to the agent or
sandbox. Source capture retains bounded text for the generated tool to interpret. Batch asset
attachment takes an explicit list of authorized paths and knows nothing about robot mesh structure.

The earlier station recording cannot establish that Meta generated its domain algorithms. New
qualification must retain the model response, exact generated artifact and observed action results.
The film should show creation and a visible operation in several domains using this same host.
Image, video and CAD examples require their own working artifacts before they appear as product
claims.

[Tool guide](../guides/canvases.md) · [Runtime contract](../reference/canvases.md)
