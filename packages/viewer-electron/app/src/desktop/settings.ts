import path from 'node:path';
import { z } from 'zod';
import type { ApplicationSettings, SettingsPatch, SettingsSnapshot } from '../domain/services';
import { defaultSettings } from '../domain/services';
import type { UIPreferences } from '../domain/contracts';
import { normalizePreferences } from '../domain/preferences';
import { defaultShortcuts, shortcutKey, validShortcut } from '../domain/shortcuts';
import { DocumentStore } from './document-store';
const localPath = z
  .string()
  .max(32768)
  .refine((value) => path.isAbsolute(value) && !value.includes('\0'));
const id = z.string().min(1).max(200);
const recipe = z.object({
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
});
export const settingsSchema = z
  .object({
    appearance: z.enum(['system', 'dark', 'light']),
    browsing: z.object({
      mode: z.enum(['list', 'grid', 'columns', 'gallery']),
      density: z.enum(['comfortable', 'compact']),
      foldersFirst: z.boolean(),
      showHidden: z.boolean(),
      restoreSession: z.boolean(),
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
    }),
    previews: z.object({
      thumbnailSize: z.number().int().min(128).max(512),
      maxImagePixels: z.number().int().min(1000000).max(128000000),
      maxModelMB: z.number().int().min(16).max(512),
    }),
    search: z.object({
      roots: z.array(localPath).max(100),
      exclusions: z.array(z.string().min(1).max(32768)).max(200),
      contentRoots: z.array(localPath).max(100),
      paused: z.boolean(),
    }),
    providers: z
      .array(
        z.object({
          id,
          name: z.string().min(1).max(100),
          kind: z.enum(['openai', 'anthropic', 'local']),
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
        }),
      )
      .max(20),
    recipes: z.array(recipe).max(100),
    agents: z.object({
      enabled: z.boolean(),
      roots: z.array(localPath).max(100),
      allowLayout: z.boolean(),
    }),
    shortcuts: z.record(z.string().max(200), z.string().max(80)),
    savedSearches: z
      .array(
        z.object({
          id,
          name: z.string().min(1).max(100),
          query: z.string().min(1).max(300),
          root: localPath.optional(),
          recursive: z.boolean().optional(),
          content: z.boolean().optional(),
        }),
      )
      .max(100),
    settingsWindow: z.object({
      width: z.number().min(760).max(2000),
      height: z.number().min(540).max(1600),
      category: z.string().max(40),
    }),
  })
  .superRefine((value, context) => {
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
    ] as const)
      if (new Set(items.map((item) => item.id)).size !== items.length)
        context.addIssue({ code: 'custom', path: [key], message: 'IDs must be unique.' });
    const shortcuts = [
      ...Object.values({ ...defaultShortcuts, ...value.shortcuts }),
      ...value.recipes.map((item) => item.shortcut || ''),
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
        [...item.template.matchAll(/\{([^{}]+)\}/g)].some((match) => !fields.includes(match[1]))
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
const documentSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().min(0),
  settings: settingsSchema,
  ui: z.unknown().transform(normalizePreferences),
});
export class SettingsService {
  private document: z.infer<typeof documentSchema>;
  private fields = new Map<string, number>();
  private queue: Promise<void> = Promise.resolve();
  private store: DocumentStore<z.infer<typeof documentSchema>>;
  private loaded?: Promise<void>;
  constructor(
    dataPath: string,
    home: string,
    private dark: () => boolean,
    private emit: (value: SettingsSnapshot) => void,
  ) {
    this.store = new DocumentStore(path.join(dataPath, 'settings-v1.json'), (value) =>
      documentSchema.parse(value),
    );
    this.document = {
      version: 1,
      revision: 0,
      settings: defaultSettings(home),
      ui: normalizePreferences(),
    };
  }
  async load(legacy?: { ui?: UIPreferences; look: 'dark' | 'light' }): Promise<void> {
    this.loaded ??= this.store.load().then((value) => {
      if (value) this.document = value;
      else if (legacy) {
        this.document.ui = normalizePreferences(legacy.ui);
        this.document.settings.appearance = legacy.look;
      }
    });
    await this.loaded;
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
    };
  }
  patch(patches: SettingsPatch[], revision: number): Promise<SettingsSnapshot> {
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        await this.load();
        const next = structuredClone(this.document);
        for (const patch of patches) {
          if (
            [...this.fields].some(
              ([field, changed]) =>
                changed > revision &&
                (field === patch.path ||
                  field.startsWith(patch.path + '.') ||
                  patch.path.startsWith(field + '.')),
            )
          )
            throw new Error('This setting changed in another window. Review its current value.');
          const keys = patch.path.split('.');
          if (
            !['settings', 'ui'].includes(keys[0]) ||
            keys.some((key) => ['__proto__', 'prototype', 'constructor'].includes(key))
          )
            throw new Error('Unknown setting.');
          let object = next as unknown as Record<string, unknown>;
          for (const key of keys.slice(0, -1)) {
            if (!object[key] || typeof object[key] !== 'object' || Array.isArray(object[key]))
              throw new Error('Unknown setting.');
            object = object[key] as Record<string, unknown>;
          }
          if (!Object.hasOwn(object, keys.at(-1)!)) throw new Error('Unknown setting.');
          object[keys.at(-1)!] = patch.value;
        }
        next.revision++;
        const validated = documentSchema.parse(next);
        await this.store.save(validated);
        this.document = validated;
        patches.forEach((patch) => this.fields.set(patch.path, validated.revision));
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
  announce(): void {
    this.emit(this.snapshot());
  }
  async flush(): Promise<void> {
    await this.queue;
    await this.store.flush();
  }
}
