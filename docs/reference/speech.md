# Speech input

Speech is local, explicit dictation into an editable draft. **Settings → Speech** owns setup,
language and microphone choices. **Settings → Models** separately owns the model used by Ask Viewer
and chat. See the [dictation guide](../guides/speech.md) for setup and controls.

## Availability

The direct macOS build bundles whisper.cpp 1.9.5 and a Viewer inference helper. Local speech
requires **macOS 13.3 or later** and a verified model. Missing or invalid runtime resources report
recognition unavailable. Browsing and typed commands remain available. Windows, Linux and Store
speech acceptance remain unqualified.

| Model         | Download bytes | Intended tradeoff                                                |
| ------------- | -------------: | ---------------------------------------------------------------- |
| Whisper Tiny  |     77,691,713 | Smallest and fastest; more transcription corrections.            |
| Whisper Base  |    147,951,465 | Lightweight multilingual dictation.                              |
| Whisper Small |    487,601,967 | Recommended multilingual choice; more memory and inference work. |

Settings **Download and use** and **Import verified weights…** select a model after checksum
verification. Scoped CLI and agent setup proposals keep installation and selection separate; see
[CLI speech setup](cli.md#local-speech-model-weights). Neither agents nor CLI clients can open the
microphone or submit arbitrary audio for recognition.

## Session and resource limits

- One recording or inference across Viewer windows at a time.
- Up to 60 seconds of mono audio, resampled to 16 kHz PCM16: at most 1,920,000 bytes.
- An AudioWorklet captures audio. The microphone stops before inference begins.
- Inference uses a separate CPU process, up to four threads, with a 120-second timeout. The process
  releases model memory when it exits. There is no continuously running recognition worker.
- Cancelling or closing the owner stops its work. Losing capture focus stops recording. Late
  cancelled results cannot replace a draft. Other windows cannot finish or cancel the session.
- Setup retains at most eight model installation attempts and four active setup tasks. Downloads
  have a 20-minute limit, fixed HTTPS origins, pinned byte sizes and SHA-256 verification. Cancelled
  and interrupted files remain retained. Removal is a separate exact-scope Trash action.

## Data and permissions

Only a trusted top-level Viewer or Settings window with an active person-started session can request
audio. Browser planes, document frames, camera requests and unsolicited media requests remain
denied. macOS microphone consent is still required.

Recordings and intermediate transcripts stay in memory. The speech service persists model
installation records, the selection, language and microphone identifier. It retains no audio files.
Inserted text follows its destination's normal persistence rules: notes autosave privately, chat
retains its draft, and Ask Viewer remains editable until submitted.

Hosted transcription, continuous listening, wake words, streamed partial transcripts, translation
and automatic command execution are not implemented. There is no silent cloud fallback. Recognition
can mishear names and punctuation; review remains necessary.
