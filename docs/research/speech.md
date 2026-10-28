# Further speech controls

Local and hosted dictation are implemented in the direct macOS build: bundled recognition, verified
model setup, provider-specific audio consent, microphone/language choices, push-to-talk and reviewed
insertion into Ask Viewer, notes and chat. Use the [dictation guide](../guides/speech.md) and
[current limits](../reference/speech.md). The directions below are proposals, not shipped features.

## Further hosted setup

Non-recording connection and catalog checks are available in Speech settings. Further discovery
could offer provider-specific model selection and language capabilities. Extend the adapter contract
for vocabulary hints and streamed results only when supported; chat providers must not become speech
providers automatically. A retry must never submit a command twice.

## Model-assisted setup

CLI and connected agents can already propose pinned installation, import and selection for review.
Extend typed Ask Viewer and chat with the same typed setup operations: “Set up offline voice
commands” or “Use a smaller Whisper model.” Do not introduce a shell installer or unchecked URL.

The review should identify runtime, model, source, size, storage destination and any external audio
processing. Imported configuration and saved execution grants must not authorize microphone capture
or provider transmission. Verified existing weights should be reused.

## More capable input

Offer live partial transcripts, vocabulary hints for permitted filenames, punctuation controls and
explicit translation. Keep partials out of execution and persistence until reviewed. A filename
misrecognition should be distinguishable from a command-planning mistake.

Capture the workspace, folder and selection for contextual requests. If a target changes, resolve
that change before execution. Follow-ups such as “only last month” should refer to the identified
previous result. Reuse existing command planning, history and review rather than building a second
command executor.

Hands-free listening and wake words need separate opt-in controls, an obvious persistent indicator
and a bounded idle resource budget. Dictation and ordinary browsing must remain available without
continuous listening.

## Installation and recovery

Add resumable downloads only when the pinned source and partial-file identity can be reverified.
Preserve usable installations during upgrades. A moved external model should offer Locate or a
managed copy without losing the selection. Model and partial-download removal must retain fresh
exact-scope approval and OS Trash.

Expose measured model memory and latency on qualified hardware. Consider bounded warm models only if
repeated use justifies their idle cost. Portable backups must exclude audio, credentials and access
grants; saved preferences must never restart recording.

## Qualification

Expand beyond public and generated clips to consented human Romanian and English speech, accents,
background noise, silence, filenames and mixed-language phrases. Measure recognition error,
command-target accuracy, release-to-transcript latency, peak memory and cancellation separately.
Keep recordings and run-specific measurements in private qualification evidence.

Exercise fresh setup, reuse, model switching, insufficient storage, corrupt downloads, interruption,
unavailable models, denied microphones, revoked credentials and stopped providers. Qualify each
platform, signed distribution and sandboxed edition independently. Repeat keyboard and accessibility
tasks from the [usability protocol](../development/usability.md).
