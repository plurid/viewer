import { presentationValuesSchema } from '../../domain/preferences/presentation/profile-fields';
import { toolbarsSchema } from '../../domain/preferences/toolbars';
import { builtInProfileIDs, type SettingProfile } from '../../domain/preferences/profiles';
import {
  appearanceSchema,
  browsingSchema,
  editorSchema,
  terminalFontSchema,
  tilingSchema,
  tourSchema,
  themeChoiceSchema,
} from '../../domain/preferences/presentation/settings-schemas';
import { keymapSchema } from './keymap-schema';
import { tileLayouts } from '../../domain/workspaces/tiling';
import { shellTokens, syntaxTokens, terminalTokens } from '../../domain/preferences/themes';
import { z } from 'zod';
import { sameJSON } from '../../domain/json';
import { providerKinds } from '../../domain/models/providers';
import {
  alternateShortcuts,
  defaultShortcuts,
  menuShortcuts,
  shortcutKey,
  validShortcut,
  validGlobalShortcut,
} from '../../domain/preferences/shortcuts';
import {
  terminalProfileSchema,
  customActionSchema,
  folderOverrideSchema,
} from '../actions/automation-schema';
import { localPath, id } from '../schemas';
import { optimizationRecipeSchema } from '../../domain/operations/optimization';
const recipe = z
  .object({
    id,
    name: z.string().min(1).max(100),
    kind: z.enum(['batch-rename', 'book-name', 'rename', 'organize', 'summarize']),
    formats: z.array(z.string().max(20)).max(100),
    recursive: z.boolean(),
    instructions: z.string().max(12000),
    template: z.string().max(1000),
    providerID: id.optional(),
    data: z.enum(['names', 'excerpts', 'full-text']),
    shortcut: z.string().max(80).optional(),
  })
  .strict();
const templatePath = z
  .string()
  .max(4096)
  .refine((value) => !value.includes('\0'));
/** A colour as themes keep it: `#rgb`, `#rrggbb` or `#rrggbbaa`. */
const themeColorSchema = z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
/** A colour theme: the shell's, the code's and the terminal's colours. */
export const themeSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(100),
    name: z.string().min(1).max(100),
    look: z.enum(['dark', 'light']),
    shell: z.partialRecord(z.enum(shellTokens), themeColorSchema),
    syntax: z.partialRecord(z.enum(syntaxTokens), themeColorSchema),
    terminal: z.partialRecord(z.enum(terminalTokens), themeColorSchema),
    metrics: z
      .object({
        fontFamily: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .refine((value) => !/[;{}\x00-\x1f]/.test(value)),
        density: z.enum(['compact', 'comfortable']),
        radius: z.number().finite().min(0).max(16),
      })
      .partial()
      .strict()
      .optional(),
  })
  .strict();
/** Raw profile definitions remain readable so an older malformed entry can be repaired. */
const storedProfileSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(100),
    name: z.string().min(1).max(100),
    values: z
      .record(z.string().max(200), z.json())
      .refine((values) => Object.keys(values).length <= 100),
  })
  .strict();

/** New/edited profiles must contain only validated window-local settings. */
export const profileSchema = storedProfileSchema.extend({ values: presentationValuesSchema });

export function validateCustomProfiles(
  next: readonly SettingProfile[],
  previous: readonly SettingProfile[] = [],
): void {
  const earlier = new Map(previous.map((profile) => [profile.id, profile]));
  for (const profile of next) {
    if (sameJSON(profile, earlier.get(profile.id))) continue;
    if (builtInProfileIDs.has(profile.id))
      throw new Error(`The profile ID “${profile.id}” is reserved for a built-in profile.`);
    profileSchema.parse(profile);
  }
}
/** A layout template: planes by kind and folder, and their tiling. */
export const layoutTemplateSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(100),
    name: z.string().min(1).max(100),
    planes: z
      .array(
        z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('folder'), path: templatePath }).strict(),
          z.object({ kind: z.literal('file'), path: templatePath }).strict(),
          z
            .object({
              kind: z.literal('terminal'),
              path: templatePath,
              profileID: z.string().max(200).optional(),
            })
            .strict(),
          z.object({ kind: z.literal('scratch') }).strict(),
          z
            .object({
              kind: z.literal('search'),
              query: z.string().max(300),
              name: z.string().min(1).max(100),
              root: templatePath.optional(),
              recursive: z.boolean().optional(),
              content: z.boolean().optional(),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(30),
    layout: z.enum(tileLayouts),
    main: z.number().min(0.2).max(0.8),
  })
  .strict();
