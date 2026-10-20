import type { ApplicationSettings } from './services';

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
  ];
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
