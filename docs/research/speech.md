# Speech input and model setup

Talk to Viewer to find files, arrange views, ask questions or dictate text. Speech recognition
should be a configurable input service, independent of the model that understands a request.

This is a proposal for speech recognition. Viewer currently supports typed
[requests in words](../reference/command-line.md#requests-in-words), model-backed actions and
conversations. The [terminal CLI](../reference/cli.md#local-speech-model-weights) can now propose
verified pinned weight downloads, local imports and explicit selection through native review.
Microphone input, the bundled recognition runtime, hosted speech adapters and the Settings flow
below are not implemented. Installed weights alone do not enable voice control.

## Start with push to talk

Hold a configurable shortcut or click a microphone button. Show listening state, live transcription
and an obvious Stop action. Releasing the shortcut finishes the utterance; Escape cancels it.
Keyboard and pointer access must both work, with accessible state announcements.

Choose the destination explicitly. In a note or conversation composer, dictation inserts editable
text. In the command palette, speech prepares a Viewer command. Show the final transcript so a
person can correct a filename or misunderstood word before submitting it. Partial transcripts never
run actions.

Capture the active workspace, folder and selection when a command begins. If that target changes
before execution, ask the person to resolve the change. Follow-ups such as “only last month” refer
to the identified previous result, rather than whichever plane happens to be active later.

## Set up local recognition in Settings

Add a **Speech** section to **Settings → Models**, with **Run locally** and **Use a provider**
choices. Keep the speech model separate from **Default for Ask Viewer**: local transcription can
feed a hosted reasoning model, and hosted transcription can feed a local reasoning model.

The local setup flow should work without an LLM account:

1. Choose **Set up local speech**. Inspect the platform, supported acceleration, available memory
   and storage. Explain the proposed runtime and model download before starting.
2. Offer lightweight, balanced and higher-accuracy Whisper models. Show the actual model identifier,
   languages, download size and estimated runtime memory. Recommendations must come from qualified
   model metadata and measured hardware behavior.
3. Install the packaged whisper.cpp runtime and selected model through a managed installer. Prefer a
   runtime shipped with Viewer; acquire a separately distributed runtime only from the approved
   release catalog. Ordinary setup must not require a terminal, compiler or package manager.
4. Show download, verification and preparation progress, with cancellation and restart recovery.
   Select the model only after verification and a successful load.
5. Offer **Try microphone**, display the recognized text and let the person choose the default
   language, microphone, shortcut and model. Make it clear whether recognition works offline.

Support choosing an existing compatible model file through a native picker. Validate its format,
runtime compatibility and identity; a filename extension alone is insufficient. Explain whether it
will be copied into managed storage or referenced in its current location. A moved or unavailable
external model offers Locate or a managed download without losing the saved selection.

Model management shows installed, downloading, available, incompatible and unavailable states.
Switching models preserves the previous working installation. Provide a measured memory estimate and
release idle runtime resources; keeping a model warm must fit a bounded resource budget.

## Ask the model to arrange setup

Allow typed requests such as “Set up offline voice commands” and “Use a smaller Whisper model.”
Typed setup works before speech is available. Once voice works, the same requests can be spoken.

The LLM proposes a typed setup operation that the desktop service resolves against the managed
runtime and model catalog. Settings and model-assisted setup use the same installer, validation,
progress and recovery. The review identifies the runtime, model, source, size, storage destination
and any external audio processing before the person starts it.

The LLM cannot install an arbitrary executable, run a package-manager script or supply an unchecked
download URL. Existing shell grants do not authorize this route. Imported preferences can select a
model identifier but cannot authorize installation, microphone capture or cloud audio transmission.
An already verified installation is reused rather than downloaded again.

## Configure hosted transcription

Provide speech-specific adapters for **Meta Muse Voice Transcribe**, **Deepgram** and other
explicitly supported transcription services. A chat provider is not automatically a speech provider.
Custom endpoints require a supported speech protocol and clear endpoint identity.

Setup asks for the provider, transcription model, private credential and supported language options.
Show whether an adapter supports live partials, push-to-talk completion, automatic speech boundaries
and vocabulary hints. Missing capabilities have explicit behavior rather than silently ignored
settings. Offer a connection check without recording, followed by an optional microphone test.

Explain that audio goes to the selected provider. Vocabulary hints containing filenames require
their own permitted metadata scope; audio permission does not authorize document contents. Keep
credentials in the existing private credential storage, outside shared configuration and portable
backups. Changing the endpoint invalidates the corresponding permission.

Retain an optional local choice, but never switch between local and hosted processing silently.
Offline, rate-limit and authentication failures offer Retry, Edit transcript or an explicit switch
of backend. A failed attempt never submits the same command twice.

## Share one speech service

Capture audio once and adapt resampling and encoding to the selected backend. Keep credentials,
network connections and local runtime ownership in the desktop service; use a worker or helper for
heavy recognition. Microphone access belongs only to the trusted speech flow, not browser planes or
document previews.

Define shared typed requests for setup, model selection, start, finish and cancel, plus
session-scoped partial, completed, progress and failure events. Provider adapters normalize their
own event shapes; confidence scores and word timestamps are optional capabilities, not assumed
fields.

Bound recording duration, queued audio, downloads, inference concurrency and retained transcripts.
Ignore late events from cancelled sessions. Cancel stops capture and inference or transmission;
finish stops capture while allowing pending final text to arrive. Closing the owning window or
revoking permission stops its session. Restoring a workspace never starts recording or installation.

Completed command text enters the existing planner, captured-target validation and command history.
Dictation remains editable text until the person submits it. Recognition supplies no additional
file, terminal or agent authority; file removals retain their exact-scope approval and OS Trash
review.

## Keep installation recoverable

Use versioned manifests with runtime compatibility, source, license, byte size and cryptographic
digest. Reject unexpected archives, path traversal and symbolic-link destinations. Preserve the
previous usable runtime and model until the new installation passes verification and loading.

Interrupted downloads remain identifiable and resumable only when the source identity can be
verified. Cancellation does not delete partial files. Removing a runtime, model or partial download
requires a fresh review of its exact files and folder contents and uses OS Trash. A failed Trash
operation preserves the items and reports the failure.

Keep transient audio in memory by default; recording retention is a separate explicit feature.
Persist model choices and harmless preferences, while excluding recordings, credentials and access
grants from portable backups. Retain completed requests through the existing history rules and make
the destination clear when dictating into a saved conversation.

## Delivery and acceptance

1. Add the shared speech contract, Settings setup and managed local runtime/model installation.
2. Add hosted adapters, separate audio permissions and connection/microphone tests.
3. Connect push-to-talk to dictation and the existing command planner, including cancellation and
   contextual follow-ups. Expose the same setup operations to model-assisted requests.
4. Qualify accuracy, responsiveness, resource use and recovery before adding hands-free listening.

Exercise fresh installation, reuse, model switching, insufficient storage, corrupt downloads,
interruption, unavailable model files, denied microphones, revoked credentials and stopped services.
Check accents, background noise, silence, filenames, commands and mixed-language speech. Qualify
Romanian and English independently for each offered model rather than assuming language support.

Measure transcription error, command-target accuracy, time from release to final text, memory and
cancellation latency on named hardware. Distinguish recognition mistakes from planner mistakes. Keep
measurements and recordings in consented qualification evidence, not this design document. Repeat
the keyboard and accessibility tasks in the [usability protocol](../development/usability.md).
