# Configuration

Settings and external editors use the same `config.jsonc` in Electron's user-data directory. **Settings → Configuration** shows its exact path, opens it in the associated editor, validates it, displays recent changes, imports/exports it and resets editable preferences. Comments and trailing commas are supported. A sibling `config.schema.json` provides editor completion and is generated from the validation declarations used by the app.

The file has `version: 1`, `$schema`, `settings` and `ui`. Start with the generated file or an export; examples below are partial objects to merge into it. Unknown fields, invalid values, duplicate IDs, conflicting shortcuts and a missing default terminal profile are rejected. Other references (a custom action's recipe, terminal profile or command, a recipe's model provider) that name nothing are listed as warnings on **Settings → Configuration**, and the action that uses one fails with the reason; an agent's configuration proposal cannot add one. Configuration errors include a path or line/column. A malformed external edit remains on disk for correction; the running app retains its last valid settings. `.last-valid` recovery does not replace an invalid or newer-version file. When neither `config.jsonc` nor its last valid copy can be read at launch, Viewer runs on its defaults and changes nothing on their account: model-data approvals, indexed locations and agent access stay as they were until the file is fixed. Import validates before replacing the configuration, then replaces `config.jsonc` with the imported text, its comments included, and keeps the text it replaced as `config.jsonc.before-import-<time>`; it works while `config.jsonc` is broken or missing. An import that changes agent access, model providers, actions that run programs or terminal profiles asks first, in a system confirmation.

Settings writes preserve unrelated comments and values. External edits reload within the watcher interval. A Settings edit based on an older revision merges when it touches independent fields; overlapping edits report a conflict. Atomic replacement checks for an intervening disk change before publishing. Legacy `settings-v1.json` receives an exclusive backup before migration and is migrated once; an unreadable one is left as it is, and settings start from the defaults.

A `config.jsonc` removed while Viewer runs is missing, not broken: the settings in effect stay, Configuration offers **Restore config.jsonc**, and the next change writes the file back from its last text, comments included (an editor that recreated it first wins). Removed while Viewer was closed, it is restored from `config.jsonc.last-valid` at the next launch. A last valid copy that cannot be read is kept as `config.jsonc.last-valid.unreadable-<time>` before anything replaces it. Existing folder appearances seed shared overrides once, with the active explorer winning a conflict.

Generated files include an agent editing guide and comments beside browsing, folder overrides, providers, recipes, custom actions, terminals/tmux, search, agent access and UI preferences. The comments explain IDs and references, supported placeholders, units, choices, numeric limits and examples for empty sections. The settings catalog supplies the displayed choices and ranges. An existing uncommented file receives the guide on its next Settings save; exports retain it. Annotation inserts comments without reserializing existing values or user comments, and subsequent saves preserve the guide; a save adds guidance only for the properties it adds, so a guide line you delete stays deleted. Settings edits a list item by item, keeping the comments beside the items it does not change; a removed item takes its own comments with it.

Credentials, authentication tokens, effective execution grants, the approved agent switch and folders, workspace arrangement, navigation sessions and caches are separate metadata. `settings.agents` can turn agents off or remove a folder; turning them on or adding a folder waits for approval in Settings → Agents. Adding an approval field to JSONC is invalid and cannot authorize an agent.

Native folder/file bookmarks, clipboard/drag session permissions and endpoint/data consent for models are also effective capabilities outside JSONC. Changing a provider endpoint or clearing its credential invalidates model consent; editing preferences cannot approve a new recipient. Use Settings → Permissions for native file access and Models for data sharing. A configuration backup is not an authorization backup.

## Folder presentation

Defaults live in `settings.browsing` and `ui.list`. A folder's overrides live in `settings.folders`, keyed by its absolute path:

```jsonc
"folders": {
  "/Users/you/Downloads": {
    "mode": "list",
    "sort": "modified",
    "descending": true,
    "list": {
      "visible": { "kind": false, "size": true },
      "widths": { "name": 700 },
      "wrapNames": true
    }
  },
  "/Users/you/Documents": {
    "mode": "columns",
    "columnWidth": 420
  }
}
```

