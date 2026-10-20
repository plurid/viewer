import { getState } from '../state/store';
import type { CommandContext, CommandDefinition } from '../commands/registry';
import type { ActionContext } from '../../domain/services';
/** Who a plan was made for: a watch rule runs as the person, and was labelled “Your selection”
 * (2026-10-20). */
export function planOrigin(context: Pick<ActionContext, 'actor' | 'workspaceID'>): string {
  if (context.actor === 'agent') return 'Agent proposal';
  return context.workspaceID === 'watch-rule' ? 'Watch rule' : 'Your selection';
}
export function requestAction(recipeID: string, context: CommandContext): void {
  window.dispatchEvent(
    new CustomEvent('viewer:action-request', {
      detail: { recipeID, context: { ...context, selection: [...context.selection] } },
    }),
  );
}
/** The same catalog supplies right-click, palette, native menu and agent-facing IDs. */
export function actionCommands(): CommandDefinition[] {
  return [
    ...getState().settings.settings.recipes.map((recipe) => ({
      id: 'recipe.' + recipe.id,
      label: recipe.name + '…',
      group: 'Actions',
      icon: 'rename' as const,
      aliases: [
        recipe.kind,
        recipe.name,
        ...(recipe.kind === 'book-name' ? ['book', 'bk', 'pdf', 'epub'] : []),
      ],
      shortcut: recipe.shortcut,
      when: (context: CommandContext) =>
        context.selection.length > 0 &&
        context.selection.some(
          (file) =>
            file.directory || !recipe.formats.length || recipe.formats.includes(file.extension),
        ),
      run: (context: CommandContext) => requestAction(recipe.id, context),
    })),
    {
      id: 'describe-task',
      label: 'Describe a task…',
      group: 'Actions',
      icon: 'command' as const,
      aliases: ['ai', 'task', 'agent'],
      when: (context: CommandContext) => !!context.selection.length,
      // a recipe that exists: 'rename' could have been removed (2026-10-20)
      run: (context: CommandContext) => {
        const recipes = getState().settings.settings.recipes;
        requestAction(
          (recipes.find((recipe) => recipe.kind === 'rename') ?? recipes[0])?.id ?? 'rename',
          context,
        );
      },
    },
  ];
}
