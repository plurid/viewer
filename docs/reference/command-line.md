# Command language

This page is the grammar of the `:` command line: its lines and words, every verb, the `:set` forms,
key bindings, named commands and requests in words.

Open it with `:` in **⌘K**, **Command line…**, or prefix **:** (⌃B then :). Ordinary palette
commands work without it.

## The command line

| Key            | Effect                                                                      |
| -------------- | --------------------------------------------------------------------------- |
| **Enter**      | Runs the line, once the whole line parses                                   |
| **Tab**        | Accepts the highlighted completion                                          |
| **⌃P**, **⌃N** | Steps back and forward through history                                      |
| Empty field    | Lists the 30 most recent lines; **Clear recent command lines** forgets them |

A line that does not parse is not run: its message names the problem and the column, and may suggest
a close spelling (`Did you mean …?`). A suggestion never runs by itself. Lines that parse enter
history before they run; history keeps 200 lines of up to 500 characters.

## Lines and words

| Element    | Syntax                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Line       | Steps separated by `\|` or `;`                                                                                                       |
| Step       | `[:][count]name[!] [words…]`                                                                                                         |
| Count      | 1 to 99; runs the step that many times                                                                                               |
| Name       | A verb, a command ID, or a named command that starts with a capital                                                                  |
| `!`        | Only on verbs that define it; see the verb table                                                                                     |
| Bare word  | Ends at a space, `\|` or `;`; a backslash keeps the next character                                                                   |
| `'single'` | Literal text                                                                                                                         |
| `"double"` | Text where `\"` and `\\` are escapes                                                                                                 |
| Flags      | `-h`, or `-T resize` when a flag takes a value; `--` ends flags                                                                      |
| Path words | `~` is Home, `%` the active plane's path, `%:h` its folder; relative paths start in the active folder. Quoted words are not expanded |

A backslash outside quotes keeps one character: `a\ b` is one word and `\|` is a literal bar.

A verb that takes one name or path joins every remaining word into it: `:tabnew My Studio` and
`:e ~/My Docs/a.md` work without quotes. `:filter`, `:find`, `:select`, `:deselect`, `:bind` and
`:command` take the rest of the line, `|` included.

The whole line is checked before any step runs, and it stops at the first step that cannot run. Each
step reads the live plane, so `cd ~/x | e %` opens what `cd` reached.

| Limit                             | Value          |
| --------------------------------- | -------------- |
| Line length                       | 500 characters |
| Steps in a line                   | 50             |
| Count                             | 1 to 99        |
| Named commands calling each other | 10 deep        |

A command ID alone is a step: `copy`, `view-list`, `setting.ui.space.grid`. It takes no words and no
`!`. ⌘K's rows carry their IDs; `:help` lists the verbs.

## Verbs

Square brackets in a name mark letters you may leave out, as in vim: `q[uit]` answers to `q`, `qu`,
`qui` and `quit`. Names after the first are synonyms, most of them from tmux.

