# Add a preview module

Work in `packages/viewer-electron/app`. Start with `src/renderer/previews/contracts.ts` and
`registry.ts`, then inspect a module with similar resource and interaction needs.

## Register a format

Add lightweight detection to the preview registry and lazy-load the component. Keep text language
detection in `src/domain/editing/languages.ts` so preview, highlighting and editing share one
catalog. Extension matches are hints; validate signatures/content when the format needs it.

Use the existing `PreviewContext` for authorized resources, cancellation, active state, preview
history, source evidence and host controls. A linked plane, Quick Preview and a column inspector
have different available space and editing capabilities. Do not create another file-access or
history service in the module.

## Bound the work

Set meaningful input, expanded-content, geometry/pixel, queue and output limits. Move expensive
parsing/decoding off the UI thread. Source version and authority must be checked before returning or
reusing derived content. Cache leases pin live consumers; last-consumer cancellation terminates
owned work.

`PreviewHost` wraps document reads in a window-local completed-data cache: at most 16 entries and 32
MiB of estimated retained data. Keys include workspace, file identity/version and worksheet window,
never a resource lease ID. Every hit requires a newly acquired authorized resource. Access changes
invalidate matching cached and pending results. Symlink entries bypass this layer because their
metadata describes the link; the desktop extraction owner checks the resolved target.
`DocumentCache` remains responsible for extraction and in-flight deduplication. Keep cached data
separate from resource URLs and mounted viewers; those belong to live consumers.

Release resources, workers, observers, controls and object URLs. Cleanup that needs the original DOM
root runs before detachment. Imperative canvas/model code must dispose renderer-owned resources
rather than relying on a global shared object to release its listeners.

## Make the preview useful

Use `PreviewToolbar` and `usePreviewCommands` for contextual controls. The host can place them in
its header; Quick Preview can render them inline. Keep content tools such as timelines, sheet tabs
and filters with their document.

Label partial rendering, missing assets, compatibility copies and unsupported features. Provide
retry or another useful view. Register small, bounded state with the existing history whitelist,
tied to source versions. Preserve unsaved text through the editing owner rather than a
component-local copy.

## Verify and document

Test detection, valid/malformed samples, bounds, cancellation, late results, source changes, revoked
access and repeated close/reopen. Check actual pixels or content, not only canvas existence. Use
real public samples with pinned provenance for complex formats.

Update [the current inventory](../reference/formats.md) and the relevant guide. Keep proposed
formats in [research](../research/formats.md). See [testing](testing.md) and
[Office](../reference/office.md) for layout versus semantic extraction examples.
