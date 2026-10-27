# Configuration

Use Settings for ordinary changes. **Settings → Configuration** opens, imports and exports the
shared `config.jsonc`, with diagnostics and an editor schema. Start from the generated file rather
than assembling every field by hand.

## File structure

The document has `version: 1`, `$schema`, `settings` and `ui`. These are partial examples to merge
into an exported configuration, not complete configurations.

```jsonc
{
  "version": 1,
  "settings": {
    "folders": {
      "/work/Photos": {
        "mode": "grid",
        "sort": "modified",
        "descending": true,
      },
    },
  },
}
```

Folder keys must be actual absolute paths on your machine. Examples here use a portable placeholder.
Shared folder presentation follows the path across roots; selection, history, filters and scroll
remain local to each explorer.

## Where choices belong

| Area                                   | Configuration owner                              |
| -------------------------------------- | ------------------------------------------------ |
| Browsing defaults and starting folders | `settings.browsing`                              |
| Per-folder view/sort/grouping/columns  | `settings.folders`                               |
| General chrome and space presentation  | `ui`                                             |
| Editor, terminal and preview metrics   | Their respective settings groups                 |
| Model provider definitions             | `settings.providers`; credentials remain private |
| Reusable actions                       | `settings.customActions`                         |
| Key prefixes, bindings and modes       | `settings.keymap`                                |
| Named presentation profiles            | `settings.profiles`                              |
| Themes and active theme IDs            | `settings.themes`, `settings.theme`              |
| Saved tiling layouts                   | `settings.layouts`                               |
| Index locations and content opt-in     | `settings.search`                                |

The schema and Settings UI define valid fields and ranges. Unknown fields, duplicate IDs, invalid
values and conflicting shortcuts are rejected. Missing references have diagnostics and cannot
silently choose another executor.

## Profiles and workspace choices

Profiles are named presentation overlays, not separate data profiles or access grants. A window
resolves shared defaults, its workspace default profile, an explicit profile and local overrides.
Folder-specific choices further refine browsing. **Workspace look** edits local presentation;
Settings edits shared values.

```jsonc
{
  "id": "reading",
  "name": "Reading",
  "values": {
    "ui.space.minimap": false,
    "settings.editor.fontSize": 20,
    "settings.editor.wordWrap": true,
  },
}
```

Built-ins include **Focus**, **Present** and **Full**. Leaving a profile reveals the retained
underlying choices. A missing definition keeps its reference and offers recovery rather than
overwriting the shared configuration. Profiles cannot hold credentials, provider permissions, agent
scopes or process authority.

## Actions, keys and themes

[Custom actions](actions.md) support contextual conditions, palette folders, parameters and
sequences. The [command language](command-line.md) explains session bindings and Keep in Settings. A
shortcut and a prefix binding use the same command vocabulary.

Themes can override shell, syntax and terminal roles. Settings can import an iTerm color preset or
supported VS Code theme. App controls, read-only previews, the editor and terminal retain their own
metrics.

## Personal backups

The desktop **Backup and restore** command uses the `viewer-personal-backup` format, version `1`.
The `.viewer-backup.json` file contains saved workspace state, bounded private documents and an
explicit selection of personal settings. It is readable JSON, with a 64 MiB limit including
formatting. Export creates a new file exclusively; an existing backup is never overwritten.

Included documents are notes/checklists, unsaved text, media editing decisions, local conversations
and command receipts. Original files, caches, model credentials, provider permissions, agent grants,
browser cookies, live terminal sessions and server processes are excluded. Import assigns new
identities and adds independent workspaces, subject to the existing 30-workspace limit.

The optional preference restore covers browsing, folder presentation, editor/terminal typography,
tiling, tours, themes, presentation profiles, layout templates, shortcuts, keymaps, saved searches,
action recipes, optimization recipes and `settings.toolbars`. It does not import executable
definitions or change effective permissions. `settings.toolbars` maps stable plane-kind or preview
module keys to ordered command IDs; each list has at most eight unique IDs. Unknown IDs remain
stored for repair. `settings.browsing.scrollbars` accepts `system` or `always` and defaults to
`system` for older profiles.

Relinking rewrites typed file and folder references. It leaves document prose, commands and web
addresses literal. Shared project associations and external agent connections need explicit
reconnection. A restored conversation is stopped and its saved context scopes are cleared. Command
receipts remain historical; a previously running receipt becomes interrupted.

The importer validates before creating documents, refuses symbolic-link inputs and writes only fresh
UUID-named private records. Existing documents and the backup are preserved. If writing fails
partway, generated records are kept for recovery; no cleanup removes them. Profiles saved by a newer
Viewer stay in place and cannot be overwritten by an older session.

## External edits and recovery

Valid changes reload live. Invalid or newer-version files remain on disk for correction; Viewer
keeps the last valid running settings. Imports validate first and preserve the replaced text.
Configuration conflict handling protects newer external edits and comments.

Changed executable/shell definitions and native integrations require their own first-run
confirmation. Effective agent grants and provider data permissions remain outside editable
configuration. An imported action or alias cannot bypass fresh exact-scope agent removal review.

See [architecture decisions](../adr/README.md) for window-local profiles and
[troubleshooting](../guides/troubleshooting.md) for configuration recovery.
