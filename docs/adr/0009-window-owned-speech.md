# Window-owned speech

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

Hosted adapters share the same capture, owner, cancellation and editable transcript flow. Private
provider metadata is separate from reasoning-model configuration; credentials use their own
encrypted namespace. Audio consent binds provider ID, protocol, endpoint and model and can only be
granted through a desktop-owned system dialog in Settings. A microphone grant and an API key are
insufficient. Endpoint/model edits, key changes and revocation invalidate capture leases and abort
uploads before queued writes finish. The final authority check and cancellable upload registration
have no intervening await.

The desktop wraps bounded PCM as a fixed-name WAV and normalizes provider responses. There is one
request per recording, a deadline and a response-size bound; no automatic retry, redirect or cloud
fallback. Raw provider errors and credentials never enter transcript errors. No audio is persisted.

Explicit metadata checks have their own bounded adapter and session-only results. They request
catalog/key metadata without audio consent, never record audio and cannot grant permission. Owner
closure or provider/key changes cancel pending checks, including OS credential waits; a late key
result cannot send a request. Public catalogs do not establish key validity, so Deepgram checks
authentication independently. A listed model is distinct from a successful transcription.
