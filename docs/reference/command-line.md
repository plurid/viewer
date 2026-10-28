# Command language and terminal launch

Type `:` in **⌘K**, or choose **Command line…**. You can use ordinary palette commands without
learning this language; it becomes useful for repeatable keyboard work, settings, aliases and
macros.

## Start small

```text
:help
:set grid!
:filter ext:pdf
:vs ~/Documents
```

Completion shows usage; Tab accepts a completion. **Ctrl+P/Ctrl+N** step through history. Invalid
input identifies its column and can suggest a spelling correction. No suggested correction runs
automatically.

## Lines and words

A line is `[count]name [arguments]`. `|` or `;` sequences steps; a count repeats its step. The
complete line is checked first and execution stops at the first step that cannot run. Limits are 500
characters and 50 steps.

Words can be bare, single-quoted literal text or double-quoted escaped text. Backslash escapes the
next unquoted character. Paths understand `~`, `%` for the active path and `%:h` for its folder;
quoted words are not expanded.

## Commands

| Task                 | Examples                                                             |
| -------------------- | -------------------------------------------------------------------- |
| Help                 | `:help`, `:help q`, `:help set`, `:help keys`, `:help query`         |
| Close views          | `:q`, `:qa`, `:on`                                                   |
| Save                 | `:w`, `:wa`, `:wq`, `:x`                                             |
| Open/navigate        | `:e path`, `:cd path`, `:pwd`                                        |
| Split                | `:sp`, `:vs [path]`, `split-window -h`                               |
| Workspaces           | `:tabnew name`, `:tabn`, `:tabp`, `:tabc`                            |
| Settings             | `:set grid`, `:set nogrid`, `:set grid!`, `:set grid?`, `:set grid&` |
| Value settings       | `:set backdrop=blur`, `:set opacity+=10`                             |
| Local settings       | `:setl minimap!`                                                     |
| Theme/profile/layout | `:colo name`, `:profile name`, `:layout name`                        |
| Find/select          | `:filter query`, `:find query`, `:select *.md`, `:deselect *.txt`    |
| File actions         | `:mkdir name`, `:touch name`, `:mv name`, `:trash`                   |

Many vim ex names and tmux equivalents are aliases. Command IDs also work directly. Use `:help` for
exact flags and aliases. `:q!` and related `!` close forms discard unsaved text; they are not a
shell escape. File removal uses OS Trash.

## Keys, modes and named commands

The default prefix is **Ctrl+B**. Prefix `?` displays bindings. Keys accept Viewer, tmux and vim
notation: `Ctrl+b`, `C-b`, `<C-b>`.

`:bind` and `:unbind` edit session bindings. `-n` selects unprefixed bindings, `-r` repeat bindings
and `-T` a named mode. Mode counts repeat actions; Escape leaves the mode. Prefix `R` enters the
default resize mode.

`:command Name line` defines a session command. Names start with a capital to avoid shadowing
built-ins. `$1` through `$9` insert escaped words; `$*` uses all arguments. Record macro captures
supported command lines for reuse.

Session changes last until quit. **Keep** in Settings → Shortcuts stores them in JSONC; **Discard**
removes the session override. A sequence cannot recursively run another custom action or user
command. See [actions](actions.md).

## Requests in words

Start the palette with `>` or choose **Ask in words…**. With a configured model, ask for something
like “select the images” or “hide the grid.” The answer proposes a command line. Enter runs an
allowed reviewed line; Tab opens it for editing. Successful lines enter history so you can reuse
their syntax.

The provider receives permitted command context and names, not file contents. Settings → Models
chooses the provider and data permission. The model's line cannot perform restricted mutations, run
opaque programs, type into a terminal, change bindings or silently discard/save text. Unsupported
requests explain why.

Manual terminal-input verbs and imported keymaps have their own trust rules. Agents propose
supported command IDs rather than command-language lines. See [agent authority](agents.md) and
[search syntax](search.md).

## Launch from a terminal

The direct build provides **Install Viewer CLI** in the command palette and **Install shell
command** in **Settings → Navigation**. Both create an executable launcher at `~/.local/bin/viewer`
pointing to that Viewer installation. Palette searches for `install viewer`, `install cli` or
`shell command` find the command. It can be run again for the same installation. It does not edit
`PATH` or replace an existing different command. There is no terminal subcommand named
`install viewer`.

```sh
viewer .
viewer ./notes.md
viewer --new-window ~/Documents
viewer --workspace "Research" ./notes.md
viewer --terminal .
viewer -- ./-draft.txt
```

| Argument or option       | Behavior                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| Paths                    | Open up to 100 paths; resolve relative paths against the invoking terminal's current folder. |
| `--new-window`           | Open an independent Viewer window.                                                           |
| `--workspace ID_OR_NAME` | Target one existing workspace by ID or unique name; takes precedence over `--new-window`.    |
| `--terminal`             | Request a terminal plane for the launch target.                                              |
| `--`                     | Treat subsequent arguments as literal paths, including names beginning with `-`.             |

Paths understand `~` and `~/`. Quote spaces using your shell's quoting rules. Unknown options fail;
the launcher does not expose arbitrary in-app command execution. Shell integration is unavailable in
the sandboxed App Store build.

Moving the application can leave the launcher pointing at its previous location. Review the existing
launcher before replacing it. **Uninstall shell command…** requires confirmation and moves only the
identity-checked Viewer launcher to OS Trash; unrelated commands are preserved.
