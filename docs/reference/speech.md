# Speech input

This page lists speech input's settings, local models, hosted providers, limits and permissions.

Speech is explicit dictation into an editable draft in Ask Viewer, notes or chat, or a spoken
request Viewer plans and runs, using local recognition or a selected hosted provider. **Settings →
Speech** owns setup, language and microphone choices. **Settings → Models** separately owns the
model used by Ask Viewer and chat.

## Settings

| Setting                               | Values                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Transcribe with**                   | **Local Whisper** (at first) or **Hosted provider**                                                     |
| **Local speech model**                | **Download and use**, **Import verified weights…**, **Use model**, **Cancel download**                  |
| **Hosted provider**                   | **Use provider**, **Add speech provider**, **Edit provider**, **Remove provider**                       |
| API key                               | **Save key**, **Clear stored key**                                                                      |
| **Connection and model**              | **Check connection and model**                                                                          |
| **Audio access**                      | **Allow recordings…** or **Revoke audio access**                                                        |
| **Language**                          | **Detect language** (at first), or one of the languages below                                           |
| **Microphone**                        | **System default** (at first), or a named input; a missing one shows **Saved microphone · unavailable** |
| **Test microphone and transcription** | Records a test whose transcript is not saved                                                            |

Languages: English, Romanian, German, French, Spanish, Italian, Portuguese, Dutch, Polish,
Ukrainian, Russian, Chinese, Japanese, Korean, Arabic, Hindi, Turkish, Greek and Hungarian.

