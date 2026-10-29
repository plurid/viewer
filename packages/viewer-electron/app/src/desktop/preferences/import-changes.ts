import { bindingRows } from '../../domain/preferences/keymap';
import { findVerb, parseCommandLine } from '../../domain/command-line/verbs';
import type { ApplicationSettings } from '../../domain/services';
import { sameJSON } from '../../domain/json';
/** What an import changes that Viewer may run, reach or send: confirmed before it applies. */
export function importChanges(current: ApplicationSettings, next: ApplicationSettings): string[] {
  const programs = (settings: ApplicationSettings) =>
    settings.customActions.filter(({ executor }) =>
      ['shell', 'executable'].includes(executor.kind),
    );
  return [
    !sameJSON(current.agents, next.agents) &&
      'agent access (turning agents on or adding folders still waits for your approval in Settings → Agents)',
    !sameJSON(current.providers, next.providers) && 'model providers and their addresses',
    !sameJSON(programs(current), programs(next)) && 'actions that run programs or shell scripts',
    !sameJSON(current.terminals, next.terminals) && 'terminal profiles and programs',
    !sameJSON(riskyLines(current), riskyLines(next)) &&
      'keys and sequences that type into terminals, move files to the Trash, rename them or drop unsaved text',
  ].filter((change): change is string => !!change);
}
/**
 * Lines of keys and sequences that act beyond the window: typing into a terminal,
 * the Trash, renaming, and `!` dropping unsaved text. An import that changes them asks first.
 */
function riskyLines(settings: ApplicationSettings): string[] {
  const lines = [
    ...[
      settings.keymap.bindings,
      settings.keymap.root ?? {},
      ...Object.values(settings.keymap.modes ?? {}).map((mode) => mode.bindings),
    ].flatMap((bindings) => bindingRows(bindings).flatMap((row) => row.commands)),
    ...settings.customActions.flatMap(({ executor }) =>
      executor.kind === 'sequence' ? executor.commands : [],
    ),
  ];
  return lines
    .filter((line) => {
      try {
        return parseCommandLine(line).some((step) => {
          const key = findVerb(step.name)?.key;
          return (
            ['send-keys', 'trash', 'mv'].includes(key ?? '') ||
            step.name === 'trash' ||
            (step.bang && ['quit', 'qall', 'only'].includes(key ?? ''))
          );
        });
      } catch {
        return false;
      }
    })
    .sort();
}
