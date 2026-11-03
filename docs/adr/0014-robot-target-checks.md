# Robot target checks

Superseded by [generated tool ownership](0015-generated-tool-host.md).

Status: accepted.

## Context

An agent-generated workbench can propose joint positions, but its HTML must not certify its own
calculations. A remembered pass must not survive changes to the target, model, tool point or base.
The existing canvas owns saved inputs, source snapshots, revision checks and portable exports.

## Decision

Add a position-only solver to the offline robot module. It uses bounded damped least squares,
deterministic restarts and explicit cancellation. The Jacobian update follows the formulation in
[Buss, section 5](https://people.csail.mit.edu/jbarry/spring2011PR2/readings/jactrans.pdf). Joint
limits constrain candidate generation. An unsuccessful search remains unresolved; it is not an
unreachability proof.

Store a task as one canvas state value: explicit units, tool link and local point, base transform,
position tolerance, world targets and complete candidate joint positions. The desktop checker
propagates points from the tool toward the root using independent rotation code, without importing
the solver or its matrix transforms. Stored SciPy poses and analytic chains test both calculations.

A frame requests a check by bound source ID and state key. The host flushes pending inputs and the
desktop verifies the saved task. A check stores only its source hash, task hash, content revision,
checker version and time. Viewer recomputes results for display, restart and import. Changes to the
bound data invalidate the check. Camera changes do not invalidate a task they do not alter.

Check details and checked JSON export belong to Viewer controls outside the iframe. The desktop
constructs the exported report and checks revisions and the selected binding after save review. The
existing new-file save preserves originals. Generic canvas exports do not become trusted robot
reports merely because they contain similarly named fields.

Base comparisons resolve the existing quoted fork and recompute both checks. They require identical
model snapshots, world targets, target order, tool point and tolerance. Only base placement and
candidate joints vary. The comparison panel observes changes to either canvas, and saving validates
both tasks again after destination review. No comparison success flag is persisted.

The offline replay helper interpolates copied joint positions. Generated controls own the clock and
keep display samples separate from saved candidates. Literal joint interpolation preserves explicit
rotations and out-of-limit values. Playback is visual inspection, not trajectory verification.

## Scope

Verification covers the supplied endpoint positions and hard joint limits. It does not cover
orientation, intervals between poses, collision, dynamics, physical actuation or calibration.
Exactly one complete candidate pose must accompany every target. An incomplete task is rejected. The
reference owns [schemas, budgets and APIs](0015-generated-tool-host.md).

## Consequences

Portable work retains its checked inputs without trusting a stored success flag. Numerical errors
can still exist in either implementation; independently generated reference poses remain required.
The local workbench fixture proves the integration, not live model generation or the completed film.
