# Terminals and command output

## Run one command

Choose **Run command…** for a folder. Review its captured working directory and shell line, then
run. Output, elapsed time, actual status, Copy and Stop appear without opening an interactive
terminal.

Closing output leaves a running window-owned command alive. Receipts retain bounded command/output
history independently of that view. Restarting Viewer never replays a receipt. **Save as action**
transfers a draft to Settings for review.

## Open an interactive terminal

**Open terminal plane** creates a PTY under the captured folder; another root has an independent
terminal. **New terminal plane** explicitly creates another view. Find, copy/paste, bracketed paste
and quoted dropped file paths are supported.

The PTY and screen survive camera culling and workspace switching while Viewer runs. Closing the
plane ends its PTY. Cold restoration starts a fresh shell and does not replay input. A spatial zoom
changes the view, not the terminal's rows and columns; resizing its logical panel changes terminal
geometry.

## External terminal and tmux

Settings → Terminals chooses the application, shell profile, scrollback and tmux options. Auto
prefers a running supported terminal, then iTerm, then macOS Terminal. Custom applications must
support the platform's opening contract.

The tmux action creates a window in its configured shared session, creating that session if needed.
An existing iTerm control-mode client is reused where possible; other supported terminals attach
normally. External tmux sessions survive quitting Viewer. tmux must already be installed.

## Profiles and permissions

Profiles specify an executable, literal arguments and environment. An empty executable uses the
login shell. Non-default programs/configurations require their exact first-run native confirmation;
imported configuration cannot silently start arbitrary programs. A working directory is not a
filesystem sandbox.

Terminal typography has separate settings from previews and the editor. General configuration is
documented in [configuration](configuration.md).

Agents can receive separately scoped terminal-output read permission. Output can contain secrets
printed by a process. Read access does not grant terminal input; opaque input cannot enforce the
agent Trash-only policy. Manage effective read grants in Settings → Agents. See
[agent authority](agents.md).
