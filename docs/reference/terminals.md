# Terminals and command output

This page lists how Viewer runs one shell line, keeps its receipt, opens terminal planes and hands
off to an external terminal or tmux, with the settings, limits and agent access for each.

Terminal commands use the selected folder, a selected file's folder, or the active browsing column.

## Quick commands in the palette

In **⌘K**, type `!` to open **Quick command**. **Return** runs the text verbatim using the default
shell profile; **Shift+Return** adds a line. The limit is 16,000 characters. The folder displayed
above the input is captured on opening: the folder or active browsing column, a terminal's starting
folder, a preview's parent, or Home when no file context is active. Execution refuses a context
whose workspace, plane or path has changed.

Output streams inline with status, exit code, **Stop**, **Copy output** and **Open receipt**.
Closing the palette does not cancel the command, and reopening returns to its last output. Only one
quick command runs at a time in a window. The output buffer keeps the last 256 KiB and marks
truncation. Interactive programs need a terminal plane. Quick commands use the same execution
service, process cancellation and receipts as **Run command…**.

## Run one command

**Run command…** opens the **Run command** dialog for the current folder.

| Control             | Behavior                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| **Command**         | One or more shell lines, up to 16,000 characters. **⌘Return** runs it.                           |
| **Recent**          | The last 20 commands run from this window; **Clear** empties the list.                           |
| **Run**             | Starts the command in the folder and shows it in **Command progress**.                           |
| **Save as action…** | Names it (**Action name**), then **Review in Settings** sends a draft to **Settings → Actions**. |

The command uses the default shell profile. **Settings → Terminals → Command startup** defaults to
**Load shell configuration**: Viewer adds `-i` for zsh, bash and fish, preserving the profile's
arguments. The built-in **Login shell** profile runs `$SHELL -l -i -c COMMAND`. Each shell reads its
own startup files, including `.zshrc` for zsh, so configured aliases and functions work. zsh honors
`ZDOTDIR`; bash follows its login or non-login startup rules.

Choose **Use profile arguments only** to run `SHELL ARGS -c COMMAND` without adding `-i`. An
explicit interactive-mode argument in a profile takes precedence. Other shells use only their
profile arguments. This setting applies to quick commands and **Run command…**, and leaves saved
custom actions unchanged.

Interactive shell startup runs in a pseudoterminal, so shell plugins can initialize job control and
terminal features. Its output is captured as plain text, with terminal control sequences removed and
line endings normalized. The command panel accepts no terminal input; stdout and stderr are
combined. Viewer checks the folder is the same one before launch and refuses if it changed.

**Command progress** shows each command's status, exit code, elapsed seconds and output, with
**Stop**, **Open receipt** and **Copy output**. Hiding the panel leaves commands running.

| Rule      | Behavior                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Output    | The last 256 KiB is kept; **Showing the last 256 KiB of output.** marks a cut.                                                             |
| Exit      | A non-zero exit or a signal is a failure: `Command exited with status N.` or `with signal NAME.`                                           |
| **Stop**  | Sends `SIGHUP` to a terminal shell, or `SIGTERM` to a piped command's process group; escalates to `SIGKILL` after 1.5 seconds.             |
| Time      | No time limit.                                                                                                                             |
| At once   | 20 commands and custom actions, running or starting. Another shows **Wait for an action to finish or cancel one before starting another.** |
| Ends with | Closing its window, quitting Viewer, or losing access to its folder stops the command.                                                     |
| Replay    | Never. Restarting Viewer does not run a command again.                                                                                     |

For a program that needs input, use a terminal plane.

## Command receipts

Each quick command and **Run command…** run writes a private receipt in Viewer's data. **Tasks…** →
**Command history** lists them, and **Open receipt** opens one as a plane.

| Field   | Content                                                                                       |
| ------- | --------------------------------------------------------------------------------------------- |
| Outcome | **Running**, **Finished**, **Exited N**, **Stopped**, **Failed to finish** or **Interrupted** |
| Times   | Start and end                                                                                 |
| Folder  | The command's working folder, with **Copy path** before it                                    |
| Command | The literal text run                                                                          |
| Output  | The last 256 KiB                                                                              |

