# Dictate into Viewer

Open **Settings → Speech**. Choose **Download and use** beside a local Whisper model, or **Import
verified weights…** if you already have the matching GGML file. No model account, terminal or
compiler is needed. The recognizer ships with Viewer; weights download once.

Small is the recommended multilingual choice. Tiny uses less storage and runs faster, but can need
more corrections, especially outside English. Choose a language if automatic detection misidentifies
short phrases.

Choose **Test microphone and transcription**. Allow microphone access in the macOS dialog, speak,
then choose **Finish recording**. Correct the transcript and choose **Done** to discard the test.
The device menu uses your system microphone by default. You can select another device after granting
microphone access.

## Use your words

- In **Ask Viewer**, choose **Dictate**. Insert reviewed words into the request field, then submit.
- In a note or checklist, choose **Dictate** to append reviewed words. A checklist adds unchecked
  items. Notes keep their existing private autosave behavior.
- In chat, choose **Dictate** to add text to the draft. **Send** remains a separate action.
- In the workspace, hold **Control + Shift + Space** to dictate an Ask Viewer request. Release to
  transcribe, review the words, then choose **Insert text**. You can also find **Dictate an Ask
  Viewer request…** in the command palette. Remap the shortcut in **Settings → Shortcuts**.

Nothing runs directly from a recording. Ask Viewer uses the reasoning model and data permissions
configured in **Settings → Models**. Local transcription itself does not send audio to that model.

## Stop or recover

**Cancel recording**, Escape or closing the dialog stops the session and discards its temporary
audio. Losing window focus stops recording. Changing the destination closes dictation so text cannot
land in another document. Each recording finishes at 60 seconds.

If access is denied, enable Viewer in **System Settings → Privacy & Security → Microphone** and
start again. An unavailable selected microphone produces an error; Viewer does not silently switch
devices. Choose another microphone in Speech settings and retry.

Downloads show progress and can be cancelled. Partial files remain retained and cannot be used.
Restarting Viewer restores the selected model and language, without resuming a download or starting
the microphone. A changed model needs a verified download or import.

See [speech limits and privacy](../reference/speech.md) for platform requirements and resource
bounds.
