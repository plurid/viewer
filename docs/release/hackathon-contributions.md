# Hackathon contribution inventory

Use this inventory to prepare the final contribution receipt. The owner supplied **27 October 2026**
as the development start date. The comparison below uses the last committed state before midnight at
the start of that date in Europe/Bucharest (`2026-10-27T00:00:00+02:00`). This is the development
baseline for attribution; organizer eligibility and contributor credits still need final review.
Keep run-specific test counts, model usage and artifact paths in the retained evaluation report.

## Source baseline

| Repository | Last revision before the start date        | Reviewed revision |
| ---------- | ------------------------------------------ | ----------------- |
| Viewer     | `c8c973f82f9473a3b8819f61e2b5edfb9466e6cf` | `7c972f5b`        |
| Plurid     | `9929887f90e6635552097f8a0466261ce92fc5c1` | `a27510396`       |

The Viewer baseline was committed on 26 October; the Plurid baseline on 23 October. Reproduce each
selection in its repository with `git rev-list -1 --before=2026-10-27T00:00:00+02:00 HEAD`, then
compare that revision with the reviewed source. Refresh the reviewed revision or attach the final
patch before submission. Commit history establishes what changed between repository states; it does
not establish the exact time every line was written.

## Existing foundation

Before the baseline, Viewer already provided a desktop file workspace, previews, commands, settings,
model configuration, permission checks, native file operations, persistent planes and ordinary
conversations. Plurid already provided the spatial engine, linked planes and camera navigation.
Introduce both as existing projects in the film.

Generated conversation canvases and exact quote branches were absent from the Viewer baseline. Their
first committed implementation is `4cee7ad0`, on 1 November. Ordinary chat predates the hackathon;
the ability to generate a tool and branch it from a selected passage belongs in the post-baseline
changes.

## Implemented candidate contributions

These are additions or extensions relative to the Viewer baseline. The source boundaries identify
the implementation; the film and retained verification establish which behaviors were exercised.
Existing provider adapters, conversation storage and file services are supporting foundations, even
where a row extends them.

| Area                           | Concrete behavior                                                                                                                    | Primary source boundary                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Conversation canvases          | Generated selectable HTML in an isolated plane; content revisions separate from saved input state                                    | `src/domain/canvases`, `src/desktop/canvases`, `src/renderer/canvases`                                 |
| Quote branches                 | Exact quoted range and frozen conversation context; independent canvas; conflict-aware application to the original                   | `src/domain/models/chat.ts`, `src/desktop/chat`, `src/renderer/chat`                                   |
| File-backed tools              | Bound inspection snapshots with hashes and coverage; explicit refresh; portable data without source-file authority                   | `src/desktop/canvases/sources.ts`, `src/domain/canvases/sources.ts`, `CanvasSources.tsx`               |
| Reviewed results               | CSV, JSON, Markdown, text and cutting DXF review; content/state revision checks; exclusive new-file save; open the saved result      | `src/domain/canvases/results.ts`, `src/desktop/canvases/service.ts`, `ResultReview.tsx`                |
| Runtime feedback               | Revision-bound loading/error observations and one bounded repair attempt                                                             | `src/desktop/canvases/observations.ts`, `src/desktop/chat/service.ts`                                  |
| Meta tool protocol             | Paired assistant calls and actual tool results; validated single-step arguments and final replies                                    | `src/desktop/models/providers.ts`, `src/desktop/chat/service.ts`                                       |
| Entry point                    | **Build tool from selection** opens a contextual draft without sending it automatically                                              | `src/renderer/commands/window-commands/comparison.ts`                                                  |
| Supplier regression            | Fictional request/quotes with known arithmetic; retained live responses; native replay and result/restart checks                     | `tools/canvases`, `tests/native/canvas-live.ts`, `tests/native/canvas-productivity.ts`                 |
| Robot sources and motion       | Bounded URDF joint tree, scoped STL meshes, exact source definitions, articulated motion and bounded target solving                  | `src/domain/robotics`, `src/desktop/canvases/robot.ts`, `src/desktop/canvases/sources.ts`              |
| Independent robot checks       | Endpoint positions and hard joint limits checked outside generated HTML; version-bound results and fixed-target base comparison      | `src/desktop/robotics/check.ts`, `src/desktop/canvases/robot-check.ts`                                 |
| Robot replay and handoff       | Visual pose interpolation; reviewed comparison JSON; portable canvas export/reopen with saved state and recomputed check             | `src/domain/robotics/replay.ts`, `src/desktop/canvases/service.ts`, `tests/native/robot-comparison.ts` |
| Robot generation qualification | Budgeted Meta creation, refinement and exact quoted alternative; retained failures, saved-response recovery and native output review | `tools/robotics`, `tests/robot-rehearsal.test.ts`                                                      |

