# Dictate into Viewer

Open **Settings → Speech** and choose **Local Whisper**. Choose **Download and use** beside a local
Whisper model, or **Import verified weights…** if you already have the matching GGML file. No model
account, terminal or compiler is needed. The recognizer ships with Viewer; weights download once.

## Use a hosted speech provider

In **Settings → Speech**, set **Transcribe with** to **Hosted provider**, then choose **Add speech
provider**. Choose Meta, OpenAI, Deepgram or a compatible endpoint. Check the name, API base URL and
model ID, then choose **Save provider**. The saved provider and its model appear together in **Use
provider**. Speech providers are separate from chat and Ask Viewer models.

Enter the provider's API key and choose **Save key**, then **Check connection and model**. This
requests provider metadata without recording or sending audio. Check any key, endpoint or model
error before trying a recording. A listed model still needs a short transcription test; a compatible
endpoint that lacks discovery is shown as unverified.

Choose **Allow recordings…** and review the endpoint and model in the system dialog. Microphone
access is a separate permission. The key alone does not authorize uploading audio.

Choose **Test microphone and transcription**, record, then choose **Finish and transcribe**. Correct
the editable transcript before inserting it into a draft. Releasing the dictation shortcut also
sends the completed recording to the selected speech provider. A recording is at most one minute.
There is no automatic retry or switch to another provider.

**Revoke audio access** stops affected sessions. Editing the endpoint or model requires new audio
consent; a new endpoint also needs its own key. To work offline, explicitly choose **Local
Whisper**. Meta's transcription model does not list Romanian support; use another supported model or
local Whisper for Romanian.

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

For example, ask to create a named branch task and supply its repository, branch and destination.
Ask Viewer can propose `task-new`, which opens an editable form. Fill any missing parameters, review
the workspace and choose **Create task…**. The desktop asks for confirmation before creating the
worktree. The new terminal stays stopped and Git review waits for **Load Git changes**. See
[branch tasks](develop.md#start-a-task-from-a-branch).

## Stop or recover

**Cancel recording**, Escape or closing the dialog stops the session and discards its temporary
audio. Losing window focus stops recording. Changing the destination closes dictation so text cannot
land in another document. Each recording finishes at 60 seconds.

If access is denied, enable Viewer in **System Settings → Privacy & Security → Microphone** and
start again. An unavailable selected microphone produces an error; Viewer does not silently switch
devices. Choose another microphone in Speech settings and retry.

For hosted authentication, rate-limit or connection errors, check the provider, model, key and audio
access in Speech settings, then start a new recording. Viewer shows a bounded error rather than
retaining or retrying your audio. Provider retention and billing follow that provider's terms.

Downloads show progress and can be cancelled. Partial files remain retained and cannot be used.
Restarting Viewer restores the selected model and language, without resuming a download or starting
the microphone. A changed model needs a verified download or import.

See [speech limits and privacy](../reference/speech.md) for platform requirements and resource
bounds.
