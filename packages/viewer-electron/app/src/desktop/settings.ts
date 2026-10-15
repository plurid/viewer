import type { ParseError } from 'jsonc-parser';
import { pathMapper, type FileChange } from '../domain/changes';
import { preferencesSchema } from './preferences-schema';
import { settingCatalog } from '../domain/setting-catalog';
import path from 'node:path';
import { z } from 'zod';
import type { ApplicationSettings, SettingsPatch, SettingsSnapshot } from '../domain/services';
import { defaultSettings } from '../domain/services';
import { providerKinds } from '../domain/model-providers';
import type { UIPreferences, Pane, FolderPane } from '../domain/contracts';
import { normalizePreferences } from '../domain/preferences';
import {
  alternateShortcuts,
  defaultShortcuts,
  menuShortcuts,
  shortcutKey,
  validShortcut,
} from '../domain/shortcuts';
import fs from 'node:fs/promises';
import { JsoncConfiguration, configChanges, overlaps } from './configuration';
import {
  terminalProfileSchema,
  customActionSchema,
  folderOverrideSchema,
} from './automation-schema';
import { localPath, id } from './schemas';
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
    appearance: z.enum(['system', 'dark', 'light']),
    browsing: z
      .object({
        mode: z.enum(['list', 'grid', 'columns', 'gallery']),
        sort: z.enum(['name', 'modified', 'created', 'kind', 'extension', 'size']).default('name'),
        descending: z.boolean().default(false),
        group: z.enum(['none', 'kind', 'modified']).default('none'),
        columnWidth: z.number().int().min(160).max(1600).default(280),
        density: z.enum(['comfortable', 'compact']),
        foldersFirst: z.boolean(),
        showHidden: z.boolean(),
        restoreSession: z.boolean(),
        confirmTrash: z.boolean().default(true),
        newPlaneLocation: z
          .enum([
            'current',
            'home',
            'desktop',
            'documents',
            'downloads',
            'pictures',
            'movies',
            'music',
            'custom',
          ])
          .default('current'),
        newPlanePath: z.union([z.literal(''), localPath]).default(''),
        emptyWorkspaceLocation: z
          .enum([
            'home',
            'desktop',
            'documents',
            'downloads',
            'pictures',
            'movies',
            'music',
            'custom',
          ])
          .default('home'),
        emptyWorkspacePath: z.union([z.literal(''), localPath]).default(''),
      })
      .strict(),
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
    settingsWindow: z
      .object({
        width: z.number().min(760).max(2000),
        height: z.number().min(540).max(1600),
        category: z.string().max(40),
      })
      .strict(),
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
  constructor(
    private dataPath: string,
    home: string,
    private dark: () => boolean,
    private emit: (value: SettingsSnapshot) => void,
  ) {
    this.store = new JsoncConfiguration(dataPath, (value) => configSchema.parse(value));
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
      if (value) this.document = { ...value, revision: 0 };
      else if (this.store.diagnostics.length) {
        const recovery = await this.store.recovery();
        if (recovery) this.document = { ...recovery, revision: 0 };
      } else {
        this.seedPending = true;
        try {
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
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
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
      await this.store.schema(schema);
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
    return {
      revision: this.document.revision,
      settings: this.document.settings as ApplicationSettings,
      ui: this.document.ui,
      look:
        this.document.settings.appearance === 'system'
          ? this.dark()
            ? 'dark'
            : 'light'
          : this.document.settings.appearance,
      credentials,
      config: {
        path: this.store.file,
        diagnostics: this.store.diagnostics,
        changes: this.store.changes,
      },
    };
  }
  private async readChanges(): Promise<void> {
    const value = await this.store.read();
    if (!value) return;
    const { revision, ...before } = this.document;
    const changes = configChanges(before, value);
    if (!changes.length) return;
    this.document = { ...value, revision: revision + 1 };
    for (const change of changes)
      this.fields.set(JSON.stringify(change.keys), this.document.revision);
    this.emit(this.snapshot());
  }
  reload(): Promise<SettingsSnapshot> {
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        await this.load();
        await this.readChanges();
        this.emit(this.snapshot());
        return this.snapshot();
      });
    this.queue = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  patch(patches: SettingsPatch[], revision: number): Promise<SettingsSnapshot> {
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
    configSchema.parse(config);
    return {
      valid: true,
      changes: configChanges(this.document, next).map((change) => change.keys.join('.')),
    };
  }
  async exportConfiguration(file: string): Promise<void> {
    await fs.copyFile(this.store.file, file);
  }
  async importConfiguration(file: string): Promise<SettingsSnapshot> {
    const text = await fs.readFile(file, 'utf8');
    const errors: ParseError[] = [];
    const { parse } = await import('jsonc-parser');
    const config = configSchema.parse(parse(text, errors, { allowTrailingComma: true }));
    if (errors.length) throw new Error('Import contains invalid JSONC.');
    return this.patch(
      [
        { path: 'settings', value: config.settings },
        { path: 'ui', value: config.ui },
      ],
      this.document.revision,
    );
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
