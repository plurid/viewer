import { settingCatalog, type SettingDefinition } from '../preferences/catalog';
import { LineError, type Word } from './lex';

/**
 * Setting names: short and fixed, as vim's option names are, so a saved line keeps
 * meaning what it meant. A full path (`ui.space.grid`) always works too. vim's own names where it
 * has the setting (`wrap`, `number`, `tabstop`, `expandtab`), with its abbreviations.
 */
export const settingNames: Readonly<Record<string, string>> = {
  grid: 'ui.space.grid',
  toolbar: 'ui.space.toolbar',
  minimap: 'ui.space.minimap',
  minimapauto: 'ui.space.minimapAuto',
  viewcube: 'ui.space.viewcube',
  headers: 'ui.space.planeHeaders',
  dragging: 'ui.space.dragging',
  handles: 'ui.space.resizing',
  origin: 'ui.space.origin',
  opening: 'ui.space.opening',
  color: 'ui.space.color',
  backdrop: 'ui.space.backdrop',
  opacity: 'ui.space.backdropOpacity',
  titlebar: 'ui.titlebar.visible',
  sidebar: 'ui.sidebar.visible',
  planesidebar: 'ui.sidebar.inNewPlanes',
  wrapnames: 'ui.list.wrapNames',
  appearance: 'settings.appearance',
  openin: 'settings.fileOpening.default',
  view: 'settings.browsing.mode',
  newplanes: 'settings.browsing.newPlaneLocation',
  emptyworkspace: 'settings.browsing.emptyWorkspaceLocation',
  newfile: 'settings.browsing.newFileExtension',
  density: 'settings.browsing.density',
  foldersfirst: 'settings.browsing.foldersFirst',
  hidden: 'settings.browsing.showHidden',
  restore: 'settings.browsing.restoreSession',
  confirmtrash: 'settings.browsing.confirmTrash',
  columnwidth: 'settings.browsing.columnWidth',
  scrollback: 'settings.terminals.scrollback',
  thumbnails: 'settings.previews.thumbnailSize',
  imagepixels: 'settings.previews.maxImagePixels',
  modelmb: 'settings.previews.maxModelMB',
  termfont: 'settings.terminalFont.fontFamily',
  termfontsize: 'settings.terminalFont.fontSize',
  termweight: 'settings.terminalFont.fontWeight',
  termlinespace: 'settings.terminalFont.lineHeight',
  termletterspace: 'settings.terminalFont.letterSpacing',
  font: 'settings.editor.fontFamily',
  fontsize: 'settings.editor.fontSize',
  lineheight: 'settings.editor.lineHeight',
  tabstop: 'settings.editor.tabSize',
  ts: 'settings.editor.tabSize',
  expandtab: 'settings.editor.insertSpaces',
  et: 'settings.editor.insertSpaces',
  wrap: 'settings.editor.wordWrap',
  number: 'settings.editor.lineNumbers',
  nu: 'settings.editor.lineNumbers',
  trim: 'settings.editor.trimTrailingWhitespace',
  splitwith: 'settings.tiling.splitWith',
  tiling: 'settings.tiling.defaultLayout',
  dwell: 'settings.tour.dwell',
  flight: 'settings.tour.duration',
  tourloop: 'settings.tour.loop',
  pauseindex: 'settings.search.paused',
};
const byPath = new Map(settingCatalog.map((definition) => [definition.path, definition]));
/** A setting by its name or its path. */
export const settingByName = (name: string): SettingDefinition | undefined =>
  byPath.get(settingNames[name] ?? name);
/** The name a setting is shown by: its first short name, or its path. */
export function settingShortName(path: string): string {
  for (const [name, target] of Object.entries(settingNames)) if (target === path) return name;
  return path;
}

export type SetOperation =
  | { definition: SettingDefinition; op: 'on' | 'off' | 'toggle' | 'show' | 'default' }
  | { definition: SettingDefinition; op: 'value'; value: string | number | boolean }
  | { definition: SettingDefinition; op: 'add'; value: number };