Supported overrides include view (including `map`, which is per folder only), sort/direction, grouping, hidden files, folders-first ordering, density, list fields/order/widths/wrapping and browsing-column width. `"group": "lens"` with `"lens": "<lens id>"` groups a folder by one of its [lenses](lenses.md); the lens itself lives in the folder's `.viewer/lenses/`, not in this file. Overrides apply to the same path in every root and workspace. Selection, cursor, history, search/filter and scroll remain independent in each explorer. Known Viewer moves/renames remap overrides and inactive sessions; arbitrary external moves are not inferred from path alone.

In Columns, **Group by kind**, **Group by date modified** and **Ungroup files**
apply to the currently browsed folder, including a child column. Each column
shows its own folder's group headings and keeps its independent view preference.

List headers and searchable column actions control fields, ordering and widths. Browser-column edges resize with drag or Left/Right when the separator is focused; Shift changes the keyboard step, double-click fits filenames, and Option applies a width to the visible trail. Names retain full-text tooltips. **Use as default folder view** updates defaults; **Reset this folder’s view** removes that folder's overrides. Grouping currently renders in List view.

**Calculate Size** retains individual folder measurements for the Size column, Get Info and later selections. Selecting a measured folder with other files adds its known contents to the selection total; selected descendants are not counted twice. Missing, partial and stale measurements remain distinct from a measured empty folder. File changes invalidate affected measurements. Columns view previews a single selected file beside its browsing trail, using the same preview modules as planes and Quick Preview.

`settings.browsing.newPlaneLocation` chooses `current`, `home`, `desktop`, `documents`, `downloads`, `pictures`, `movies`, `music` or `custom`. A custom location uses `newPlanePath`. Current follows a folder plane, a terminal's working folder or a preview's parent, with Home as the fallback. `emptyWorkspaceLocation` is a separate preference for the first plane in an empty workspace, used by its New folder plane button, + and Command-N. It defaults to `home` and accepts the same choices except `current`; custom uses the separate `emptyWorkspacePath`. Later planes use `newPlaneLocation`. Both paths must be absolute. Creating a plane always creates a fresh root.

## Opening and shortcuts

`settings.fileOpening.default` is `automatic`, `plane` or `native`. Automatic uses an available preview module, otherwise the OS association. `types` overrides individual lowercase extensions, for example `{ "pdf": "plane", "mkv": "native" }`. New settings preview `docx` and `xlsx` in planes and open other Office extensions natively; a configuration saved before Office previews keeps native opening for every Office extension. Explicit **Open linked plane**, **Open in another plane**, **Open in …** and **Open With…** remain available regardless of automatic opening policy. An application or other macOS bundle (`.app`, `.pages`, `.bundle` and the like) opens in its app, as Finder's double-click does; `{ "app": "plane" }` browses into applications instead, and **Show Package Contents** goes inside one either way.

`settings.editor` configures the text editor of preview and scratch planes: `fontSize` and `lineHeight` in pixels (18 and 40, as VS Code at those settings), `fontFamily` (one monospace family name, `Menlo` by default), `tabSize` (4), `insertSpaces`, `wordWrap`, `lineNumbers` and `trimTrailingWhitespace` (on: spaces and tabs at line ends go when a file is saved, as an edit the editor can undo). Settings → Editor lists them, and Reset editor defaults restores them.

Read-only source previews share the editor font family but use independent `settings.previews.textFontSize` (16px), `textLineHeight` (20px) and `textWordWrap` (off) defaults. Settings → Previews edits them; local zoom and Reset use this reading size.

`settings.terminalFont` sets the terminal plane's text: `fontFamily` (one monospace family name; Menlo is used where it is not installed), `fontSize` in pixels, `fontWeight` (`normal` or `bold`), `lineHeight` as a multiple of the font's height, and `letterSpacing` in pixels. The defaults are Hack Nerd Font Mono, bold, 17, 1.3 and 1. Settings → Terminals lists them, with Reset terminal font.

