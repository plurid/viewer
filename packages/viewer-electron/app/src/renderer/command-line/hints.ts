import { quoteWord } from '../../domain/command-line/lex';
import { settingByName, settingShortName } from '../../domain/command-line/set';
import { getState } from '../state/store';
import type { ResolvedCommand } from '../commands/registry';
import { choicesPrefix } from '../commands/palette-sections';

/** Commands a verb names alone: the verb is the shorter line. */
const verbLines: Readonly<Record<string, string>> = {
  'close-plane': 'q',
  'close-all-planes': 'qa',
  'close-other-planes': 'on',
  'save-file': 'w',
  'save-all': 'wa',
  'tile-split-right': 'vs',
  'tile-split-down': 'sp',
  'next-workspace': 'tabn',
  'previous-workspace': 'tabp',
  'new-workspace': 'tabnew',
  'delete-workspace': 'tabc',
  'rename-workspace': 'rename-window',
  'plane-hints': 'display-panes',
  'keymap-help': 'h keys',
};
/** The name after a family's label (“Theme: Night Owl”, “Open layout “Pair””). */
const labelName = (label: string) => /[“:]\s*(.+?)”?$/.exec(label)?.[1] ?? label;
/**
 * THE LINE A ROW IS (2026-10-23), shown beside it in the palette, to learn the command line by:
 * Close plane is `:q`, Hide background grid `:set grid!`, Theme: Night Owl `:colo 'Night Owl'`.
 */
export function lineHint(command: ResolvedCommand): string | undefined {
  const verb = verbLines[command.id];
  if (verb) return verb;
  if (command.id.startsWith(choicesPrefix)) {
    const name = settingShortName(command.id.slice(choicesPrefix.length + 'setting.'.length));
    return settingByName(name) && name !== command.id ? `set ${name}=` : undefined;
  }
  const setting = /^setting\.([^=@]+)(?:=(.+)|(@workspace))?$/.exec(command.id);
  if (setting) {
    const [, path, value, local] = setting;
    const name = settingShortName(path!);
    const definition = settingByName(name);
    if (!definition || name === path) return undefined;
    if (value) return `set ${name}=${value}`;
    if (definition.kind !== 'boolean') return `set ${name}=`;
    return `${local ? 'setl' : 'set'} ${name}!`;
  }
  if (command.id.startsWith('theme.')) return `colo ${quoteWord(labelName(command.label))}`;
  if (command.id.startsWith('profile.')) return `profile ${command.id.slice('profile.'.length)}`;
  if (command.id.startsWith('tile-layout-'))
    return `layout ${command.id.slice('tile-layout-'.length)}`;
  if (command.id.startsWith('layout.')) return `layout ${quoteWord(labelName(command.label))}`;
  if (command.id.startsWith('workspace:')) {
    const name = getState().saved.workspaces.find(
      (space) => `workspace:${space.id}` === command.id,
    )?.name;
    return name ? `tabn ${quoteWord(name)}` : undefined;
  }
  return undefined;
}
