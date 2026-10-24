import { presentationValuesSchema } from '../../domain/preferences/presentation/profile-fields';
import { profileDiagnostics } from '../../domain/preferences/presentation/resolver';
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
import { bindingRows } from '../../domain/preferences/keymap';
import { findVerb, parseCommandLine } from '../../domain/command-line/verbs';
import type { ParseError } from 'jsonc-parser';
import { pathMapper, type FileChange } from '../../domain/files/changes';
import { preferencesSchema } from './preferences-schema';
import { keymapSchema } from './keymap-schema';
import { sequencesOnly } from '../../domain/automation/actions';
import { tileLayouts } from '../../domain/workspaces/tiling';
import { shellTokens, syntaxTokens, terminalTokens } from '../../domain/preferences/themes';
import { settingCatalog, workspaceMayChange } from '../../domain/preferences/catalog';
import path from 'node:path';
import { z } from 'zod';
import type { ApplicationSettings, SettingsPatch, SettingsSnapshot } from '../../domain/services';
import { defaultSettings } from '../../domain/services';
import { providerKinds } from '../../domain/models/providers';
import type { UIPreferences, Pane, FolderPane } from '../../domain/contracts';
import { normalizePreferences } from '../../domain/preferences/ui';
import {
  alternateShortcuts,
  defaultShortcuts,
  menuShortcuts,
  shortcutKey,
  validShortcut,
  validGlobalShortcut,
} from '../../domain/preferences/shortcuts';
import fs from 'node:fs/promises';
import { JsoncConfiguration, configChanges, overlaps } from './configuration';
import {
  terminalProfileSchema,
  customActionSchema,
  folderOverrideSchema,
} from '../actions/automation-schema';
import { localPath, id } from '../schemas';
import { referenceIssues } from '../../domain/automation/references';
import { modelDataLevels } from '../../domain/models/permissions';
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
/** A colour theme (2026-10-23): the shell's, the code's and the terminal's colours. */
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

function validateCustomProfiles(
  next: readonly SettingProfile[],
  previous: readonly SettingProfile[] = [],
): void {
  const earlier = new Map(previous.map((profile) => [profile.id, profile]));
  for (const profile of next) {
    if (JSON.stringify(profile) === JSON.stringify(earlier.get(profile.id))) continue;
    if (builtInProfileIDs.has(profile.id))
      throw new Error(`The profile ID “${profile.id}” is reserved for a built-in profile.`);
    profileSchema.parse(profile);
  }
}
/** A layout template (2026-10-23): planes by kind and folder, and their tiling. */
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
    // no longer used: the Settings window keeps its frame and category privately (2026-10-20);
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
      ['savedSearches', value.savedSearches],
      ['customActions', value.customActions],
      ['terminalProfiles', value.terminals.profiles],
    ] as const)
      if (new Set(items.map((item) => item.id)).size !== items.length)
        context.addIssue({ code: 'custom', path: [key], message: 'IDs must be unique.' });
    // a command's name runs one sequence (2026-10-23)
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
/** What an import changes that Viewer may run, reach or send: confirmed before it applies (2026-10-20). */
export function importChanges(current: ApplicationSettings, next: ApplicationSettings): string[] {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const programs = (settings: ApplicationSettings) =>
    settings.customActions.filter(({ executor }) =>
      ['shell', 'executable'].includes(executor.kind),
    );
  return [
    !same(current.agents, next.agents) &&
      'agent access (turning agents on or adding folders still waits for your approval in Settings → Agents)',
    !same(current.providers, next.providers) && 'model providers and their addresses',
    !same(programs(current), programs(next)) && 'actions that run programs or shell scripts',
    !same(current.terminals, next.terminals) && 'terminal profiles and programs',
    !same(riskyLines(current), riskyLines(next)) &&
      'keys and sequences that type into terminals, move files to the Trash, rename them or drop unsaved text',
  ].filter((change): change is string => !!change);
}
/**
 * Lines of keys and sequences that act beyond the window (2026-10-23): typing into a terminal,
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
/**
 * What the workspace window changes: its own preferences and views. It could patch any setting, so a
 * compromised workspace renderer could widen agent folders, add a provider or an action (2026-10-20);
 * the rest is changed in Settings.
 */
