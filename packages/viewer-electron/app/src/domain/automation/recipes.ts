import { z } from 'zod';
import type { ActionRecipe, ApplicationSettings } from '../services';
import { sameJSON } from '../json';
import { shortcutClash } from '../preferences/shortcuts';

const recipeID = z.string().min(1).max(200);
const recipeSchema = z
  .object({
    id: recipeID,
    name: z.string().min(1).max(100),
    kind: z.enum(['batch-rename', 'book-name', 'rename', 'organize', 'summarize']),
    formats: z.array(z.string().max(20)).max(100),
    recursive: z.boolean(),
    instructions: z.string().max(12000),
    template: z.string().max(1000),
    providerID: recipeID.optional(),
    data: z.enum(['names', 'excerpts', 'full-text']),
    shortcut: z.string().max(80).optional(),
  })
  .strict();

export const recipeListSchema = z.array(recipeSchema).max(100);

/** Import alongside the current recipes. A changed copy keeps its contents and leaves the local recipe in place. */
export function mergeImportedRecipes(
  current: ApplicationSettings,
  incoming: ActionRecipe[],
): ActionRecipe[] {
  const recipes = [...current.recipes];
  for (const recipe of incoming) {
    const existing = recipes.find((item) => item.id === recipe.id);
    if (existing && sameJSON(recipeSchema.parse(existing), recipe)) continue;
    const copy = { ...recipe, id: existing ? crypto.randomUUID() : recipe.id };
    if (copy.shortcut && shortcutClash({ ...current, recipes: [...recipes, copy] }))
      delete copy.shortcut;
    if (existing) {
      const imported = recipeSchema.parse({ ...copy, id: recipe.id });
      if (
        recipes.some((item) => {
          const comparable = recipeSchema.parse({ ...item, id: recipe.id });
          return sameJSON(comparable, recipe) || sameJSON(comparable, imported);
        })
      )
        continue;
    }
    recipes.push(copy);
  }
  return recipes;
}
