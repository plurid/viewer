# Terminals

The searchable file/background menu and Commands provide **Open in Terminal**, **Open in tmux** and **Open terminal plane**. A selected folder becomes the working directory; a selected file uses its parent; otherwise the action uses the active browsing column or folder. Targets capture the originating workspace, root, plane and directory before asynchronous work. Opening a terminal in another root creates an independent terminal.

## External terminal

Settings → Terminals chooses the app, default shell profile, scrollback and tmux options. `settings.terminals.application` accepts `auto`, an application name or an absolute `.app` path. Auto prefers a running supported terminal, then iTerm, then macOS Terminal. Discovery updates the contextual action's label to the selected application.

When a running iTerm installation contains its official bundled `it2`, Viewer checks for the `window new --command` capability before using it. Otherwise the OS opens a private executable `.command` file with the chosen application. That file safely quotes the working directory and arguments, removes itself and starts the selected shell. Viewer does not install a helper or change iTerm automation preferences. Explicit unsupported apps must be able to open `.command` files; there is no generic command-line contract for every terminal app.

## Shell profiles

Profiles are editable in Settings and `settings.terminals.profiles`:

```jsonc
"terminals": {
  "application": "auto",
  "profileID": "login",
  "profiles": [
    { "id": "login", "name": "Login shell", "executable": "", "args": ["-l"], "env": {} },
    { "id": "zsh", "name": "Project zsh", "executable": "/bin/zsh", "args": ["-l"], "env": { "PROJECT_MODE": "development" } }
  ],
  "scrollback": 10000,
  "tmux": { "executable": "tmux", "session": "viewer", "socket": "", "windowName": "{folder}" }
}
```

An empty executable resolves the user's login shell. Arguments are literal values. Profile IDs must be unique, and the default/custom-action profile must exist. Reserved Electron, dynamic-loader and Node process variables are rejected. Shells still run with the user's ordinary OS permissions. The login shell runs the user's own `$SHELL`; any other profile, a tmux program other than `tmux` with the default server, and an application chosen by `.app` path ask for native confirmation once, for that exact program, arguments and environment, before they first run. A saved terminal plane that would start on restore waits for the same confirmation, so imported or externally edited configuration cannot run code silently.

## tmux

The tmux action creates one new window in the configured shared session for each invocation. It creates the session if necessary, uses the captured working directory, supports an optional socket path, and expands `{folder}` in the window name. An existing iTerm control-mode client is reused; otherwise Viewer opens one using `tmux -CC`. Other terminal apps attach with an ordinary tmux client. Quitting Viewer leaves external tmux sessions running.

tmux must already be installed. Its executable and session can be configured; Viewer reports a missing executable or failed command rather than silently creating a second window. See the official [iTerm tmux integration reference](https://iterm2.com/documentation-tmux-integration.html).

## Embedded terminal planes

Each terminal plane runs a real PTY through a dedicated Electron utility process and uses xterm for terminal behavior. Linked terminal planes use the normal 90.1° child layout and face the camera when opened. Local panel size controls rows/columns; spatial zoom or rotation does not resize the shell. Command-K and Settings remain app commands; terminal keys and wheel input stay within the terminal. Copy/paste, bracketed paste, find and quoted dropped file paths are supported.

The PTY and terminal screen remain alive when camera culling detaches the React view or the workspace changes. Output is batched and acknowledged after xterm parsing, with backpressure for a hidden terminal. Closing a plane ends its owned PTY; quitting ends embedded sessions. Reopening the app restores terminal planes with fresh shells, and never replays old commands. This is session continuity within a running app, not a durable tmux replacement.

The native package includes and unpacks node-pty and its spawn helper. A successful renderer build alone does not verify terminal availability; the hidden desktop foundations test starts a real shell and checks output, interruption, geometry and independent root ownership.

Agents can be granted terminal read access only. Read access exposes bounded terminal output, which can contain secrets printed by commands; folder scope identifies the session's launch directory and is not process containment. Terminal input is unavailable to agents, because shell input cannot enforce Trash-only removal. Manage read grants in Settings → Agents, outside editable JSONC. A grant covers the folder its path resolves to; a folder chosen through a link or alias shows, and revokes, the grant made through it. Grants belong to the connection, not its token: regenerating the shared connection's token keeps them, so revoke them there too when the old token may have leaked. See [actions.md](actions.md).
