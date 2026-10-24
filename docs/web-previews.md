# HTML previews and local servers

Open an HTML file to see its rendered **Preview**. **Source** shows the same file
in the text viewer and editor; Edit and ⌘E work there too. Returning to Preview
with unsaved edits offers the existing Save, Discard or Cancel choice. Cancel
keeps the text, caret and undo history. **Reload** refreshes the saved page and
its local assets.

The embedded page can run its scripts and load nearby HTML, CSS, JavaScript,
JSON, images and fonts. It has an opaque sandbox origin, no Viewer bridge and
no external network access. Private capability URLs stay inside the selected
folder; dotfiles, outside symlinks and unsupported assets are refused.
HTML held inside an archive or comparison remains available as Source.

Choose **Start local server** from a folder's commands or the File menu. Viewer
opens a **Local server** plane linked to that folder and starts an HTTP listener
on `127.0.0.1` with an available port. The plane shows the URL, Copy URL, Open in
Browser, Start, Stop and Restart. It serves static files and `index.html`; a folder
without an index gets a bounded directory listing. Use a framework's development
server when the project needs compilation or hot reload.

The request log shows method, path, status, duration and transferred bytes. Its
filters, refresh and auto-follow controls operate on the most recent 200 requests.
Query strings, headers and bodies are not retained. **Clear request log** clears
only this in-memory history.

A running server belongs to its window and server plane. Spatial culling leaves
it running; closing the plane or window stops it. Saved server planes reopen
stopped and wait for Start. Restart may assign a different port, so copy the
current URL afterward. Server controls and logs stay in the local workspace and
are excluded from portable project exports. Agents cannot start these listeners.

The services only read project files. They use bounded reads, native access
checks, captured folder identities and explicit lifecycle cleanup. The HTTP
listener accepts only its own loopback Host and same-origin browser requests;
it is not a LAN sharing server.