// the workspace window's own view and presentation: domain/preferences/catalog.ts
const workspaceMayPatch = workspaceMayChange;
const configSchema = z
  .object({
    $schema: z.literal('config.schema.json').default('config.schema.json'),
    version: z.literal(1),
    settings: settingsSchema,
    ui: preferencesSchema,
  })
  .strict();
export class SettingsService {
  private document: z.infer<typeof configSchema> & { revision: number };
  private fields = new Map<string, number>();
  private queue: Promise<void> = Promise.resolve();
  private store: JsoncConfiguration<z.infer<typeof configSchema>>;
  private loaded?: Promise<void>;
  private seedPending = false;
  private profilesReady = false;
  /** The copy in effect while config.jsonc cannot be read: its last valid copy, or the defaults. */
  private fallback?: 'last-valid' | 'defaults';
  private restored?: string;
  constructor(
    private dataPath: string,
    home: string,
    private dark: () => boolean,
    private emit: (value: SettingsSnapshot) => void,
  ) {
    this.store = new JsoncConfiguration(dataPath, (value) => {
      const parsed = configSchema.parse(value);
      if (this.profilesReady)
        validateCustomProfiles(parsed.settings.profiles, this.document.settings.profiles);
      return parsed;
    });
    this.document = {
      $schema: 'config.schema.json',
      version: 1,
      revision: 0,
      settings: defaultSettings(home),
      ui: normalizePreferences(),
    };
  }
  /** `seed` carries interface preferences kept with workspace state, for a first configuration. */
  async load(seed?: { ui?: UIPreferences; look: 'dark' | 'light' }): Promise<void> {
    this.loaded ??= (async () => {
      await fs.mkdir(this.dataPath, { recursive: true, mode: 0o700 });
      const value = await this.store.read();
      const last = value || this.store.diagnostics.length ? {} : await this.store.lastValid();
      if (value) this.document = { ...value, revision: 0 };
      else if (this.store.diagnostics.length) {
        const recovery = await this.store.recovery();
        if (recovery) this.document = { ...recovery, revision: 0 };
        this.fallback = recovery ? 'last-valid' : 'defaults';
      } else if (last.value) {
        // config.jsonc is missing and its last valid copy is not: the file was removed. The copy is
        // the person's settings; a removed file was a first run, which wrote the defaults over the
        // last valid copy too (2026-10-20).
        this.document = { ...last.value, revision: 0 };
        this.restored = 'config.jsonc was missing: Viewer restored it from its last valid copy.';
        await this.write();
      } else {
        this.seedPending = true;
        // never replace a copy that was not read: it is kept under a name of its own
        if (last.unreadable) await this.store.keepUnreadableLastValid();
        // settings-v1 is migrated once: its backup says it was, and then it is older than whatever
        // config.jsonc held since (it came back whenever config.jsonc went missing)
        const migrated = await fs
          .access(path.join(this.dataPath, 'settings-v1.migration-backup.json'))
          .then(
            () => true,
            () => false,
          );
        try {
          if (migrated)
            throw Object.assign(new Error('settings-v1 was migrated before.'), { code: 'ENOENT' });
          const text = await fs.readFile(path.join(this.dataPath, 'settings-v1.json'), 'utf8');
          const prior = JSON.parse(text);
          await fs
            .writeFile(path.join(this.dataPath, 'settings-v1.migration-backup.json'), text, {
              flag: 'wx',
              mode: 0o600,
            })
            .catch((error: NodeJS.ErrnoException) => {
              if (error.code !== 'EEXIST') throw error;
            });
          this.document = {
            ...configSchema.parse({
              version: 1,
              settings: prior.settings,
              ui: normalizePreferences(prior.ui),
            }),
            revision: prior.revision || 0,
          };
        } catch (error) {
          // An unreadable earlier file stays where it is and settings start from the defaults;
          // rethrown, it kept Viewer from starting at all.
          if (
            !(error instanceof SyntaxError || error instanceof z.ZodError) &&
            (error as NodeJS.ErrnoException).code !== 'ENOENT'
          )
            throw error;
          if (seed) {
            this.document.ui = normalizePreferences(seed.ui);
            this.document.settings.appearance = seed.look;
          }
        }
        await this.write();
      }
      // Generate the schema from the same declarations used by Settings and IPC.
      const schema = z.toJSONSchema(configSchema, { unrepresentable: 'any' });
      for (const field of settingCatalog) {
        let object = schema as Record<string, unknown>;
        for (const key of field.path.split('.'))
          object =
            (object.properties as Record<string, Record<string, unknown>> | undefined)?.[key] || {};
        object.title = field.label;
        if (field.detail) object.description = field.detail;
      }
      const settingsProperties = (
        schema.properties as
          Record<string, { properties?: Record<string, Record<string, unknown>> }> | undefined
      )?.settings?.properties;
      if (settingsProperties?.profiles)
        settingsProperties.profiles.items = z.toJSONSchema(profileSchema, {
          unrepresentable: 'any',
        });
      await this.store.schema(schema);
      this.profilesReady = true;
      this.store.watch(() => {
        void this.reload().catch(() => {});
      });
    })();
    await this.loaded;
  }
  private write(): Promise<void> {
    const { revision: _revision, ...config } = this.document;
    return this.store.write(config);
  }
  snapshot(credentials: string[] = []): SettingsSnapshot {
    const systemLook = this.dark() ? 'dark' : 'light';
    return {
      revision: this.document.revision,
      settings: this.document.settings as ApplicationSettings,
      ui: this.document.ui,
      look:
        this.document.settings.appearance === 'system'
          ? systemLook
          : this.document.settings.appearance,
      credentials,
      systemLook,
      config: {
        path: this.store.file,
        diagnostics: this.store.diagnostics,
        changes: this.store.changes,
        ...(this.store.missing ? { missing: true } : {}),
        ...(this.restored ? { restored: this.restored } : {}),
        ...(this.fallback && this.store.diagnostics.length ? { fallback: this.fallback } : {}),
        warnings: [
          ...referenceIssues(this.document.settings as ApplicationSettings),
          ...profileDiagnostics(this.document.settings.profiles).map((issue) => issue.message),
        ],
      },
    };
  }
  /** `true` when it announced a change. */
  private async readChanges(): Promise<boolean> {
    const value = await this.store.read();
    if (!value) return false;
    const { revision, ...before } = this.document;
    const changes = configChanges(before, value);
    if (!changes.length) return false;
    this.document = { ...value, revision: revision + 1 };
    for (const change of changes)
      this.fields.set(JSON.stringify(change.keys), this.document.revision);
    this.emit(this.snapshot());
    return true;
  }
  reload(): Promise<SettingsSnapshot> {
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        await this.load();
        // the diagnostics of a file that could not be read are announced here; a change, once (it was
        // announced by the read and again here, 2026-10-20)
        if (!(await this.readChanges())) this.emit(this.snapshot());
        return this.snapshot();
      });
    this.queue = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  patch(
    patches: SettingsPatch[],
    revision: number,
    scope?: 'workspace',
  ): Promise<SettingsSnapshot> {
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        await this.load();
        await this.readChanges();
        if (this.store.diagnostics.length) throw new Error(this.store.diagnostics[0]);
        const next = structuredClone(this.document);
        for (const patch of patches) {
          const keys = patch.keys || patch.path.split('.');
          if (
            !['settings', 'ui'].includes(keys[0] ?? '') ||
            keys.some((key) => ['__proto__', 'prototype', 'constructor'].includes(key))
          )
            throw new Error('Unknown setting.');
          // Record macro saves a command sequence from the workspace: checked once the result is known
          const macros = keys[0] === 'settings' && keys[1] === 'customActions';
          if (scope === 'workspace' && !workspaceMayPatch(keys) && !macros)
            throw new Error('Change this setting in Settings.');
          if (
            [...this.fields].some(
              ([field, changed]) => changed > revision && overlaps(JSON.parse(field), keys),
            )
          )
            throw new Error(
              'This setting changed in another window or config.jsonc. Review its current value.',
            );
          let object = next as unknown as Record<string, unknown>;
          for (const key of keys.slice(0, -1)) {
            if (!object[key] && keys[1] === 'folders') object[key] = {};
            if (!object[key] || typeof object[key] !== 'object' || Array.isArray(object[key]))
              throw new Error('Unknown setting.');
            object = object[key] as Record<string, unknown>;
          }
          const key = keys.at(-1)!;
          if (!Object.hasOwn(object, key) && keys[1] !== 'folders')
            throw new Error('Unknown setting.');
          if (patch.value === undefined || (patch.value === null && keys[1] === 'folders'))
            delete object[key];
          else object[key] = patch.value;
        }
        const { revision: _revision, ...config } = next;
        const validated = configSchema.parse(config);
        validateCustomProfiles(validated.settings.profiles, this.document.settings.profiles);
        if (
          scope === 'workspace' &&
          !sequencesOnly(this.document.settings.customActions, validated.settings.customActions)
        )
          throw new Error('Change this setting in Settings.');
        // a whole browsing section from the workspace keeps the person's Trash confirmation
        if (
          scope === 'workspace' &&
          validated.settings.browsing.confirmTrash !== this.document.settings.browsing.confirmTrash
        )
          throw new Error('Change this setting in Settings.');
        await this.store.write(validated);
        this.document = { ...validated, revision: this.document.revision + 1 };
        for (const patch of patches)
          this.fields.set(
            JSON.stringify(patch.keys || patch.path.split('.')),
            this.document.revision,
          );
        const result = this.snapshot();
        this.emit(result);
        return result;
      });
    this.queue = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  preview(patches: SettingsPatch[]): { valid: true; changes: string[] } {
    const next = structuredClone(this.document) as unknown as Record<string, unknown>;
    for (const patch of patches) {
      const keys = patch.keys || patch.path.split('.');
      if (
        !['settings', 'ui'].includes(keys[0] ?? '') ||
        keys.some((key) => ['__proto__', 'prototype', 'constructor'].includes(key))
      )
        throw new Error('Unknown setting.');
      let object = next;
      for (const key of keys.slice(0, -1)) {
        if (!object[key] && keys[1] === 'folders') object[key] = {};
        if (!object[key] || typeof object[key] !== 'object' || Array.isArray(object[key]))
          throw new Error('Unknown setting.');
        object = object[key] as Record<string, unknown>;
      }
      const key = keys.at(-1)!;
      if (!Object.hasOwn(object, key) && keys[1] !== 'folders') throw new Error('Unknown setting.');
      if (patch.value === undefined || (patch.value === null && keys[1] === 'folders'))
        delete object[key];
      else object[key] = patch.value;
    }
    const { revision: _revision, ...config } = next;
    const parsed = configSchema.parse(config);
    validateCustomProfiles(parsed.settings.profiles, this.document.settings.profiles);
    // An agent edits a recipe, not what binds it to the person: its shortcut, its model provider,
    // or more data than it sent. A whole-recipes patch carried them (2026-10-20).
    const recipes = new Map(this.document.settings.recipes.map((recipe) => [recipe.id, recipe]));
    for (const recipe of parsed.settings.recipes) {
      const before = recipes.get(recipe.id);
      if (
        (recipe.shortcut || '') !== (before?.shortcut || '') ||
        (recipe.providerID ?? '') !== (before?.providerID ?? '') ||
        (before && modelDataLevels.indexOf(recipe.data) > modelDataLevels.indexOf(before.data))
      )
        throw new Error(
          `A recipe’s shortcut, model provider and data stay with you: change “${recipe.name}” in Settings → Actions.`,
        );
    }
    // an agent's change may leave an earlier reference to a missing item; it may not add one
    const earlier = new Set(referenceIssues(this.document.settings as ApplicationSettings));
    const added = referenceIssues(parsed.settings as ApplicationSettings).filter(
      (issue) => !earlier.has(issue),
    );
    if (added.length) throw new Error(added.join(' '));
    return {
      valid: true,
      changes: configChanges(this.document, next).map((change) => change.keys.join('.')),
    };
  }
  /** Writes a removed config.jsonc back from the settings in effect (a no-op while it is there). */
  restoreConfiguration(): Promise<SettingsSnapshot> {
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        await this.load();
        await this.readChanges();
        if (this.store.missing) await this.write();
        const result = this.snapshot();
        this.emit(result);
        return result;
      });
    this.queue = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  async exportConfiguration(file: string): Promise<void> {
    await fs.copyFile(this.store.file, file);
  }
  /** `confirm` is asked first when the import changes what Viewer may run, reach or send. */
  async importConfiguration(
    file: string,
    confirm?: (changes: string[]) => Promise<boolean>,
  ): Promise<SettingsSnapshot> {
    const text = await fs.readFile(file, 'utf8');
    const errors: ParseError[] = [];
    const { parse } = await import('jsonc-parser');
    const config = configSchema.parse(parse(text, errors, { allowTrailingComma: true }));
    if (errors.length) throw new Error('Import contains invalid JSONC.');
    validateCustomProfiles(config.settings.profiles);
    await this.load();
    const changes = importChanges(
      this.document.settings as ApplicationSettings,
      config.settings as ApplicationSettings,
    );
    if (changes.length && confirm && !(await confirm(changes)))
      throw new Error('The import was cancelled. Nothing changed.');
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        const value = await this.store.replace(text);
        const { revision, ...before } = this.document;
        this.document = { ...value, revision: revision + 1 };
        this.fallback = undefined;
        for (const change of configChanges(before, value))
          this.fields.set(JSON.stringify(change.keys), this.document.revision);
        const result = this.snapshot();
        this.emit(result);
        return result;
      });
    this.queue = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  async remapFolders(changes: readonly FileChange[]): Promise<void> {
    await this.load();
    await this.flush();
    const map = pathMapper(changes);
    const snapshot = this.snapshot();
    const folders = Object.fromEntries(
      Object.entries(snapshot.settings.folders).map(([folder, value]) => [map(folder), value]),
    );
    if (JSON.stringify(folders) !== JSON.stringify(snapshot.settings.folders))
      await this.patch([{ path: 'settings.folders', value: folders }], snapshot.revision);
  }
  async seedFolders(panes: Pane[]): Promise<void> {
    await this.load();
    if (!this.seedPending) return;
    this.seedPending = false;
    if (Object.keys(this.document.settings.folders).length) return;
    const folders = Object.fromEntries(
      panes
        .filter((pane): pane is FolderPane => pane.type === 'folder')
        .map((pane) => [
          pane.path,
          {
            mode: pane.mode,
            sort: pane.sort,
            descending: pane.descending,
            showHidden: pane.showHidden,
          },
        ]),
    );
    if (Object.keys(folders).length)
      await this.patch([{ path: 'settings.folders', value: folders }], this.document.revision);
  }
  announce(): void {
    this.emit(this.snapshot());
  }
  async flush(): Promise<void> {
    await this.queue;
  }
  close(): void {
    this.store.close();
  }
}
