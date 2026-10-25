# 0005: Keep framing intent through scheduler delays and resize

Accepted: October 25, 2026.

## Context

A framing request needs several delivered animation frames to measure stable
engine layout. Its former 1.5-second wall-clock deadline could expire while a
busy renderer was unable to perform those measurements, silently leaving the
requested plane offscreen. Stable idle geometry in a native test did not prove
that the framing request had completed.

The last completed placement also retained resize ownership while a newer
explicit request waited for layout. A resize could therefore supersede that
request with the preceding plane target.

## Decision

`renderer/workspace/framing.ts` relinquishes the previous resize owner as soon as
a new framing request starts. That request observes current viewport and node
geometry; intervening resize notifications cannot restore an older destination.
Only the current generation's completed placement can claim future resize refits.

Readiness is bounded by 90 delivered measurement frames, including recovery
attempts, rather than elapsed wall time. A scheduler pause spends no measurements.
The request still requires stable engine dimensions, matching DOM boxes and the
current viewport. Pointer/wheel input, camera gestures, superseding requests and
detached engines/surfaces retain their cancellation behavior.

The engine still owns camera projection and transitions. No second camera model,
forced scroll reset or increasing wall-clock timeout is introduced.

## Consequences

An overloaded or hidden renderer can resume the original intent when frames are
delivered again. Missing or unopenable targets remain bounded and cannot revive
an obsolete resize destination. Independent engines retain independent ownership.

Native checks wait for the requested result inside the live viewport as well as
stable idle geometry. A controlled pause after the real Frame plane command
reproduces the old failure without relying on incidental machine load.

Evidence: `workspace-framing.test.ts`, `tests/native/git-actions.ts` scheduling
stress and the candidate-specific verification ledger.