**Export Markdown…** saves a receipt as a Markdown file. A receipt still running when Viewer quit
reads **Interrupted**: _Viewer closed before a final outcome was recorded. The command was not
replayed._ Viewer keeps up to 1,000 receipts; past that, new runs report **Command receipt storage
is full. Existing receipts were preserved.** Closing a receipt plane keeps the receipt.

## Terminal planes

| Command                 | Opens                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------- |
| **Open terminal plane** | A terminal linked to the folder plane, starting in its folder.                        |
| **New terminal plane**  | A root terminal plane in the folder where new planes start (**Settings → Browsing**). |

Each terminal plane has its own shell, started from the default shell profile.

| Feature    | Behavior                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Find       | **Find in terminal**; **Return** finds the next match, **Shift-Return** the previous; **Escape** or **Close find** closes it. |
| Paste      | Copy, paste and bracketed paste.                                                                                              |
| Drop       | Dropping files pastes their quoted paths.                                                                                     |
| Scrollback | **Terminal scrollback lines**, 100 to 50,000, default 10,000.                                                                 |
| At once    | 100 terminals, Git terminals included. Another shows **Close a terminal before opening another.**                             |
| Size       | Resizing the plane changes rows and columns; zooming the space does not.                                                      |

The shell keeps running while the plane is out of view or another workspace is shown. Closing the
plane ends its shell. After Viewer restarts, a saved terminal plane starts a fresh shell; nothing is
replayed. Losing access to the folder stops its terminals. A working folder is not a sandbox: the
shell can reach anything your account can.

## Commands a workspace starts