`settings.keymap` holds key sequences, as tmux has them. Press `prefix` (default `Ctrl+B`), then a key from `bindings`: a key names a line (a command ID such as `frame-all`, or a command line such as `vs ~/Documents | set grid!`; see [command-line.md](command-line.md)), a list of lines run in order, or a map for a chord (keys pressed in turn, at most four deep). Keys may be written as Viewer, tmux or vim write them (`Ctrl+b`, `C-b`, `<C-b>`). The defaults follow tmux where Viewer has the same idea: `c` new terminal plane, `x` close plane, `z` dock, `o` next plane, `h`/`j`/`k`/`l` and the arrows the plane in that direction, `f` plane hints, `n`/`p` next and previous workspace, `w` change workspace, `,` rename workspace, `:` the command line, `?` every binding, `R` the resize mode, `>` copy to the pair's other folder, `<` swap the pair's folders, Tab the pair's other plane, `q` Record macro, `t` scratch plane and `s` window navigation. `leader` (empty by default) is a key such as `Space` that starts a sequence outside text fields and terminals. `inTerminals` and `inTextFields` (both false) leave `Ctrl+B` to the shell and to text fields; pressing the prefix twice in a terminal sends it to the shell. `whichKey` shows the next keys after a moment; `timeout` (ms) ends a sequence left waiting. `root` holds keys that need no prefix (tmux's `bind -n`), each with ⌃, ⌥ or ⌘ or an F-key; `repeat` lists prefix keys that may be pressed again without the prefix within `repeatTime` (ms, default 500), as tmux's `bind -r` (`+` and `-` by default); `modes` holds named tables (`resize` by default) that a `mode <name>` line enters and Escape leaves, where a digit the mode does not bind is a count. Two spellings of one key, and a `mode` line naming no mode, are listed as warnings. Settings → Shortcuts → Prefix keys edits the same keymap as rows of keys and lines, for the prefix, the keys without one and each mode (with a Repeat box and Add mode), and lists this session's `:bind`s and `:command`s with Keep and Discard; the prefix and leader are set by clicking them and pressing the key, as tmux's `set -g prefix C-a` sets it by name (`Ctrl+A`, `Ctrl+Space` and other ⌃ or ⌘ chords). The prefix takes part in shortcut conflict checks.

A custom action's executor can be `{ "kind": "sequence", "commands": [...], "command"?: "Name" }`: lines run in order (command IDs as before, or lines with words), the later ones where the earlier ones left things; it stops at the first not available. With `command`, a capitalised name, it also runs on the command line as `:Name words`, `$1`… and `$*` taking the words; no step may run a custom action or another named command. **Record macro** (prefix `q`, or the palette) collects the lines run until it is stopped, with their words, and saves them as such an action, named in a dialog and as a command (`open docs` runs as `:OpenDocs`); the workspace window may save and change sequences, while programs, scripts and terminal actions still change only in Settings. An agent may propose a sequence only if it could propose each step.

In the palette (⌘K), a path (`/…`, `~/…`, `./…`) lists its folder's contents to open; `=` and arithmetic calculates, and choosing the result copies it; `z` and a name jumps to a folder by frecency (folders you open often and lately, as zoxide); and `new folder <name>`, `new file <name>`, `rename <name>` and `go <path>` do so at once.

The space keeps **views**: ⌃⌥⌘1–9 saves the camera as view 1–9 and ⌥⌘1–9 (or prefix 1–9) flies back to it; **Save view…** names one and **Views…** goes to, renames or removes them. They are saved with the workspace's arrangement. **Tour the views** (prefix `b t`) flies through them in turn; `settings.tour` sets the `dwell` at each view and each flight's `duration` (ms) and whether it `loop`s; any key, click or scroll stops it.

