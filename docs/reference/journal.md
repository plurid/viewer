# Journal

Use **Open Journal**, **Journal for workspace** or **Journal for plane** to inspect Viewer activity.
The scoped commands prefill context; each Journal view keeps its own filters and reading position.

## Find an event

Filter by source, severity, workspace, plane, time or safe summary/IDs. Presets, named filters and
trace filtering help follow related events. Select a row for details and a link to its existing
source view.

Reading older activity pauses following. New matches increment a count without replacing the rows
you are inspecting. Resume explicitly returns to the latest events. Arrow keys, Home and End
navigate the virtual event list.

## What it records

Journal projects supported desktop activity into a bounded private event store. Sources retain their
real ownership: filesystem operations, commands, previews and other services report their own
events. Safe summaries exclude file contents, credentials and unrestricted process output.

Journal is diagnostic history. Operation receipts still own mutation and Undo; command receipts own
recorded process output. A history event cannot authorize, apply, undo or replay an action.

## Export and retention

Choose a reviewed export when you need to share selected activity. Inspect its scope before
exporting. Store retention and paging are bounded; Journal is not an unlimited external logging
backend. Human Journal commands do not expose a renderer append endpoint or agent query route.

For a command's literal output, open its [command receipt](terminals.md). For a failed operation,
use [Operations recovery](file-operations.md).