| Names                                                   | Usage                             | Does                                                                                     |
| ------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------- |
| `h[elp]`                                                | `[topic]`                         | Lists verbs; `:help <verb>`, `:help set`, `:help <setting>`, `:help keys`, `:help query` |
| `his[tory]`                                             |                                   | Opens the command line with its history                                                  |
| `command-prompt`                                        |                                   | Opens the command line                                                                   |
| `q[uit]`, `kill-pane`, `killp`                          | `[!]`                             | Closes the plane; `!` discards its unsaved text                                          |
| `qa[ll]`, `quita[ll]`                                   | `[!]`                             | Closes every plane in the workspace; `!` discards unsaved text                           |
| `on[ly]`                                                | `[!]`                             | Closes every other plane, keeping the ones this plane opened from                        |
| `w[rite]`                                               | `[path]`                          | Saves; with a path, Save As there                                                        |
| `wa[ll]`                                                |                                   | Saves every edited file                                                                  |
| `wq`                                                    |                                   | Saves, then closes the plane                                                             |
| `x[it]`, `exi[t]`                                       |                                   | Saves if changed, then closes the plane                                                  |
| `e[dit]`                                                | `{path}`                          | Opens a path as a plane; a text file opens for editing                                   |
| `cd`, `chd[ir]`                                         | `[path]`                          | Shows a folder in this folder plane; Home without one                                    |
| `pw[d]`                                                 |                                   | Shows this plane's folder                                                                |
| `sp[lit]`                                               | `[path]`                          | Splits down: a tile below, showing the path                                              |
| `vs[plit]`                                              | `[path]`                          | Splits right: a tile beside, showing the path                                            |
| `split-window`, `splitw`                                | `[-h] [-c path]`                  | Splits down, or right with `-h`                                                          |
| `mkd[ir]`                                               | `{name}`                          | Creates a folder in this folder                                                          |
| `touch`                                                 | `{name}`                          | Creates a file in this folder                                                            |
| `mv`                                                    | `{name}`                          | Renames the one selected item; a name, not a path                                        |
| `trash`                                                 |                                   | Moves the selection to the Trash, with the confirmation set in Settings                  |
| `filter`                                                | `[query]`                         | Filters this folder plane; no query clears it                                            |
| `find`                                                  | `{query}`                         | Searches this folder and its subfolders; results open as a plane                         |
| `select`, `sel`                                         | `{glob\|query}`                   | Adds matching items to the selection                                                     |
| `deselect`, `unselect`                                  | `{glob\|query}`                   | Takes matching items out of the selection                                                |
| `tabnew`, `new-window`, `neww`                          | `[name]` or `-n name`             | Creates a workspace                                                                      |
| `tabn[ext]`, `next-window`, `next`                      | `[n\|name]`                       | The next workspace, or the one numbered from 1 or named                                  |
| `tabp[revious]`, `tabN[ext]`, `previous-window`, `prev` |                                   | The previous workspace                                                                   |
| `select-window`, `selectw`                              | `-t {name}`                       | The workspace named                                                                      |
| `tabc[lose]`, `kill-window`, `killw`                    |                                   | Deletes the workspace after asking; Undo restores it                                     |
| `rename-window`, `renamew`                              | `{name}`                          | Renames the workspace                                                                    |
| `se[t]`                                                 | `{setting}…`                      | Changes settings; see [`:set`](#set); none opens **Search settings…**                    |
| `setl[ocal]`                                            | `{setting}…`                      | Changes this workspace's own value                                                       |
| `colo[rscheme]`, `theme`                                | `{theme}`                         | The colour theme for this appearance                                                     |
| `profile`                                               | `{profile}`                       | Applies a setting profile                                                                |
| `layout`, `select-layout`, `selectl`                    | `{layout}`                        | A tiling layout or a layout template                                                     |
| `select-pane`, `selectp`                                | `-L\|-R\|-U\|-D`                  | Focuses the plane left, right, up or down                                                |
| `resize-pane`, `resizep`                                | `-L\|-R\|-U\|-D [n]`              | Grows the active tile toward a neighbour, 1 to 12 steps                                  |
| `display-panes`, `displayp`                             |                                   | Labels the planes in view to jump to one                                                 |
| `mode`, `switch-client`, `switchc`                      | `[name]` or `-T name`             | Enters a key mode until Escape; no name leaves it                                        |
| `bind`, `bind-key`                                      | `[-n\|-r\|-T mode] {keys} {line}` | Binds keys for this session                                                              |
| `unbind`, `unbind-key`                                  | `[-n\|-T mode] {keys}`            | Unbinds keys for this session                                                            |
| `com[mand]`, `alias`, `command-alias`                   | `{Name} {line}`                   | Names a line for this session                                                            |
| `delc[ommand]`, `unalias`                               | `{Name}`                          | Forgets a named line of this session                                                     |
| `send-keys`, `send`                                     | `{text\|Key}…`                    | Types into the active terminal plane                                                     |
| `task-new`                                              | see [below](#task-new)            | Opens an editable branch task form                                                       |

`:layout` takes `even-horizontal`, `even-vertical`, `main-vertical`, `main-horizontal` or `tiled`,
or the name of a saved layout template. `:colo`, `:profile` and `:layout` match an ID, a name, or
the unique start of one name; workspaces match the same way.

`:q!` and the other `!` forms only discard unsaved text. They are not a shell escape, and the
command line has none.

`:send-keys` types each word as text and each key name as that key: `Enter`, `Tab`, `Escape`,
`Space`, `Backspace`, `Delete`, `Up`, `Down`, `Left`, `Right`, `Home`, `End`, `C-c` (Control) and
`M-x` (Meta). Quoted words are always text. Words are typed one after another without spaces, so
quote text that contains them: `:send-keys 'ls -la' Enter`. It works only in a terminal plane.

## `:set`

Each word is one change:

| Form                         | Effect                                            |
| ---------------------------- | ------------------------------------------------- |
| `grid`                       | Turns an on/off setting on; shows any other value |
| `nogrid`                     | Turns it off                                      |
| `grid!`, `invgrid`           | Toggles it                                        |
| `grid?`                      | Shows its value                                   |
| `grid&`, `grid<`             | Restores the default                              |
| `opacity=60`, `opacity:60`   | Sets a value                                      |
| `opacity+=10`, `opacity-=10` | Adds to or subtracts from a number                |

On/off values accept `on`, `off`, `true`, `false`, `yes`, `no`, `1` and `0`. Choices accept their
value or label. Colours accept `#rgb`, `#rrggbb`, or `auto` to clear. Numbers are checked against
the setting's range. A full setting path (`ui.space.grid`) works wherever a short name does.

A setting that only Settings may change opens Settings at that row instead. `:setl` changes this
workspace's own value and works only for settings a workspace can override; `:setl grid&` removes
the override.

| Name              | Setting                                    |
| ----------------- | ------------------------------------------ |
| `grid`            | `ui.space.grid`                            |
| `toolbar`         | `ui.space.toolbar`                         |
| `minimap`         | `ui.space.minimap`                         |
| `minimapauto`     | `ui.space.minimapAuto`                     |
| `viewcube`        | `ui.space.viewcube`                        |
| `headers`         | `ui.space.planeHeaders`                    |
| `dragging`        | `ui.space.dragging`                        |
| `handles`         | `ui.space.resizing`                        |
| `origin`          | `ui.space.origin`                          |
| `opening`         | `ui.space.opening`                         |
| `color`           | `ui.space.color`                           |
| `backdrop`        | `ui.space.backdrop`                        |
| `opacity`         | `ui.space.backdropOpacity`                 |
| `titlebar`        | `ui.titlebar.visible`                      |
| `sidebar`         | `ui.sidebar.visible`                       |
| `planesidebar`    | `ui.sidebar.inNewPlanes`                   |
| `wrapnames`       | `ui.list.wrapNames`                        |
| `appearance`      | `settings.appearance`                      |
| `openin`          | `settings.fileOpening.default`             |
| `view`            | `settings.browsing.mode`                   |
| `newplanes`       | `settings.browsing.newPlaneLocation`       |
| `emptyworkspace`  | `settings.browsing.emptyWorkspaceLocation` |
| `newfile`         | `settings.browsing.newFileExtension`       |
| `density`         | `settings.browsing.density`                |
| `foldersfirst`    | `settings.browsing.foldersFirst`           |
| `hidden`          | `settings.browsing.showHidden`             |
| `restore`         | `settings.browsing.restoreSession`         |
| `confirmtrash`    | `settings.browsing.confirmTrash`           |
| `columnwidth`     | `settings.browsing.columnWidth`            |
| `scrollback`      | `settings.terminals.scrollback`            |
| `thumbnails`      | `settings.previews.thumbnailSize`          |
| `imagepixels`     | `settings.previews.maxImagePixels`         |
| `modelmb`         | `settings.previews.maxModelMB`             |
| `termfont`        | `settings.terminalFont.fontFamily`         |
| `termfontsize`    | `settings.terminalFont.fontSize`           |
| `termweight`      | `settings.terminalFont.fontWeight`         |
| `termlinespace`   | `settings.terminalFont.lineHeight`         |
| `termletterspace` | `settings.terminalFont.letterSpacing`      |
| `font`            | `settings.editor.fontFamily`               |
| `fontsize`        | `settings.editor.fontSize`                 |
| `lineheight`      | `settings.editor.lineHeight`               |
| `tabstop`, `ts`   | `settings.editor.tabSize`                  |
| `expandtab`, `et` | `settings.editor.insertSpaces`             |
| `wrap`            | `settings.editor.wordWrap`                 |
| `number`, `nu`    | `settings.editor.lineNumbers`              |
| `trim`            | `settings.editor.trimTrailingWhitespace`   |
| `splitwith`       | `settings.tiling.splitWith`                |
| `tiling`          | `settings.tiling.defaultLayout`            |
| `dwell`           | `settings.tour.dwell`                      |
| `flight`          | `settings.tour.duration`                   |
| `tourloop`        | `settings.tour.loop`                       |
| `pauseindex`      | `settings.search.paused`                   |

[Configuration](configuration.md) gives each setting's values and range.

## Queries and patterns

`:filter`, `:find`, `:select` and `:deselect` take the [file query language](search.md). `:select`
and `:deselect` also take globs (`*.md *.txt`) and report how many items matched and how many are
selected. `:help query` lists the terms with examples.

## Keys and modes

The default prefix is **⌃B**, as in tmux. After it, **?** shows every binding, **:** opens the
command line and **R** enters the `resize` mode. Pressing the prefix twice sends it to a terminal.
[Shortcuts](shortcuts.md) lists the default prefix keys; `:help keys` lists the keys in effect.

Keys can be written as Viewer, tmux or vim write them: `Ctrl+b`, `C-b` and `<C-b>` are one key.
Modifiers are `Ctrl` (`C`, `control`), `Alt` (`M`, `A`, `opt`, `option`, `meta`), `Cmd` (`D`,
`command`) and `Shift` (`S`). Named keys include `Space`, `Enter` (`CR`, `Return`), `Escape`
(`Esc`), `Tab`, `Backspace` (`BS`), `Delete` (`Del`, `DC`), the arrows, `Home`, `End`, `PageUp`
(`PgUp`, `PPage`), `PageDown` (`PgDn`, `NPage`), `lt` for `<`, `bar` for `|`, and `F1` to `F24`.

| `:bind` flag | Table                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------ |
| none         | After the prefix                                                                                 |
| `-n`         | Without the prefix; the key needs ⌃, ⌥ or ⌘, or is an F-key                                      |
| `-r`         | After the prefix, then again without it within the repeat time (500 ms by default); one key only |
| `-T mode`    | In a named mode; mode names are lowercase, up to 31 characters                                   |

A binding is one to four keys in turn. In a mode, digits before a key repeat it; **Escape** leaves
the mode. Errors include `“x” is not a key.`, `One to four keys, in turn.` and
`-r is for one prefix key.`

## Named commands

`:command Name line` names a line for this session; `:Name words` runs it. A name starts with a
capital letter and has up to 31 letters and digits, so it never shadows a verb.

| In the line | Becomes                                                       |
| ----------- | ------------------------------------------------------------- |
| `$1`…`$9`   | That word, escaped so it stays one word; empty when not given |
| `$*`        | Every word                                                    |
| `$$`        | A dollar sign                                                 |

A line without `$` placeholders refuses words: `:Name takes no words.` A command sequence saved in
**Settings → Actions** with a command name runs as `:Name` too; see [actions](actions.md). A
sequence cannot run another custom action or named command.

**Record macro** (prefix **q**) records the commands you run by key, menu or palette, up to 50, and
saves them as a command sequence. It skips custom actions, the palette, Settings, **Show key
sequences**, plane hints and agent commands. A workspace switch is recorded as `tabn Name`.

## Session changes

`:bind`, `:unbind`, `:command` and `:delcommand` last until Viewer quits. **Settings → Shortcuts →
This session** lists them: **Keep** writes them into `config.jsonc` (bindings into the keymap, named
lines as command sequences), and **Discard** drops them. A session holds up to 200 bindings and 100
named lines.

Importing a configuration that changes keys or sequences which type into terminals, move files to
the Trash, rename them, or use a `!` form asks for confirmation first.

## `task-new`

```text
:task-new "Improve search" --repo /projects/viewer --branch feature/search --path /projects/Search --workspace Development
```

`task-new [name] [--repo path] [--branch name] [--path new-folder] [--base local-branch | --existing] [--workspace name-or-id]`

- Options follow the name; quote names and paths that contain spaces.
- `--repo` and `--path` resolve once, from the originating folder.
- Each option appears once; `--existing` and `--base` exclude each other.
- The name is 1 to 100 ordinary characters.
- The step runs alone: no count, no other steps, not inside a named command.
- Omitted fields stay editable in the form; the current folder and workspace are the defaults.

The line opens the form; it creates nothing. Creating the task needs the native confirmation after
you review the form. [Tasks and Git](tasks-and-git.md) describes the result.

## Requests in words

Type `>` in ⌘K, or choose **Ask in words…**, and describe what you want: "select the images", "hide
the grid". The model set as **Default for Ask Viewer** in **Settings → Models** answers with one
command line and one sentence. **Enter** runs the line; **Tab** puts it in the field to edit.

The model receives the request, the active folder's path, up to 50 selected names, the workspace
names and the commands available here. It never receives file contents. A request is at most 1,000
characters.

| A proposed line is refused when it                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uses `trash`, `mv`, `send-keys`, `bind`, `unbind`, `command`, `delcommand`, `w`, `wa`, `wq` or `x`                                                                                                          |
| Uses any `!` form                                                                                                                                                                                           |
| Names a command that uses a terminal, runs a program, opens another application, runs Git program actions, moves to the Trash, renames, saves, moves to the paired folder, undoes file operations or pastes |
| Expands to more than 50 steps, or nests named commands more than 10 deep                                                                                                                                    |
| Names a verb, command or named command that does not exist here                                                                                                                                             |

A refused line is not offered; the reason shows instead. Agents connected to Viewer cannot type
command lines; they propose commands through their own tools. See
[what an agent cannot do](agents.md#what-an-agent-cannot-do).

**Related:** [Make repeated work a command](../guides/automate.md) · [Search](search.md) ·
[Shortcuts](shortcuts.md) · [Custom actions](actions.md) · [Terminal CLI](cli.md) ·
[Terms](terms.md)
