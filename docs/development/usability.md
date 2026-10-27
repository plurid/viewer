# Qualify complete desktop tasks

Use the same small task set for a newcomer and an experienced user. Explain the goal, then observe
without teaching the interface. Keep generated fixtures and use new destinations for every export.
Closing a view is safe; removing a file still requires the person's explicit approval.

| Task                                                  | Completion evidence                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Find a document by its name, then by words inside it. | Correct file, correct search scope, no model request needed.                            |
| Select several files and rename one.                  | Selection and range behavior are predictable; text entry keeps editing keys.            |
| Preview, edit and save a document.                    | Changes persist, focus returns, and the original replacement follows normal review.     |
| Compare or transform a file and export it.            | The result is inspectable beside the original; cancellation leaves the original intact. |
| Recover a missing or changed source.                  | The message identifies the problem and the next action preserves the person's edits.    |
| Find an unfamiliar action and customize its toolbar.  | The person can find, pin, reorder and run it on the intended selection.                 |
| Back up work and restore it to another profile.       | Counts make sense; relinking finds the files; existing work remains beside the copies.  |
| Quit, reopen and continue.                            | Positions, hidden controls, tools and unsaved work return without execution replay.     |

Repeat the relevant tasks with keyboard and pointer input, both appearances, minimum supported
windows, enlarged text and always-visible scrollbars. Qualify VoiceOver navigation and the native
application menu in an observed macOS session. Do not infer accessibility usability from labels in
the DOM alone.

For each session record the candidate hash, platform, viewport, input method, previous experience,
task, elapsed time, completion, hesitation, accidental actions, interventions and recovery. Keep
permission to record the session separate from product access. Use a timestamped evidence folder;
avoid collecting personal document contents.

Automated checks cover routing, focus restoration, saved preferences, bounded cache cancellation,
backup round trips and repeat opening. The desktop-quality native scenario exercises the actual
dialog and toolbar flows; document navigation and mixed-workspace scenarios provide timing and
resource observations. These are repeatable engineering checks. Record observed human sessions in a
separate result table, with unperformed sessions marked **not observed**.

| Participant  | Experience | Task | Completed | Time | Interventions | Findings |
| ------------ | ---------- | ---- | --------- | ---- | ------------- | -------- |
| Not observed | —          | —    | —         | —    | —             | —        |
