# Dictate into Viewer

Use this guide to speak instead of type: an Ask Viewer request, a note, a checklist or a chat
message. You set up speech once, on your Mac or with a hosted provider, then check the words before
you use them. Nothing you say runs until you choose to.

**Find it:** **Settings → Speech** · hold **⌃⇧Space** in the workspace · **⌘K** → **Dictate an Ask
Viewer request…** · **Dictate** in Ask Viewer, a note, a checklist or a chat

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

## Dictate

| Where         | How                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------- |
| The workspace | Hold **⌃⇧Space**, speak, release, then choose **Insert text** to make an Ask Viewer request |
| Ask Viewer    | Choose **Dictate**, then submit the request                                                 |
| A note        | Choose **Dictate** to add the words to the end                                              |
| A checklist   | Choose **Dictate**; each phrase becomes an unchecked item                                   |
| Chat          | Choose **Dictate** to add to the draft; **Send** is still yours                             |

Change the shortcut in **Settings → Shortcuts**. A dictated request goes to the **Default for Ask
Viewer** model in **Settings → Models**, which only ever proposes an action for you to review. For
example, ask for a branch task, then fill any missing details in the form it opens. See
[Start a task from a branch](develop.md#start-a-task-from-a-branch).

## Stop or recover

- **Escape**, **Cancel recording** or closing the dialog stops and discards the recording. So does
  switching to another window.
- If macOS denied the microphone, allow Viewer in **System Settings → Privacy & Security →
  Microphone** and try again.
- If the chosen microphone is unplugged, pick another in **Settings → Speech**. Viewer does not
  switch devices on its own.
- For a hosted error, check the provider, model, key and recording permission in **Settings →
  Speech**, then record again.
- A cancelled download stays unusable until you download or import the model again.

[Speech reference](../reference/speech.md) covers requirements, limits and privacy.
