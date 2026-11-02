# Conversation canvases own content separately from input state

## Decision

The desktop canvas service owns revisioned generated HTML, saved user state and immutable assets.
The Plurid plane is a view of that document. It keeps its identity when an agent writes a revision.
Content replacement uses an expected revision and preserves compatible saved state. State updates
have their own revision counter and participate in the renderer's save barrier.

Canvas HTML runs through the existing private web-preview protocol in an opaque iframe. A narrow
MessageChannel carries bounded state patches and user-reviewed proposals. It does not expose preload
methods, file access, provider keys or shell execution. The host can remove the frame when its
renderer becomes unresponsive.

Source snapshots belong to content revisions and are hashed at the desktop boundary. Generated code
reads bounded evidence through the runtime, never local paths. Refresh is explicit and Undo restores
the earlier snapshot. Portable exports and backups strip source-path authority.

Result export is a request for host review. The host binds that review to both content and input
revisions, checks them again after the save dialog and creates only a new file. A frame cannot
silently write a result or replace an existing file. Preview observations report loading and runtime
errors; they do not certify calculation correctness. Repair attempts remain bounded.

Generated tools can register bounded named actions. The same handler serves a visible control and a
model invocation. The desktop binds each invocation to its window, conversation, live frame, content
revision and saved input revision. It validates scalar arguments, accepts one result and commits a
valid state patch once. The 30-second deadline, frame changes and user takeover cancel pending
execution. Cancellation cannot undo a result already accepted into the persistence queue.

The action broker is ephemeral. A portable canvas carries code and state, never a live registration.
Reopening creates new registrations. Chat records the actual tool result; execution status does not
assert mathematical correctness. Domain checks remain desktop-owned and recompute from saved source
snapshots. No action registry entry authorizes native execution or file removal.

Quote branches capture transcript context at an exact passage. Their canvases fork independently.
Applying content back checks the original revision and retains the person's newest original inputs.
Conflicts require comparison, not a silent overwrite.

Photo reconstruction is a desktop-owned paid job. A reviewed photo and SAM mask are submitted only
after native confirmation. Durable request IDs permit status recovery without automatic paid
resubmission. The result enters the same immutable asset store and canvas revision path as other
content.

## Consequences

Generated controls remain ordinary selectable DOM. The page can render a Three scene without gaining
native authority. Reopening, branching and exporting do not require a model call. Undo tracks
content, while the user's inputs persist independently. Personal backups must include history assets
and remap canvas and conversation references together.

The sandbox excludes arbitrary network APIs and remote module imports. Large or invalid assets are
rejected before rendering. A reconstructed mesh is inferred appearance and geometry, not dimension
verification.

## Owners

Contracts: `domain/canvases`, `domain/models/chat.ts`. Persistence, reconstruction and runtime
preparation: `desktop/canvases`. Preview capabilities: `desktop/previews/web`. Chat branching:
`desktop/chat`. Presentation: `renderer/canvases`, `renderer/chat`. Workspace placement remains in
the existing workspace controller.

[Canvas reference](../reference/canvases.md) · [Domain map](../../CONTEXT.md)
