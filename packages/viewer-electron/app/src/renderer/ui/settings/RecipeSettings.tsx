import { mergeImportedRecipes, recipeListSchema } from '../../../domain/automation/recipes';
import { KeyCapture } from './KeyCapture';
import { shortcutOwner } from '../../../domain/preferences/shortcuts';
import type { ActionRecipe, ApplicationSettings } from '../../../domain/services';
import { builtInRecipes } from '../../../domain/services';
import { Field } from './SettingField';
import { ReferencedRemove } from './AutomationSettings';
import { referencesTo } from '../../../domain/automation/references';
import { Disclosure } from '../Disclosure';
import { ChoiceButton } from '../ChoiceMenu';
import type { SettingsEditor } from './editor';

/** Action recipes: editing, duplicating, importing and exporting. */
export function RecipeSettings({ editor }: { editor: SettingsEditor }) {
  const { snapshot, save, error: setError } = editor;
  const settings = snapshot.settings;
  const recipePatch = (id: string, values: Partial<ActionRecipe>) =>
    save((current) => [
      {
        path: 'settings.recipes',
        value: current.settings.recipes.map((recipe) =>
          recipe.id === id ? { ...recipe, ...values } : recipe,
        ),
      },
    ]);
  const changeRecipes = (change: (current: ApplicationSettings) => ActionRecipe[]) =>
    save(({ settings }) => [{ path: 'settings.recipes', value: change(settings) }]);
  return (
    <>
      <h2>Recipes</h2>
      <p className="settings-note">
        Recipes appear in Commands and file menus. Viewer shows each change for review before it
        applies.
      </p>
      {settings.recipes.map((recipe) => (
        <Disclosure
          variant="row"
          className="settings-recipe"
          key={recipe.id}
          summary={recipe.name}
          meta={recipe.kind}
        >
          <div className="settings-editor">
            <label>
              Name
              <Field
                label="Recipe name"
                value={recipe.name}
                save={(name) => recipePatch(recipe.id, { name })}
              />
            </label>
            <label>
              Action type
              <ChoiceButton
                label="Action type"
                value={recipe.kind}
                choices={builtInRecipes.map((item) => ({ value: item.kind, label: item.name }))}
                onChoose={(kind) =>
                  recipePatch(recipe.id, {
                    kind: kind as ActionRecipe['kind'],
                    template: builtInRecipes.find((item) => item.kind === kind)?.template || '',
                  })
                }
              />
            </label>
            <label>
              Formats
              <Field
                label="Recipe formats"
                placeholder="Empty means all files"
                value={recipe.formats.join(', ')}
                save={(value) =>
                  recipePatch(recipe.id, {
                    formats: value
                      .split(',')
                      .map((value) => value.trim().replace(/^\./, '').toLowerCase())
                      .filter(Boolean),
                  })
                }
              />
            </label>
            <label className="settings-row">
              <span>Include subfolders</span>
              <input
                type="checkbox"
                checked={recipe.recursive}
                onChange={(event) => recipePatch(recipe.id, { recursive: event.target.checked })}
              />
            </label>
            {['book-name', 'batch-rename'].includes(recipe.kind) && (
              <label>
                Filename template
                <Field
                  label="Filename template"
                  value={recipe.template}
                  save={(template) => recipePatch(recipe.id, { template })}
                />
              </label>
            )}
            <label>
              Instructions
              <Field
                multiline
                label="Recipe instructions"
                value={recipe.instructions}
                save={(instructions) => recipePatch(recipe.id, { instructions })}
              />
            </label>
            <label>
              Model provider
              <ChoiceButton
                label="Model provider"
                value={recipe.providerID || ''}
                choices={[
                  { value: '', label: 'Local metadata / no model' },
                  ...settings.providers.map((provider) => ({
                    value: provider.id,
                    label: `${provider.name} · ${provider.model || 'Choose model'}`,
                  })),
                ]}
                onChoose={(providerID) =>
                  recipePatch(recipe.id, { providerID: providerID || undefined })
                }
              />
            </label>
            <label>
              Permitted data
              <ChoiceButton
                label="Permitted data"
                value={recipe.data}
                choices={[
                  { value: 'names', label: 'Filenames only' },
                  { value: 'excerpts', label: 'Metadata and excerpts' },
                  { value: 'full-text', label: 'Extracted text' },
                ]}
                onChoose={(data) => recipePatch(recipe.id, { data: data as ActionRecipe['data'] })}
              />
            </label>
            <label>
              Shortcut
              <KeyCapture
                label="Recipe shortcut"
                kind="shortcut"
                value={recipe.shortcut || ''}
                owner={(value) => shortcutOwner(settings, value, 'recipe.' + recipe.id)}
                onChange={(shortcut) => recipePatch(recipe.id, { shortcut: shortcut || undefined })}
              />
            </label>
            <div className="settings-actions">
              <button
                onClick={() =>
                  changeRecipes((current) => {
                    const source = current.recipes.find((item) => item.id === recipe.id);
                    return source
                      ? [
                          ...current.recipes,
                          {
                            ...source,
                            id: crypto.randomUUID(),
                            name: source.name + ' copy',
                            shortcut: undefined,
                          },
                        ]
                      : current.recipes;
                  })
                }
              >
                Duplicate Recipe
              </button>
              {!builtInRecipes.some((item) => item.id === recipe.id) && (
                <ReferencedRemove
                  name={`the recipe “${recipe.name}”`}
                  users={referencesTo(settings, 'recipe', recipe.id)}
                  onRemove={() =>
                    changeRecipes((current) =>
                      current.recipes.filter((item) => item.id !== recipe.id),
                    )
                  }
                >
                  Remove Recipe
                </ReferencedRemove>
              )}
            </div>
          </div>
        </Disclosure>
      ))}
      <div className="settings-actions">
        <button
          onClick={() =>
            changeRecipes((current) => [
              ...current.recipes,
              { ...builtInRecipes[2]!, id: crypto.randomUUID(), name: 'New action' },
            ])
          }
        >
          New Recipe
        </button>
        <button
          onClick={() => {
            const data = JSON.stringify(settings.recipes, null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'viewer-recipes.json';
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export Recipes
        </button>
        <label className="button-label">
          Import Recipes
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file)
                void file
                  .text()
                  .then((text) => {
                    const value: unknown = JSON.parse(text);
                    const result = recipeListSchema.safeParse(value);
                    if (!result.success)
                      throw new Error(
                        'That file isn’t a list of valid recipes. Choose one Viewer exported.',
                      );
                    changeRecipes((current) => mergeImportedRecipes(current, result.data));
                  })
                  .catch((error) => setError(error.message));
            }}
          />
        </label>
      </div>
    </>
  );
}
