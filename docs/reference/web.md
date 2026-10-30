# Browser planes and local servers

This page lists the controls, rules and limits of browser planes, HTML file previews and the
built-in static server.

| View          | For                                                            |
| ------------- | -------------------------------------------------------------- |
| Browser plane | Interactive web pages, including a local development server.   |
| HTML preview  | Looking at one saved HTML file and its neighbouring files.     |
| Local server  | Serving a folder's files over `http://127.0.0.1` to a browser. |

## Browser planes

**Open web page…** asks for a **Web address** and opens a browser plane. A task's **+ Browser** and
a server's **Open in Viewer** open one too.

| Address typed                                               | Opens                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| `localhost`, `127.0.0.1` or `[::1]`, with or without a port | `http://` that address                                                    |
| `host:port`, or no scheme                                   | `https://` that address                                                   |
| `http://…` or `https://…`                                   | That address                                                              |
| Any other scheme, or a user name or password in the address | Refused: **Enter an HTTP or HTTPS address without embedded credentials.** |

| Control                           | Does                                                            |
| --------------------------------- | --------------------------------------------------------------- |
| **Back**, **Forward**             | History.                                                        |
| **Reload page**, **Stop loading** | Reloads, or stops a load. A hung page's process is ended first. |
| **Go**                            | Opens the address in the field.                                 |
| **Open in default browser**       | Opens the current address in your default browser.              |
| **Open page in window**           | Opens the page in a separate Viewer window.                     |
| Zoom (the **%** button)           | Shows the page zoom; choosing it resets to 100%.                |
| **Retry**                         | Reloads after a failed load.                                    |

With the page focused, **⌘C**, **⌘V**, **⌘X** and **⌘A** edit, **⌘R** reloads, **⌘+** or **⌘=**
zooms in, **⌘-** zooms out and **⌘0** resets. Zoom runs from 50% to 300% in steps of 10%.

| Rule        | Behavior                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Profile     | One isolated, persistent Chromium profile for all browser planes; separate from Viewer itself.                                      |
| Requests    | Pages navigate to `http` and `https` only; their requests may also use `ws`, `wss`, `data`, `blob` and `about`. Others are blocked. |
| Permissions | Every site permission request is denied: camera, microphone, location, notifications and others.                                    |
| Downloads   | Blocked.                                                                                                                            |
| New windows | A page's `window.open` or `target=_blank` link opens in the same plane.                                                             |
| Isolation   | Pages get no Viewer preload, file protocols, agent access or app session.                                                           |
| Planes      | 8 browser planes at once, across all windows.                                                                                       |
| Restore     | A saved browser plane opens its last address again.                                                                                 |

The page is drawn into the plane, so it stays interactive under the space's perspective. Whether a
site works or keeps a sign-in depends on the site.

**Open page in window** opens a 1000 × 740 window with the page's own keyboard focus and
accessibility tree, for a screen reader. It uses the same browser profile, so sign-ins carry over;
form values and scroll position do not. The plane stays open. Up to 8 page windows are open at once,
and they do not reopen after quitting.

## HTML preview

Selecting an `.html`, `.htm` or `.xhtml` file shows **Preview** and **Source** tabs and **Reload**,
which reads the saved file and its local files again. Editing the source uses the ordinary editor.

| Rule          | Behavior                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| Sandbox       | Scripts run in an opaque-origin sandbox. Forms, frames, workers and plugins are off.                         |
| Loads         | Only files in the HTML file's folder and below; no network.                                                  |
| File types    | HTML, CSS, JavaScript, JSON, PNG, JPEG, GIF, WebP, AVIF, SVG, ICO, BMP and WOFF, WOFF2, TTF, OTF, EOT fonts. |
| Sizes         | The HTML file up to 4 MiB; each other file up to 32 MiB.                                                     |
| Folders       | No directory listings.                                                                                       |
| Open previews | 16 per window, 64 in all.                                                                                    |

Email messages (`.eml`, `.emlx`, `.mbox`) and saved web pages (`.webarchive`) show the same way,
without scripts. For a site that needs a server, a build or a sign-in, use a browser plane.

## Local servers

**Start local server** (in a folder, or with one folder selected) opens a server plane and starts
serving that folder. **Local servers…** lists this window's servers with **Show plane** and
**Stop**.

| Control                                        | Does                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Start**, **Stop**, **Restart server**        | Starts, stops or restarts the listener.                                                                         |
| **Address**                                    | The server's `http://127.0.0.1:PORT/` address.                                                                  |
| **Copy server URL**                            | Copies the address.                                                                                             |
| **Open server in browser**                     | Opens the address in your default browser.                                                                      |
| **Open in Viewer**                             | Opens it in a linked browser plane.                                                                             |
| **Filter requests**                            | Filters the log by text.                                                                                        |
| **Request method**, **Request status**         | Filters by method, or by **2xx · Success**, **3xx · Redirect**, **4xx · Client error**, **5xx · Server error**. |
| **Auto-follow**                                | Keeps the newest request in view.                                                                               |
| **Refresh request log**, **Clear request log** | Reads or empties the log.                                                                                       |

The log has **Time**, **Method**, **Path**, **Status**, **Duration** and **Size** columns. It keeps
the last 200 requests in memory, and paths exclude query strings.

| Rule            | Behavior                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------- |
| Address         | IPv4 loopback `127.0.0.1` only, on a port the system assigns. A restart can change the port. |
| Host            | The `Host` header must be exactly `127.0.0.1:PORT`. `localhost:PORT` is refused with 403.    |
| Origin          | Cross-origin and cross-site requests are refused.                                            |
| Methods         | `GET` and `HEAD` only; requests with a body are refused.                                     |
| Folders         | `index.html` if present, otherwise a listing of up to 200 entries.                           |
| Hidden files    | Any path part starting with `.` is refused, as are encoded `/`, `\` and null characters.     |
| Links           | A link may resolve only inside the served folder.                                            |
| Files           | Up to 128 MiB each, with byte ranges. Responses are `no-store`.                              |
| Connections     | 16 at once, 100 requests each; headers within 8 KiB and 5 seconds.                           |
| Servers running | 16 in all, 8 per window.                                                                     |
| Server planes   | 64 in all, 32 per window.                                                                    |

The server sends files as they are on disk. It runs no build step, framework server or hot reload;
start a project's own server with [Run command… or a terminal plane](terminals.md) and open its
address in a browser plane.

A listener belongs to its window, not its plane. Closing the plane keeps a running server; reopen it
from **Local servers…**. Closing the window or quitting Viewer stops its servers. A saved server
plane restores stopped. When the server is stopped, a linked browser plane shows **The local server
is stopped.** with **Start server** and **Server details**; after a restart it goes to the new
address and keeps its path.

Agents cannot start servers or use a browser plane's sessions.

**Related:** [Work on a project](../guides/develop.md#look-at-a-local-site) ·
[Terminals](terminals.md) · [Tasks and Git](tasks-and-git.md) ·
[Read and inspect files](../guides/previews.md) · [Formats](formats.md)
