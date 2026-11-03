# Canvases and quote branches

A canvas is a private versioned document linked to a conversation. Its plane identity is stable
across content changes. Content revisions hold HTML, default values, evidence snapshots and assets.
Input state has a separate revision counter; changing a control does not reload the page. Rapid
updates retain the latest value for each changed key while a save is in flight. Refinement requests,
quote branches, reload and export wait for pending input saves. Content and state revision checks
still reject stale changes.

Model requests include the current canvas and its evidence. Historical tool snapshots reference
identical large values in that current context through `$viewerContext` JSON Pointers. Different
historical values, action results and check failures remain present. This projection does not alter
the saved transcript or frozen quote context. Meta receives each current-turn result once, paired
with its native tool call. The existing context and inspection limits still apply.

## Tool ownership and management

A plugin includes its interface, application logic and tests. The agent can reuse an existing plugin
or template and extend its code across requests. Viewer supplies the scaffold, context snapshots,
local assets, sandbox, action transport, persistence and export review. Domain parsing, calculations
and validation belong to the plugin package. The host does not supply a robotics solver or a pose
checker. The [ownership decision](../adr/0015-generated-tool-host.md) defines this boundary.

**Tool library** is a persistent Plurid plane, available from commands, Chat and a canvas toolbar.
It lists saved canvas documents without starting them. Each entry has a name, project, revision,
source and asset counts and enabled state. Rename and enable changes require the current revision.
Disabling invalidates live registrations, cancels pending work and stops the visible frame. A late
result cannot change saved inputs. Enabling permits a fresh frame; it does not resume a canceled
model request.

**Duplicate** creates a new conversation and canvas with copied inputs, sources and asset
references. It makes no model request. **Source code**, **Undo revision**, quoted alternatives and
portable export operate on the same document; there is no separate plugin registry or executor. The
library reads at most 1,000 documents from its own private directory. Invalid entries show an error,
linked files are ignored, and documents open in another window cannot be changed.

## Runtime API

Generated HTML receives `window.viewerCanvas`:

| Member                                | Behavior                                                       |
| ------------------------------------- | -------------------------------------------------------------- |
| `getSources()`                        | Return copies of bound evidence snapshots                      |
| `requestExport(result)`               | Request host review of `{format,name,content}`                 |
| `getState()`                          | Return a copy of saved input state                             |
| `setState({ key: value })`            | Merge values and request a desktop save                        |
| `subscribe(listener)`                 | Observe state updates; returns an unsubscribe function         |
| `assets`                              | Attached assets as `{ id, name, mime, url }` records           |
| `openSource(id)`                      | Request review of a captured source                            |
| `propose(text)`                       | Prepare text for review in the conversation                    |
| `registerAction(definition, handler)` | Register a named operation in this live frame                  |
| `invokeAction(id, input)`             | Run a registered operation through the host; returns a promise |

Use stable state keys. A new content revision cannot change the type of an existing saved value.
HTML, CSS and scripts run in an opaque sandbox through `viewer-html`. The page has no desktop
bridge, Node, credentials, parent-document access or external network. Asset URLs belong to that
preview. Workers, nested frames, forms and browser plugins are disabled.

The import map supplies `three` and bundled `three/addons/` modules for `OrbitControls`,
`GLTFLoader`, `STLLoader`, `BufferGeometryUtils` and `SkeletonUtils`. Other dependencies must be
included in the document or attached as code assets; remote CDNs are unavailable. A plugin can
import an attached JavaScript module with `await import(asset.url)`, where `asset` is an entry in
`api.assets`. The asset is stored by hash, travels with the exported canvas and runs under the same
sandbox restrictions. It is not added to the host's import map or exposed to other tools.

### Actions shared by the person and agent

Register a handler once per frame. Use the same action from a visible button and from the model's
`canvas_invoke` tool. The handler receives copied inputs, captured saved state and an AbortSignal.
Return `{result,patch?}`; the host validates and saves the patch as one state revision. Calling
`setState` inside a running handler is refused. Observe the host's saved state through `subscribe`.

```js
const api = window.viewerCanvas;
api.registerAction(
  {
    id: 'calculateTotal',
    label: 'Calculate total',
    inputSchema: {
      type: 'object',
      properties: { quantity: { type: 'number', minimum: 1, maximum: 1000 } },
      required: ['quantity'],
      additionalProperties: false,
    },
  },
  ({ quantity }, { state, signal }) => {
    signal.throwIfAborted();
    const total = quantity * state.unitPrice;
    return { result: { total }, patch: { quantity, total } };
  },
);
// A visible control receives the handler's result after its patch is saved.
const { total } = await api.invokeAction('calculateTotal', { quantity: 20 });
```

`invokeAction` resolves to the handler's `result` value directly. It does not return the
`{result,patch}` handler envelope or the model tool's execution record. Failed or canceled actions
reject the promise.

