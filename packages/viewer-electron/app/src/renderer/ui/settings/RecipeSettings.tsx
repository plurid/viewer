import type { ActionRecipe } from '../../../domain/services';
import { builtInRecipes } from '../../../domain/services';
import { Field } from '../SettingField';
import { ReferencedRemove } from '../AutomationSettings';
import { referencesTo } from '../../../domain/references';
import { Icon } from '../Icon';
import type { SettingsEditor } from './editor';

/** Action recipes: editing, duplicating, importing and exporting. */
export function RecipeSettings({ editor }: { editor: SettingsEditor }) {
  const { snapshot, patch, save, error: setError } = editor;
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
  return (
    <>
      <h2>Recipes</h2>
      <p className="settings-note">
        Recipes appear in Commands and file actions. Every file-change proposal opens for review.
      </p>
      {settings.recipes.map((recipe) => (
        <details className="settings-recipe" key={recipe.id}>
          <summary>
            <Icon name="right" size={12} />
            <span>{recipe.name}</span>
            <small>{recipe.kind}</small>
          </summary>
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
              <select
                value={recipe.kind}
                onChange={(event) =>
                  recipePatch(recipe.id, {
                    kind: event.target.value as ActionRecipe['kind'],
                    template:
                      builtInRecipes.find((item) => item.kind === event.target.value)?.template ||
                      '',
                  })
                }
              >
                {builtInRecipes.map((item) => (
                  <option key={item.kind} value={item.kind}>
                    {item.name}
                  </option>
                ))}
              </select>
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
              <select
                value={recipe.providerID || ''}
                onChange={(event) =>
                  recipePatch(recipe.id, { providerID: event.target.value || undefined })
                }
              >
                <option value="">Local metadata / no model</option>
                {settings.providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name} · {provider.model || 'Choose model'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Permitted data
              <select
                value={recipe.data}
                onChange={(event) =>
                  recipePatch(recipe.id, { data: event.target.value as ActionRecipe['data'] })
                }
              >
                <option value="names">Filenames only</option>
                <option value="excerpts">Metadata and excerpts</option>
                <option value="full-text">Extracted text</option>
              </select>
            </label>
            <label>
              Shortcut
              <Field
                label="Recipe shortcut"
                value={recipe.shortcut || ''}
                placeholder="Cmd+Shift+R"
                save={(shortcut) => recipePatch(recipe.id, { shortcut: shortcut || undefined })}
              />
            </label>
            <div className="settings-actions">
              <button
                onClick={() =>
                  patch('settings.recipes', [
                    ...settings.recipes,
                    {
                      ...recipe,
                      id: crypto.randomUUID(),
                      name: recipe.name + ' copy',
                      shortcut: undefined,
                    },
                  ])
                }
              >
                Duplicate recipe
              </button>
              {!builtInRecipes.some((item) => item.id === recipe.id) && (
                <ReferencedRemove
                  users={referencesTo(settings, 'recipe', recipe.id)}
                  onRemove={() =>
                    patch(
                      'settings.recipes',
                      settings.recipes.filter((item) => item.id !== recipe.id),
                    )
                  }
                >
                  Remove recipe
                </ReferencedRemove>
              )}
            </div>
          </div>
        </details>
      ))}
      <div className="settings-actions">
        <button
          onClick={() =>
            patch('settings.recipes', [
              ...settings.recipes,
              { ...builtInRecipes[2], id: crypto.randomUUID(), name: 'New action' },
            ])
          }
        >
          New recipe
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
          Export recipes
        </button>
        <label className="button-label">
          Import recipes
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file)
                void file
                  .text()
                  .then((text) => {
                    const value: unknown = JSON.parse(text);
                    if (!Array.isArray(value)) throw new Error('Choose a recipe JSON array.');
                    patch('settings.recipes', [...settings.recipes, ...value]);
                  })
                  .catch((error) => setError(error.message));
            }}
          />
        </label>
      </div>
    </>
  );
}
