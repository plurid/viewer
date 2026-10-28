# Speech input

Speech is explicit dictation into an editable draft, using local recognition or a selected hosted
provider. **Settings → Speech** owns setup, language and microphone choices. **Settings → Models**
separately owns the model used by Ask Viewer and chat. See the
[dictation guide](../guides/speech.md) for setup and controls.

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
- Local inference uses a separate CPU process, up to four threads, with a 120-second timeout. The
  process releases model memory when it exits. There is no continuously running recognition worker.
- Cancelling or closing the owner stops its work. Losing capture focus stops recording. Late
  cancelled results cannot replace a draft. Other windows cannot finish or cancel the session.
- Setup retains at most eight model installation attempts and four active setup tasks. Downloads
  have a 20-minute limit, fixed HTTPS origins, pinned byte sizes and SHA-256 verification. Cancelled
  and interrupted files remain retained. Removal is a separate exact-scope Trash action.

## Hosted adapters

Up to eight providers can be saved independently of reasoning models. The named presets use fixed
API origins; **Compatible endpoint** accepts HTTPS or HTTP on loopback only. Redirects are rejected.

| Provider   | API base URL                  | Default model               | Request                                                                  |
| ---------- | ----------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| Meta       | `https://api.meta.ai/v1`      | `muse-voice-transcribe-1.0` | `/asr/transcribe`; JSON `request` part and WAV `audio` part.             |
| OpenAI     | `https://api.openai.com/v1`   | `gpt-4o-mini-transcribe`    | `/audio/transcriptions`; multipart file, model and JSON response format. |
| Deepgram   | `https://api.deepgram.com/v1` | `nova-3`                    | `/listen`; WAV body, model and language query parameters.                |
| Compatible | User-supplied base            | User-supplied ID            | OpenAI Audio Transcriptions protocol.                                    |

Hosted requests contain a fixed-name mono PCM16 WAV recording, the selected model and optional
language. They do not attach filenames, file contents, workspace context or vocabulary hints. Meta's
language bias accepts its supported language names and rejects unsupported selections before upload;
Romanian is not supported by that preset. Other language availability depends on the model.

Each request has a 120-second deadline. Responses are bounded to 256 KiB and 48,000 transcript
characters. There are no automatic retries, fallbacks or background uploads. Authentication and
server errors omit response bodies and credentials. Cancelling, revoking consent, clearing a key or
editing a provider invalidates its active sessions and rejects late results.

**Check connection and model** uses only explicit GET requests. Meta and OpenAI-compatible adapters
request `/models` with the saved key. Deepgram checks `/auth/token`, then its public `/models`
catalog for recorded-audio support. An unlisted custom Deepgram model or an endpoint without
discovery remains unverified. A successful catalog check does not establish transcription support,
quality, quota or billing status and never grants audio access.

Checks have a 15-second deadline and a 2 MB response limit. They reject redirects and omit provider
error bodies. Checks are cancelled on owner closure, key/model/endpoint changes or revocation; late
credential reads cannot trigger a request. Results last only for the current session and clear on
provider or key edits. Audio permission remains separate.

## Data and permissions

Only a trusted top-level Viewer or Settings window with an active person-started session can request
audio. Browser planes, document frames, camera requests and unsolicited media requests remain
denied. macOS microphone consent is still required.

Recordings and intermediate transcripts stay in memory in Viewer. Hosted recognition sends the
completed recording to the explicitly permitted endpoint. The speech service persists model
installation records, provider metadata, the selection, language and microphone identifier. It
retains no audio files. Provider-side retention is outside Viewer's local storage policy. Inserted
text follows its destination's normal persistence rules: notes autosave privately, chat retains its
draft, and Ask Viewer remains editable until submitted.

Speech credentials are encrypted in private storage, separate from chat keys and configuration
exports. Audio consent lives outside editable configuration and binds the provider ID, protocol,
endpoint and model. Changing the model or endpoint revokes it. Microphone consent, chat data access,
configuration imports and agent grants cannot grant audio transmission. Keys are never returned in
speech status. Restart restores choices and consent without recording or uploading.

Continuous listening, wake words, streamed partial transcripts, translation and automatic command
execution are not implemented. There is no silent cloud fallback. Recognition can mishear names and
punctuation; review remains necessary.