Paths in this table are relative to `packages/viewer-electron/app`. The
[canvas reference](../reference/canvases.md) defines the contracts and limits. The
[ownership decision](../adr/0011-conversation-canvases.md) explains persistence and isolation.

The source-snapshot, reviewed-result and runtime-observation files first appear in `e8953828`. The
robot reader appears in `ced1b0c5`, the independent checker and comparison owner in `d734681b`, and
pose replay in `d00d4fa7`. These are all 1 November commits. Quote branch fields and canvas
operations were added to the existing chat schema in `4cee7ad0`.

## Plurid changes after the baseline

The engine comparison adds plane-relative camera anchors and tours; pinned and stacked planes;
arrangement history for those states; and fading of planes that obscure the current view. It also
changes modifier selection to title bars by default, preserves text selection in content, respects
custom title-bar height and bounds the camera transform cache. The engine's `docs/MIGRATION.md`
describes the prepared 30 and 31 October releases and their source contracts.

Credit these as improvements to an existing engine. Do not describe spatial navigation or Plurid
itself as invented during this hackathon, or imply every new engine feature is demonstrated in the
robot film. Package publication is a separate status from source implementation.

## Work outside the qualified case

The supplier case remains
[evaluation material](../development/testing.md#canvas-evaluation-and-replay). Its outputs and tests
are not evidence for the robot endpoint study or the separate mounting and cutting-service example.

The [implementation audit](../research/workshop.md#implementation-audit) owns the qualification
boundary and remaining presentation work. The generated SO-101 workflow has native evidence for
creation, refinement, an unchanged original with a quoted alternative, checked endpoints, comparison
save, replay, export/reopen and restart. This does not establish collision checking, continuous
trajectory validation, dynamics, device calibration or physical operation. Keep these absent
capabilities out of the completed contribution list.

The selected [screenplay](hackathon-demo.md) shows a robot inspector gaining target-testing and
base-placement controls in response to a new requirement. Its practical result is a saved tool and
checked endpoint candidates for two fixed work points. Attribute saved-response replay, condensed
repair rounds, staged reveals, local layout refinements and the replay-clock repair in the film
credits. The presentation manifest records the script hashes before and after that local repair; the
original provider output remains retained.

The separate mounting example's Meta-generated controls have native evidence for width editing,
measured DXF export, source-bound quote selection, save/reopen and restart. The supplier remains a
local simulation, and the plate dimensions are illustrative. Physical mounting fit remains outside
the completed contribution list. Existing footage shows actual native interactions with saved Meta
output; it does not depict fresh generation for this new job. Attribute public robot assets,
supporting libraries, model-generated UI and Viewer implementation separately. Credit the local
two-agent supplier simulation as presentation work, not a real service integration.

## Attach to the final receipt

1. The baseline revisions above and the final source revision or patch, with contributor attribution
   and confirmation that the organizer accepts the declared window.
2. A feature-by-feature distinction between prior work, event changes and third-party components.
3. The supplier sample's CC0 statement if included; pinned provenance and notices for each robot
   asset, supporting library and media element used in the final entry.
4. Live provider/model attribution and a complete usage summary, including failed and canceled
   calls. Keep API keys and private profile files out of the receipt.
5. The retained verification report, result files and replay instructions. Distinguish model
   generation, deterministic tests and the actual native recording.
6. Known limitations and any checks not completed. Do not claim local replay is a new live model
   evaluation or that a video contains a restart checked only outside the capture.

The receipt can describe an uncommitted patch during review. Creating commits or publishing changes
is a separate owner decision.