There are at most 16 actions per frame and 24 scalar inputs per action. Inputs accept strings up to
1,000 characters, finite numbers or booleans. Optional enum, minimum, maximum and description fields
constrain them. Action IDs start with a letter and contain at most 80 letters, digits, dots,
underscores or hyphens. Labels are at most 120 characters. Results must be JSON within 32,000 UTF-8
bytes. Patches share the 128,000-byte canvas-state limit and cannot change an existing value's type.

One action runs per canvas, with a 30-second deadline. Its activity row names the actor and action.
**Take over** cancels pending work and stops the associated model turn. **Stop** removes the frame.
An action holds input editing while it runs. Revision changes, frame closure and cancellation
discard pending results. Once a validated result starts its atomic save, that save settles as
completed or failed; late cancellation cannot relabel a saved result as discarded.

Registrations and activity are live-frame state, not portable authority. Reloading or reopening must
register handlers again. Window, conversation, frame, content revision and input revision are
checked before invocation; duplicate and late replies are rejected. A completed action means its
handler ran. Domain checks and tests run in the generated plugin. The host does not certify their
conclusions or supply an undisclosed domain implementation. Actions gain no file-write, shell,
network or provider capability.

Snapshots contain `{id,name,version,hash,data}`. `data` contains bounded `facts`, `evidence`,
`coverage`, and optionally `table: {rows,malformed}` for CSV/TSV. Rows include the header. Local
source paths are not exposed to the frame. Text snapshots retain up to 48,000 UTF-8 bytes of
evidence within the source limit. File formats such as URDF are supplied as text for the plugin to
interpret; they do not trigger a host domain parser. `openSource(id)` opens the host's source
review. Refreshing replaces the snapshot under its existing ID in a new content revision and
preserves saved inputs. Undo restores the previous snapshot as well as HTML.

Result formats are `csv`, `json`, `markdown`, `text` and `dxf`. `content` is UTF-8 text, limited to
1 MB; JSON must parse. `name` is a basename without path separators. The host adds the extension if
missing. It captures content and state revisions when preparing review and checks both again after
the save picker. Saving creates an exclusive new file; it never overwrites a destination or follows
a destination link. Canceling writes nothing. Completing a save closes only its own review. A newer
result requested while the picker is open remains available for a separate review and save.

### Cutting DXF results

`dxf` accepts ASCII DXF with `$INSUNITS` set to `4` (millimetres). Supported sections are `HEADER`,
`TABLES` and `ENTITIES`. Cuts use `LINE`, `ARC`, `CIRCLE`, `LWPOLYLINE` or planar `POLYLINE`
entities. Polylines have zero width. Cuts must form closed outlines; hidden entities, paper-space
entities, blocks, annotations, loose paths, duplicates and repaired gaps are refused. All geometry
lies in XY with zero elevation and thickness.

The limits are 256 cut entities, 2,048 vertices, 15,000 DXF groups, 8,192 preview points at 0.01 mm
chord tolerance, and numeric geometry values within 10,000 of the origin. Viewer rewrites accepted
geometry as R12 DXF through its fabrication writer, then reads and measures those bytes for review.
The desktop repeats validation before saving. The preview reports geometry dimensions; it does not
certify attachment requirements, material, tool clearance or manufacturing readiness.

## Model tools

`canvas_read` obtains current content, saved state and revision. `canvas_write` supplies complete
HTML in `text`, a title in `query`, the expected revision in `commandID`, and default state values
in `patches`. Canvas writes accept up to 512,000 HTML characters, matching the document limit. Other
structured turns retain a 32,000-character text limit. `canvas_asset` attaches the explicit paths in
`path` and `files`, up to 24 unique files. Every path must be in the attached conversation context.
The full list is authorized before the first attachment. It returns `{assets,revision}`. Attached
files require the provider's images data level before being sent as model context.

Writes use revision checks. A stale response cannot replace a newer revision. The model receives
current content and state, not the entire revision history. Canvas requests cannot authorize file or
shell operations.

`canvas_source` inspects an authorized attached file and returns `{source,revision}`. Repeating it
returns the saved snapshot unchanged; refresh is a user action. Source context requires the
provider's document-excerpts permission.

`canvas_read` and the next model round include `actions`, `lastAction`, `stateRevision`, `enabled`
and the generic `host` contract. `canvas_invoke` takes JSON in `text`:
`{"action":"calculateTotal","input":{"quantity":20},"revision":1,"stateRevision":0}`. It invokes
only the current conversation's live canvas and returns its actual status, result and saved state.
It cannot invoke a handler in another conversation or an unopened frame.

Preview observations are tied to a content revision. `ready` means the page loaded, not that its
calculations were verified. `error` includes a bounded runtime message. `not-observed` means no
renderer report arrived. The agent may make one repair after a runtime error, within the same
eight-round request budget; remaining errors stop further automatic repairs.

A canvas turn has an eight-minute overall deadline. Each model request retains its own two-minute
timeout, and **Stop** cancels the turn. Ordinary Chat turns keep their two-minute overall deadline.

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