export const settingsSchema = z
  .object({
    toolbars: toolbarsSchema,
    checkpoints: z
      .object({
        budgetBytes: z
          .number()
          .int()
          .min(0)
          .max(1024 ** 4),
      })
      .strict()
      .default({ budgetBytes: 5 * 1024 ** 3 }),
    appearance: appearanceSchema,
    browsing: browsingSchema,
    folders: z.record(localPath, folderOverrideSchema).default({}),
    fileOpening: z
      .object({
        default: z.enum(['automatic', 'plane', 'native']),
        types: z.record(z.string().max(30), z.enum(['plane', 'native'])),
      })
      .strict()
      .default({
        default: 'automatic',
        types: {
          doc: 'native',
          docx: 'native',
          xls: 'native',
          xlsx: 'native',
          ppt: 'native',
          pptx: 'native',
        },
      }),
    customActions: z.array(customActionSchema).max(200).default([]),
    terminals: z
      .object({
        application: z.string().max(32768),
        profileID: id,
        profiles: z.array(terminalProfileSchema).min(1).max(30),
        scrollback: z.number().int().min(100).max(50000),
        tmux: z
          .object({
            executable: z.string().min(1).max(32768),
            session: z
              .string()
              .regex(/^[A-Za-z0-9_-]+$/)
              .max(100),
            socket: z.string().max(32768),
            windowName: z.string().max(100),
          })
          .strict(),
      })
      .strict()
      .default({
        application: 'auto',
        profileID: 'login',
        profiles: [{ id: 'login', name: 'Login shell', executable: '', args: ['-l'], env: {} }],
        scrollback: 10000,
        tmux: { executable: 'tmux', session: 'viewer', socket: '', windowName: '{folder}' },
      }),
    previews: z
      .object({
        thumbnailSize: z.number().int().min(128).max(512),
        maxImagePixels: z.number().int().min(1000000).max(128000000),
        maxModelMB: z.number().int().min(16).max(512),
        textFontSize: z.number().int().min(8).max(32).default(16),
        textLineHeight: z.number().int().min(12).max(64).default(20),
        textWordWrap: z.boolean().default(false),
      })
      .strict(),
    editor: editorSchema,
    terminalFont: terminalFontSchema,
    tiling: tilingSchema,
    prompts: z
      .object({ providerID: z.string().max(200).default('') })
      .strict()
      .default({ providerID: '' }),
    git: z
      .object({ enabled: z.boolean().default(false) })
      .strict()
      .default({ enabled: false }),
    hotkey: z
      .object({
        enabled: z.boolean().default(false),
        shortcut: z.string().min(1).max(80).refine(validGlobalShortcut).default('Alt+Space'),
      })
      .strict()
      .default({ enabled: false, shortcut: 'Alt+Space' }),
    quit: z
      .object({ warnShortcut: z.boolean().default(true) })
      .strict()
      .default({ warnShortcut: true }),
    themes: z
      .array(themeSchema)
      .max(30)
      .refine(
        (themes) => new Set(themes.map((item) => item.id)).size === themes.length,
        'Theme IDs must be unique.',
      )
      .default([]),
    theme: themeChoiceSchema,
    profiles: z
      .array(storedProfileSchema)
      .max(30)
      .refine(
        (profiles) => new Set(profiles.map((item) => item.id)).size === profiles.length,
        'Profile IDs must be unique.',
      )
      .default([]),
    layouts: z
      .array(layoutTemplateSchema)
      .max(50)
      .refine(
        (layouts) => new Set(layouts.map((item) => item.id)).size === layouts.length,
        'Layout IDs must be unique.',
      )
      .default([]),
    tour: tourSchema,
    search: z
      .object({
        roots: z.array(localPath).max(100),
        exclusions: z.array(z.string().min(1).max(32768)).max(200),
        contentRoots: z.array(localPath).max(100),
        paused: z.boolean(),
      })
      .strict(),
    providers: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1).max(100),
            kind: z.enum(providerKinds),
            endpoint: z
              .string()
              .url()
              .max(2000)
              .refine((value) => {
                const url = new URL(value);
                return (
                  !url.username &&
                  !url.password &&
                  (url.protocol === 'https:' ||
                    (url.protocol === 'http:' &&
                      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
                );
              }),
            model: z.string().max(200),
            allowContent: z.boolean(),
          })
          .strict(),
      )
      .max(20),
    recipes: z.array(recipe).max(100),
    optimizationRecipes: z.array(optimizationRecipeSchema).max(100).default([]),
    agents: z
      .object({
        enabled: z.boolean(),
        roots: z.array(localPath).max(100),
        allowLayout: z.boolean(),
      })
      .strict(),
    shortcuts: z.record(z.string().max(200), z.string().max(80)),
    keymap: keymapSchema,
    savedSearches: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1).max(100),
            query: z.string().min(1).max(300),
            root: localPath.optional(),
            recursive: z.boolean().optional(),
            content: z.boolean().optional(),
          })
          .strict(),
      )
      .max(100),
    // no longer used: the Settings window keeps its frame and category privately;
    // accepted so existing files stay valid
    settingsWindow: z
      .object({
        width: z.number().min(760).max(2000),
        height: z.number().min(540).max(1600),
        category: z.string().max(40),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.browsing.emptyWorkspaceLocation === 'custom' && !value.browsing.emptyWorkspacePath)
      context.addIssue({
        code: 'custom',
        path: ['browsing', 'emptyWorkspacePath'],
        message: 'Choose the folder to open in an empty workspace.',
      });
    if (value.browsing.newPlaneLocation === 'custom' && !value.browsing.newPlanePath)
      context.addIssue({
        code: 'custom',
        path: ['browsing', 'newPlanePath'],
        message: 'Choose the folder to open in new planes.',
      });
    for (const [key, items] of [
      ['providers', value.providers],
      ['recipes', value.recipes],
      ['optimizationRecipes', value.optimizationRecipes],
      ['savedSearches', value.savedSearches],
      ['customActions', value.customActions],
      ['terminalProfiles', value.terminals.profiles],
    ] as const)
      if (new Set(items.map((item) => item.id)).size !== items.length)
        context.addIssue({ code: 'custom', path: [key], message: 'IDs must be unique.' });
    // a command's name runs one sequence
    const named = value.customActions.flatMap((action) =>
      action.executor.kind === 'sequence' && action.executor.command
        ? [action.executor.command]
        : [],
    );
    if (new Set(named).size !== named.length)
      context.addIssue({
        code: 'custom',
        path: ['customActions'],
        message: 'Two sequences have the same command name.',
      });
    if (!value.terminals.profiles.some((profile) => profile.id === value.terminals.profileID))
      context.addIssue({
        code: 'custom',
        path: ['terminals', 'profileID'],
        message: 'Choose an existing terminal profile.',
      });
    const shortcuts = [
      ...Object.values({ ...defaultShortcuts, ...menuShortcuts, ...value.shortcuts }),
      ...Object.values(alternateShortcuts),
      ...value.recipes.map((item) => item.shortcut || ''),
      ...value.customActions.map((item) => item.shortcut || ''),
      // the prefix starts a sequence: no shortcut may share it
      value.keymap.prefix,
    ].filter(Boolean);
    if (shortcuts.some((shortcut) => !validShortcut(shortcut)))
      context.addIssue({
        code: 'custom',
        message: 'Use Cmd or Ctrl plus a key, with optional Alt and Shift.',
      });
    const normalized = shortcuts.map(shortcutKey);
    for (const item of value.recipes) {
      const fields =
        item.kind === 'batch-rename'
          ? ['name', 'extension', 'number']
          : item.kind === 'book-name'
            ? ['year', 'authors', 'title', 'publisher', 'extension']
            : [];
      if (
        fields.length &&
        [...item.template.matchAll(/\{([^{}]+)\}/g)].some(
          (match) => !fields.includes(match[1] ?? ''),
        )
      )
        context.addIssue({
          code: 'custom',
          path: ['recipes'],
          message: 'The filename template contains an unknown field.',
        });
    }
    if (new Set(normalized).size !== normalized.length)
      context.addIssue({
        code: 'custom',
        message: 'A shortcut is assigned to more than one action.',
      });
  });
