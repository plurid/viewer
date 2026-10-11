import { getState } from '../state/store';
import type { CommandContext, CommandDefinition } from '../commands/registry';
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
      run: (context: CommandContext) => requestAction('rename', context),
    },
  ];
}
