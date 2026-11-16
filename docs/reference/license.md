# Offline license keys and trial state

This feature applies only to an interactive direct build configured with both `publicKey` and
`purchaseURL` in `licenseConfiguration` in `packages/viewer-electron/app/src/desktop/release.ts`.
Both shipped values are empty. The purchase address must be https without credentials. An incomplete
or invalid configuration disables the feature at runtime; the direct release check and issuer refuse
it. `process.mas`, terminal CLI and MCP runs do not read or write a license record.

## Key format

```text
viewer-license-1.<payload>.<signature>
```

Both parts use unpadded base64url. The signature is 64 Ed25519 bytes, encoded as 86 characters. The
payload is UTF-8 JSON with these required fields:

| Field     | Value                                             |
| --------- | ------------------------------------------------- |
| `product` | `"viewer"`                                        |
| `email`   | Non-empty text, at most 320 characters            |
| `order`   | Non-empty order reference, at most 256 characters |
| `issued`  | Valid date in `YYYY-MM-DD` form                   |

The key carries no Viewer version or build, and verification applies no version or build
restriction.

Later payload fields are accepted. The signature covers the exact payload bytes, including any JSON
whitespace. Verification never recomputes a canonical JSON representation. The app applies no
address pattern to signed email text. The issuer requires exactly one `@`, text on both sides, and
no whitespace or control characters; international addresses are accepted.

The complete input is limited to 4096 characters. Key copying ignores whitespace and only these
additional invisible characters: U+200B (zero-width space), U+200D (zero-width joiner), U+2060 (word
joiner), U+FEFF (byte-order mark) and U+00AD (soft hyphen). One surrounding pair of matching
straight or curly single or double quotes is accepted. Other characters, internal quotes and
surrounding prose are refused.

The embedded public key is base64 of an Ed25519 DER SubjectPublicKeyInfo. The issuer holds its
matching private key outside the repository. There is no activation service, device binding,
revocation request or periodic online check. The public source makes the local check inspectable; it
does not prevent someone from modifying their own build to bypass it.

## Trial clock

The trial starts at the first interactive launch with no readable record. An existing profile from
before this feature starts then too. The duration is 30 periods of 24 hours of recorded clock span.
Days left round up: the final partial day shows 1, and the exact end shows **Trial ended**.

The record keeps the earliest start and latest observed time, and their span is elapsed trial time,
so clock changes in either direction can only shorten the trial. A running interactive app refreshes
status hourly and when a window requests it.

Updates and reinstalls preserve the record in the same data folder. A new data folder, including a
new `VIEWER_DATA_DIRECTORY`, starts a new trial. There are no markers outside that folder. An
unreadable record is preserved before a fresh trial starts. A key this build cannot verify stays in
the record and falls back to the recorded trial dates.

## Stored record

`license-v1.json` in Electron's `userData` folder is an owner-readable application metadata
document:

```text
{ version: 1, trial: { started, seen }, key? }
```

`started` and `seen` are nonnegative epoch milliseconds. `key`, when present, is the cleaned key
text. Viewer verifies it again at every launch; a saved paid flag has no effect. Removing the key
preserves the trial dates and the record file. The file contains the signed email and order
reference in readable form, without Keychain storage. Viewer sends none of it to its developer.

Only a missing file means no previous record exists. A record that cannot be read or validated is
kept byte for byte beside it as `license-v1.json.unreadable-<time>-<id>` before a fresh record is
written. If recovery cannot finish, the existing copy stays intact and the fresh trial runs in
memory; this session refuses key entry and removal and saves nothing over that copy. Unexpected
links and directories stay in place too. Restore access and relaunch to retry recovery.

A key this build cannot verify is never erased on a status read. A newly entered valid key replaces
it; **Remove license key** is the only action that clears it.

Creating the first record writes once. Later writes require a changed key, status kind or days left,
or at least an hour of advance in the saved `seen` time. Other clock observations stay in memory
between saves; opening another window or reading an unchanged status does not rewrite the record.

The ended-trial reminder has no modal or delay and never disables work. Hiding it lasts for the
current desktop process, across windows and reloads. That hidden state stays in memory. About uses
**Licensed to**, **Trial: N days left** or **Trial ended**. The Settings page is **License**, the
menu and palette command are **License Key…**, and **Acknowledgements** remains the third-party
software notices.

[Try Viewer and enter a key](../guides/license.md) ·
[Publisher setup](../development/releases.md#set-up-offline-license-keys) ·
[All reference](README.md)