Hold the **Dictate** shortcut, **⌃⇧Space** at first, in the workspace to ask Viewer by voice, and
release it to transcribe. The microphone in the title bar and **Ask Viewer by voice…** start a
recording that **Finish and transcribe** ends, or the microphone chosen again. **Settings →
Shortcuts** changes the shortcut. A missing selected microphone never switches silently to another
device. [Ask Viewer by voice](agents.md#ask-viewer-by-voice) gives exactly what a spoken request
sends to a model and what it may run.

## Local recognition

The direct macOS build bundles whisper.cpp 1.9.5 and a Viewer inference helper. Local speech runs on
every macOS version Viewer supports and requires a verified model. Missing or invalid runtime
resources report recognition unavailable. Browsing and typed commands remain available. Windows,
Linux and Store speech acceptance remain unqualified.

| Model                       | Download bytes | In Settings                                                               |
| --------------------------- | -------------: | ------------------------------------------------------------------------- |
| Whisper Tiny                |     77,691,713 | Fastest and smallest; best for short English phrases                      |
| Whisper Base                |    147,951,465 | A small multilingual model for everyday dictation                         |
| Whisper Small · Recommended |    487,601,967 | More accurate multilingual dictation; more memory and a longer transcribe |

All three are multilingual, MIT-licensed GGML weights from a pinned upstream revision. **Download
and use** and **Import verified weights…** select a model only after its size and SHA-256 match.
Scoped CLI and agent setup proposals keep installation and selection separate; see
[CLI speech setup](cli.md#local-speech-model-weights). Neither agents nor CLI clients can open the
microphone or submit audio for recognition.

## Session and resource limits

- One recording or inference across Viewer windows at a time.
- 0.1 to 60 seconds of mono audio, resampled to 16 kHz PCM16: at most 1,920,000 bytes. Locally, a
  nearly silent recording returns no text without running inference.
- An AudioWorklet captures audio. The microphone stops before inference begins.
- Local inference uses a separate CPU process, four threads, with a 120-second timeout and 256 KiB
  of output. The process releases model memory when it exits. There is no continuously running
  recognition worker.
- Cancelling or closing the owner stops its work. Losing capture focus stops recording. Late
  cancelled results cannot replace a draft. Other windows cannot finish or cancel the session.
- Setup retains at most eight model downloads and runs at most four setup tasks. Downloads have a
  20-minute limit, pinned byte sizes and SHA-256 verification, and fetch over HTTPS from
  `huggingface.co`, `cdn-lfs.huggingface.co` and `*.hf.co` only, through at most five redirects
  among them. Cancelled and interrupted files remain retained and cannot be used. Removal is a
  separate exact-scope Trash action.

## Hosted adapters

Up to eight providers can be saved independently of reasoning models. The named presets use fixed
API origins; **Compatible endpoint** accepts HTTPS, or HTTP on `localhost`, `127.0.0.1` or `[::1]`.
An endpoint cannot hold a user name, password, query or fragment. Redirects are rejected.

| Provider            | API base URL                  | Default model               | Request                                                                               |
| ------------------- | ----------------------------- | --------------------------- | ------------------------------------------------------------------------------------- |
| Meta                | `https://api.meta.ai/v1`      | `muse-voice-transcribe-1.0` | `/asr/transcribe`; JSON `request` part and WAV `audio` part                           |
| OpenAI              | `https://api.openai.com/v1`   | `gpt-4o-mini-transcribe`    | `/audio/transcriptions`; multipart file, model and JSON response format               |
| Deepgram            | `https://api.deepgram.com/v1` | `nova-3`                    | `/listen`; WAV body, with `model`, `smart_format` and `language` or `detect_language` |
| Compatible endpoint | Your HTTPS or loopback base   | Your model ID               | OpenAI Audio Transcriptions protocol                                                  |

Hosted requests contain a fixed-name mono PCM16 WAV recording, the selected model and the language
when one is chosen. They do not attach filenames, file contents, workspace context or vocabulary
hints. Meta's language bias covers English, German, French, Spanish, Italian, Portuguese, Dutch,
Polish, Chinese (as Mandarin Chinese), Japanese, Korean, Arabic, Hindi and Turkish; Romanian,
Ukrainian, Russian, Greek and Hungarian are refused before upload. Other providers' language
availability depends on the model.

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

### A live run

`tools/speech/transcribe-live.ts` sends one WAV recording to Meta's Muse Voice Transcribe exactly as
hosted speech in the app does. With `--plan`, Muse Spark then reads the transcript into a plan for a
job folder shown as Job 1042, through the app's own prompt and checks, beside Viewer's own matching.
It writes nothing.

1. Record a request, or have macOS speak one:
   `say --file-format=WAVE --data-format=LEI16@16000 -o request.wav "Check this job and prepare the cut sheets"`.
   Any 16-bit PCM WAV at 16 kHz or more works; `afconvert -f WAVE -d LEI16@16000 -c 1` converts
   another recording.
2. Set `META_API_KEY` in the environment. The run reads the key from there only and holds it in
   memory: it never prints, writes or logs it.
3. From the repository root, run
   `node --import tsx packages/viewer-electron/app/tools/speech/transcribe-live.ts request.wav --plan`.
   It prints the transcript, the model, the audio's length and the time the call took, then each
   plan.

| Option              | Effect                                                                        |
| ------------------- | ----------------------------------------------------------------------------- |
| `--language en`     | The language, as **Language** in **Settings → Speech**; detected unless given |
| `--model <id>`      | Another transcription model; `muse-voice-transcribe-1.0` unless given         |
| `--plan`            | Also plans the transcript with Muse Spark, at the `names` level               |
| `--plan-model <id>` | Another Muse Spark model; `muse-spark-1.3` unless given                       |
| `--text "<words>"`  | Plans these words with Muse Spark, without audio                              |

Each run makes one transcription call, and one Muse Spark call with `--plan` or `--text`.

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
endpoint and model. Changing the model or endpoint revokes it, and a new endpoint needs its own key.
Microphone consent, chat data access, configuration imports and agent grants cannot grant audio
transmission. Keys are never returned in speech status. Restart restores choices and consent without
recording or uploading.

A spoken request runs at once only commands that change no file, and only on the folder and
selection captured when the recording began; every other step waits for the person's press. The
transcript reaches a model only as text, at the `names` level of **Settings → Models**; audio goes
only to the speech provider chosen here. Continuous listening, wake words, streamed partial
transcripts and translation are not implemented. There is no silent cloud fallback. Recognition can
mishear names and punctuation, so the panel shows the words it heard.

**Related:** [Dictate into Viewer](../guides/speech.md) · [Terminal CLI](cli.md) ·
[Agents](agents.md) · [Keyboard shortcuts](shortcuts.md) · [Platform status](platforms.md)
