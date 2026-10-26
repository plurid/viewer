# Viewer: Meta hackathon strategy

Recorded October 26, 2026. **Status: research-backed proposal.** Viewer Workshop
is a working name; the capabilities proposed here have not been implemented.
This document consolidates the broader Viewer ambition, competition strategy,
the RP1 reference project, lessons from Forge, the proposed presentation and the
decisions needed before building.

The competition details below come from the participant guide supplied in the
conversation. The event page could not be fetched independently during research.
Model and RP1 facts link to primary sources checked on October 26. Recheck event
rules, model access and upstream revisions before submission. Recommendations and
the assessment of winning potential are product judgments, not predictions.

## 1. Competition and positioning

### Event requirements

The supplied [Meta Global AI Developer Hackathon guide](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details)
sets the following constraints:

| Item               | Requirement from the supplied guide                                            |
| ------------------ | ------------------------------------------------------------------------------ |
| Problem statements | Build for Your World or Push the Frontier                                      |
| Technology         | Incorporate Meta models meaningfully                                           |
| Building period    | October 27–November 4, 2026                                                    |
| Submission         | November 4 at 9:00 PM Eastern; the submission section specifies EST            |
| Local deadline     | November 5 at 04:00 in Bucharest, using the stated EST deadline                |
| Team               | Solo participation allowed; at most four participants                          |
| Repository         | Public and accessible to judges                                                |
| Existing code      | Existing products may be foundations; identify the work built during the event |
| Video              | Three minutes, highlighting the specific new functionality                     |
| Materials          | Code, data and assets must have appropriate usage rights                       |

The kickoff is October 26. Confirm the exact opening time for eligible work and
the platform's deadline before relying on a date-only schedule. Existing Viewer
work completed before the building period must remain clearly attributed as the
pre-event foundation.

The guide lists judging on November 5–8, the closing ceremony on November 9 and
the community-vote result on November 16. The main tracks are Indie Developer and
Startups; choosing between them remains open.

### What the entry needs to demonstrate

The four equally weighted criteria are Impact, Use of Meta AI Tooling, Technical
Depth and Execution, and Demo. The proposed positioning is **Push the Frontier**:
help people understand and maintain a physical engineering project through its
connected digital artifacts.

| Criterion       | Proposed evidence                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Impact          | A real project and a clear task: locating a component's evidence, understanding a configuration or maintaining its documentation. Measure user effort rather than inventing savings. |
| Meta tooling    | Multimodal interpretation and, when footage supports it, segmentation drive the workflow and the resulting artifacts.                                                                |
| Technical depth | Stable component identity, versioned evidence, bounded tools, explicit uncertainty, compatibility checks and selective regeneration.                                                 |
| Demo            | One component leads to connected evidence, a useful investigation and an inspectable output. A source change produces a visible, understandable consequence.                         |

The guide excludes basic RAG applications and simple image analyzers among its
sample anti-projects. The entry therefore needs working interactions, checks and
outputs beyond conversational answers about uploaded files.

The stated prize pool is $1 million: $400,000 for Indie Developer, $550,000 for
Startups and $50,000 in bonuses. Best Agentic Use-Case and Best Build on Meta Open
Weight Models are relevant opportunities; creative and viral awards should not
expand the critical path. No award is assumed.

### Alternatives considered

