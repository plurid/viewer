import { z } from 'zod';
import type { JSONValue } from '../../workspaces/project';
import { preferencesSchema } from './ui-schema';
import {
  appearanceSchema,
  browsingSchema,
  editorSchema,
  terminalFontSchema,
  tilingSchema,
  tourSchema,
  themeChoiceSchema,
} from './settings-schemas';

function prefixed<Prefix extends string, Fields extends Record<string, z.ZodType>>(
  prefix: Prefix,
  fields: Fields,
): { [Key in keyof Fields & string as `${Prefix}.${Key}`]: Fields[Key] } {
  return Object.fromEntries(
    Object.entries(fields).map(([key, schema]) => [`${prefix}.${key}`, schema]),
  ) as { [Key in keyof Fields & string as `${Prefix}.${Key}`]: Fields[Key] };
}

const { headerControls, ...space } = preferencesSchema.shape.space.shape;
const { visible, widths, ...list } = preferencesSchema.shape.list.shape;
const {
  restoreSession: _restoreSession,
  confirmTrash: _confirmTrash,
  ...browsing
} = browsingSchema.shape;

/** Every profile field is validated by the same schema as its shared preference. */
export const presentationFields = {
  ...prefixed('ui.sidebar', preferencesSchema.shape.sidebar.shape),
  ...prefixed('ui.titlebar', preferencesSchema.shape.titlebar.unwrap().shape),
  ...prefixed('ui.space', space),
  ...prefixed('ui.space.headerControls', headerControls.shape),
  ...prefixed('ui.list', list),
  ...prefixed('ui.list.visible', visible.shape),
  ...prefixed('ui.list.widths', widths.shape),
  'settings.appearance': appearanceSchema,
  ...prefixed('settings.browsing', browsing),
  ...prefixed('settings.editor', editorSchema.unwrap().shape),
  ...prefixed('settings.terminalFont', terminalFontSchema.unwrap().shape),
  ...prefixed('settings.tiling', tilingSchema.unwrap().shape),
  ...prefixed('settings.tour', tourSchema.unwrap().shape),
  ...prefixed('settings.theme', themeChoiceSchema.unwrap().shape),
} as const;

export type PresentationPath = keyof typeof presentationFields;
export type PresentationValues = Partial<{
  [Path in PresentationPath]: z.output<(typeof presentationFields)[Path]>;
}>;

export interface ProfileDiagnostic {
  code:
    | 'unknown-setting'
    | 'invalid-value'
    | 'shared-setting'
    | 'missing-profile'
    | 'reserved-id'
    | 'legacy-conflict';
  path: string;
  message: string;
  profileID?: string;
}

export interface CompiledPresentation {
  values: PresentationValues;
  diagnostics: ProfileDiagnostic[];
}

export const presentationPaths = Object.keys(presentationFields) as PresentationPath[];
const maximumExpandedFields = 128;
const reservedKeys = new Set(['__proto__', 'prototype', 'constructor']);

export function presentationPath(path: string): path is PresentationPath {
  return Object.hasOwn(presentationFields, path);
}

export function presentationValue(path: PresentationPath, value: unknown): JSONValue {
  return presentationFields[path].parse(value) as JSONValue;
}

/**
 * Legacy parent shorthand expands into known leaves. A malformed sibling makes
 * that shorthand invalid as a whole, and can never change a protected setting.
 */
export function compileProfileFields(
  values: Readonly<Record<string, unknown>>,
  fields: Readonly<Record<string, z.ZodType>>,
): { values: Record<string, JSONValue>; diagnostics: ProfileDiagnostic[] } {
  const diagnostics: ProfileDiagnostic[] = [];
  const normalized = new Map<string, JSONValue>();
  const paths = Object.keys(fields);
  const expand = (path: string, value: unknown): Map<string, JSONValue> | undefined => {
    if (path.split('.').some((key) => reservedKeys.has(key))) {
      diagnostics.push({
        code: 'unknown-setting',
        path,
        message: `${path}: unknown profile setting.`,
      });
      return;
    }
    if (Object.hasOwn(fields, path)) {
      const parsed = fields[path]!.safeParse(value);
      if (parsed.success && parsed.data !== undefined)
        return new Map([[path, parsed.data as JSONValue]]);
      diagnostics.push({
        code: 'invalid-value',
        path,
        message: `${path}: ${parsed.success ? 'a value is required.' : (parsed.error.issues[0]?.message ?? 'invalid value.')}`,
      });
      return;
    }
    const prefix = path + '.';
    const children = paths.some((field) => field.startsWith(prefix));
    if (children && value && typeof value === 'object' && !Array.isArray(value)) {
      const result = new Map<string, JSONValue>();
      let valid = true;
      for (const [key, next] of Object.entries(value)) {
        const entries = expand(`${path}.${key}`, next);
        if (!entries) valid = false;
        else for (const [field, item] of entries) result.set(field, item);
      }
      return valid ? result : undefined;
    }
    const code = children
      ? 'invalid-value'
      : path.startsWith('settings.')
        ? 'shared-setting'
        : 'unknown-setting';
    diagnostics.push({
      code,
      path,
      message: children
        ? `${path}: a group of profile settings is required.`
        : `${path}: this setting cannot be overridden by a window profile.`,
    });
  };
  // More specific entries win regardless of their order in imported JSON.
  const entries = Object.entries(values).sort(
    ([left], [right]) => left.split('.').length - right.split('.').length,
  );
  for (const [path, value] of entries) {
    const expanded = expand(path, value);
    if (!expanded) continue;
    for (const [field, next] of expanded) normalized.set(field, next);
    if (normalized.size > maximumExpandedFields) {
      diagnostics.push({
        code: 'invalid-value',
        path,
        message: 'The profile contains too many settings.',
      });
      return { values: {}, diagnostics };
    }
  }
  return { values: Object.fromEntries(normalized), diagnostics };
}

export function compilePresentationValues(
  values: Readonly<Record<string, unknown>>,
): CompiledPresentation {
  const result = compileProfileFields(values, presentationFields);
  return { ...result, values: result.values as PresentationValues };
}

export const presentationValuesSchema = z
  .record(z.string().max(200), z.json())
  .refine((values) => Object.keys(values).length <= 100, 'Too many profile entries.')
  .superRefine((values, context) => {
    for (const issue of compilePresentationValues(values).diagnostics)
      context.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
  });
