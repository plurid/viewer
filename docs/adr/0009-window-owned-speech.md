# Window-owned local speech

## Decision

`desktop/speech` owns microphone authorization, verified model selection and one capture or
inference slot. The renderer owns bounded AudioWorklet capture and editable transcript review. Each
session carries a generated ID and its initiating WebContents identity. Closing or navigating that
window cancels its work; another window cannot finish or cancel it.

Reserve the session before asynchronous runtime, model or consent checks. Releasing a held shortcut
then cancels a pending start instead of starting a late recording after consent returns. Drop
microphone authority before inference. Keep the inference slot until an aborted helper has exited,
preventing overlapping memory-heavy workers.

Ship a pinned whisper.cpp runtime and compile Viewer's bounded stdin/stdout helper. Weights remain
separately verified data. The helper accepts at most one minute of mono PCM, runs locally and exits
after an utterance. No audio files, shell installation or agent microphone route exist.

A transcript has no execution authority. A person reviews it and inserts it into a stable
destination. Ask Viewer follows ordinary model permissions and command reviews. Changing the
destination closes dictation. Preferences and workspace restoration never start recording.

## Consequences

Local use needs no speech provider credential and works offline after model setup. Loading per
utterance trades some latency for predictable idle memory and cancellation. Shortcuts, Settings
tests, notes and chat share one service. Hosted speech needs an explicit adapter and separate audio
transmission consent.
