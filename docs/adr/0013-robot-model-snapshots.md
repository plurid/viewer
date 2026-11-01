# Robot semantics belong to source snapshots

## Decision

The canvas source owner parses a complete URDF into a bounded, validated joint tree before the model
or generated page uses it. `domain/robotics` owns that schema, the URDF subset and pure forward
kinematics. The original source version, snapshot hash and exact joint-definition ranges travel with
the canvas's existing content revisions. A truncated text excerpt can coexist with a complete joint
tree; a truncated URDF cannot produce that tree.

Generated HTML imports the bundled `viewer/robotics` module to compute link transforms. This module
has no I/O or authority. It requires every movable joint value and reports hard position-limit
violations without clamping. It is not an independent result checker or a reachability solver.

`desktop/canvases/robot.ts` resolves relative binary STL references inside the model folder. The
conversation authorizes every companion under its existing scope and provider data permission.
Attaching a URDF alone grants no access to sibling meshes. Package URLs, external paths and linked
resources are refused. Meshes use the existing immutable canvas asset store and portable exports.

The page can request review of a joint by source ID and joint name. The host selects the stored
definition and offers **Open joint definition**. The page cannot supply a path or arbitrary evidence
anchor. Portable copies retain definitions but have no authority to open the original files.

## Consequences

The agent creates the controls and their layout using a shared motion capability. Source versions,
saved inputs, branching, Undo and exports keep their existing owners. No robot-specific workspace or
second persistence service is introduced.

Unsupported joint types, mimic joints, malformed trees and missing hard limits fail explicitly.
Calibration, dynamics, collision and physical safety are outside the implementation. A generated
page's success message is not trusted verification. The
[target-check decision](0014-robot-target-checks.md) extends this foundation with bounded position
solving and independent endpoint checks. Motion intervals and collisions remain unchecked.

## Owners

Model semantics: `domain/robotics`. Source capture and mesh attachment: `desktop/canvases`.
Conversation authority: `desktop/chat`. Bundled module: `tools/canvas-libraries.ts`. Source review:
`renderer/canvases`. Existing canvas documents own persistence.

[Canvas reference](../reference/canvases.md) · [Implementation audit](../research/workshop.md)
