# 0004: Keep the spatial Overview clear of plane controls

Accepted: October 24, 2026.

## Context

The engine minimap can overlap a projected plane header. Raising the entire minimap above the
workspace leaves buttons unreachable; disabling all minimap input removes useful navigation. The
engine must retain ownership of projection and its map buttons.

## Decision

`renderer/workspace/overlays/placement.ts` is a pure rectangle solver. It chooses a clear viewport
corner with explicit inset and clearance, retaining the current valid corner to avoid camera-induced
jitter. Visible plane controls, the viewcube and engine toolbar are obstacles. If no safe corner
fits, the host collapses the map to an explicit Overview entry rather than covering a control.

The Viewcube keeps the engine's corner anchors, conceal offsets, responsive rules and hover
transition. Viewer leaves those anchors and transition styles to the engine; a cube with conceal off
may receive a temporary translation to yield to a fixed map. If its visible, viewport-clipped
portion overlaps a protected control, the host temporarily suppresses its visibility and restores it
when the obstruction clears. The toolbar's full-width, click-through band is not an obstacle: only
its actual controls and open menus participate. Hover and completed transitions invalidate the
measurement as well as engine and viewport changes.

`SpatialOverview.ts` adapts only public Plurid DOM attributes and engine subscriptions. Measurements
coalesce to an animation frame after engine, resize or relevant child changes; active pointer
gestures and an expanded Overview hold placement steady. The map's empty background ignores pointer
input while its own buttons remain usable. Plane buttons receive host labels and paths.

The expanded Overview uses the browser top layer. Escape, native light dismissal and navigation
close it; keyboard focus returns to its connected opener as appropriate. Adapter disposal restores
owned attributes/styles and removes every subscription, observer and window listener. Plurid still
projects and navigates; the host does not fork its engine or edit dependencies.

## Consequences

Small or crowded workspaces expose Overview explicitly instead of guaranteeing an always-expanded
minimap. The fallback must remain discoverable and keyboard operable. Tests cover geometry,
collision fallback, observer lifecycle, input and focus behavior. Browser/native checks must
additionally use real projected headers, resizing, zoom and multiple camera orientations; source
tests alone cannot establish physical hit-testing.

Evidence: `spatial-overview.test.ts`, the browser workspace scenarios and the dated native
qualification ledger.

## Addendum: independent Overview and corner choice

Accepted: November 17, 2026.

At the owner's request, `ui.space.minimapCorner` adds `automatic`, `bottom-right`, `bottom-left`,
`top-right` and `top-left`. Automatic remains the default and keeps the existing collision solver
and corner retention. A fixed corner ignores obstacles and falls back only when the viewport cannot
fit the map. The expanded Overview uses the same fixed corner. This trades collision avoidance for a
still map when plane focus or camera movement changes the controls beneath it. An expanded fixed
Overview follows viewport, layout and corner changes. The viewcube yields to a fixed map by moving
to a clear corner while conceal is off. A concealed viewcube always keeps its engine position,
including when hovering reveals its controls. It may overlap the fixed map so it stays under the
pointer. The host adds a temporary translation without changing the engine's anchors or transitions,
restoring it when conceal is enabled or the map no longer obstructs its original position.
Measurements subtract the host's current animated translation from the reported box instead of
resetting styles. Placement is cached by map bounds, viewport and cube size, so completed
transitions do not restart movement. If no corner fits, the cube with conceal off is suppressed
until there is room.

Overview is available when the space is shown and holds a plane, independently of minimap
visibility. An empty space says Open a plane first. The host temporarily enables the engine's map
through surface configuration when needed, waits for its DOM element, then opens the original map in
the browser top layer. While the saved preference hides the minimap, CSS keeps the closed map
invisible between mounting, expansion and removal. Closing releases the temporary request on the
next animation frame without editing preferences, after the engine's root click listener has handled
navigation. Light dismissal restores the connected opener only if focus is on the body or inside the
map; focus taken by a clicked control stays there. Escape returns focus to the opener, while
choosing a plane retains navigation focus. Pending requests belong to their workspace epoch, can be
canceled with Escape before the map mounts and are cancelled when an applied engine configuration
produces no map. Docking or closing the last plane also closes Overview. Closing the last plane puts
keyboard focus on the empty workspace surface.
