# Viewer: sharing and file-manager directions

Research and proposals, October 26, 2026. This follows the
[reliability work](reliability-followup.md); it does not mark these features as
implemented. No sharing service was deployed, file uploaded or link published.

## The product bet

**Let someone enter the useful context around a file.**

A download link answers “which bytes?” Viewer could also answer “which page,
which revision, which model angle, which comparison, and why does it matter?”
The recipient should get a useful browser preview immediately, with an optional
Open in Viewer action. A single file remains a simple single-file share.

This extends the existing local workspace, task tools, previews and commands.
It does not require a second file database to become authoritative for the user's
filesystem, or uploading a workspace merely to use it locally.

## What Loaf suggests

The pasted Reddit post could not be fetched independently. Its primary
[repository README](https://github.com/m-uvex/loaf-fm#features) documents the
following capabilities; these are documentation claims, not results of running
Loaf here. The website and detailed sharing implementation were inaccessible
during this read. In particular, its “P2P” wording does not establish a direct
connection or end-to-end encryption of content.

| Loaf idea                                                    | Useful direction for Viewer                                                                                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| On-demand tunnel links with expiry, password and rate limits | A deliberate Share action, explicit lifetime and one place to inspect/revoke active shares                             |
| Named SMB connections and keyring credentials                | A small Locations connector model; mounted network folders first, explicit remote/offline state                        |
| Incremental live folders and asynchronous thumbnails         | Keep independent bounded work, cancellation and observable progress; our private decoder work is particularly relevant |
| Nonmodal operation progress and conflict handling            | Keep work visible without blocking browsing; show actual failure, recovery and destination evidence                    |
| Archive browsing, batch rename, scripts                      | Improve the existing preview/operation/command paths rather than introduce another automation system                   |
| Tabs and two panes                                           | Preserve two visible source/destination contexts through linked/tiled planes and keyboard focus                        |

The lesson is reducing the steps between intent and outcome. More permanent
toolbar buttons are not a requirement. The pasted comments about packages that
would not launch are also a reminder that a source build and a packaged install
need separate acceptance.

## Ideas from other approaches

| Reference                                                             | Documented idea                                                                 | Viewer proposal                                                                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [Marta navigation](https://marta.sh/docs/)                            | Clear active source and destination panes                                       | Pin an explicit destination plane for Copy/Move; preview the exact plan before mutation                                             |
| [Marta Flatten](https://marta.sh/docs/actions/flatten/)               | Browse descendant files in one list                                             | A recursive folder lens that keeps original parent paths visible and never physically flattens files                                |
| [Marta actions](https://marta.sh/docs/core/actions/)                  | Contextual actions with configurable entry points                               | Keep palette, keyboard, contextual menu and agents on the same typed command registry                                               |
| [Yazi features](https://yazi-rs.github.io/features/)                  | Search results are actionable; scheduled work reports progress and cancellation | Treat search/lens selections like real file selections with captured identities and reviewed operations                             |
| [Yazi CLI](https://yazi-rs.github.io/docs/cli/)                       | CLI integration and a versioned plugin environment                              | Let a tool request a selection or open a result plane without inheriting unrestricted filesystem authority                          |
| [TagSpaces metadata](https://docs.tagspaces.org/dev/metafileformats/) | Portable structured metadata beside files                                       | Optional exported annotations/manifests; keep private app data the default and make external moves/conflicts explicit               |
| [TagSpaces links](https://docs.tagspaces.org/linking/)                | Internal references and relative links differ from downloads                    | Clearly distinguish a local reference from a share the recipient can actually read                                                  |
| [Spacedrive's stated direction](https://spacedrive.com/)              | One local view across devices and data sources                                  | A later provider-neutral resource identity with availability/freshness, without claiming its advertised implementation was verified |

These are translations of useful interactions into Viewer proposals, not a
recommendation to copy their interfaces or run their software.

## plurid.link: three distinct meanings

The public domain's ownership, DNS, certificates, existing application and
service availability have not been verified. The name below is a proposed
product surface, not a claim that a service exists.

| Mode            | What it contains                                            | Recipient and lifetime                                                                  |
| --------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Local reference | Opaque resource/view identity; no uploaded bytes            | Resolves only on a device with the resource and authority; label it **Local link**      |
| Snapshot share  | An explicitly selected immutable revision and optional view | Browser-readable while hosted; works when the sender's laptop sleeps                    |
| Live share      | A reviewed, read-only endpoint for selected current content | Says **Sender must remain online**; stops serving when revoked, expired or disconnected |

Start with **snapshot shares** for a dependable remote experience. Offer a live
relay later for very large content or short sessions. A tunnel service is one
possible transport; calling it P2P is not a security or reliability contract.
Encryption, identity and authorization need their own reviewed design.

The first UI can be small:

1. Select a file/folder and invoke **Share link…**.
2. Review the exact included entries, byte estimate, revision and view. The
   initial remote share defaults to read-only; folder contents are an explicit
   selection rather than an invisible recursive grant.
3. Choose lifetime and access; create the share as a cancellable background job.
4. Show **Copy link**, **Open recipient view**, upload/progress state and
   **Revoke**. Copy is available only once the recipient URL works.
5. Reopen all active shares from one **Shares** command. Closing its plane does
   not hide the share's actual lifetime or stop a running job implicitly.

The browser gets folder navigation, safe previews and permitted downloads.
Unsupported formats still get useful type/size/manifest information. It must
work without a Viewer installation or a Plurid account when link access was
chosen by the sender.

### Share a view

An optional versioned view record can contain:

- PDF page/selection and comment anchors;
- media time range, track choices and captions;
- model camera, clipping/visibility and measurements;
- image crop/zoom or comparison position;
- table sheet, original row/column addresses and filters;
- a small workspace arrangement with chosen notes and related artifacts.

A view is separate from source identity. A changed source cannot silently make
an old page, line or measurement refer to different content. Show a revision
mismatch and offer the snapshot or an explicit remap. A selected excerpt is
either a derived excerpt with a receipt or a view over an included full source;
the recipient review must reveal which one is being shared.

Durable references need a new versioned product record. Current per-window
preview/resource handles and their URLs are temporary capabilities, not portable
IDs. Keep device paths in the private local locator; export an opaque entry ID,
revision and reviewed relative name. A moved or missing source gets a resolution
prompt, not an automatic scan or a grant to another folder.

### Minimum service boundary

Use a versioned share manifest: entry IDs, normalized relative names, media
types, byte sizes, immutable revision digests, included derivatives and optional
view references. A service owns share metadata, access checks, object storage,
expiry and revocation. Desktop code owns source capture and reviewed inclusion.
The preview client consumes only that restricted manifest and its read API.
Existing `.plurid.com` account cookies do not automatically extend to
`plurid.link`; cross-domain sign-in requires an explicit authentication flow.

Never expose the desktop bridge, MCP broker, debugger, terminal, credentials or
an existing development server through a share. A live share needs a separate
read-only server. Resolve each requested entry against the reviewed manifest;
paths, symlinks, traversal, renamed sources and newly created folder children
must not expand its authority. Bound ranges, directory counts, decompression,
preview workers, requests and bandwidth.

Revocation blocks future service access, including cached authorization and
derived-object URLs. It cannot recall a recipient's downloaded bytes. Expiry
does not authorize deletion of local originals, fixtures or other user files;
storage-retention/garbage-collection policy needs its own explicit contract.
Recipient “preview only” also cannot guarantee that displayed content is
uncopyable. Generated summaries and secret-detection suggestions are not proof
that a selection contains no private information.

The smallest acceptance loop is: share generated file → inspect it in a clean
browser → verify exact bytes/revision → revoke → retry the old and derived URLs
and observe denial. Also cover interrupted upload, same-name replacement,
offline sender, partial manifest, oversized content and restart without replay.

## Where Plurid adds something substantial

The local [strategy](../../../../docs/00-strategy.md),
[product ownership rules](../../../../docs/01-product-spatial-notes.md),
[September roadmap](../../../../docs/03-roadmap.md) and
[lift program](../../../../docs/09-the-lift.md) support a shared spatial engine
with separate product data and a common delivery path. Their dated deployment
and version counts are snapshots; they are not current production acceptance.
For example, September's roadmap supersedes July's open culling task.

The engine should own camera/viewpoint serialization, plane identity, links,
selection, layout, input arbitration and rendering lifecycle. Viewer should own
files, derivatives, jobs, source revisions and share permissions. Platform code
can supply accounts/storage through adapters when actually needed. The engine
must not acquire filesystem or account authority.

[Depict](../../../../docs/06-product-depict.md) contributes the idea of a media
collection as an arrangement, with derivatives made after explicit inclusion.
[Dechat](../../../../docs/08-product-dechat.md) contributes visible conversation
branches and artifact planes. [Detime](../../../../docs/07-product-detime.md)
suggests a useful distinction between calendar time and navigable event history.
Reuse these ideas and public seams; do not copy entire product runtimes into
Viewer or infer that their cloud contracts fit arbitrary local files.

## Stronger follow-on features

| Feature                           | Concrete interaction                                                                                 | Smallest useful delivery                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Review a workspace                | Open a link to a PDF, a model and a note at the relevant views; move between their anchors           | Two artifacts, one note, saved viewpoint, read-only web client                                |
| Act on a virtual collection       | “Images over 4 MB in these three folders” → inspect → optimize → compare                             | Existing lens selection feeds one reviewed operation with original paths                      |
| Keep a delivery destination       | Pin a folder/connected location, gather results, compare before transfer                             | Explicit source/destination IDs and conflict review; no ambiguous spatial proximity           |
| Explain an output                 | Open an optimized image beside its source, settings, size change and receipt                         | One durable provenance relation, checksums and exact transform parameters                     |
| Revisit a decision                | Select a Journal event to reveal the task, command receipt and affected artifact                     | Deep links into existing records; never imply that logs reconstruct lost file bytes           |
| Find identical content in context | See copies in several places, then open their uses and provenance                                    | Exact hashes and source availability; removal remains separately reviewed                     |
| Move work between realms          | A conversation passage becomes a note; a referenced hunk opens its diff; an artifact enters a review | Explicit actions over existing task/session references; no guessed agent status               |
| Compose by connecting             | Connect a selection to Optimize, Compare and Export planes                                           | Typed ports over the existing command/workflow runner, previewed scope and resumable receipts |
| Hand work to another machine      | Export a task's portable references and chosen content, then resolve missing locations               | Manifest import with missing-resource placeholders; no auto-run of terminals or commands      |

The spatial arrangement should answer a relationship question—source/output,
parent/child, before/after, evidence/conclusion, or task/tool. A growing room of
unlabelled windows would make these workflows harder.

## Delivery sequence

1. Finish the [current reliability gates](reliability-followup.md), including the
   outstanding human Trash acceptance; preserve all evidence.
2. Prove a **local reference + view** using existing resource identities and
   source versions. This is valuable offline and exercises stale-reference UX.
3. Build the **snapshot share loop** on generated public fixtures: one file,
   then an explicit folder manifest, web preview, revoke and restart acceptance.
4. Add **share this view** and the small multi-artifact review. This is the
   clearest demonstration of the spatial advantage.
5. Add live relay and remote locations only with bounded disconnect/recovery
   acceptance. Improve local lenses and provenance in parallel-sized increments.

For the [hackathon strategy](meta-hackathon-strategy.md), a shareable review is
an optional way to let judges inspect a newly produced result. It should not
replace the strategy's working, verifiable core demo or turn its schedule into
an infrastructure migration. Every presented addition still needs to be clearly
identified as work built during the event.
