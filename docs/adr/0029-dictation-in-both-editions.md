# Dictation in both editions

Status: accepted. Date: 2026-11-21.

## Context

Direct builds shipped with local whisper.cpp dictation and hosted speech, while the Mac App Store
build lacked the audio-input sandbox entitlement and left Store dictation unconfigured. The owner
decided that dictation is offered in both the direct download and the Mac App Store edition.

## Decision

`storeEntitlements` (`tools/mas-configuration.ts`) includes `com.apple.security.device.audio-input`
alongside `com.apple.security.network.client` in the Store main entitlements (`main.plist`), and
`forge.config.ts` keeps `NSMicrophoneUsageDescription` in `Info.plist` for both channels.

`forge.config.ts` bundles the `viewer-speech-v1-darwin-<arch>` resource folder
(`viewer-speech-recognizer` and `libwhisper.dylib`) on macOS in both editions. Store builds sign
helper binaries with `inherit.plist` (`com.apple.security.app-sandbox` and
`com.apple.security.inherit`) through `tools/mas.ts`. `SpeechRuntime`
(`src/desktop/speech/runtime.ts`) and `verifySpeechPackage`
(`src/desktop/speech/signed-resources.ts`) verify either the pinned manifest checksums or the sealed
`.app` code signature before running local transcription. Model downloads and hosted speech use the
Store network-client entitlement, and imported local models use security-scoped folder access.

## Consequences

Both editions offer local and hosted dictation with the same microphone consent and window-owned
capture rules. Unit and configuration tests cover Store entitlements and helper signing, while a
signed Store build still requires end-to-end qualification on a registered Mac before release.

See [Window-owned speech](0009-window-owned-speech.md), [Spoken requests](0010-spoken-requests.md)
and [Speech reference](../reference/speech.md).
