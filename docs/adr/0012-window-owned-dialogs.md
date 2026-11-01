# Ordinary dialogs belong to the requesting Viewer window

## Decision

`desktop/native/window-dialogs.ts` owns a bounded queue of ordinary file and message questions for
each BrowserWindow. `renderer/dialogs/DialogHost.tsx` presents that window's current question using
the shared Dialog control. Requests and answers cross one validated `dialog` IPC method. An answer
must name the active request in the sending window; another window cannot browse or answer it.

The desktop validates paths, file types, current access and destination conflicts. Folder browsing
reads one directory at a time. Choosing a destination does not write it. Each feature's existing
writer retains its save, recovery and changed-source checks. Editor replacement requires a second
explicit choice for the displayed destination and its current identity.

Renderer loss, navigation or window closure cancels outstanding questions. Callers with AbortSignal
can cancel queued notices. The renderer subscribes before requesting the current question so an
older handshake cannot replace a newer event.

## Native boundaries

The shared open/save facade uses OS panels when security-scoped bookmarks are needed, when no
renderer is ready, or when the person chooses **System dialog…**. Custom browsing cannot mint a
macOS sandbox grant. Native agent-removal and other protected approval dialogs keep their existing
authority and cannot be answered through the new renderer method.

## Consequences

Imports, exports, folder selection and ordinary editor warnings share Viewer styling and keyboard
behavior. Settings dialogs stay attached to Settings. Native panels remain available for platform
access and recovery. New callers must supply their owner window; they must not route protected
consent through the ordinary message facade.

[File guide](../guides/files.md#open-and-save-in-viewer) · [Domain map](../../CONTEXT.md)
