# Canvases and quote branches

A canvas is a private versioned document linked to a conversation. Its plane identity is stable
across content changes. Content revisions hold HTML, default values, evidence snapshots and assets.
Input state has a separate revision counter; changing a control does not reload the page. Rapid
updates retain the latest value for each changed key while a save is in flight. Refinement requests,
quote branches, reload and export wait for pending input saves. Content and state revision checks
still reject stale changes.

## Runtime API

Generated HTML receives `window.viewerCanvas`:

| Member                                 | Behavior                                                 |
| -------------------------------------- | -------------------------------------------------------- |
| `getSources()`                         | Return copies of bound evidence snapshots                |
| `requestRobotCheck(sourceID,stateKey)` | Ask Viewer to check the task saved under that state key  |
| `requestExport(result)`                | Request host review of `{format,name,content}`           |
| `getState()`                           | Return a copy of saved input state                       |
| `setState({ key: value })`             | Merge values and request a desktop save                  |
| `subscribe(listener)`                  | Observe state updates; returns an unsubscribe function   |
| `assets`                               | Attached assets as `{ id, name, mime, url }` records     |
| `openSource(id, joint?)`               | Request source review, optionally for a named URDF joint |
| `propose(text)`                        | Prepare text for review in the conversation              |

Use stable state keys. A new content revision cannot change the type of an existing saved value.
HTML, CSS and scripts run in an opaque sandbox through `viewer-html`. The page has no desktop
bridge, Node, credentials, parent-document access or external network. Asset URLs belong to that
preview. Workers, nested frames, forms and plugins are disabled.

The import map supplies `three` and bundled `three/addons/` modules for `OrbitControls`,
`GLTFLoader`, `STLLoader`, `BufferGeometryUtils` and `SkeletonUtils`. Other dependencies must be
included in the document; remote CDNs are unavailable.

Snapshots contain `{id,name,version,hash,data}`. `data` contains bounded `facts`, `evidence`,
`coverage`, and optionally `table: {rows,malformed}` for CSV/TSV. Rows include the header. Local
source paths are not exposed to the frame. `openSource(id)` opens the host's source review.
Refreshing replaces the snapshot under its existing ID in a new content revision and preserves saved
inputs. Undo restores the previous snapshot as well as HTML.

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
structured turns retain a 32,000-character text limit. `canvas_asset` attaches a file the
conversation is allowed to inspect. Attached files require the provider's images data level before
being sent as model context.

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

A canvas turn has an eight-minute overall deadline. Each model request retains its own two-minute
timeout, and **Stop** cancels the turn. Ordinary Chat turns keep their two-minute overall deadline.

## Robot sources and motion

`canvas_source` recognizes `.urdf` files. A complete definition supplies `data.robot`, with
`format`, `name`, `root`, `units`, `links`, `joints` and scope `notes`. Links contain visual
geometry, origins and optional RGBA colors. Joints contain parent and child names, type, origin,
normalized axis, hard position limits and the exact captured definition. URDF units are metres and
radians. The file's zero convention is preserved; hardware calibration is not inferred.

The reader supports one connected tree with fixed, revolute, continuous and prismatic joints. It
rejects mimic, floating and planar joints, cycles, unresolved macros, missing hard position limits
and incomplete source text. Limits are 128 KB of input, 64 links and 256 visual elements, subject to
the existing snapshot size limit. Supported visuals are meshes, boxes, spheres and cylinders.
Collision geometry, dynamics, soft safety-controller limits and calibration tags do not participate
in these calculations. Texture resources are not loaded.

`canvas_robot_assets` takes `path` to an already-bound URDF. It authorizes and attaches the relative
binary STL visual files, returning `{resources:[{resource,assetID}],revision}`. Each file must
already belong to the conversation's scope, and provider images permission is required. The
containing folder can supply that scope; attaching only the URDF does not. Paths must stay within
its folder, without links, parent traversal, absolute paths or package/network URLs. A mesh is
limited to 200,000 triangles and the normal canvas asset budgets. Failed or cancelled attachment can
retain previously attached assets; it does not change the original files.

Use the returned IDs to find asset URLs. Resource names inside URDF are metadata, not fetchable
URLs. The offline `viewer/robotics` module exports:

- `forwardKinematics(robot, positions, base?)`: `positions` names every movable joint exactly once.
  `base` is `{xyz:[x,y,z],rpy:[roll,pitch,yaw]}`, defaulting to zero. The result has `links`, a map
  of column-major 4×4 world transforms, and `violations`, the unclamped hard position-limit
  violations.
