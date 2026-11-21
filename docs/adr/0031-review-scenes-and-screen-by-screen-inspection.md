# Review scenes and screen-by-screen inspection before handover

Status: accepted. Date: 2026-11-21.

## Context

Unit tests and jsdom component tests verify logic without real font metrics, scroll bar tracks,
narrow column widths or native macOS rendering. Visual regressions such as wrapped labels, clipped
controls, layout shifts on selection and exposed home paths passed automated tests and reached the
owner. The owner decided that every interface change must add or update its review scenes and that a
build must be inspected screen by screen before it reaches the owner.

## Decision

Every interface change adds or updates the review scenes covering its screens under
`tools/review/scenes/`, registered in `tools/review/scenes/index.ts`. `pnpm review`
(`tools/review/main.ts`) launches the packaged binary in the hidden QA runtime
(`VIEWER_RENDER_TEST=1`, `VIEWER_BACKGROUND_TEST=1`, isolated `VIEWER_DATA_DIRECTORY`;
`backgroundTest` in `src/main.ts`, `qaRuntime` in `src/desktop/bridge.ts`), captures each scene in
narrow and wide sizes across light and dark appearance (plus scene-specific choices such as long
file names), runs automatic layout and wording checks (`tools/review/checks.ts`) and writes an
interactive HTML review sheet (`tools/review/report.ts` with `tools/review/sheet-script.ts`) under
`out/review/<run>/index.html`.

Before any build is handed to the owner, the person or coordinating agent looks at every changed
capture on the review sheet against its `mustBeTrue` statements and `DESIGN.md`, fixes defects,
re-runs the affected scenes and accepts the updated baseline (`pnpm review --accept-run <run>`).
When implementation is delegated to other agents, visual verification stays the coordinating agent's
responsibility. Interface work that has not been looked at in the packaged app must be reported as
not yet seen.

## Consequences

Visual defects, wording regressions and layout shifts are caught against the real packaged app in
hidden windows without disturbing the operator's screen. Maintaining review scenes is part of every
interface change, and passing unit tests alone is no longer sufficient to hand over interface work.

See [Review every screen](../development/review.md) and
[Look at every changed screen](../development/testing.md#look-at-every-changed-screen).
