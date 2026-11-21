# Shipped shortcuts yield to the person's own keys and new-item keys

Status: accepted. Date: 2026-11-21.

## Context

Saving a full copy of default shortcuts prevents updated defaults from reaching users, while adding
or changing a shipped shortcut can collide with a key the person already assigned to a command,
recipe or custom action. In addition, Viewer's file-creation keys needed to match Finder's habits in
a multi-plane workspace. The owner decided that a shipped shortcut always gives way to the person's
own key and set the shipped new-item keys.

## Decision

`src/domain/preferences/shortcuts.ts` owns shortcut resolution. Settings saves only keys the person
changed; unchanged shortcuts always come from `defaultShortcuts`, `menuShortcuts` and
`previewShortcuts`. `resolvedShortcut` returns the person's saved binding when present, else the
shipped key unless `shippedKeyHolder` finds that the person gave that chord to another command,
recipe, custom action or the keymap prefix. When taken, the shipped command yields (`""`) and
Settings names who holds the key. Built-in pairs shipped sharing a chord in separate contexts (such
as Command-L for **Go to Folder…** and **Rotate Picture Left**) remain valid while both keep their
shipped chord.

`settingsSchema` (`src/desktop/preferences/settings-schema.ts`) uses `resolvedShortcut` and
`shortcutClash` to refuse conflicting person-owned bindings without rejecting an existing settings
file when a release adds a shipped shortcut. `installApplicationMenu`
(`src/desktop/windows/application-menu.ts`) and `keyCommand` (`src/renderer/explorer/input.ts`) read
the same resolution.

The shipped new-item keys are:

- Command-N: **New Files Plane** (`new-root-folder` in `defaultShortcuts`).
- Shift-Command-N: **New Folder…** (`new-folder` in `defaultShortcuts`).
- Option-Command-N: **New Window** (`new-native-window` in `menuShortcuts`).

## Consequences

Releases can ship new or updated default shortcuts without breaking saved configurations or taking
over keys the person chose. Menus, the command palette, preview keys and Settings always agree on
the active key for every command.

See [DESIGN.md](../../DESIGN.md) and [Shortcuts reference](../reference/shortcuts.md).
