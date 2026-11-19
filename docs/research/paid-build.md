# The paid build

Viewer is to be sold: a free trial, then a license key bought once. This page records the rules that
were chosen, the reasons, and the questions still open. The feature is built and stays off until the
publisher sets the signing key and purchase page. The [license guide](../guides/license.md) and
[license reference](../reference/license.md) describe how it behaves; this page keeps the reasoning.

## The rules

| Rule                  | Choice                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| Trial                 | 30 days from the first launch, with everything working                                               |
| During the trial      | Viewer says nothing. About and Settings show the days left                                           |
| After the trial       | Everything keeps working. A bar offers **Buy Viewer** and **Enter license…**, and can be hidden      |
| The key               | Signed text that arrives by email. Viewer checks the signature on the Mac                            |
| Updates               | One payment covers every later version of Viewer (decided 2026-11-16)                                |
| The network           | None. No activation, no account, nothing sent. **Buy Viewer** opens the purchase page in the browser |
| Mac App Store edition | None of this appears, and nothing is written                                                         |
| The price             | Stated on the purchase page, not in the application or these documents                               |

## Why these

**A file explorer must not hold files hostage.** People put Viewer between themselves and their own
folders. If a missing key could stop a copy or a move, the first bad review would say so, and it
would be right. The reminder asks; it never blocks, delays or interrupts a task.

**The first run stays quiet.** [DESIGN.md](../../DESIGN.md) asks for a quiet first run with one
hint. A countdown in the workspace would break that on day one, so the trial is silent until it
ends.

**The source is public, so the check is honest instead of hidden.** Anyone can read how a key is
verified. What they cannot do is make one, because that needs the private half of the signing key.
Hiding the check would cost effort and protect nothing.

**No server means no failure on the buyer's side.** A key that verifies offline works on a plane,
behind a firewall and ten years from now. It also keeps the promise that Viewer sends nothing to its
developer.

## The key

A key is one line of text: a version prefix, a payload and a signature. The payload names the
product, the buyer's email, an order reference and the issue date. The signature is Ed25519 over the
payload's exact bytes, the same primitive that authenticates the update feed. The key is stored in
Viewer's data folder and verified again at every launch; there is no "paid" switch to flip.

## The trial clock

- The trial starts at the first launch that finds no record.
- Viewer keeps the earliest start and the latest moment it has seen, and counts the span between
  them. A wrong clock in either direction can only shorten a trial, never lengthen it.
- The record lives in the data folder. An update or a reinstall keeps it; a new data folder starts a
  new trial. There are no hidden markers elsewhere on the Mac.
- A record that cannot be read starts a new trial, and the unreadable file is kept, so a key inside
  it is never lost. Someone who edits the record gets what they asked for; the person who never
  touches it is never punished for a damaged file.
- A saved key that a build cannot verify is kept too. Only **Remove License Key** clears a key.

## What stays out of the first version

- Activation servers, accounts and device limits.
- Revoking a key. A refund is settled with the buyer, not enforced in the application.
- A `viewer://` link or a license file. The key is pasted in Settings.
- Storing the key in the Keychain.
- Delivering the key automatically. The first keys are issued by hand from the payment notice.

## Open questions

- **The license of the source.** The event build of 2026-11-03, since withdrawn, used the delicense,
  which lets anyone rebuild and resell it, and that grant stays. A later release can carry a license
  that forbids reselling builds as Viewer while leaving the code readable and usable; the choice is
  the owner's.
- **The Mac App Store edition.** The store has its own purchase rules, and a key bought directly
  does not unlock it. The edition's text and links need a separate review before submission.
- **Existing event-build folders.** Their trial starts at the first launch of the paid build.

**Related:** [Product priorities](roadmap.md) · [File-manager gaps](file-manager-gaps.md) ·
[Platform status](../reference/platforms.md)
