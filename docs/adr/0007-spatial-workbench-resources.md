# 0007: Separate views, runtimes and typed transformations

Accepted 2026-10-25.

Folder/preview views, server listeners, web guests and media drafts have different lifetimes. A
plane ID must not simultaneously identify all of them.

Server planes bind to stable window-owned runtime IDs. Closing a view detaches it; Local servers
reattaches controls. Window closure/quit stops its listeners. Restored descriptors remain stopped
until Start. Child creation uses a source row when applicable and header anchors for toolbar
actions; the controller keeps engine IDs and relationship discovery inside the workspace adapter.

Web guests use isolated persistent offscreen Chromium, without the application preload, Node, Viewer
protocols or agent DOM access. GPU textures, with bounded bitmap fallback, paint plane canvases;
projected pointer coordinates and an IME proxy deliver interaction under perspective. Culling pauses
painting while the guest retains navigation/session state. Saved URLs remain private.

Foreground preview claims, long response streams and transformation claims have separate bounded
native queues. This prevents unconsumed media streams from starving document access. Resource
acquisition is cancellable before a grant exists; stale completions dispose their grants. Document
extraction shares a bounded versioned cache and independently cancellable subscribers.

Media drafts are private revisioned documents. Typed image/media/PDF plans use an executor port on
the existing file-operation service. Fixed packaged processors own codecs; operations own staging,
source pins, publication, collisions, receipts and cancellation. Optimization results record sizes
and skip larger candidates. The renderer owns tools and drafts, not process arguments or a second
filesystem mutation queue. Workflows and agents prepare reviewed typed exports; they gain no shell,
deletion-approval or authenticated-browser capability.

Fabrication checks are private documents with independent views. Closing a plane detaches its owner;
only explicit cancellation stops its request. A restored check reads its saved result and never
replays a model call. Source verification and human confirmations bind to captured source versions.
The desktop validates them again when a reviewed correction or handoff executes.

Check and note instances may pin to the viewport. Per-instance engine policy preserves shared
preview route identity when a scratchpad is saved. Restoring a layout cannot bypass pinning policy.
Stack membership and previous placements are part of arrangement history, alongside geometry.

Saved workspace state uses byte-preserving pre-migration backups. Browser sessions, media drafts and
private check references stay outside portable project exports. Actual processor/UI behavior is
qualified with retained generated native fixtures; service tests alone do not qualify an interactive
surface.