A [defined workspace](../guides/workspaces.md#open-a-defined-workspace) can name a command for a
terminal plane. Each such plane shows **Command not started**, the literal command and its folder.
Choose **Run `npm run dev`** or **Shell only**. Neither the shell nor the named command starts until
you choose. **Shell only** starts the configured shell without typing the definition's command.

A notice in normal flow offers **Run all N commands** for the planes still waiting for a choice.
**Not now** hides that notice until the workspace next opens. Each plane keeps its own outcome; one
unavailable plane does not prevent the others from starting. An already running plane is attached
without typing its command again.

The first Run of each new or changed command also asks for native approval. The dialog lists only
unapproved commands, their folders and profiles, including a custom profile's full program,
arguments and environment. Long batches use several bounded pages without cutting command text.
Declining runs none of the listed commands. Approval remembers an exact fingerprint: the definition
key, the real folder after resolving links, the profile's executable, arguments and environment, and
the literal command. A change to any of these needs approval again. Moving a link to another folder
also changes that fingerprint. The private approval file is `confirmed-actions-v1.json`.

Approval never starts a command by itself. Opening, reopening, resetting, restoring on launch and
reloading all show the Start panel again. Starting a fresh shell after a command does not replay its
input. The desktop refuses a click if the definition changed since the panel displayed it; review
the refreshed command before choosing Run again.

Agents, model-authored lines, spoken plans, custom actions and macros cannot open definitions or
start their commands. Agent navigation and task opening leave terminals deferred with **Run**
disabled; **Shell only** remains available to the person. An agent-driven window cannot approve or
start definition commands.

Viewer types the approved line once after shell output and 120 ms of quiet, within three seconds.
For zsh and fish, it also waits for the line editor to enable bracketed paste. It waits for tracked
terminal queries to be answered; DECRQSS replies are discarded for safety, and its wait clears only
when the shell enables bracketed paste after the query. Focus reporting does not delay startup.
Offscreen planes keep an xterm attached to answer the shell. Only character-size window reporting is
enabled.

If readiness never arrives, Viewer keeps the shell open and displays the literal command for you to
type manually. A shell cannot distinguish a command typed by Viewer from one typed by a person. For
shells other than zsh and fish, a startup question in an rc file can receive the command as its
answer. For zsh or fish with bracketed paste disabled, type the displayed command yourself after
startup finishes. These checks do not sandbox a shell or its startup files.

Viewer holds up to 65,536 input characters during startup, then sends them after the command in
order. Control-C cancels the pending command. Overflow also cancels it, sends the held input to the
ordinary shell and displays a notice. Requested terminal reports pass immediately; unsolicited
report-shaped input and every DECRQSS reply are dropped while the command is pending.

## Shell profiles

**Settings → Terminals** → **Shell profiles** defines what a terminal starts. **Default shell
profile** chooses the one used by terminal planes, **Run command…** and external terminals.

| Field          | Rule                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------ |
| **Name**       | 1 to 100 characters.                                                                             |
| **Executable** | A program path or name; empty uses your login shell (`$SHELL`, else `/bin/zsh`).                 |
| Arguments      | Up to 100 literal arguments. The built-in **Login shell** profile uses `-l`.                     |
| Environment    | Variables named `[A-Za-z_][A-Za-z0-9_]*`. `DYLD_*`, `ELECTRON_*` and `NODE_OPTIONS` are refused. |
| Count          | 1 to 30 profiles. **New shell profile** adds one; **Remove profile** removes one.                |

The built-in login shell starts without asking. Any other profile asks **Start terminal profile
“NAME” for the first time?** in a system dialog, showing exactly what it runs. The answer is kept
for that exact program, arguments and environment; a change asks again. This applies to profiles
from edited or imported configuration and to terminal planes restored on launch.

## External terminal and tmux

| Command          | Does                                                                            |
| ---------------- | ------------------------------------------------------------------------------- |
| **Open in APP**  | Opens the folder in the external terminal app (**Open Terminal** when unknown). |
| **Open in tmux** | Adds a window for the folder to a shared tmux session.                          |

**External terminal** is `auto` or an app name or path such as `iTerm2`, `Terminal` or
`/Applications/YourApp.app`. `auto` uses a running supported terminal, then iTerm, then Terminal. An
app chosen by path asks a native confirmation once. External terminals are macOS only.

To hand off, Viewer writes a launcher script into `terminal-launches` in its data, a folder only you
can open (mode 0700). The script holds the profile's environment and arguments, which can carry
tokens, so it removes itself as the terminal app starts it: only its own file, only in that folder,
never through a link. A launcher the app never ran is removed when Viewer next starts. If removal
fails, the shell still opens.

| tmux setting               | Default    | Rule                                                        |
| -------------------------- | ---------- | ----------------------------------------------------------- |
| **tmux executable**        | `tmux`     | tmux must already be installed.                             |
| **Shared session**         | `viewer`   | Letters, digits, `_` and `-`, up to 100 characters.         |
| **Socket path (optional)** | empty      | Passed as `-S PATH` when set.                               |
| **Window name**            | `{folder}` | Up to 100 characters; `{folder}` becomes the folder's name. |

**Open in tmux** creates the session when it does not exist, otherwise adds a window, then attaches
the terminal app to it. iTerm attaches in control mode (`-CC`) and reuses a control-mode client
already attached. The default profile's environment applies; its program and arguments do not. The
tmux executable, socket and environment are confirmed natively before first use. tmux sessions keep
running after Viewer quits. Up to 20 handoffs can wait at once.

Typography (**Settings → Terminals**, `settings.terminalFont`) is separate from previews and the
editor; [configuration](configuration.md) lists every terminal setting and default.

## Agents and terminals

An agent can read terminal output only with the `terminal-read` capability and a separate grant: in
**Settings → Agents**, choose the client, **Grant for folder**, then **Read terminal output**. The
grant covers terminals started in that folder, including the last 128,000 characters they showed,
even after the shell changes folder. Output can contain secrets a program printed.

Agents never type into a terminal: terminal input could delete files permanently and bypass the
Trash. Git action terminals are private to the person who ran them. See
[what an agent cannot do](agents.md#what-an-agent-cannot-do).

**Related:** [Work on a project](../guides/develop.md#run-commands) ·
[Make repeated work a command](../guides/automate.md) · [Custom actions](actions.md) ·
[Tasks and Git](tasks-and-git.md) · [Configuration](configuration.md) · [Agents](agents.md)