const truths: Record<string, boolean> = {
  on: true,
  true: true,
  yes: true,
  '1': true,
  off: false,
  false: false,
  no: false,
  '0': false,
};
/** A value typed for a setting, checked against its kind, choices and range. */
export function settingInput(
  definition: SettingDefinition,
  text: string,
  at = 0,
): string | number | boolean {
  const name = settingShortName(definition.path);
  if (definition.kind === 'boolean') {
    const value = truths[text.toLowerCase()];
    if (value === undefined) throw new LineError(`${name} is on or off.`, at);
    return value;
  }
  if (definition.kind === 'choice') {
    const choice = (definition.choices ?? []).find(
      ([value, label]) =>
        value.toLowerCase() === text.toLowerCase() || label.toLowerCase() === text.toLowerCase(),
    );
    if (!choice || choice[0] === 'custom')
      throw new LineError(
        `${name} is one of ${(definition.choices ?? [])
          .filter(([value]) => value !== 'custom')
          .map(([value]) => value)
          .join(', ')}.`,
        at,
      );
    return choice[0];
  }
  if (definition.kind === 'color') {
    if (['', 'auto', 'none', 'default'].includes(text.toLowerCase())) return '';
    const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
    if (short)
      return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
    const long = /^#?([0-9a-f]{6})$/i.exec(text);
    if (long) return `#${long[1]!.toLowerCase()}`;
    throw new LineError(`${name} is a colour as #rrggbb, or auto.`, at);
  }
  const value = Number(text);
  if (!text.trim() || !Number.isFinite(value)) throw new LineError(`${name} is a number.`, at);
  if (definition.min !== undefined && value < definition.min)
    throw new LineError(`${name} is at least ${definition.min}.`, at);
  if (definition.max !== undefined && value > definition.max)
    throw new LineError(`${name} is at most ${definition.max}.`, at);
  return value;
}
/**
 * vim's `:set` forms, each word one change: `grid` (on, or shows a value), `nogrid`, `grid!` and
 * `invgrid` (toggle), `grid?` (show), `grid&` (default), `opacity=60`, `opacity+=10`, `opacity-=10`.
 */
export function parseSet(words: readonly Word[]): SetOperation[] {
  return words.map((word) => {
    const assignment = /^([A-Za-z0-9._]+)(\+=|-=|=|:)(.*)$/.exec(word.text);
    if (assignment) {
      const [, name, operator, input] = assignment;
      const definition = settingByName(name!);
      if (!definition) throw new LineError(`No setting “${name}”.`, word.at);
      if (operator === '+=' || operator === '-=') {
        if (definition.kind !== 'number') throw new LineError(`${name} is not a number.`, word.at);
        const step = Number(input);
        if (!Number.isFinite(step)) throw new LineError(`${input} is not a number.`, word.at);
        return { definition, op: 'add', value: operator === '+=' ? step : -step };
      }
      return { definition, op: 'value', value: settingInput(definition, input!, word.at) };
    }
    const form = /^([A-Za-z0-9._]+)([!?&<]?)$/.exec(word.text);
    if (!form) throw new LineError(`“${word.text}” is not a setting.`, word.at);
    const [, name, suffix] = form;
    let definition = settingByName(name!);
    let op: 'on' | 'off' | 'toggle' | 'show' | 'default' | undefined;
    if (!definition && !suffix && /^(no|inv)./.test(name!)) {
      const prefix = name!.startsWith('no') ? 'no' : 'inv';
      definition = settingByName(name!.slice(prefix.length));
      op = prefix === 'no' ? 'off' : 'toggle';
      if (definition && definition.kind !== 'boolean')
        throw new LineError(`${prefix} is for on/off settings.`, word.at);
    }
    if (!definition) throw new LineError(`No setting “${name}”.`, word.at);
    if (suffix === '!' && definition.kind !== 'boolean')
      throw new LineError(`! toggles on/off settings only.`, word.at);
    op ??=
      suffix === '!'
        ? 'toggle'
        : suffix === '?'
          ? 'show'
          : suffix === '&' || suffix === '<'
            ? 'default'
            : definition.kind === 'boolean'
              ? 'on'
              : 'show';
    return { definition, op };
  });
}
/** A setting's value as `:set name?` shows it. */
export function settingText(definition: SettingDefinition, value: unknown): string {
  const name = settingShortName(definition.path);
  if (definition.kind === 'boolean') return value ? name : 'no' + name;
  if (definition.kind === 'color') return `${name}=${value || 'auto'}`;
  return `${name}=${String(value)}`;
}
