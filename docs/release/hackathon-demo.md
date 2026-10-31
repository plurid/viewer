# Three-minute demonstration draft

Record one completed laser-job check in Viewer. Use the generated **Job 1042**: its request, drawing
and five DXF parts. The drawing specifies a 50 mm hole pitch; the original part measures 48 mm. The
recording must show a real Meta response, Viewer's measurement, a reviewed correction and the
exported handoff.

This is a shooting script. Live Meta evaluation and the final recording are still required. The
automated fabrication test uses recorded replies and does not qualify as a live model run.

## Timeline and narration

| Time      | Picture and action                                                                                                                                                                                                           | Narration                                                                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0:00–0:12 | A folder, a creative preview and a development workspace appear in succession. Reveal them together in the spatial workspace.                                                                                                | “A file explorer. A creative studio. A development environment. Three worlds. One workspace. This is Viewer.”                                                                                    |
| 0:12–0:28 | Open Job 1042. Show its request, drawing and DXF parts as linked planes. Keep filenames readable.                                                                                                                            | “Before this job reaches the laser cutter, the request, drawing and parts need to agree. One wrong dimension can turn a batch of parts into scrap.”                                              |
| 0:28–0:52 | Choose **Check laser job…**. Show **Sent to the model**, the selected Meta model and the start of the real request. Cut past the wait with an elapsed-time caption.                                                          | “Viewer gives Meta the request, drawing pages and measured geometry. The model connects the evidence. Viewer checks the claims against the source text and its own measurements.”                |
| 0:52–1:22 | Show the pitch finding and its requirement status. Choose **Review evidence** for a readable drawing/DXF/request comparison, briefly **Stack evidence**, then restore the comparison. Show the dimension and measured holes. | “The drawing says fifty millimetres between these holes. Viewer measures forty-eight in the DXF. The finding brings us straight to both pieces of evidence, so we can inspect the disagreement.” |
| 1:22–1:52 | Read the proposed correction. Save the corrected copy and show the measured-again result. Briefly show both filenames.                                                                                                       | “The correction moves the identified holes in a new DXF copy. I review and save it. Viewer measures the result again: fifty millimetres. The original remains available.”                        |
| 1:52–2:22 | Open **Prepare cut sheets**. Show quantities and thicknesses from the request, then **Checked** on each nesting tab.                                                                                                         | “The same job context carries into preparation. Quantities and material thicknesses are verified against the request. The corrected part goes into the cut sheets, and each layout is checked.”  |
| 2:22–2:45 | Choose **Export handoff** or **Nest and export handoff**. Open the resulting folder and show **Cut sheets**, **Evidence**, the tour and check record.                                                                        | “The result is a handoff someone can use: cut sheets, source evidence, a replayable tour and a record of what was checked.”                                                                      |
| 2:45–3:00 | Return to the spatial evidence view. End with the project name and the final public source and reproduction links.                                                                                                           | “Meta interprets the job. Viewer makes the evidence inspectable and verifies the geometry. From a folder of files to a checked result, in one workspace.”                                        |

## Before recording

1. Use a dedicated demo workspace containing only generated Job 1042 files. The generators live in
   `packages/viewer-electron/app/tools/playground/samples/fabrication.ts`; see
   [the sample and evaluation reference](../reference/fabrication.md#live-evaluation).
2. Configure Meta in **Settings → Models** and confirm its picture-sharing permission. Keep
   credentials and Settings out of the recording.
3. Run the live evaluation on a planted problem and a clean control, then the remaining jobs. Retain
   each reply, grade, timing and outline result. Resolve failures before selecting the demonstration
   take.
4. Rehearse Job 1042 with the final app. Confirm the pitch finding, the corrected copy's new
   measurement and a complete handoff. Read back the exported files.
5. Confirm that comparison, stack, Undo/Redo and Restore arrangement preserve the reviewed evidence.
   Close and reopen the saved check without another model call. If a requirement needs human
   confirmation, show that step and retain its **Human confirmed** label.
6. Use a window size at which the finding, dimension and measurement remain readable in the final
   video. Keep the title bar quiet. Hide unrelated windows and notifications.

## Capture and edit

- Keep the complete source take. Cut model and nesting waits, with the actual elapsed time shown.
  Preserve the order of actions and results.
- Show the model and outline provenance the app actually reports. A fallback box must retain its
  fallback label. A failed or unverified finding cannot stand in for a confirmed measurement.
- Keep the before-and-after measurement visible long enough to read. Keep the source comparison
  readable. Use a short optional stack transition; avoid fast camera motion.
- Record narration after the successful take so every statement matches the visible result. Aim for
  2:55, leaving room for the final export.
- Check the final export for personal paths, customer information, credentials, unrelated files and
  unreadable text. The generated job's people and addresses are fictional.
- Prepare the event contribution receipt after implementation and the final take. The opening
  introduces Viewer's existing foundation; the submission must separately identify event work.

The [workshop strategy](../research/workshop.md) records the broader pitch and supplied event
requirements. Confirm the event's current rules before submission. This draft does not claim a
completed live evaluation, recorded video or published submission.