**Tiling** lays planes out face-on as tmux lays out panes, at the camera's natural scale so text reads at its size: prefix `%` splits the active plane right and `"` down (adding what `settings.tiling.splitWith` names: `same`, `folder`, `terminal` or `scratch`), `=` tiles the planes in view, Space steps through the layouts (side by side, stacked, main beside the rest, main above the rest, grid; `settings.tiling.defaultLayout` is the first), `{` and `}` swap the active tile, `M` makes it the main tile, `+` and `-` size the main tile, and `!` stops tiling. The tiling is kept with the workspace and follows the window's size; a closed tile's space goes to the rest.

`settings.layouts` holds **layout templates**: `{ id, name, planes, layout, main }`, where each plane is `{ "kind": "folder" | "file", "path" }`, `{ "kind": "terminal", "path", "profileID"? }`, `{ "kind": "scratch" }` or `{ "kind": "search", "query", "name", "root"? }`; a path starting `~` is in the home folder and an empty path is the folder in view. **Save layout as template…** captures the tiled planes (or those in view) and **Open layout “…”** adds them, tiled, to the workspace in view.

**Explode folder** (prefix `e`, or 2 and 3 levels from the palette) opens the active folder plane's subfolders as linked planes around it, at most 60, without hidden folders, bundles or links, in one undo step; **Collapse exploded folders** (prefix `E`) closes them again.

Every setting in Settings is also a command, in the palette (⌘K) and for a shortcut; the space toolbar, minimap, viewcube and grid are in the View menu too: an on/off setting toggles (**Hide minimap**, **Hide space toolbar**, **Turn off: Editor › Wrap long lines**), a choice offers each value (**Space background: Blur**), and a number or colour opens Settings at it. Their ids are `setting.<path>` and `setting.<path>=<value>`, for `shortcuts` and agents. The palette keeps them apart from the commands: what is typed lists at most four settings, in a Settings section after the commands (before them when one is the better match), found by the words of their names or values only, with **All N matching settings** for the rest; a workspace's own (**This workspace: …**) is listed when `this` or `workspace` is typed. Typing `,` first, or **Search settings…**, searches the settings alone, by category; Backspace in an empty search goes back to the commands. Each row shows its value: a switch for on and off, the current choice or number beside the rest. A setting with choices is one row until its name and a colon (`Appearance:`) or a value (`appearance light`) is typed; choosing the row lists its choices. A setting the workspace window does not change itself (programs, Trash confirmation, file opening, limits) opens Settings at it instead. Agents may propose the on/off and choice commands for the settings they may configure; each is reviewed like any other proposal.

`ui.titlebar.visible` (default `true`) shows Viewer's title bar. Hidden (**Hide title bar**, ⌥⌘T), it takes the window's buttons with it and comes back over the space while the pointer is at the window's top edge, so the window can still be moved and its menus reached.

`ui.space.grid` (default `true`) draws the space's grid lines (**Hide background grid**). `ui.space.color` is the space's colour as `#rrggbb`; `""` (the default) follows the appearance. A workspace can have its own colour over it, set with **Workspace look…** in the Workspace menu and kept with the workspace's layout. Settings → Space offers swatches for the appearance and the system colour picker for any other.

