# The command line

Viewer has one small language for its command line, its keys, its macros and its sequences. It reads as vim's ex lines and tmux's commands do.

## Five rules

1. **`:` opens the command line.** Type `:` at the start of the palette (⌘K), press the prefix and then `:`, or choose **Command line…**.
   - A line is `[count]name [words]`; `|` runs the next step (tmux's `;` also works).
   - A count runs its step again: `:3 focus-right`.
2. **Names.** A name is one of:
   - vim's ex names: `q`, `w`, `e`, `x`, `wq`, `sp`, `vs`, `on`, `set`, `setl`, `tabnew`, `tabn`, `tabp`, `tabc`, `colo`, `h`;
   - tmux's long names: `split-window -h`, `kill-pane`, `select-pane -L`, `bind-key`, `send-keys`;
   - any command id: `tile-split-right`, `setting.ui.space.grid`;
   - your own commands, which start with a capital, as vim's `:command` requires (`:Dev`), so they never shadow a built-in.
3. **`set` changes a setting by its name.**
   - `set grid` turns it on, `set nogrid` off, `set grid!` toggles, `set grid?` shows it and `set grid&` resets it.
   - `set backdrop=blur` and `set opacity=60` set a value; `set opacity+=10` and `set opacity-=10` adjust a number.
   - `setl minimap!` changes this workspace's own setting only.
   - A setting only Settings changes (`confirmtrash`) opens Settings at it.
4. **Keys run lines.** There are four kinds of key:
   - the prefix's keys;
   - `-n` keys, which need no prefix;
   - `-r` keys, which repeat without the prefix for a moment;
   - modes, which stay until Escape.

   In a mode, a digit the mode does not bind is a count.
5. **Session first, keep later.** `:bind`, `:unbind`, `:command` and `:unalias` last until Viewer quits, as tmux's prompt changes the running server and not `.tmux.conf`. Settings → Shortcuts lists them, with **Keep** (into `config.jsonc`) and **Discard**.

## Learning it

- Completion shows each verb's usage as you type; Tab inserts the first completion.
- ⌃P and ⌃N step through past lines; with nothing typed, the last lines are listed.
- A line that does not parse is not run: the error points at its column, with a did-you-mean.
- `:help` lists every verb, `:help q` one verb's names, `!` and flags, `:help set` every setting with its value, and `:help keys` every key with the line it runs.
- The palette shows each command's line beside it: Close plane `:q`, Hide background grid `:set grid!`, Theme: Night Owl `:colo 'Night Owl'`.

## Words

- Words are bare, `'literal'` or `"escaped"` (`\"`, `\\`). Outside quotes, a backslash keeps the next character: `e ~/My\ Docs`.
- A verb that takes one name or path takes every word left: `tabnew My Studio`, `e ~/My Docs/a.md`.
- In a path, `~` is home, `%` the active plane's path and `%:h` its folder. Quoted words are not expanded.
- A line is at most 500 characters and runs at most 50 steps. The whole line is checked before any of it runs, and it stops at the first step that cannot run.

## Cheat sheet

| vim | tmux | Viewer does |
|---|---|---|
| `:q`, `:q!` | `kill-pane` | Close the plane; `!` drops its unsaved text without asking |
| `:qa`, `:qa!` | | Close every plane in the workspace |
| `:on`, `:on!` | | Close every other plane, keeping the ones this plane opened from |
| `:w`, `:w path` | | Save; with a path, Save As opens there |
| `:wa` | | Save every edited file; scratch planes without a file are counted |
| `:wq`, `:x` | | Save (`:x` only if changed), then close |
| `:e path` | | Open a path as a plane, a text file for editing |
| `:cd path`, `:pwd` | | Show a folder in this folder plane; say which |
| `:sp`, `:vs [path]` | `split-window [-h] [-c path]` | Split down or right, tmux-style tiling |
| `:tabnew`, `:tabn`, `:tabp`, `:tabc` | `new-window`, `next-window`, `previous-window`, `kill-window`, `select-window -t`, `rename-window` | Workspaces |
| `:set`, `:setl` | | Settings |
| `:colo name` | | The colour theme |
| | `select-pane -L/-R/-U/-D` | The plane in that direction |
| | `resize-pane -L/-R [n]` | Shrink or grow the main tile |
| | `display-panes` | Plane hints |
| | `switch-client -T name` | `:mode name`: enter a key mode |
| `:command Name line` | `command-alias`, `bind-key`, `unbind-key` | Your commands and keys, for the session |
| | `send-keys 'ls -la' Enter` | Type into the terminal plane: words as text, key names (Enter, Tab, C-c, M-x) as keys |

Viewer's own verbs are `filter query` (the folder plane's filter: `:filter ext:md modified<7d`, none clears it), `find query` (this folder and its subfolders, as a results plane), both in the file query language ([search.md](search.md), `:help query`), `mkdir name`, `touch name`, `mv name` (rename the selection), `trash` (the system Trash, asking as Settings says), `profile name` and `layout name` (a tiling layout or a layout template).

## Keys

- **Writing a key.** A key is written as Viewer writes it (`Ctrl+b`, `Alt+h`, `Shift+Tab`, `F5`), as tmux does (`C-b`, `M-h`) or as vim does (`<C-b>`, `<M-h>`, `<D-k>`, `<Space>`, `<CR>`). A letter with ⌃ or ⌘ is the letter whatever its case: write `Shift` for ⌃⇧B.
- **Sets of keys.** `settings.keymap` holds:
  - `bindings`, the prefix's keys;
  - `root`, keys without the prefix. Each needs ⌃, ⌥ or ⌘, or is an F-key, so typing is never taken; it follows `inTerminals` and `inTextFields`;
  - `repeat`, prefix keys that repeat within `repeatTime` (default 500 ms);
  - `modes`, named tables.
- **Defaults.** Prefix `R` enters the `resize` mode: `h` and `l` shrink and grow the main tile, `j` and `k` swap, `2l` grows it twice, and Escape leaves. Prefix `+` and `-` repeat.
- **What a key runs.** A binding is a line, a list of lines, or a chord (keys in turn).
- **Binding by typing.** `:bind [-n|-r|-T mode] keys line` binds keys for the session; the line may hold `|`. Quote a chord: `bind "b x" vs`. `:unbind keys` unbinds.

## Your commands

- **Naming a line.** `:command Name line` (also `alias` and `command-alias`) names a line for the session. `:Name words` runs it, `$1` to `$9` taking each word and `$*` all of them: `:command Dev cd ~/Developer/$1 | vs`, then `:Dev viewer`.
- **Keeping it.** Keep in Settings saves it as a sequence with `"command": "Dev"`; any sequence given a `command` runs as `:Dev`.
- **Macros.** Record macro saves what you ran as lines, with their words, named as a command too (`open docs` is `:OpenDocs`).
- **What a sequence cannot run.** A sequence never runs a custom action or another of your commands, so none runs itself.

## Safety

- There is no `:!` shell escape, and no line deletes a file: `trash` is the system Trash, with its confirmation.
- `!` only drops text you typed and never saved.
- Agents still propose single command ids, never lines, and never `send-keys`, `bind`, `command` or a `!` form.
- An imported configuration asks first when its keys or sequences type into terminals, move files to the Trash, rename them or drop unsaved text.
- The keymap and your commands are written to `config.jsonc` only by Keep in Settings.
