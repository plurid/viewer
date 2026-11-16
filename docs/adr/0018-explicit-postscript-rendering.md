# Explicit PostScript rendering

Status: accepted.

## Decision

PostScript inspection reads bounded comments, source and embedded pictures without interpreting the
program. Illustrator files with a PDF inside use the existing PDF reader. A separate **Render pages
with Ghostscript** button is available only to the person in the direct edition. Selection, Quick
Preview, restoration and agent navigation never start the interpreter. There is no automatic render
preference or command alias. Automatic double-click opening continues to use the file's own app;
Space and explicit linked opening use Viewer.

Discovery checks only three fixed installation locations. The initial custom executable setting was
removed: imported or synced configuration could supply a program outside the execution-confirmation
and import-review guards, and an identity probe itself runs that program before it can identify it.
This version has no custom path. Ordinary preview configuration remains available to agents because
it no longer contains an executable setting. The resource IPC handler separately refuses rendering
during agent dispatch; neither CLI nor MCP exposes a rendering service.

Identity and version probing waits for the explicit click. The desktop requires the Ghostscript name
and version in bounded help output, verifies executable identity again, and includes that identity
and source version in the existing derived-preview cache key. Changes cannot reuse pages from
another interpreter.

The shared process runner owns direct spawning, a minimal non-inherited environment, deadlines,
stdout and scratch limits, priority reduction and process-group cancellation. It settles from the
owned process's exit with a bounded final stdout drain, so descendants cannot hold the cache slot
through an inherited pipe. The PostScript section is streamed through stdin with backpressure. TIFF
sections are bounded byte inputs to the existing image pipeline. Neither path makes a document copy
on disk. An EPS uses `-dEPSCrop` only for a stated, non-deferred box within the
[format limits](../reference/formats.md). A full-page fallback avoids failed or zero-sized pages
when comments cannot supply a usable box, and the preview explains that choice.

Ghostscript receives a private `TMPDIR`, a monitored 64 MiB scratch budget and `-K131072` for a 128
MiB allocation budget. The [format reference](../reference/formats.md) states sampling, traversal,
input, output and time limits. Normal completion leaves an empty stage, using the existing
empty-stage disposal rule. Only leftover interpreter scratch reaches Trash, under a truthful
Ghostscript scratch name; failed disposal preserves it. Preservation tests use recording adapters
that keep every stage and Trash receipt while exercising this disposal policy.

## Consequences

A fixed-location executable can still fail the identity check after the click. Its version is known
only after a rendering request. Inspection survives optional-picture errors and conversion failure;
malformed source or binary header ranges retain the hex fallback. One capped comment scan avoids
blocking the main process on newline floods. The Store edition still provides source, comments,
embedded pictures and PDF-compatible Illustrator content without an external interpreter.

Process groups stop all owned descendants while Viewer is running. A Viewer crash can leave the
detached interpreter running until it finishes or the person stops it; its main-process time and
scratch monitoring ends with that crash. The stage can remain. Safe mode and the allocation switch
are interpreter restrictions, not an operating-system sandbox or a hard RSS quota. Viewer does not
bundle Ghostscript or make a licensing decision for its owner.