`ui.space.backdrop` sets what the space shows between planes: `opaque` (its colour, the default), `blur` (what is behind Viewer's window, blurred) or `clear` (what is behind, as it is; this applies when the window next opens, as macOS makes a window transparent only as it is created). `ui.space.backdropOpacity` (0 to 100, default 60) is how much of the space's colour covers what is behind. Planes stay opaque.

## Workspace profiles and local choices

**Workspace look…** chooses a workspace default profile and local presentation
choices. Resolution is shared general preferences → workspace default profile →
explicitly selected profile → local workspace overrides. For a folder, its shared
path-specific view then applies, followed by project folder views when that project
is open. Selection, cursor and navigation stay independent in every explorer.

Settings always edits shared defaults. A profile pins only the leaves it names;
other shared edits still appear immediately. Applying or leaving a profile never
rewrites `config.jsonc`. Supported presentation commands invoked in a workspace
write local choices while a profile is active; without one they retain their
ordinary shared behavior. Explicit **This workspace: …** commands
(`setting.<path>@workspace`) and `:setlocal` always stay local. A choice equal to
its inherited profile value removes that local override. **Use profile defaults in
this workspace** clears local choices; without a profile it is **Use the general
settings in this workspace**.

Local presentation includes title bar/sidebar, space toolbar, minimap, viewcube,
grid, headers, origin, colour and backdrop choices. A native effect such as clear
transparency still requires reopening the window. The window is created from the
same effective preferences as its renderer.

`settings.profiles` holds up to 30 shared definitions, `{ id, name, values }`:

```jsonc
"profiles": [
  {
    "id": "reading",
    "name": "Reading",
    "values": {
      "ui.space.minimap": false,
      "settings.editor.fontSize": 20,
      "settings.editor.wordWrap": true
    }
  }
]
```

Supported leaves are UI sidebar/titlebar/space/list presentation,
`settings.appearance`, browsing defaults, editor settings, terminal font, tiling,
Tour and chosen theme IDs. Session restoration and Trash confirmation stay shared.
Providers, agent scopes, permissions, hotkey/process settings and reusable catalogs
cannot be profile values. Validation uses the same type/range schemas as Settings;
unknown paths and malformed values are rejected. Parent-object shorthand expands
only through supported leaves, and an explicit leaf wins independent of JSON order.
A profile supports at most 100 input entries and 128 expanded leaves.

Built-ins **Focus**, **Present** and **Full** have reserved IDs. Focus hides title
bar, sidebar, space toolbar, minimap, viewcube and grid. Present also hides plane
headers and starts Tour only when explicitly invoked with saved views available.
Full shows the chrome, including sidebar. **Focus mode** (⇧⌘F) toggles the explicit
Focus overlay. **Leave profile …** clears the explicit selection and reveals the
workspace default and retained local choices. **Save profile as…** captures the
current effective chrome/look values as a new shared definition. It does not
capture credentials or consent.

Profile definitions update live in every window referencing their ID. Removing a
definition keeps those references and shows an unavailable-profile notice with
inherited fallback; Workspace look can clear or repair it. Unsupported legacy
values remain readable with warnings so an existing file can be repaired. New
invalid profiles/imports are rejected. Old globally applied profiles migrate with
compare-and-set restoration; newer shared edits and unresolved previous values
are preserved with diagnostics. Saved workspace format 7 keeps these local records
separate from configuration; versions 1–6 are backed up before migration.

`settings.prompts.providerID` names the model provider that answers requests in words (`>` in the palette, [command-line.md](command-line.md)); `""` uses the first provider. Settings → Models chooses it.

`settings.themes` holds **themes**: `{ id, name, look, shell, syntax, terminal, metrics? }`, where `look` is `dark` or `light` and each group maps tokens to `#rrggbb` colours (or `#rrggbbaa`, `#rgb`). `shell` has `space`, `surface`, `raised`, `field`, `ink`, `muted`, `subtle`, `accent`, `line`, `selection` and `danger`; `syntax` has `comment`, `string`, `keyword`, `number` and `function`, the code colours of previews and editors; `terminal` has `background`, `foreground`, `cursor`, `selectionBackground` and the sixteen ANSI colours (`black` … `brightWhite`). A theme leaves out what it keeps from the built-in Viewer Dark or Viewer Light. `settings.theme` is `{ "dark": id, "light": id }`, the theme for each appearance; `""` is the built-in one. Settings → Themes picks them, makes a new theme from the built-in one, edits each colour with the system picker or as hex, duplicates, copies a theme as JSON and removes it, and **Import…** reads an iTerm colour preset (`.itermcolors`: the terminal palette, and the space, text and accent from it) or a VS Code colour theme (`.json`, comments allowed: the workbench, token and terminal colours). The palette offers **Theme: …** for each theme of the appearance in use. plurid's grid, minimap and controls follow a custom theme's space, surface, text and accent.

Optional `metrics` supplies `fontFamily`, `density` (`comfortable` or `compact`)
and `radius` (0–16 pixels). These apply to core interface typography, spacing and
control/panel/dialog corners. An empty family or omitted metric inherits the
built-in theme. Theme insertion and choosing it publish one revisioned Settings
edit, so two windows cannot observe a selected ID before its definition exists.

`settings.browsing.newFileExtension` (default `md`) is the extension, without the dot, that **New file…** names a file with; a new scratch plane starts in its language, and Save As offers it when it is one of that language. Settings → Browsing offers each language of the highlighting table.

`settings.shortcuts` maps command IDs to `Cmd+…` or `Ctrl+…`, with optional `Alt` and `Shift`; an empty string disables an override's binding. Settings → Shortcuts lists the defaults. Useful IDs include `copy-path` (Option-Command-C, newline-separated absolute paths as plain text), `open-selection`, `parent`, `back`, `forward`, `view-list`, `view-grid`, `view-columns`, `view-gallery`, `new-root-folder`, `open-terminal`, `open-tmux`, `open-terminal-plane`, `open-config`, `new-scratch-plane`, `edit-file`, `save-file` and `save-file-as`. Recipe and custom-action shortcuts join the same conflict checks. Text editing, dialogs and terminal input retain their own key handling.

`settings.browsing.confirmTrash` defaults to `true` and is available as **Confirm before moving to Trash** in Settings → Browsing. Set it to `false` to move files directly to the native system Trash, with the same guarded Undo. When confirmation is enabled, Escape cancels and Enter confirms; both keys appear before their button labels. This setting does not enable permanent deletion. New folder requires Command-Shift-N; pressing only modifiers cannot invoke a command.

## Declarative custom actions

Settings → Actions edits custom actions alongside existing recipes. A custom action appears in the searchable context menu, Commands, native Actions menu and optional shortcut. The active context determines whether it is available.

```jsonc
"customActions": [
  {
    "id": "project-shell",
    "name": "Project shell",
    "aliases": ["ps", "shell"],
    "icon": "terminal",
    "shortcut": "Cmd+Alt+T",
    "order": 10,
    "pinned": true,
    "when": { "target": "any", "extensions": [], "min": 0, "max": 10000 },
    "executor": { "kind": "terminal", "profileID": "login" }
  }
]
```

`when.target` accepts `any`, `files`, `folders` or `background`; `extensions` restricts all selected items, and `min`/`max` bound the selection count. Extensions exclude the dot. Executor kinds are:

| Kind         | Fields                            | Behavior                                                                                  |
| ------------ | --------------------------------- | ----------------------------------------------------------------------------------------- |
| `builtin`    | `command`                         | Invoke a built-in command with the captured context. Custom-action recursion is rejected. |
| `recipe`     | `recipeID`                        | Open the existing action setup and proposal review.                                       |
| `terminal`   | `profileID`                       | Create a terminal plane with that shell profile.                                          |
| `executable` | `executable`, `args`, `perItem`   | Start a process with literal argument values.                                             |
| `shell`      | `executable`, `script`, `perItem` | Explicitly interpret a script through the chosen shell.                                   |

Executable arguments support `{directory}` and, for one selected item or `perItem: true`, `{path}`, `{name}` and `{extension}`. A whole argument `{paths}` expands into separate literal arguments for the selection. Filenames containing spaces, quotes or `$()` are passed as values. `perItem: true` executes sequentially for each selected entry; otherwise one process receives the batch. Shell scripts receive the captured directory as `$1` and selected paths as `$2` onward, without inserting filenames into script text.

Custom processes run in the captured folder, validate selected identities, retain bounded output and offer cancellation. These are user-authored processes with the user's OS permissions; a working directory is not a sandbox, and arbitrary script changes do not gain file-operation Undo. For reviewed rename/move workflows, use a recipe and the ordinary operation service.

The Settings window keeps its size, position and last category privately (`settings-window-v1.json`, beside `window-state-v1.json`); resizing it or changing category no longer writes `config.jsonc`. `settings.settingsWindow` is no longer used: an existing one is accepted, read once as the window's first size, and can be deleted.

See [terminals.md](terminals.md) for shell profiles and tmux, and [actions.md](actions.md) for agent discovery, proposal review and execution grants.
