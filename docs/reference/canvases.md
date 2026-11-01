# Canvases and quote branches

A canvas is a private versioned document linked to a conversation. Its plane identity is stable
across content changes. Content revisions hold HTML, default values, evidence snapshots and assets.
Input state has a separate revision counter; changing a control does not reload the page.

## Runtime API

Generated HTML receives `window.viewerCanvas`:

| Member                     | Behavior                                               |
| -------------------------- | ------------------------------------------------------ |
| `getSources()`             | Return copies of bound evidence snapshots              |
| `requestExport(result)`    | Request host review of `{format,name,content}`         |
| `getState()`               | Return a copy of saved input state                     |
| `setState({ key: value })` | Merge values and request a desktop save                |
| `subscribe(listener)`      | Observe state updates; returns an unsubscribe function |
| `assets`                   | Attached assets as `{ id, name, mime, url }` records   |
| `openSource(assetID)`      | Request a user-reviewed source action                  |
| `propose(text)`            | Prepare text for review in the conversation            |

Use stable state keys. A new content revision cannot change the type of an existing saved value.
HTML, CSS and scripts run in an opaque sandbox through `viewer-html`. The page has no desktop
bridge, Node, credentials, parent-document access or external network. Asset URLs belong to that
preview. Workers, nested frames, forms and plugins are disabled.

The import map supplies `three` and bundled `three/addons/` modules for `OrbitControls`,
`GLTFLoader`, `BufferGeometryUtils` and `SkeletonUtils`. Other dependencies must be included in the
document; remote CDNs are unavailable.

Snapshots contain `{id,name,version,hash,data}`. `data` contains bounded `facts`, `evidence`,
`coverage`, and optionally `table: {rows,malformed}` for CSV/TSV. Rows include the header. Local
source paths are not exposed to the frame. `openSource(id)` opens the host's source review.
Refreshing replaces the snapshot under its existing ID in a new content revision and preserves saved
inputs. Undo restores the previous snapshot as well as HTML.

Result formats are `csv`, `json`, `markdown` and `text`. `content` is UTF-8 text; JSON must parse.
`name` is a basename without path separators. The host adds the extension if missing. It captures
content and state revisions when preparing review and checks both again after the save picker.
Saving creates an exclusive new file; it never overwrites a destination or follows a destination
link. Canceling writes nothing.

## Model tools

`canvas_read` obtains current content, saved state and revision. `canvas_write` supplies complete
HTML in `text`, a title in `query`, the expected revision in `commandID`, and default state values
in `patches`. The structured turn's `text` field has a 32,000-character limit. `canvas_asset`
attaches a file the conversation is allowed to inspect. Attached files require the provider's images
data level before being sent as model context.

Writes use revision checks. A stale response cannot replace a newer revision. The model receives
current content and state, not the entire revision history. Canvas requests cannot authorize file or
shell operations.

`canvas_source` inspects an authorized attached file and returns `{source,revision}`. Repeating it
returns the saved snapshot unchanged; refresh is a user action. Source context requires the
provider's document-excerpts permission.

Preview observations are tied to a content revision. `ready` means the page loaded, not that its
calculations were verified. `error` includes a bounded runtime message. `not-observed` means no
renderer report arrived. The agent may make one repair after a runtime error, within the same
eight-round request budget; remaining errors stop further automatic repairs.

## Branches

A quote branch stores the original conversation and message IDs, exact text offsets, the quote, and
a frozen transcript through that message. Selection is limited to one message and 16,000 characters.
Branching makes no model request. If a canvas exists, the branch gets an independent copy and state,
with a reference to the original content revision.

Applying a branch checks that original revision and retains the original's latest state. It refuses
a content conflict. **Source conversation** navigates to the captured range; it does not
continuously reset selection as new messages arrive.

## Storage and bounds

| Item                      | Limit                                          |
| ------------------------- | ---------------------------------------------- |
| Document HTML             | 512,000 characters                             |
| Saved state and defaults  | 128,000 UTF-8 bytes each                       |
| Retained content history  | 16 revisions                                   |
| Assets per revision       | 24                                             |
| Individual asset          | 32 MiB                                         |
| Current assets combined   | 96 MiB                                         |
| Sources per revision      | 12                                             |
| One source snapshot       | 64,000 UTF-8 bytes                             |
| Source snapshots combined | 128,000 UTF-8 bytes                            |
| Tabular snapshot          | 500 rows, 4,000 cells                          |
| One proposed result       | 1,000,000 UTF-8 bytes                          |
| Personal backup           | 64 MiB, including base64 assets and formatting |

Documents live in `canvas-documents`; immutable bytes live in `canvas-assets` under their SHA-256
hash. Version 2 adds inline source snapshots; version 1 loads with an empty source list. Every load
verifies asset and snapshot hashes. Export creates a fresh folder. Import checks the manifest and
assets before creating a new document, rejects linked assets, and removes source-file authority from
assets and snapshots. Personal backups include assets referenced by revision history so Undo remains
valid. Restore remaps conversation, canvas and fork references without changing IDs used inside
HTML.

## Photo to 3D

Object selection uses the configured Meta SAM provider and its existing data approval. Generation
uses a separate encrypted fal credential and the fixed `fal-ai/sam-3/3d-objects` endpoint. The photo
and full-frame mask are reviewed before a native paid-generation confirmation.

The desktop saves intent before submission and saves the remote request ID before polling. A lost
acknowledgment becomes `submission-unknown` and is never automatically submitted again. Restart
resumes polling a known request. A cancellation request can still finish remotely; it is not shown
as cancelled until the provider confirms it. Provider errors remain visible.

Only a bounded GLB result is accepted. External resources, unsupported compression and excessive
geometry or texture allocation are rejected. Downloads are restricted to fal media hosts without
forwarding the API key. The saved asset includes provenance; reconstruction jobs and credentials are
excluded from portable backups. Restoring a model restores its asset, not a paid request.

[Canvas walkthrough](../guides/canvases.md) · [Personal backups](configuration.md#personal-backups)
