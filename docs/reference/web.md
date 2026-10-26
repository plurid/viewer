# Browser planes and local servers

Viewer has two web views with different jobs.

## Open a webpage

A **browser plane** is an interactive Chromium page with address entry, Back, Forward, Reload, zoom
and Open externally. It uses an isolated persistent browser profile and remains interactive under
spatial perspective. Site compatibility, login and device permissions depend on the site and
available browser support.

A failed navigation has retry controls. For an associated stopped local server, the plane offers
**Start server** and **Server details**. Restarting at the same address navigates again rather than
keeping an old error.

## Preview an HTML file

An HTML file preview provides **Preview**, **Source** and Reload. Its rendered document uses a
restricted sandbox; it is for inspection rather than a full authenticated browsing session. Editable
source uses the ordinary file editor.

Use a browser plane or a local server for interactive project behavior that the file preview
intentionally does not run.

## Serve a folder

Start the built-in local server from the folder's commands. Its plane shows the loopback address,
status and bounded request log, with filters and follow controls. Open the address in a browser
plane or external browser.

The listener belongs to its workspace window, independently of its controls view. Closing that plane
keeps a running server available through **Local servers…**. Stopping ends the listener; quitting
its window ends window-owned runtimes. Saved server views restore stopped until explicitly started.

The server serves static files. It does not run framework build commands or hot reload. Use
[Run command or a terminal](terminals.md) for a project's own server, then open that URL in a
browser plane.

Authenticated browser sessions and listener-start authority are not agent tools.
[Task areas](tasks-and-git.md) can retain the logical links between servers and their browser views
without automatically restarting them.
