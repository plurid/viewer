import type { ApplicationSettings } from '../services';
import {
  bindingRows,
  canonicalBindings,
  type Keymap,
  type KeymapBinding,
} from '../preferences/keymap';
import { findVerb, parseCommandLine } from '../command-line/verbs';

/**
 * References that name nothing (2026-10-20): a custom action's recipe or terminal profile, a built-in
 * command that is another custom action, a recipe's provider. They were not checked at all. They are
 * reported, not refused: config.jsonc refused would put Viewer on its defaults, and Settings deletes
 * that leave one behind would fail. A use fails visibly, and an agent cannot add one.
 */
export function referenceIssues(settings: ApplicationSettings): string[] {
  const recipes = new Set(settings.recipes.map((recipe) => recipe.id));
  const profiles = new Set(settings.terminals.profiles.map((profile) => profile.id));
  const providers = new Set(settings.providers.map((provider) => provider.id));
  return [
    ...settings.customActions.flatMap(({ name, executor }) =>
      executor.kind === 'recipe' && !recipes.has(executor.recipeID)
        ? [`The action “${name}” runs the recipe “${executor.recipeID}”, which does not exist.`]
        : executor.kind === 'terminal' && !profiles.has(executor.profileID)
          ? [
              `The action “${name}” opens the terminal profile “${executor.profileID}”, which does not exist.`,
            ]
          : executor.kind === 'builtin' && executor.command.startsWith('custom.')
            ? [
                `The action “${name}” runs another custom action, “${executor.command}”, which actions cannot do.`,
              ]
            : [],
    ),
    ...settings.recipes.flatMap(({ name, providerID }) =>
      providerID && !providers.has(providerID)
        ? [`The recipe “${name}” uses the model provider “${providerID}”, which does not exist.`]
        : [],
    ),
    ...keymapIssues(settings.keymap),
  ];
}
/**
 * The keymap's (2026-10-23): two spellings of one key (`Ctrl+B` and `C-b`), the later used; and
 * `mode name` lines naming no mode.
 */
function keymapIssues(keymap: Keymap): string[] {
  const tables: [string, Record<string, KeymapBinding>][] = [
    ['prefix', keymap.bindings],
    ['no-prefix', keymap.root ?? {}],
    ...Object.entries(keymap.modes ?? {}).map(
      ([name, mode]): [string, Record<string, KeymapBinding>] => [`mode ${name}`, mode.bindings],
    ),
  ];
  const modes = new Set(Object.keys(keymap.modes ?? {}));
  return tables.flatMap(([table, bindings]) => [
    ...canonicalBindings(bindings).collisions.map(
      (keys) => `Two ${table} bindings are the key ${keys}: the later one is used.`,
    ),
    ...bindingRows(bindings).flatMap(({ keys, commands }) =>
      commands.flatMap((line) => {
        try {
          return parseCommandLine(line)
            .filter((step) => findVerb(step.name)?.key === 'mode')
            .flatMap((step) => {
              const name = step.words.find((word) => !word.text.startsWith('-'))?.text;
              return name && !modes.has(name)
                ? [`${keys.join(' ')} (${table}) enters the mode “${name}”, which does not exist.`]
                : [];
            });
        } catch {
          return [];
        }
      }),
    ),
  ]);
}

/** The names of what uses a recipe, a terminal profile or a provider: Settings keeps it until they change. */
export function referencesTo(
  settings: ApplicationSettings,
  kind: 'recipe' | 'profile' | 'provider',
  id: string,
): string[] {
  if (kind === 'provider')
    return settings.recipes
      .filter((recipe) => recipe.providerID === id)
      .map((recipe) => `“${recipe.name}”`);
  return settings.customActions
    .filter(({ executor }) =>
      kind === 'recipe'
        ? executor.kind === 'recipe' && executor.recipeID === id
        : executor.kind === 'terminal' && executor.profileID === id,
    )
    .map((action) => `“${action.name}”`);
}
