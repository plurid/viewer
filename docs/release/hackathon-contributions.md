# Hackathon contribution inventory

Use this inventory to prepare the final contribution receipt. It describes feature boundaries; it
does not establish event eligibility or authorship dates. Confirm the event's accepted baseline and
each contributor before turning it into the submitted receipt. Keep run-specific test counts, model
usage and artifact paths in the retained evaluation report.

## Existing foundation

Viewer already provides a desktop file workspace, previews, commands, settings, model configuration,
permission checks, native file operations and persistent planes. Plurid provides the spatial engine.
Describe these as the foundation of the entry, not as software created entirely during the event.

The conversation/canvas foundation also predates the current source-snapshot and result-export
changes. Attribute its event eligibility from its own history, not from the latest working diff.

## Implemented candidate contributions

These source boundaries identify existing implementations. Their inclusion here does not establish
that every behavior was filmed, that the robot case works, or that all of this code falls within the
event window.

| Area                           | Concrete behavior                                                                                                                    | Primary source boundary                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Conversation canvases          | Generated selectable HTML in an isolated plane; content revisions separate from saved input state                                    | `src/domain/canvases`, `src/desktop/canvases`, `src/renderer/canvases`                                 |
| Quote branches                 | Exact quoted range and frozen conversation context; independent canvas; conflict-aware application to the original                   | `src/domain/models/chat.ts`, `src/desktop/chat`, `src/renderer/chat`                                   |
| File-backed tools              | Bound inspection snapshots with hashes and coverage; explicit refresh; portable data without source-file authority                   | `src/desktop/canvases/sources.ts`, `src/domain/canvases/sources.ts`, `CanvasSources.tsx`               |
| Reviewed results               | CSV, JSON, Markdown and text proposal review; content/state revision checks; exclusive new-file save; open the saved result          | `src/domain/canvases/results.ts`, `src/desktop/canvases/service.ts`, `ResultReview.tsx`                |
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

The supplier case remains
[evaluation material](../development/testing.md#canvas-evaluation-and-replay). Its outputs and tests
are not evidence for the selected robot demonstration.

## Work outside the qualified case

The [implementation audit](../research/workshop.md#implementation-audit) owns the qualification
boundary and remaining presentation work. The generated SO-101 workflow has native evidence for
creation, refinement, an unchanged original with a quoted alternative, checked endpoints, comparison
save, replay, export/reopen and restart. This does not establish collision checking, continuous
trajectory validation, dynamics, device calibration or physical operation. Keep these absent
capabilities out of the completed contribution list.

The [screenplay](hackathon-demo.md) is publication preparation. Its synthetic opening and planned
robot scenes do not establish implemented behavior. Attribute public robot assets, supporting
libraries, generated UI and human-authored Viewer capabilities separately.

## Attach to the final receipt

1. The event baseline revision and final source revision or patch, with contributor attribution.
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
