import type { CommandContext } from '../commands/registry';
import { useCommands, useCommandRevision } from '../commands/context';
import { report, useViewer } from '../state/store';

/** Reuse captured command targets and the normal proposal/review flow from manual rename. */
export function RenameActions({
  context,
  disabled,
  onChoose,
}: {
  context: CommandContext;
  disabled: boolean;
  onChoose(): void;
}) {
  const registry = useCommands();
  useCommandRevision(context.paneID);
  const recipes = useViewer((state) => state.settings.settings.recipes);
  const ids = ['rename', 'book-name', 'batch-rename'].flatMap((kind) =>
    recipes.filter((recipe) => recipe.kind === kind).map((recipe) => 'recipe.' + recipe.id),
  );
  const commands = registry.list({
    paneID: context.paneID,
    scope: 'files',
    context,
    ids,
  });
  if (!commands.length) return null;
  return (
    <select
      className="rename-action-select"
      aria-label="Rename actions"
      disabled={disabled}
      value=""
      onChange={(event) => {
        const command = commands.find((command) => command.id === event.target.value);
        if (!command) return;
        onChoose();
        // Remove the manual dialog from the native top layer before opening action setup.
        requestAnimationFrame(() => {
          void registry
            .run(command)
            .then((ran) => {
              if (!ran) report('The originating plane is unavailable. Reopen Rename to try again.');
            })
            .catch(report);
        });
      }}
    >
      <option value="" disabled>
        Rename actions…
      </option>
      {ids.flatMap((id) => {
        const command = commands.find((command) => command.id === id);
        return command ? (
          <option key={id} value={id}>
            {command.label}
          </option>
        ) : (
          []
        );
      })}
    </select>
  );
}