An earlier candidate was a bug-recording workflow: reproduce an observed problem,
create repairs in separate worktrees, compare them and replay verification.
It fits Viewer's recent development tooling, but overlaps with existing
[Replay debugging](https://docs.replay.io/basics/debugging/overview) and
[Sentry Seer](https://docs.sentry.io/product/ai-in-sentry/seer) capabilities.
It remains an alternative, rather than the preferred differentiation.

A media-production workflow could assemble a launch kit from footage, photographs
and documents. It offers immediate visual results, but needs a specific user
problem and stronger differentiation from general AI content tools.

**The preferred direction is Viewer Workshop, with RP1 as the first reference
project.** Its combination of geometry, documents, parts lists and software gives
Plurid a concrete role in navigating evidence and changes.

### The larger Viewer ambition

Viewer should let a person inspect, create, change and operate a project across
file types and tools while keeping its context. A folder, website, source file,
recording, model, command result and agent conversation can belong to the same
piece of work. Their relationships should survive opening another view,
switching branches, closing a plane and returning later.

The long-term product spans the following nine realms. This is positioning and
direction; each claim needs its own demonstrated capability.

| Realm                   | Existing foundation                                    | What makes the broader claim valuable                                                  |
| ----------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| File explorer           | Folder views, previews, search and file operations     | Navigate from a file to its uses, dependencies, history and possible actions           |
| Browser                 | Browser planes and local servers                       | Keep a running page connected to its project, source, requests and changes             |
| Development environment | Terminals, Git, worktrees, task areas and commands     | Move from investigation through a reviewed change to a real test result                |
| Document workspace      | Notes, checklists, PDF and Office views                | Compose source-linked documents and update affected sections after changes             |
| Creative studio         | Media drafts, image tools, conversion and optimization | Turn selected material into edited, inspectable outputs without losing the originals   |
| Engineering workbench   | CAD, drawing and mesh previews                         | Connect components, BOMs, configurations, requirements and verification evidence       |
| Data inspector          | Structured text, trees and table previews              | Inspect typed records and relationships with tools appropriate to their meaning        |
| Automation console      | Parameterized actions, scoped commands and sequences   | Compose reusable work with visible inputs, progress, results and recovery              |
| Agent workspace         | Reviewed proposals and reported session navigation     | Let agents work with the same authorized resources, references and actions as the user |

These foundations have different limits; their presence does not establish the
complete experience in the right-hand column. See the
[spatial workbench delivery record](spatial-workbench-implementation.md),
[task workflows](task-workflow-implementation.md) and
[format roadmap](preview-roadmap.md) for the current boundary.

The proposed differentiator is continuity across those realms. For example:

- Follow a running local page to its source, inspect a branch change, run a
  check and return to the page with the result available.
- Turn selected footage into an edited clip, transcript, illustrated instruction
  and optimized export, with each output linked to its source version.
- Follow a robot component into its drawing, BOM and configuration, investigate
  a variant and produce a report showing the checks that actually ran.

These are proposed complete experiences, assembled from existing foundations and
new work. The hackathon should prove the third through one narrow RP1 task.
Workshop is a focused demonstration of Viewer's broader direction.

## 2. Viewer Workshop

### Core idea

Make a project's objects addressable across their representations. A bracket can
appear as a model component, a tracked object in video, a drawing reference, a
spreadsheet row and a configuration dependency. Viewer should retain those
connections and make them useful for inspection and artifact creation.

Proposed pitch:

> Point at a component, follow its evidence across the project, and produce a
> guide or investigation that stays connected to its sources.

The intended users are makers and small hardware or robotics teams that work
across several applications and file families. The first evaluation should use
real project files and a narrow task with an independently checkable result.

### Original assembly-guide workflow

The broader concept begins with a model containing identifiable parts, a short
assembly recording, a bill of materials and a manual:

1. Select a physical part in the recording. Track it and propose corresponding
   model, document and parts-list references.
2. Confirm or correct ambiguous correspondences; keep unresolved ones visible.
3. Ask the agent to assemble a guide using those sources and inspect any
   disagreements.
4. Review discrepancies with both references available. The user identifies the
   authoritative revision rather than the model silently choosing one.
5. Create an interactive HTML guide and PDF with real renders, excerpts and
   source references.
6. Change a source; mark affected sections stale and regenerate reviewed outputs.

The earlier example of an M3×12 versus M3×16 fastener disagreement is an
illustrative scenario. No such defect has been established in RP1.

### Why Plurid matters

Give each selected component a persistent group containing its representations,
source evidence and generated artifacts. Selection should focus the associated
model component, document passage, table row or video moment. Keep two revisions
beside each other for comparison. Preserve the groups and navigation context
while the user inspects a disagreement.

Use short, purposeful camera movements and readable focused planes. The demo
should let a viewer understand why the connected views are useful without
requiring them to learn spatial navigation first.

The spatial interface should make the relationships actionable:

- Select an object once and reveal its corresponding views, with a visible
  explanation of each connection and a way to correct it.
- Keep source and candidate revisions beside each other, including their actual
  checks and outputs. A spatial group should restore the investigation context.
- Show affected dependencies when a source changes. Historical outputs retain
  their original inputs; newer outputs identify what superseded them.
- Keep a running task independent of its current plane. Closing a view should
  retain a discoverable way back to the task and its reported state.

These are proposed interaction goals. Camera depth and animation serve those
operations; they must preserve readable evidence and predictable navigation.

### Lessons from Forge

The local [Forge overview](../../../../../../piatra/apps/forge/README.md) describes
a manufacturing operating system connecting design, engineering records,
execution and quality through a digital thread. Its stated status is
**architecture complete, no code yet**. Its walkthroughs are designed scenarios,
not evidence of a running service or manufactured and tested products.

The most useful ideas for Viewer are:

| Forge principle                                      | Proposed Viewer application                                                                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version, revision and release have distinct meanings | A saved file version is not an approved engineering revision. An accepted report does not release a robot for operation.                                             |
| A baseline captures a known configuration            | Pin the exact model, drawing, BOM, description and configuration inputs for an investigation, including hashes and repository revisions.                             |
| Derived artifacts retain their source revision       | Preserve the original guide/report and its inputs when generating a successor. A new result states which earlier result it supersedes.                               |
| Requirements link to both design and verification    | Keep an intended property, a design reference, a proposed explanation and an observed check result distinct. Missing or stale evidence stays visible.                |
| Change control identifies downstream effects         | A proposed change shows the before/after, reason, affected references, checks and human decision. It can produce a change report without silently rewriting sources. |
| Agents are identifiable actors                       | Record the model/tool versions, selected inputs, proposed recommendation, actual outcomes and human review separately.                                               |
| Correlation and causation explain the chain          | Relate one investigation's operations and identify which change or action triggered each downstream result.                                                          |

The [architecture](../../../../../../piatra/apps/forge/docs/ARCHITECTURE.md)
defines these concepts. The
[bicycle-stem walkthrough](../../../../../../piatra/apps/forge/docs/walkthroughs/bicycle-stem.md)
illustrates requirement-to-result traceability and the cost of stale drawings.
The [electronics-enclosure walkthrough](../../../../../../piatra/apps/forge/docs/walkthroughs/electronics-enclosure.md)
adds mechanical, PCB and firmware configuration relationships. For RP1, this
suggests retaining compatibility evidence between the hardware, robot description
and deployment configuration rather than treating a matching filename as proof.

Forge's [v0.1 scope](../../../../../../piatra/apps/forge/docs/v0.1-scope.md)
also sets a useful delivery rule: prove one complete workflow before widening
the architecture. Viewer can apply that discipline using its existing local
services and typed actions. A manufacturing service fleet, ERP, shop-floor system
and production-release process are beyond this hackathon slice.

These links are **local research references** into
`/Users/ly3xqhl8g9/Data/i/theings/piatra/apps/forge`; they will not resolve from a
standalone public Viewer checkout. The submission must explain its own behavior
without requiring access to Forge. Forge's service called Spark is separate from
Meta's Muse Spark model. Reading Forge does not establish a runtime integration.

## 3. RP1 reference project

### Available sources

[RP1](https://github.com/Roboparty/RP1) is the project overview and repository
guide. The proposed corpus spans independently versioned repositories:

| Repository                                                        | Research-confirmed role                                                           | Proposed Viewer use                                                                |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [RP1_hardware](https://github.com/Roboparty/RP1_hardware)         | Mechanical/manufacturing resources, drawings, BOMs, PCB and harness documentation | Relate component identity to geometry, drawings and material/configuration records |
| [RP1_description](https://github.com/Roboparty/RP1_description)   | URDF, MJCF and mesh resources                                                     | Add a robot hierarchy with links, joints and source references                     |
| [roboparty_deploy](https://github.com/Roboparty/roboparty_deploy) | Robot interfaces and deployment configuration                                     | Trace selected joints into configuration evidence                                  |
| [roboparty_train](https://github.com/Roboparty/roboparty_train)   | Training and simulation workflows                                                 | Optional context for a later simulation slice                                      |

The main repository explicitly directs readers to the appropriate sub-repository
for releases and supported configurations. It does not establish that arbitrary
revisions of these repositories form a compatible set.
[Repository guide](https://github.com/Roboparty/RP1/blob/main/README.md).

The hardware BOM directory identifies two RP1.3.4 configurations:
`RP1_BOM_5DOF_MotionHead.xlsx` and `RP1_BOM_7DOF_MotionHead.xlsx`. The documented
worksheets include `总BOM` for parts and `包材` for packaging. Part numbers and
revisions are useful proposed matching keys, subject to inspection of the actual
files. [BOM documentation](https://github.com/Roboparty/RP1_hardware/blob/main/04_BOM/README.md).

Manufacturing resources include STEP models and PDF drawings. Full assembly
downloads include SolidWorks sources and a Parasolid model; those downloads are
not a promise that Viewer can decode their native formats.
[Mechanical resources](https://github.com/Roboparty/RP1_hardware/blob/main/01_Mechanic/README.md),
[hardware release](https://github.com/Roboparty/RP1_hardware/releases/tag/v0.1.0).

### Initial scope

Start with **one arm in the five-DoF-arm configuration**, then inspect differences
against the seven-DoF-arm variant. Choose the exact component only after confirming
its matching geometry, drawing, BOM entry and configuration references. Do not
make complete whole-robot coverage a prerequisite.

The manufacturer's introduction describes the 24-axis configuration as having the
complete training-to-deployment path and describes gaps in released default
policies/dedicated training tasks for the 28-axis configuration. This is a reason
to investigate the 24-axis path first, not evidence that the 28-axis variant is
defective. Counts must retain their meaning: arm, body, head and hand degrees of
freedom are different scopes.
[RP1 introduction](https://roboparty.com/documents/roboto-01?doc=overview%2Fintroduction&lang=en).

No pinned asset pack has been downloaded or qualified as part of writing this
document. Matching revisions, manageable geometry sizes, precise part identity
and licensing for description assets remain open.

### Proposed RP1 investigation

The narrower demo question is:

> Show me how this arm is built, where its configuration comes from, and what
> changes between the five- and seven-DoF versions.

The intended sequence is component selection, linked drawing/BOM/joint evidence,
agent investigation, deterministic checks, and export of an inspection report or
guide. A reviewed worktree change can show affected files beside the baseline.

Following the Forge ideas, the report should retain a captured baseline, the
question, source references, proposed interpretation, actual checks and unresolved
items. If a bounded change is demonstrated, its report adds before/after inputs
and affected artifacts. A human review and the model's recommendation remain
separate records. No verified RP1 defect is required to demonstrate this flow.

Candidate checks are joint names and order where the configuration declares them,
declared limits, referenced mesh existence, part references and source revisions.
A passing check establishes only the property actually checked. It does not
certify robot operation, policy suitability or physical assembly safety.

MuJoCo is a separately labelled simulation stretch. The manufacturer's quick-start
guide supplies model entry points, including `mjcf/robot_24dof.xml`. Loading a model
does not establish that a matching controller or deployable policy is available.
[Quick start](https://roboparty.com/documents/roboto-01?doc=overview%2Fquick-start&lang=en).

### Current Viewer boundary

Viewer already has [STEP/mesh previews](model-previews.md),
[PDF tools](pdf-workbench.md), [Office previews](office-previews.md), linked planes,
task worktrees, Git review and export workflows. These provide a foundation.

URDF/MJCF semantics, robot component navigation, joint inspection and mappings
into drawings/BOM/configuration would be new work. Current CAD measurement is
based on tessellated surfaces; complete assembly topology and exact solid
inspection remain separate capabilities. SolidWorks and Parasolid decoding are
outside the initial proposal.

## 4. Meta integration and engineering

### Model responsibilities

| Model                             | Proposed responsibility                                                                          | Priority                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Muse Spark or Muse Wonder         | Interpret selected evidence, propose correspondences, plan investigations and choose tools       | Core; select after a real task evaluation                    |
| SAM 3.1                           | Segment a selected physical object and associate its tracked video regions with project evidence | Core to the video-led guide; conditional on suitable footage |
| Muse Voice Transcribe             | Convert spoken assembly explanations into candidate instructions for review                      | Optional                                                     |
| Muse Spark Open through a partner | Power the primary reasoning loop if quality and access support the open-weight route             | Optional alternative                                         |
| Muse Glimmer                      | Explore local interpretation on suitable hardware                                                | Later investigation                                          |
| Muse Image                        | Generate clearly identified illustrative material if it serves the chosen workflow               | Optional; keep authoritative geometry renders source-derived |

Spark/Wonder accept multimodal input and support tools/structured output. Voice
Transcribe is speech-to-text. Spark Open and Glimmer are separately hosted
open-weight routes. Confirm account/model access before committing to an
integration. Wonder Full is not a Model API model.
[Meta model catalog](https://dev.meta.ai/docs/models).

SAM provides masks and boxes and follows objects in video; it does not establish
CAD identity, physical dimensions or a 3D joint pose. Spark/Wonder would propose
interpretations, while the application retains source geometry and correspondence
state. Point prompts must be transformed from the preview to the source media's
coordinates, including rotation and cropping.
[Media segmentation](https://dev.meta.ai/docs/media-segmentation),
[SAM prompting](https://dev.meta.ai/docs/sam/segmenting).

Structured output can constrain response shape. Local validation must still check
whether a proposed entity, reference or action is meaningful and permitted.
[Structured-output documentation](https://dev.meta.ai/docs/structured-output).

### Proposed foundations

| Concept            | Minimum intended behavior                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Entity             | Stable identity for a component, separate from its current plane or filename                                      |
| Source reference   | Captured source version plus a locator such as a node, page region, sheet/row, configuration field or video range |
| Correspondence     | Explicit relationship with evidence and a proposed, confirmed or unresolved state                                 |
| Baseline           | A captured set of source versions and configuration identity used by an investigation                             |
| Investigation run  | Captured inputs, model/tool identities and actual observed outcomes                                               |
| Change proposal    | Before/after references, reason, affected dependencies, checks and a separate human decision                      |
| Generated artifact | Output linked to its inputs and checks, with stale state when dependencies change                                 |

These describe proposed domain concepts, not an approved wire schema. This
document changes no public API. A later implementation plan must define their
minimal contracts around the selected RP1 slice.

The proposed data flow is: select authorized sources; parse bounded facts;
request model proposals; resolve references and review uncertainty; run typed
inspection/export actions; publish new artifacts; retain source dependencies;
mark affected results stale when inputs change. Schema validation and model
confidence must not be presented as factual verification.

Reuse the current resource/permission boundary, operation services, task ownership
and command system. Geometry supplies measured facts; models supply proposed
interpretation and planning. Report unresolved revisions or missing evidence
instead of generating an apparently complete result.

Persist the source baseline, run outcomes and artifact provenance in the domain
records that own them. The existing Journal is a bounded support history with a
closed vocabulary; it is not a transaction authority or tamper-proof audit. A
future Workshop event producer can project safe lifecycle IDs into Journal while
keeping paths, source content and detailed evidence in their authorized stores.
Correlation and causation must not become a reason to append arbitrary agent
text or expose new agent Journal access.

### Existing foundation and new contributions

| Existing Viewer foundation                                            | Proposed hackathon contribution                                      |
| --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Spatial planes, linked navigation, task worktrees and Git hunk review | Component-driven groups, shared selection and revision investigation |
| PDF, XLSX, STEP and mesh readers                                      | Cross-source component references and robot-model semantics          |
| Typed actions, export jobs and reviewed proposals                     | Workshop investigation and artifact-generation orchestration         |
| Journal and explicit agent session reports                            | Appropriate Workshop lifecycle observations and links                |
| Caches, resource versions and scoped access                           | Versioned evidence dependencies and selective regeneration           |

See [task workflows](task-workflow-implementation.md),
[composable actions](composable-actions.md),
[agent session reports](agent-session-reports.md), [Journal](journal-plane.md)
and [architecture](architecture.md) for existing behavior and limitations. The
pre-event test record in [verification](verification.md) is baseline evidence,
not acceptance of Workshop or a Meta integration.

## 5. Demo and delivery

### Opening and the "one software" reveal

The user's presentation idea borrows the theatrical rhythm of the Steve Jobs
three-product reveal: name familiar software categories, repeat them, then reveal
that they are one workspace. The supplied
[YouTube reference](https://www.youtube.com/shorts/1F5Jd6rfeZs) could not be fetched;
the script below is an original proposal based on the described idea, not a
transcription of that clip.

**Recommendation: speak three categories and reveal the wider range visually.**
The preferred broad-product opening is:

> A file explorer.
>
> A creative studio.
>
> A development environment.
>
> Three worlds. One workspace.
>
> This is Viewer.

For an opening closest to the user's first version, use "A file explorer. A
browser. A development environment." The terminal belongs inside the development
environment in this framing. For an engineering-only presentation, "An
engineering workbench" can replace "A creative studio." Choose one set for the
recording; the nine-realm product ambition remains the same.

Seven to ten spoken categories are an alternative, but make a longer opening and
give each claim less room for proof. The nine realms in section 1 can instead
appear as short labels around the same project, then resolve into its connected
planes. Show only capabilities available in the demonstrated build; future
realms belong in an explicitly labelled vision segment outside the competition
demo. The first visible action should cross a meaningful boundary between tools.

For the proposed Steve Jobs synthetic appearance/voice, use a clearly visible
"AI-generated homage" label and original narration, with no suggestion of an
actual endorsement. Confirm the rights for the particular visual, voice and
audio assets before recording; the label alone does not establish permission to
reuse source footage. An original presenter can deliver the same script. No
synthetic footage, voice or likeness asset has been created or selected here.

Keep the opening to roughly 10–12 seconds within the existing first 25-second
storyboard slot. The remaining time should show the working Meta-backed
contribution. Existing capabilities may establish context with clear pre-event
attribution; the feature demonstration must identify the work built during the
hackathon.

The immediate proof of the reveal is a continuous action: select the RP1 part,
open its linked sources, run an investigation and inspect the generated report.
The same part and source baseline remain in view throughout. The audience should
understand what the connections enable as soon as the categories come together.

### Three-minute storyboards

The original guide concept remains a useful target:

| Time      | Assembly-guide demonstration                                                     |
| --------- | -------------------------------------------------------------------------------- |
| 0:00–0:25 | Introduce a real project and the task; identify the existing Viewer foundation   |
| 0:25–1:00 | Select a part in video and inspect its connected model/document/table references |
| 1:00–1:40 | Review a source disagreement and identify the authoritative revision             |
| 1:40–2:15 | Open the actual generated HTML guide and PDF                                     |
| 2:15–2:45 | Change a source, inspect stale sections and regenerate reviewed outputs          |
| 2:45–3:00 | Show artifacts, measured results and the hackathon contribution                  |

The narrower RP1 storyboard is the initial planning default:

| Time      | RP1 investigation demonstration                                                        |
| --------- | -------------------------------------------------------------------------------------- |
| 0:00–0:25 | Introduce the selected RP1 arm/configuration and the user's investigation question     |
| 0:25–1:00 | Select a component and reveal drawing, BOM and robot/configuration references          |
| 1:00–1:40 | Let the Meta-backed investigation explain a variant difference and run explicit checks |
| 1:40–2:15 | Inspect a reviewed change/report beside its baseline and source evidence               |
| 2:15–2:45 | Change one source and show the affected result becoming stale and updating             |
| 2:45–3:00 | Open the exported result and identify what was newly built                             |

Video/SAM can join the RP1 storyboard once usable footage and correspondence
quality are established. Simulation is optional and labelled as simulation.
Use one coherent story in the submission. Recorded/cached model results must be
identified as such; show a working end-to-end flow rather than implying unseen
features are complete.

### Delivery milestones

| Dates                               | Delivery goal                                                                                          | Exit evidence                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Before the eligible building period | Record the Viewer baseline, select the entry track, confirm rules/access and identify candidate assets | Baseline revision and explicit old/new contribution inventory    |
| October 27–28                       | Pin a small RP1 corpus and link one component across geometry, drawing, BOM and configuration          | A resolvable component with inspected, source-linked references  |
| October 29–30                       | Run the Meta-backed investigation and create an inspectable report or guide                            | Real output files, tool outcomes and source references           |
| October 31–November 1               | Add source-change handling, reviewed regeneration and recovery                                         | Correct stale state and a successful affected-output update      |
| November 2–3                        | Evaluate additional cases, collect user evidence, fix failures and freeze the demo                     | Recorded results on the primary and additional examples          |
| November 4                          | Record the three-minute demo, check public access/attribution and submit with a buffer                 | Accessible repository/video and platform submission confirmation |

The first go/no-go milestone is **one component linked across geometry, drawing,
BOM and configuration**. If matching sources or licenses cannot be established,
choose another documented RP1 component or a smaller licensed assembly before
expanding the feature set. Generalize only after that first interaction works.

### Evaluation and acceptance

The future implementation should demonstrate:

- References resolve to the captured source versions and correct locations.
- Part identity and configuration scope remain explicit; ambiguous associations
  are reviewable and can remain unresolved.
- Every reported check has a specific input and actual result. A controlled
  mismatch is labelled as a test case rather than an upstream defect.
- An old passing result cannot verify a changed source. Historical outputs keep
  their original baseline, and a successor identifies its own inputs and checks.
- Changing a variant or correcting a correspondence updates the affected evidence
  dependencies. Model confidence does not become an engineering approval.
- Model/tool failures, missing media and missing mesh references retain useful
  work and offer an understandable recovery path.
- Changing a source marks dependent results stale and preserves independent work.
- Exports open successfully and retain source references and appropriate credit.
- Original hashes remain unchanged; closing/reopening does not replay execution.
- Repeated use has bounded memory/process behavior and does not disrupt Finder or
  other applications.

Use manually inspected examples and, where available, a small independent user
evaluation. Measure elapsed effort, accepted/corrected associations and unresolved
references. Record actual outcomes; do not invent accuracy or productivity claims.
Keep the evidence associated with the exact candidate and source revisions.

## 6. Eligibility, risks and open decisions

### New work and submission provenance

Create a clear baseline before the eligible building period. Maintain a
`HACKATHON.md` contribution inventory when implementation begins: pre-existing
Viewer features, upstream RP1 materials, new modules, contributors, evaluation
and demo reproduction instructions. The demo should highlight the newly built
flow. Existing Viewer previews, upstream robot designs, policies and recordings
must retain their attribution.

The supplied guide offers $150 in Meta API credits per accepted participant and
conditional partner credits. Distribution, account requirements and redemption
must be checked in the event platform. Partner credits are not guaranteed. The
Baseten event model ID stated in the guide is
`meta-models/muse-spark-open-1026`; confirm availability before configuring it.
Use bounded selected inputs, reuse valid cached results, track actual spend and
avoid making an unverified credit allocation a delivery dependency.

### Asset rights and provenance

The hardware repository's licensing map assigns RoboParty-owned hardware design
source, including relevant release assets, to CERN-OHL-W-2.0. Explanatory
documentation uses CC BY-SA 4.0; technical drawings remain hardware design source.
Third-party material retains its own terms. Preserve the applicable notices and
upstream references for every selected asset.
[Hardware license scope](https://github.com/Roboparty/RP1_hardware/blob/main/LICENSES.md).

Licensing for the selected description meshes/URDF/MJCF, deployment materials and
footage still needs file/repository-specific verification. Do not assume the main
RP1 repository's license governs every companion repository. No footage or model
asset pack is approved for redistribution by this proposal. Pin each source
repository and release independently; record revisions, original paths, hashes
and license/credit information before bundling sample material.

### Reliability and execution boundaries

The [October 26 Quick Look incident](task-workflow-implementation.md#finder-and-quick-look-incident-october-26)
sets a concrete reliability requirement. RAW isolation is implemented, but other
image paths still use shared Quick Look. Complete the necessary isolation and
lifecycle work for the chosen demo inputs, and test sustained use before adding
more formats or running broad qualification concurrently.

Retain resource limits, cancellation, source identity checks and explicit model
data consent. Workshop should use bounded inspection and reviewed output actions.
Imported plans, aliases and saved grants must not confer new authority. Existing
agent shell/executable/terminal-input restrictions remain in force; simulation
needs its own reviewed, bounded adapter rather than an opaque shell bypass.

The removal policy in [AGENTS.md](../AGENTS.md) continues to apply to coding and
Viewer agents: exact-path permission, OS Trash only, no agent-approved removal
and preservation of generated fixtures/builds. No automatic cleanup or Trash
erasure is part of this strategy. Physical robot actuation and policy training
are outside the initial demonstration.

### Decisions still open

| Decision             | Current planning default or required evidence                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Competition track    | Choose Indie Developer or Startups using the actual entry's eligibility                                                            |
| RP1 subsystem        | One arm in the five-DoF-arm configuration; exact component waits for matching sources                                              |
| Corpus versions      | Establish a compatible, independently pinned hardware/description/deployment set                                                   |
| Asset rights         | Verify description assets, third-party files and footage before bundling                                                           |
| Core model           | Evaluate Spark/Wonder on the selected investigation; verify account access and cost                                                |
| Video/SAM            | Include when a usable, permitted recording and reliable correspondence exist                                                       |
| Output               | Begin with an inspection report; expand to the interactive guide when the source graph supports it                                 |
| Change demonstration | Add a bounded, labelled before/after only after the source-linked investigation works                                              |
| Simulation           | MuJoCo is a labelled stretch requiring a separate feasibility and execution check                                                  |
| Presentation         | Three spoken categories, the broader realms shown through the working project; presenter/labelled homage remains a creative choice |
| Publication          | Public repository/sample assets require the user's explicit publication action or authorization                                    |

These questions do not authorize product implementation or publication. Their
answers should update this strategy and inform a separate implementation plan.