- `originTransform(origin)`: convert URDF fixed-axis roll/pitch/yaw and translation to a matrix.
- `multiplyTransforms(a,b)`: compose two column-major matrices. A visual's world transform is its
  link transform multiplied by its visual origin, followed by its mesh scale.

The page can call `openSource(sourceID,jointName)` to show a captured joint in the host's source
review. **Open joint definition** navigates through the original version and stored anchor.

`await solvePosition(robot,{link,point,target,positions,base,tolerance},signal?)` searches for a
candidate tool position. `point` is local to `link`; `target` is in world coordinates. It returns
`{outcome,positions,residual,iterations}`. `outcome` is `candidate` or `unresolved`. A failed
numerical search does not establish unreachability. The solver uses a damped Jacobian update with
hard-limit projection, deterministic restarts and line search. It preserves joints outside the tool
chain. Its cap is six attempts of 96 iterations, at most 16 moving chain joints. It yields every
eight iterations and accepts an AbortSignal. Inputs are copied before yielding. Tolerance is
0.000001 to 0.005 metres. Orientation is not a search objective.

`createPoseReplay(robot,poses)` copies 1 to 16 complete poses, each `{targetID,positions}`. It
returns `{length,sample(cursor)}`. The cursor is a finite number from zero to `length-1`; integer
cursors return the supplied endpoints. Fractional cursors linearly interpolate explicit joint values
and return `{from,to,fraction,positions}`. Continuous joints retain explicit revolutions; values are
not wrapped or clamped. The function owns no animation clock and changes no saved inputs. It does
not validate a trajectory. Generated controls must keep sampled poses separate from the task,
provide pause and scrubbing, stop at the last pose, and pause when hidden or reopened.

### Check target poses in Viewer

Save the task under one stable canvas state key, then call `requestRobotCheck(sourceID,stateKey)`.
The task shape is:

```json
{
  "version": 1,
  "units": { "length": "m", "angle": "rad" },
  "tool": { "link": "tool_link", "point": [0, 0, 0] },
  "base": { "xyz": [0, 0, 0], "rpy": [0, 0, 0] },
  "tolerance": 0.001,
  "targets": [{ "id": "A", "position": [0.2, 0.1, 0.3] }],
  "poses": [{ "targetID": "A", "positions": { "joint_name": 0.5 } }]
}
```

The example shows syntax, not a measured robot pose. Supply each actual movable joint exactly once.
There must be exactly one pose per unique target, with at most 16 targets. The host waits for input
saves and verifies the persisted values, not an independently supplied frame payload. The desktop
checker uses a separate point-propagation implementation from the solver's matrix implementation. It
measures each endpoint's error and all hard joint bounds. The panel displays the tolerance, world
target coordinates, tool offset, base transform and source-linked limit violations.

The saved binding contains the source ID/hash, canonical task hash, canvas content revision, checker
version and request time. It contains no pass/fail result. Every report is recomputed in Viewer,
including after restart and portable import. Changed task inputs, source snapshots or canvas content
require a new check. Unrelated camera state does not. `canvas_read` and the conversation's canvas
context include `robotReport`; its status is `checked` or `stale`. A checked report can pass or
fail. Generated HTML has no API for supplying a check result.

**Save check JSON…** builds its payload in the desktop service and uses the existing exclusive
new-file save. The saved file includes inputs, source version/hash, checker version, residuals and
joint violations. Revision and check-binding changes during save review cancel the write. Ordinary
frame exports remain proposed content; JSON parsing does not certify them as checked.

These checks cover endpoint positions and hard position limits only. Orientation, intervals between
poses, collision, dynamics and hardware calibration remain unchecked. No physical operation is
implied.

### Compare base placements

A quoted alternative can request `robot-comparison` through the host. Viewer resolves its saved fork
reference, enforces window ownership and recomputes both current checks. The model snapshot hash and
parsed model must match. Units, tool link and local point, tolerance, ordered world targets and pose
target order must match exactly. Base transforms and candidate joint positions may differ. Missing
or stale checks and unequal fixed inputs produce `status: 'unavailable'` with a reason.

A `compared` result includes `sourceHash`, `original` and `alternative`. Each side records canvas
ID, title, content and input revisions, task hash and its independently recomputed endpoint report.
`canvas_read` and conversation context include `robotComparison` for a fork. The Viewer panel
refreshes when either canvas changes. A compared result can contain failed endpoints; it is not an
unreachability proof.

**Save comparison JSON…** exports both measured tasks with checker version `position-v1`. Changes to
either side during save review cancel the new-file write. Comparison results are recomputed after
restart. A portable canvas import drops the fork link and retains its own task and check; the
separately saved comparison JSON retains both measured tasks as a snapshot.

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
