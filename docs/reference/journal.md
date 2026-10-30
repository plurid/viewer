# Journal

This page lists what the Journal records, its filters and controls, and how its history is exported,
bounded and cleared.

## Open it

| Command                   | Opens                            |
| ------------------------- | -------------------------------- |
| **Open Journal**          | Every event                      |
| **Journal for workspace** | Filtered to the active workspace |
| **Journal for plane**     | Filtered to the active plane     |

Each Journal plane keeps its own filters and reading position.

## What it records

The desktop records events from five sources. Each operation writes a `started` event, a `waiting`
event when a file operation waits for a name-collision decision, and one outcome; its events share a
trace ID.

| **Event source** | Actions                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Files**        | Copy, Move, Transfer, Duplicate, Create alias, Rename, Create folder, Create file, Move to Trash, Compress, Extract, Convert, Save file |
| **Git**          | Status, History, Stage selected, Stage all, Commit, Pull, Push                                                                          |
| **Chat**         | Model request                                                                                                                           |
| **Workspace**    | Save workspace                                                                                                                          |
| **Server**       | Start server, Stop server, Restart server, Close server                                                                                 |

| Phase       | Shown as               | Level   |
| ----------- | ---------------------- | ------- |
| `started`   | started                | Info    |
| `waiting`   | waiting for a decision | Warning |
| `succeeded` | completed              | Info    |
| `cancelled` | cancelled              | Info    |
| `failed`    | failed                 | Error   |

An event holds its time, source, action, phase, level, workspace, plane, window, trace, task and
session IDs, and where they apply its duration, items completed and exit code. It has no field for
file names, paths, arguments, credentials, file contents, Chat text, provider responses or terminal
output.

The Journal is diagnostic history. Operation receipts own changes and Undo; command receipts own
process output. An event cannot authorize, apply, undo or replay anything. No window can append to
it, and agents have no route to read it.

## Find an event

| Control                   | Values                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------ |
| **Search events or IDs**  | Up to 200 characters, matched against the summary, source and IDs                    |
| **Event source**          | **All sources** or one source                                                        |
| **Event severity**        | **All levels**, **Info**, **Warning**, **Error**                                     |
| **Event time range**      | **All time**, **Last 15 minutes**, **Last hour**, **Last 24 hours**, **Time range…** |
| **Journal workspace**     | **All workspaces** or one; a closed one shows as **Closed workspace**                |
| **Journal plane**         | **All planes** or one; a closed one shows as **Closed plane**                        |
| **Filters…**              | Presets and your saved filters                                                       |
| **Save Journal filters**  | Saves the current filters by name, up to 80 characters; 20 per Journal plane         |
| **Clear Journal filters** | Removes every filter                                                                 |

| Preset                     | Filter               |
| -------------------------- | -------------------- |
| **All activity**           | None                 |
| **Errors**                 | Level **Error**      |
| **Waiting for a decision** | Phase `waiting`      |
| **File operations**        | Source **Files**     |
| **Git**                    | Source **Git**       |
| **Chat requests**          | Source **Chat**      |
| **Local servers**          | Source **Server**    |
| **Workspace saves**        | Source **Workspace** |

The list shows 200 events at a time; **Load older events** reads the next 200. **↑**, **↓**,
**Home** and **End** move through it. Select a row for its details: **Show trace** filters to its
trace, **Go to plane** or **Go to workspace** opens its source when it is still open, and **Copy
event ID** copies the ID.

## Follow and pause

**Following live** shows new events as they arrive. Reading older events pauses following: new
matches then add to a count (**N new · Show latest**) without replacing the rows you are reading.
**Paused · Resume** or **Show latest** returns to the newest events.

## Export

**Export…** prepares the matching events as JSON (`{ "version": 1, "records": [...] }`) and shows
the exact text with its count and size. It includes the internal workspace, plane and task IDs and
nothing else beyond the event fields. **Save export…** writes it to a new file you choose; it never
overwrites an existing file.

| Export limit      | Value                                                        |
| ----------------- | ------------------------------------------------------------ |
| Events            | The newest 2,000 matching; narrow the filters for older ones |
| Preview valid for | 10 minutes; then preview again                               |

## Storage and clearing

The Journal is one private local file. It holds up to 10,000 events or 8 MiB, whichever comes first.
It does not rotate. When it is full it stops recording, says **Journal is full. Export events, then
move history to the Trash to continue recording.**, and counts the events it could not record this
session.

**Move history to Trash…** asks for confirmation, then moves the Journal file to the Trash and
starts an empty one. If the file changed outside Viewer, recording stops and the file is kept:
**Recording is unavailable. Existing history is preserved; actions still work.**

**Related:** [Get back to your work](../guides/troubleshooting.md) ·
[File operations](file-operations.md) · [Terminals and command output](terminals.md) ·
[Terms](terms.md)
