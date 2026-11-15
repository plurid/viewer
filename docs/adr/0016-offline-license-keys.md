# Offline license keys for direct builds

Status: accepted.

## Decision

The direct-download edition offers a quiet 30-day trial followed by a hideable reminder. All
features remain available after the trial. About and Settings show trial days; the workspace has no
countdown. The reminder never opens a modal, delays work or appears in terminal CLI, MCP or headless
runs. The Store edition has no license UI or record.

A pay-once key contains a Viewer product identifier, purchase email, order reference and issue date.
Ed25519 signs the exact UTF-8 payload bytes. The app embeds one public key and verifies the saved
key at every launch. It stores no paid flag and contacts no activation service. Only pressing **Buy
Viewer** opens the fixed https purchase page in the person's browser.

`domain/license` owns payload validation, the status union and trial arithmetic. `desktop/license`
owns signature verification and the `DocumentStore` record in `userData`. IPC restricts key entry
and removal to Settings. Menu and palette use **License Key…**; Settings uses **License** so the
feature stays distinct from third-party notices.

Both publisher configuration fields ship empty, disabling the feature without reading or writing a
record. A release accepts fully empty or fully valid configuration; partial and invalid fields stop
it. Issuance requires valid configuration, keeps the private key outside the repository and refuses
a key that differs from the embedded public key.

## Consequences

Public source cannot conceal the check or stop a modified build from bypassing it. Cryptographic
signatures make forging a key for an unchanged build difficult without sending purchase details
anywhere. The email and order reference remain readable on this Mac.

The app treats a signed email as bounded non-empty text, without a library-specific address pattern
that could invalidate issued keys later. Only the issuer checks its one-`@`, no-whitespace and
no-control-character form, accepting international addresses.

The record keeps the earliest start and latest observed time, and their span is elapsed trial time,
so clock changes in either direction can only shorten the trial. A missing or unreadable record
starts a fresh trial. This is accepted in place of hidden markers or a remote clock. Reinstalling
with the same data folder retains the dates.

Unreadable records are kept byte for byte under a recovery name before a fresh record is written;
failed preservation keeps the existing copy intact and disables writes for this session. Keys that
this build cannot verify stay in the record until explicit replacement or removal. Status reads save
only key or visible status changes, or an advance of at least one hour in the saved clock.

The desktop process owns reminder dismissal in memory so every workspace and reloaded window agrees
until Quit. Payment fulfillment, revocation and license links remain outside the feature.

[User guide](../guides/license.md) · [Format and trial reference](../reference/license.md)
