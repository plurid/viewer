# Dictate into Viewer

Use this guide to speak instead of type: a request Viewer carries out, a note, a checklist or a chat
message. You set up speech once, on your Mac or with a hosted provider. Viewer shows the words it
heard and what it will do with them, and runs by itself only what changes no file.

**Find it:** **Settings → Speech** · hold **⌃⇧Space** in the workspace · the microphone in the title
bar · **⌘K** → **Ask Viewer by voice…** · **Dictate** in Ask Viewer, a note, a checklist or a chat

## Set up speech on your Mac

1. Open **Settings → Speech** and set **Transcribe with** to **Local Whisper**.
2. Under **Local speech model**, choose **Download and use** beside a model. **Whisper Small** is
   the best multilingual choice; **Whisper Tiny** is faster and smaller but needs more corrections.
   If you already have the GGML file, choose **Import verified weights…**.

The recognizer ships with Viewer, so no account, terminal or compiler is needed. The model downloads
once and works offline from then on.

## Test the microphone

1. Choose **Test microphone and transcription** and allow microphone access when macOS asks.
2. Speak, then choose **Finish recording**. With a hosted provider the button reads **Finish and
   transcribe**.
3. Read the transcript, then choose **Done**.

Viewer uses the system microphone. To use another one, pick it under **Recording → Microphone**. If
short phrases come out in the wrong language, choose the **Language** instead of automatic
detection.

## Use a hosted provider instead

1. In **Settings → Speech**, set **Transcribe with** to **Hosted provider** and choose **Add speech
   provider**.
2. Pick Meta, OpenAI, Deepgram or **Compatible endpoint**, check the address and model, and choose
   **Save provider**.
3. Enter the API key, choose **Save key**, then **Check connection and model**. No audio is sent for
   this check.
4. Choose **Allow recordings…** and confirm the endpoint and model in the system dialog.
5. Run **Test microphone and transcription** once before relying on it.

Speech providers are separate from the models that answer requests. Each recording is sent once, at
most a minute long, and never retried or sent to another provider. For Romanian, use local Whisper
or another model that lists it; Meta's does not. **Revoke audio access** stops sending recordings.

## Ask Viewer by voice

1. Show the folder you want to work on, or select its files. For a laser job, show or select the
   job's folder, such as Job 1042.
2. Hold **⌃⇧Space**, say what you want, such as "Check this job and prepare the cut sheets", and
   release. Or choose the microphone in the title bar, speak, then choose **Finish and transcribe**.
3. The **Ask Viewer** panel shows your words as soon as they arrive, then the plan: "Check Job 1042,
   then prepare its cut sheets."
4. Steps that change no file run at once, one after another. The check runs, and once it is graded
   the cut sheets open in a Nesting plane. Each step says how it went, such as "1 finding, 1
   confirmed by Viewer".

- **Steps that change files wait for you.** Saving corrected copies, exporting a handoff, renaming
  and moving to the Trash show as a button, such as **Export handoff**. Nothing is saved until you
  choose it.
- **The check sends pictures only when its model may.** When Meta may not receive pictures yet, the
  step says so. Choose **Allow pictures for Meta** in the check panel, then **Check 3 files**, and
  the plan goes on.
- **A job that is not here.** Say "check job 1043" while Job 1042 is shown and the panel says "Job
  1043 is not here. Job 1042 is." Choose **Check Job 1042, then prepare its cut sheets** to go on.
- **Part of the request Viewer cannot do.** The panel names that part and waits. Choose the plan's
  button to run the rest.
- **Who reads your words.** The **Default for Ask Viewer** model in **Settings → Models** plans the
  steps when it may receive file names, such as Muse Spark. Viewer checks each step against the
  commands where you spoke. Without such a model, Viewer matches your words to its command names
  itself.
- **Change or stop it.** **Edit as text** opens your words in Ask Viewer to change them. **Stop**
  ends the plan; a check already running goes on in its panel.

The plan acts on the folder and selection you were looking at when you began to speak. Moving to
another plane while you speak stops the recording.

## Dictate

| Where         | How                                                                           |
| ------------- | ----------------------------------------------------------------------------- |
| The workspace | Hold **⌃⇧Space**, speak and release: Viewer plans and runs it, as shown above |
| Ask Viewer    | Choose **Dictate**, then submit the request                                   |
| A note        | Choose **Dictate** to add the words to the end                                |
| A checklist   | Choose **Dictate**; each phrase becomes an unchecked item                     |
| Chat          | Choose **Dictate** to add to the draft; **Send** is still yours               |

Change the shortcut in **Settings → Shortcuts**. A request dictated into Ask Viewer goes to the
**Default for Ask Viewer** model in **Settings → Models**, which only ever proposes a line for you
to review. For example, ask for a branch task, then fill any missing details in the form it opens.
See [Start a task from a branch](develop.md#start-a-task-from-a-branch).

## Stop or recover

- **Escape**, **Cancel recording**, **Cancel** or closing the dialog or panel stops and discards the
  recording. So does switching to another window.
- Releasing **⌃⇧Space** before the microphone is ready stops the recording: hold it while you speak.
- If macOS denied the microphone, allow Viewer in **System Settings → Privacy & Security →
  Microphone** and try again.
- If the chosen microphone is unplugged, pick another in **Settings → Speech**. Viewer does not
  switch devices on its own.
- For a hosted error, check the provider, model, key and recording permission in **Settings →
  Speech**, then record again.
- A cancelled download stays unusable until you download or import the model again.

[Speech reference](../reference/speech.md) covers requirements, limits and privacy;
[Ask Viewer by voice](../reference/agents.md#ask-viewer-by-voice) covers exactly what a plan may
run.
