import { categories } from '../../domain/preferences/catalog';
import { commandScore, normalize, rankCommands, type ResolvedCommand } from './registry';

/**
 * Settings apart in the palette. Every setting is a command (window-commands/
 * settings.ts), a few hundred of them, whose labels start alike ("Turn off: …", "Hide …"), so loose
 * matching listed them for nearly anything typed. The palette lists them in a Settings section after
 * the commands, found only by the words of their names and a few at a time; `,` (as ⌘, opens
 * Settings) searches the settings alone. A setting with choices is one row with its value until its
 * name and a colon, or one of its values, is typed.
 */
export interface PaletteView {
  rows: ResolvedCommand[];
  /** Section headings, by the id of the row each comes before. */
  headings: ReadonlyMap<string, string>;
}

/** An explicitly named action wins over interpreting its remaining words as an argument. */
export function paletteSuggestions(
  commands: readonly ResolvedCommand[],
  suggestions: readonly ResolvedCommand[],
  query: string,
): ResolvedCommand[] {
  const named = (label: string) => normalize(label.replace(/[.…]+$/u, '').trim());
  const needle = named(query);
  if (!needle) return [...suggestions, ...commands];
  const exact = commands.filter((command) => named(command.label) === needle);
  const ids = new Set(exact.map((command) => command.id));
  return [...exact, ...suggestions, ...commands.filter((command) => !ids.has(command.id))];
}
/** The row that searches every matching setting. */
export const moreSettingsID = 'palette:more-settings';
/** A setting's choices folded into one row: choosing it lists them. */
export const choicesPrefix = 'palette:choices:';
/** Words of a setting's label that say what its command does, not what it is. */
const verbs = new Set(['turn', 'on', 'off', 'show', 'hide', 'change', 'this', 'workspace']);
const words = (text: string) =>
  normalize(text.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2'))
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
/**
 * How well a setting matches: each word typed starts a word of its name, choice, label or
 * category. In the palette (`anchored`) one of them must be of its name or choice and not a verb,
 * so "turn" or "space" alone list nothing; its path matches a query with a dot.
 */
function settingScore(command: ResolvedCommand, needle: string, anchored: boolean): number {
  const setting = command.setting;
  if (!setting || !needle) return 0;
  const path = command.id.replace(/^setting\./, '').toLowerCase();
  if (needle.includes('.')) return path.startsWith(needle) ? 1000 : path.includes(needle) ? 850 : 0;
  const named = [...words(setting.name), ...words(setting.choice ?? '')];
  const others = [...words(command.label), ...words(command.detail ?? '')];
  let anchor = !anchored;
  for (const term of words(needle)) {
    if (named.some((word) => !verbs.has(word) && word.startsWith(term))) anchor = true;
    else if (![...named, ...others].some((word) => word.startsWith(term))) return 0;
  }
  if (!anchor) return 0;
  const label = normalize(command.label);
  return label.startsWith(needle) ? 1000 : normalize(setting.name).startsWith(needle) ? 950 : 900;
}
interface Scored {
  command: ResolvedCommand;
  index: number;
  score: number;
}
const choiceKey = (command: ResolvedCommand) =>
  command.setting?.choice === undefined ? undefined : command.id.split('=')[0];
/**
 * A setting's choices as one row with its current value, unless the query names the setting and a
 * colon ("Appearance:") or one of its choices ("appearance light"): those rows then.
 */
function foldChoices(items: readonly Scored[], needle: string): Scored[] {
  const terms = words(needle);
  const groups = new Map<string, Scored[]>();
  for (const item of items) {
    const key = choiceKey(item.command);
    if (key) groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const folded: Scored[] = [];
  for (const item of items) {
    const key = choiceKey(item.command);
    if (!key) {
      folded.push(item);
      continue;
    }
    const group = groups.get(key)!;
    if (group[0] !== item) continue;
    const picked = group.filter(
      ({ command, score }) =>
        score > 0 &&
        ((needle.includes(':') && normalize(command.label).startsWith(needle)) ||
          words(command.setting!.choice!).some((word) =>
            terms.some((term) => word.startsWith(term)),
          )),
    );
    if (picked.length) {
      folded.push(...picked);
      continue;
    }
    const current = group.find(({ command }) => command.setting!.current) ?? item;
    const { name } = current.command.setting!;
    folded.push({
      index: item.index,
      score: Math.max(...group.map((member) => member.score)),
      command: {
        ...current.command,
        id: choicesPrefix + key,
        label: name,
        icon: 'settings',
        setting: { name, value: current.command.setting!.choice },
      },
    });
  }
  return folded;
}
function ranked(commands: readonly ResolvedCommand[], needle: string, anchored: boolean) {
  const items = foldChoices(
    commands.map((command, index) => ({
      command,
      index,
      score: settingScore(command, needle, anchored),
    })),
    needle,
  ).filter((item) => item.score > 0);
  // a setting's name and a colon is that setting's choices alone
  const named = needle.includes(':')
    ? items.filter((item) => normalize(item.command.label).startsWith(needle))
    : [];
  return (named.length ? named : items).sort((a, b) => b.score - a.score || a.index - b.index);
}
/**
 * The palette's rows: with no query the recent and primary commands, as before; with one, the
 * commands that match, and the settings whose names do: four after commands, eight alone, first
 * when one is the better match, the rest a row away. A workspace's own setting is listed when
 * "workspace" or "this" is typed.
 */
export function paletteRows(
  commands: readonly ResolvedCommand[],
  query: string,
  recent: readonly string[],
): PaletteView {
  const needle = normalize(query.trim());
  if (!needle)
    return { rows: rankCommands(commands, query, recent, 'palette'), headings: new Map() };
  const plain = rankCommands(
    commands.filter((command) => !command.setting),
    query,
    recent,
    'palette',
  );
  const workspace = words(needle).some((term) => term === 'this' || term === 'workspace');
  const settings =
    needle.length < 2
      ? []
      : ranked(
          commands.filter(
            (command) => command.setting && (workspace || !command.setting.workspace),
          ),
          needle,
          true,
        );
  const limit = plain.length ? 4 : 8;
  const shown = settings.slice(0, limit).map((item) => item.command);
  if (!shown.length) return { rows: plain, headings: new Map() };
  const more: ResolvedCommand[] =
    settings.length > limit
      ? [
          {
            id: moreSettingsID,
            label: `All ${settings.length} matching settings`,
            group: 'Settings',
            icon: 'settings',
            aliases: [],
            primary: false,
            source: '',
            context: shown[0]!.context,
          },
        ]
      : [];
  const first = settings[0]!.score > (plain[0] ? commandScore(plain[0], needle) : 0);
  const headings = new Map([[shown[0]!.id, 'Settings']]);
  if (first && plain[0]) headings.set(plain[0].id, 'Commands');
  return {
    rows: first ? [...shown, ...more, ...plain] : [...plain, ...shown, ...more],
    headings,
  };
}
/** An on/off setting by its name beside its switch: "Sort folders first", not "Turn off: …". */
const byName = (row: ResolvedCommand): ResolvedCommand =>
  typeof row.setting?.value === 'boolean'
    ? { ...row, label: (row.setting.workspace ? 'This workspace › ' : '') + row.setting.name }
    : row;
/**
 * The settings search: every setting under its category heading (the rows then without it), or
 * those whose words match, each with its category; on/off settings by their names.
 */
export function settingRows(commands: readonly ResolvedCommand[], query: string): PaletteView {
  const settings = commands.filter((command) => command.setting);
  const needle = normalize(query.trim());
  if (needle)
    return {
      rows: ranked(settings, needle, false).map((item) => byName(item.command)),
      headings: new Map(),
    };
  const order = (command: ResolvedCommand) => {
    const index = categories.indexOf(command.detail ?? '');
    return index < 0 ? categories.length : index;
  };
  const rows = foldChoices(
    settings.map((command, index) => ({ command, index, score: 0 })),
    '',
  )
    .sort((a, b) => order(a.command) - order(b.command) || a.index - b.index)
    .map((item) => item.command);
  const headings = new Map<string, string>();
  rows.forEach((row, index) => {
    if (row.detail && row.detail !== rows[index - 1]?.detail) headings.set(row.id, row.detail);
  });
  return { rows: rows.map((row) => ({ ...byName(row), detail: undefined })), headings };
}
