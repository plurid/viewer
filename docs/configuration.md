# Configuration

Settings and external editors use the same `config.jsonc` in Electron's user-data directory. **Settings → Configuration** shows its exact path, opens it in the associated editor, validates it, displays recent changes, imports/exports it and resets editable preferences. Comments and trailing commas are supported. A sibling `config.schema.json` provides editor completion and is generated from the validation declarations used by the app.

The file has `version: 1`, `$schema`, `settings` and `ui`. Start with the generated file or an export; examples below are partial objects to merge into it. Unknown fields, invalid values, duplicate IDs, conflicting shortcuts and missing referenced profiles/recipes are rejected. Configuration errors include a path or line/column. A malformed external edit remains on disk for correction; the running app retains its last valid settings. `.last-valid` recovery does not replace an invalid or newer-version file. Import validates before replacing the configuration.

Settings writes preserve unrelated comments and values. External edits reload within the watcher interval. A Settings edit based on an older revision merges when it touches independent fields; overlapping edits report a conflict. Atomic replacement checks for an intervening disk change before publishing. Legacy `settings-v1.json` receives an exclusive backup before migration. Existing folder appearances seed shared overrides once, with the active explorer winning a conflict.

Credentials, authentication tokens, effective execution grants, workspace arrangement, navigation sessions and caches are separate metadata. Adding an approval field to JSONC is invalid and cannot authorize an agent.

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

Supported overrides include view, sort/direction, grouping, hidden files, folders-first ordering, density, list fields/order/widths/wrapping and browsing-column width. Overrides apply to the same path in every root and workspace. Selection, cursor, history, search/filter and scroll remain independent in each explorer. Known Viewer moves/renames remap overrides and inactive sessions; arbitrary external moves are not inferred from path alone.

List headers and searchable column actions control fields, ordering and widths. Browser-column edges resize with drag or Left/Right when the separator is focused; Shift changes the keyboard step, double-click fits filenames, and Option applies a width to the visible trail. Names retain full-text tooltips. **Use as default folder view** updates defaults; **Reset this folder’s view** removes that folder's overrides. Grouping currently renders in List view.

`settings.browsing.newPlaneLocation` chooses `current`, `home`, `desktop`, `documents`, `downloads`, `pictures`, `movies`, `music` or `custom`. A custom location uses `newPlanePath`. Current follows a folder plane, a terminal's working folder or a preview's parent, with Home as the fallback. Creating a plane always creates a fresh root.

## Opening and shortcuts

`settings.fileOpening.default` is `automatic`, `plane` or `native`. Automatic uses an available preview module, otherwise the OS association. `types` overrides individual lowercase extensions, for example `{ "pdf": "plane", "mkv": "native" }`. Office extensions start with native opening. Explicit **Open linked plane**, **Open another plane**, **Open in …** and **Open With…** remain available regardless of automatic opening policy.

`settings.shortcuts` maps command IDs to `Cmd+…` or `Ctrl+…`, with optional `Alt` and `Shift`; an empty string disables an override's binding. Settings → Shortcuts lists the defaults. Useful IDs include `open-selection`, `parent`, `back`, `forward`, `view-list`, `view-grid`, `view-columns`, `view-gallery`, `new-root-folder`, `open-terminal`, `open-tmux`, `open-terminal-plane` and `open-config`. Recipe and custom-action shortcuts join the same conflict checks. Text editing, dialogs and terminal input retain their own key handling.

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

See [terminals.md](terminals.md) for shell profiles and tmux, and [actions.md](actions.md) for agent discovery, proposal review and execution grants.
