# Viewer Workshop and hackathon strategy

This is a proposed project, based on the owner-supplied Meta Global AI Developer Hackathon guide and
exploration of Forge and RP1. It is not a claim that Viewer currently controls robots or includes
those integrations.

## The entry

Build one complete workflow in which Meta models turn a physical-world task into an inspectable
workspace of source documents, images, models, actions and verified results. A strong example is
understanding an assembly, finding a mismatch and preparing a grounded correction with the original
evidence beside it.

The event guide requires Meta tooling, public source, a video of at most three minutes and clear
separation of event work from an existing codebase. Its criteria weight impact 30%, creative use of
Meta tooling 25%, technical execution 20% and demo 25%. The submission deadline is November 4, 2026,
9 PM Eastern. Confirm the
[event guide](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details) before submission.

## A complete demonstration

1. Open the project and its instructions in Viewer.
2. Ask a Meta model a concrete assembly/design question.
3. Open cited document passages, image regions and model parts as linked views.
4. Present a typed proposed action or correction with its assumptions and evidence.
5. Run an appropriate deterministic check and show the actual result.
6. Export a useful handoff rather than ending with an unverified chat answer.

For Job 1042, **Review evidence** opens a readable comparison of the exact drawing, DXF and request.
**Stack evidence** is optional and reversible. Completion of a model request never rearranges the
person's workspace by itself. Source-verified and human-confirmed requirements retain separate
labels; geometry verification alone cannot establish what a drawing requires.

Meta models should do substantive multimodal interpretation, decomposition and grounding.
Deterministic tools own measurements, validation and execution. Model names, API availability,
credits and model-specific limits must be checked during implementation rather than hardcoded from
planning notes.

## RP1 and Forge

[RP1](https://github.com/Roboparty/RP1) is a candidate reference project with a physical system,
source assets and assembly context. First inventory its actual files, licenses, units, dependencies
and runnable tools. Prefer inspection and a bounded simulation/validation result before physical
actuation. Hardware success requires its own environment and acceptance.

Forge suggests connecting artifacts, tools, versioned intent and results in a shared working
context. Borrow the useful relationships, not an entire parallel application architecture. Viewer
already owns files, views, typed transforms, review and resource lifetimes.

## Presentation video

The [laser-job shooting script](../release/hackathon-demo.md) turns this direction into a
three-minute demonstration of the implemented fabrication workflow. It still requires live Meta
evaluation and a successful recorded take.

The agreed opening has three spoken categories, then nine shown visually:

> A file explorer.
>
> A creative studio.
>
> A development environment.
>
> Three worlds. One workspace.
>
> This is Viewer.

The visual reveal can show files, documents, images, audio/video, models, code, browser, terminal
and agents. Then immediately demonstrate the new Workshop task. The broad reveal introduces the
product; the main video proves the specific work built during the event.

An earlier idea used a Steve Jobs-style “these are one product” opening. Preserve the rhythm and
reveal in an original presentation, with clear attribution for any referenced material and no
implication of an actual endorsement.

## Three-minute structure

| Time      | Show                                                              |
| --------- | ----------------------------------------------------------------- |
| 0:00–0:20 | The three-world opening and the practical problem                 |
| 0:20–1:10 | Multimodal question, source grounding and spatial evidence        |
| 1:10–2:10 | Proposed action, deterministic validation and useful correction   |
| 2:10–2:40 | Result, export and why the integrated workspace helps             |
| 2:40–3:00 | New contributions, Meta responsibilities and reproducible project |

Keep event provenance as explicit commit/feature boundaries. Retain model/tool inputs and outcomes,
evaluate a small set of success/failure cases, and show a working result. Existing browsing, preview
and task infrastructure must be labeled as the foundation. Asset rights, public sample provenance
and any external service requirements belong in the submission.
